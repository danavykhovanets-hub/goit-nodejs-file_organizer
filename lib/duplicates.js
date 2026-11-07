import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { listFiles } from './utils.js';


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
  async find(directory) {
    const root = path.resolve(directory);
    const files = await listFiles(root);

  
    const bySize = new Map();
    for (const filePath of files) {
      try {
        const { size } = await fsp.stat(filePath);
        if (size === 0) continue;
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

  
    const byHash = new Map(); 
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
