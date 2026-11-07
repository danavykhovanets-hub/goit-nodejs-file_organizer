import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { listFiles } from './utils.js';

/**
 * Хеш через stream: файл читається шматками, тому в пам'яті ніколи
 * не лежить увесь файл одночасно, навіть якщо він на кілька GB.
 */
export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  /**
   * Події:
   *  'hash-start'       { directory, totalFiles, toHash }
   *  'file-processed'   { path, hash, processed, total }
   *  'file-error'       { path, error, processed, total }
   *  'duplicates-found' { groups, totalWasted }
   */
  async find(directory) {
    const root = path.resolve(directory);
    const files = await listFiles(root);

    // Крок 1: групуємо за розміром. Файли з різним розміром не можуть
    // мати однаковий вміст, тож хешувати їх немає сенсу.
    const bySize = new Map(); // Map<size, Array<filePath>>
    for (const filePath of files) {
      try {
        const { size } = await fsp.stat(filePath);
        if (size === 0) continue; // порожні файли не займають місця
        const list = bySize.get(size) ?? [];
        list.push(filePath);
        bySize.set(size, list);
      } catch (error) {
        this.emit('file-error', { path: filePath, error, processed: 0, total: 0 });
      }
    }

    const candidates = [];
    for (const [size, paths] of bySize) {
      if (paths.length > 1) {
        for (const filePath of paths) candidates.push({ filePath, size });
      }
    }

    const total = candidates.length;
    this.emit('hash-start', { directory: root, totalFiles: files.length, toHash: total });

    // Крок 2: хешуємо лише кандидатів і групуємо за хешем.
    const byHash = new Map(); // Map<hash, { size, paths: Array<filePath> }>
    let processed = 0;

    for (const { filePath, size } of candidates) {
      try {
        const hash = await calculateHash(filePath);
        const group = byHash.get(hash) ?? { size, paths: [] };
        group.paths.push(filePath);
        byHash.set(hash, group);
        processed++;
        this.emit('file-processed', { path: filePath, hash, processed, total });
      } catch (error) {
        processed++;
        this.emit('file-error', { path: filePath, error, processed, total });
      }
    }

    const groups = [...byHash.entries()]
      .filter(([, group]) => group.paths.length > 1)
      .map(([hash, group]) => ({
        hash,
        size: group.size,
        paths: group.paths.sort(),
        wasted: group.size * (group.paths.length - 1),
      }))
      .sort((a, b) => b.wasted - a.wasted);

    const totalWasted = groups.reduce((sum, group) => sum + group.wasted, 0);

    const result = { directory: root, groups, totalWasted };
    this.emit('duplicates-found', result);
    return result;
  }
}
