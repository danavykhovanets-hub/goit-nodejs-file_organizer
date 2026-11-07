import fs from 'fs/promises';
import path from 'path';

export const DAY_MS = 1000 * 60 * 60 * 24;
export const LARGE_FILE_SIZE = 10 * 1024 * 1024;

export async function listFiles(directory) {
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

export function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

export function drawProgressBar(current, total, width = 20) {
  const percentage = total === 0 ? 1 : current / total;
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

/**
 * Перетворює код помилки Node.js на зрозуміле повідомлення.
 */
export function describeError(error, target) {
  switch (error.code) {
    case 'ENOENT':
      return `Not found: ${target}`;
    case 'EACCES':
    case 'EPERM':
      return `Permission denied: ${target}`;
    case 'ENOTDIR':
      return `Not a directory: ${target}`;
    case 'EISDIR':
      return `Is a directory, expected a file: ${target}`;
    case 'EEXIST':
      return `Already exists: ${target}`;
    case 'ENOSPC':
      return `No space left on device while writing: ${target}`;
    case 'EBUSY':
      return `File is busy or locked: ${target}`;
    case 'EMFILE':
      return `Too many open files while processing: ${target}`;
    default:
      return `Unexpected error (${error.code ?? 'unknown'}): ${error.message}`;
  }
}
