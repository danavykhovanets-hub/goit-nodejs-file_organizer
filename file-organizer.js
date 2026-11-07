#!/usr/bin/env node
import path from 'path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import { formatSize, drawProgressBar, describeError } from './lib/utils.js';

const LINE = '━'.repeat(34);
const MAX_TYPES = 10;      // скільки розширень показувати окремо, решта йде в (other)
const PREVIEW_LIMIT = 10;  // скільки файлів показувати в списку cleanup

// ---------- Допоміжне ----------

function printUsage() {
  console.log(`
Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <source> --output <target>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]
`);
}

function fail(message) {
  console.error(`❌ Error: ${message}`);
  process.exit(1);
}

function parseFlags(args) {
  const flags = { confirm: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--confirm') {
      flags.confirm = true;
    } else if (arg === '--output') {
      flags.output = args[++i];
    } else if (arg === '--older-than') {
      flags.olderThan = args[++i];
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

function renderProgress(label, current, total) {
  if (total === 0) return;
  process.stdout.write(`\r${label} ${drawProgressBar(current, total)}`);
  if (current === total) process.stdout.write('\n');
}

function relative(root, filePath) {
  return path.join(path.basename(root), path.relative(root, filePath));
}

// ---------- scan ----------

async function runScan(directory) {
  const scanner = new Scanner();

  scanner.on('scan-start', ({ directory, total }) => {
    console.log(`📂 Scanning: ${directory}`);
    if (total === 0) console.log('No files found.');
  });

  scanner.on('file-found', ({ processed, total }) => {
    renderProgress('Processing...', processed, total);
  });

  scanner.on('file-error', ({ path: filePath, error, processed, total }) => {
    renderProgress('Processing...', processed, total);
    console.error(`\n⚠️  Skipped: ${describeError(error, filePath)}`);
  });

  scanner.on('scan-complete', (stats) => {
    console.log('\n📊 Scan Results:');
    console.log(LINE);
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size: ${formatSize(stats.totalSize)}`);

    if (stats.totalFiles === 0) return;

    console.log('\nBy File Type:');
    const types = [...stats.byType.entries()].sort((a, b) => b[1].totalSize - a[1].totalSize);
    const shown = types.slice(0, MAX_TYPES);
    const rest = types.slice(MAX_TYPES);

    if (rest.length > 0) {
      shown.push([
        '(other)',
        rest.reduce(
          (acc, [, t]) => ({ count: acc.count + t.count, totalSize: acc.totalSize + t.totalSize }),
          { count: 0, totalSize: 0 },
        ),
      ]);
    }

    for (const [ext, { count, totalSize }] of shown) {
      console.log(
        `  ${ext.padEnd(9)} ${String(count).padStart(4)} files   ${formatSize(totalSize).padStart(9)}`,
      );
    }

    console.log('\nFile Age:');
    console.log(`  Last 7 days:    ${stats.age.last7} files`);
    console.log(`  Last 30 days:   ${stats.age.last30} files`);
    console.log(`  Older than 90:  ${stats.age.olderThan90} files`);

    console.log('\nLargest files:');
    const nameWidth = Math.max(...stats.largest.map((f) => f.name.length)) + 2;
    stats.largest.forEach((file, i) => {
      console.log(`  ${i + 1}. ${file.name.padEnd(nameWidth)} ${formatSize(file.size).padStart(9)}`);
    });

    const oldest = stats.oldest;
    console.log(`\nOldest file: ${oldest.name} (modified ${Math.floor(oldest.daysOld)} days ago)`);

    if (stats.errors > 0) console.log(`\n⚠️  ${stats.errors} files could not be read.`);
  });

  await scanner.scan(directory);
}

// ---------- duplicates ----------

async function runDuplicates(directory) {
  const finder = new DuplicateFinder();

  finder.on('hash-start', ({ directory, totalFiles, toHash }) => {
    console.log(`🔍 Searching for duplicates in: ${directory}`);
    console.log(`${totalFiles} files found, ${toHash} share a size with another file and need hashing.`);
  });

  finder.on('file-processed', ({ processed, total }) => {
    renderProgress('Calculating hashes...', processed, total);
  });

  finder.on('file-error', ({ path: filePath, error, processed, total }) => {
    if (total > 0) renderProgress('Calculating hashes...', processed, total);
    console.error(`\n⚠️  Skipped: ${describeError(error, filePath)}`);
  });

  finder.on('duplicates-found', ({ directory, groups, totalWasted }) => {
    if (groups.length === 0) {
      console.log('\n✅ No duplicates found.');
      return;
    }

    console.log(`\nFound ${groups.length} duplicate groups (${formatSize(totalWasted)} wasted):\n`);

    groups.forEach((group, i) => {
      console.log(LINE);
      console.log(`Group ${i + 1} (${group.paths.length} copies, ${formatSize(group.size)} each):`);
      console.log(`  SHA-256: ${group.hash.slice(0, 12)}...\n`);
      for (const filePath of group.paths) {
        console.log(`  📄 ${relative(directory, filePath)}`);
      }
      console.log(`\n  Wasted space: ${formatSize(group.wasted)}\n`);
    });

    console.log(LINE);
    console.log(`💾 Total wasted space: ${formatSize(totalWasted)}`);
  });

  await finder.find(directory);
}

// ---------- organize ----------

async function runOrganize(source, output) {
  const organizer = new Organizer();

  organizer.on('organize-start', ({ source, output }) => {
    console.log(`📦 Organizing: ${source}`);
    console.log(`Target: ${output}\n`);
    console.log('Creating folders...');
  });

  organizer.on('folder-created', ({ category }) => {
    console.log(`  ✓ ${category}/`);
  });

  organizer.on('copy-complete', ({ processed, total }) => {
    if (processed === 1) console.log('');
    renderProgress('Copying files...', processed, total);
  });

  organizer.on('copy-error', ({ source, error, processed, total }) => {
    renderProgress('Copying files...', processed, total);
    console.error(`\n⚠️  Failed to copy: ${describeError(error, source)}`);
  });

  organizer.on('organize-complete', ({ output, summary, totalCopied, totalSize, failed }) => {
    console.log('\n✅ Organization complete!\n');
    console.log('Summary:');
    const outName = path.basename(output);
    for (const [category, { count }] of Object.entries(summary)) {
      console.log(`  ${(category + ':').padEnd(11)} ${String(count).padStart(4)} files → ${outName}/${category}/`);
    }
    console.log(`\nTotal copied: ${totalCopied} files (${formatSize(totalSize)})`);
    if (failed > 0) console.log(`⚠️  Failed: ${failed} files`);
  });

  await organizer.organize(source, output);
}

// ---------- cleanup ----------

async function runCleanup(directory, olderThan, confirm) {
  const cleanup = new Cleanup();

  cleanup.on('cleanup-start', ({ directory, olderThan }) => {
    console.log(`🧹 Cleanup: ${directory}`);
    console.log(`Looking for files older than ${olderThan} days...\n`);
  });

  cleanup.on('file-error', ({ path: filePath, error }) => {
    console.error(`⚠️  Skipped: ${describeError(error, filePath)}`);
  });

  cleanup.on('search-complete', ({ files, totalSize, dryRun }) => {
    if (files.length === 0) {
      console.log('✅ No files older than the threshold.');
      return;
    }

    console.log(`Found ${files.length} files to delete:\n`);
    console.log(LINE);
    for (const file of files.slice(0, PREVIEW_LIMIT)) {
      console.log(file.name);
      console.log(`  Size: ${formatSize(file.size)}`);
      console.log(
        `  Modified: ${Math.floor(file.daysOld)} days ago (${file.mtime.toISOString().slice(0, 10)})\n`,
      );
    }
    if (files.length > PREVIEW_LIMIT) {
      console.log(`... (${files.length - PREVIEW_LIMIT} more files)`);
    }
    console.log(LINE);
    console.log(`\nTotal: ${files.length} files (${formatSize(totalSize)})\n`);

    if (dryRun) {
      console.log('⚠️  DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.');
    } else {
      console.log(`⚠️  DELETING ${files.length} files (${formatSize(totalSize)}). This action cannot be undone!\n`);
    }
  });

  cleanup.on('file-deleted', ({ processed, total }) => {
    renderProgress('Deleting...', processed, total);
  });

  cleanup.on('delete-error', ({ path: filePath, error, processed, total }) => {
    renderProgress('Deleting...', processed, total);
    console.error(`\n⚠️  Failed to delete: ${describeError(error, filePath)}`);
  });

  cleanup.on('cleanup-complete', ({ dryRun, found, deleted, freed, failed }) => {
    if (dryRun || found === 0) return;
    console.log('\n✅ Cleanup complete!');
    console.log(`Deleted: ${deleted} files (${formatSize(freed)} freed)`);
    if (failed > 0) console.log(`⚠️  Failed: ${failed} files`);
  });

  await cleanup.run(directory, { olderThan, confirm });
}

// ---------- Точка входу ----------

async function main() {
  const [command, target, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const commands = ['scan', 'duplicates', 'organize', 'cleanup'];
  if (!commands.includes(command)) {
    printUsage();
    fail(`Unknown command: ${command}`);
  }

  if (!target || target.startsWith('--')) {
    printUsage();
    fail('Directory path is required');
  }

  const flags = parseFlags(rest);

  try {
    switch (command) {
      case 'scan':
        await runScan(target);
        break;

      case 'duplicates':
        await runDuplicates(target);
        break;

      case 'organize':
        if (!flags.output) fail('--output <target directory> is required for organize');
        await runOrganize(target, flags.output);
        break;

      case 'cleanup': {
        const days = Number(flags.olderThan);
        if (flags.olderThan === undefined || !Number.isFinite(days) || days < 0) {
          fail('--older-than <days> must be a non-negative number');
        }
        await runCleanup(target, days, flags.confirm);
        break;
      }
    }
  } catch (error) {
    if (error.code === 'ESAMEDIR') fail(error.message);
    fail(describeError(error, path.resolve(target)));
  }
}

await main();
