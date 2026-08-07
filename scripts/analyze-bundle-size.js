#!/usr/bin/env node

/**
 * Build size analysis script for Amplify Cloudflare Workers.
 *
 * After running `pnpm run build`, this script analyzes the built bundles
 * and reports their sizes, highlighting any that exceed the 3MB target.
 *
 * Usage: node scripts/analyze-bundle-size.js
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const SIZE_LIMIT_MB = 3;
const SIZE_LIMIT_BYTES = SIZE_LIMIT_MB * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getGzipSize(buffer) {
  // Approximate gzip size (actual compression varies)
  // Using a rough 3:1 ratio for JS code
  return Math.round(buffer.length * 0.33);
}

function analyzeDirectory(dir, label) {
  if (!fs.existsSync(dir)) {
    console.log(`\n⚠️  ${label} directory not found: ${dir}`);
    return;
  }

  console.log(`\n📦 ${label} Bundle Analysis`);
  console.log('='.repeat(60));

  const results = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath);
        results.push({
          path: path.relative(dir, fullPath),
          size: stat.size,
          gzipEstimate: getGzipSize(content),
        });
      }
    }
  }

  walk(dir);

  // Sort by size descending
  results.sort((a, b) => b.size - a.size);

  let totalSize = 0;
  let overLimit = false;

  for (const r of results) {
    totalSize += r.size;
    const isOver = r.size > SIZE_LIMIT_BYTES;
    if (isOver) overLimit = true;

    const icon = isOver ? '🔴' : r.size > SIZE_LIMIT_BYTES * 0.7 ? '🟡' : '🟢';
    console.log(`  ${icon} ${r.path}`);
    console.log(`     Raw: ${formatBytes(r.size)} | Est. gzip: ${formatBytes(r.gzipEstimate)}`);
  }

  console.log('-'.repeat(60));
  const totalIcon = totalSize > SIZE_LIMIT_BYTES ? '🔴' : '🟢';
  console.log(`  ${totalIcon} TOTAL: ${formatBytes(totalSize)} | Est. gzip: ${formatBytes(getGzipSize(Buffer.alloc(totalSize)))}`);
  console.log(`  Target: < ${SIZE_LIMIT_MB} MB per Worker`);

  if (overLimit) {
    console.log('\n  ⚠️  Some bundles exceed the 3MB size limit!');
    console.log('  Consider:');
    console.log('    - Lazy-loading heavy dependencies');
    console.log('    - Splitting routes into separate Workers (functions/api/)');
    console.log('    - Replacing heavy packages with lighter alternatives');
  }

  return { totalSize, overLimit };
}

// Analyze both client and server bundles
const serverResult = analyzeDirectory(path.join(BUILD_DIR, 'server'), 'Server (Worker)');
const clientResult = analyzeDirectory(path.join(BUILD_DIR, 'client'), 'Client');

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Summary');
console.log('='.repeat(60));

if (serverResult) {
  const status = serverResult.overLimit ? '🔴 OVER LIMIT' : '🟢 UNDER LIMIT';
  console.log(`  Server Worker: ${formatBytes(serverResult.totalSize)} — ${status}`);
}

if (clientResult) {
  console.log(`  Client Bundle: ${formatBytes(clientResult.totalSize)}`);
}

console.log('\n💡 Tips for reducing Worker bundle size:');
console.log('  1. Use dynamic import() for heavy deps (lazy loading)');
console.log('  2. Create separate functions/api/ for heavy routes');
console.log('  3. Replace native addons (sharp) with WASM/JS alternatives');
console.log('  4. Replace @octokit/rest with raw fetch() calls');
console.log('  5. Lazy-load AI SDK providers on demand');
