import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { listFiles, DAY_MS } from './utils.js';

export class Scanner extends EventEmitter {
  async scan(directory) {
    const root = path.resolve(directory);
    const files = await listFiles(root);

    const total = files.length;
    this.emit('scan-start', { directory: root, total });

    const statistics = {
      directory: root,
      totalFiles: 0,
      totalSize: 0,
      byType: new Map(),
      age: { last7: 0, last30: 0, olderThan90: 0 },
      largest: [],
      oldest: null,
      errors: 0,
    };

    const now = Date.now();
    const allFiles = [];
    let processed = 0;

    for (const filePath of files) {
      try {
        const stats = await fs.stat(filePath);
        const ext = path.extname(filePath).toLowerCase() || '(no ext)';
        const daysOld = (now - stats.mtime.getTime()) / DAY_MS;

        const fileData = {
          path: filePath,
          name: path.basename(filePath),
          ext,
          size: stats.size,
          mtime: stats.mtime,
          daysOld,
        };

        statistics.totalFiles++;
        statistics.totalSize += stats.size;

        const typeStats = statistics.byType.get(ext) ?? { count: 0, totalSize: 0 };
        typeStats.count++;
        typeStats.totalSize += stats.size;
        statistics.byType.set(ext, typeStats);

        if (daysOld <= 7) statistics.age.last7++;
        if (daysOld <= 30) statistics.age.last30++;
        if (daysOld > 90) statistics.age.olderThan90++;

        if (!statistics.oldest || fileData.mtime < statistics.oldest.mtime) {
          statistics.oldest = fileData;
        }

        allFiles.push(fileData);
        processed++;
        this.emit('file-found', { ...fileData, processed, total });
      } catch (error) {
        statistics.errors++;
        processed++;
        this.emit('file-error', { path: filePath, error, processed, total });
      }
    }

    statistics.largest = allFiles.sort((a, b) => b.size - a.size).slice(0, 3);

    this.emit('scan-complete', statistics);
    return statistics;
  }
}
