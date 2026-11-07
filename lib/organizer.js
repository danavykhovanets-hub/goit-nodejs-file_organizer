import { EventEmitter } from 'events';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { listFiles, LARGE_FILE_SIZE } from './utils.js';

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

export function getCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(ext)) return category;
  }
  return 'Other';
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * file.pdf → file(1).pdf → file(2).pdf ... поки не знайдемо вільну назву.
 */
async function getUniquePath(targetPath) {
  const { dir, name, ext } = path.parse(targetPath);
  let candidate = targetPath;
  let counter = 1;

  while (await exists(candidate)) {
    candidate = path.join(dir, `${name}(${counter})${ext}`);
    counter++;
  }
  return candidate;
}

async function copyFile(source, target, size) {
  if (size >= LARGE_FILE_SIZE) {
    // Великі файли: stream шматками, pipeline сам керує backpressure і помилками.
    // flags 'wx' не дасть перезаписати файл, якщо він раптом з'явився.
    await pipeline(fs.createReadStream(source), fs.createWriteStream(target, { flags: 'wx' }));
    return 'stream';
  }
  await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  return 'copyFile';
}

export class Organizer extends EventEmitter {
  /**
   * Події:
   *  'organize-start'    { source, output, total }
   *  'folder-created'    { category, path }
   *  'copy-start'        { source, category, processed, total }
   *  'copy-complete'     { source, target, category, size, method, processed, total }
   *  'copy-error'        { source, error, processed, total }
   *  'organize-complete' { summary, totalCopied, totalSize, failed }
   */
  async organize(sourceDir, outputDir) {
    const source = path.resolve(sourceDir);
    const output = path.resolve(outputDir);

    if (source === output) {
      const error = new Error('Source and output directories must be different');
      error.code = 'ESAMEDIR';
      throw error;
    }

    // Якщо output лежить всередині source, не копіюємо вже відсортовані файли повторно.
    const outputPrefix = output + path.sep;
    const files = (await listFiles(source)).filter((file) => !file.startsWith(outputPrefix));

    const total = files.length;
    this.emit('organize-start', { source, output, total });

    for (const category of Object.keys(categories)) {
      const categoryPath = path.join(output, category);
      await fsp.mkdir(categoryPath, { recursive: true });
      this.emit('folder-created', { category, path: categoryPath });
    }

    const summary = Object.fromEntries(
      Object.keys(categories).map((category) => [category, { count: 0, totalSize: 0 }]),
    );
    let totalCopied = 0;
    let totalSize = 0;
    let failed = 0;
    let processed = 0;

    for (const filePath of files) {
      const category = getCategory(filePath);
      this.emit('copy-start', { source: filePath, category, processed, total });

      try {
        const { size } = await fsp.stat(filePath);
        const target = await getUniquePath(path.join(output, category, path.basename(filePath)));
        const method = await copyFile(filePath, target, size);

        summary[category].count++;
        summary[category].totalSize += size;
        totalCopied++;
        totalSize += size;
        processed++;
        this.emit('copy-complete', { source: filePath, target, category, size, method, processed, total });
      } catch (error) {
        failed++;
        processed++;
        this.emit('copy-error', { source: filePath, error, processed, total });
      }
    }

    const result = { source, output, summary, totalCopied, totalSize, failed };
    this.emit('organize-complete', result);
    return result;
  }
}
