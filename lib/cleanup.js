import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { listFiles, DAY_MS } from './utils.js';

export class Cleanup extends EventEmitter {
  async run(directory, { olderThan, confirm = false }) {
    const root = path.resolve(directory);
    const dryRun = !confirm;
    const files = await listFiles(root);

    this.emit('cleanup-start', { directory: root, olderThan, dryRun });

    const now = Date.now();
    const oldFiles = [];

    for (const filePath of files) {
      try {
        const stats = await fs.stat(filePath);
        const daysOld = (now - stats.mtime.getTime()) / DAY_MS;

        if (daysOld > olderThan) {
          const fileData = {
            path: filePath,
            name: path.basename(filePath),
            size: stats.size,
            mtime: stats.mtime,
            daysOld,
          };
          oldFiles.push(fileData);
          this.emit('file-found', fileData);
        }
      } catch (error) {
        this.emit('file-error', { path: filePath, error });
      }
    }

    oldFiles.sort((a, b) => b.daysOld - a.daysOld);
    const totalSize = oldFiles.reduce((sum, file) => sum + file.size, 0);

    this.emit('search-complete', { files: oldFiles, totalSize, dryRun });

    let deleted = 0;
    let freed = 0;
    let failed = 0;

    if (!dryRun) {
      let processed = 0;
      const total = oldFiles.length;

      for (const file of oldFiles) {
        try {
          await fs.unlink(file.path);
          deleted++;
          freed += file.size;
          processed++;
          this.emit('file-deleted', { path: file.path, size: file.size, processed, total });
        } catch (error) {
          failed++;
          processed++;
          this.emit('delete-error', { path: file.path, error, processed, total });
        }
      }
    }

    const result = { dryRun, found: oldFiles.length, totalSize, deleted, freed, failed };
    this.emit('cleanup-complete', result);
    return result;
  }
}
