#!/usr/bin/env node

/**
 * Patch vite-plugin-node-polyfills shim packages to mark them as having side effects.
 *
 * The buffer and process shim sub-packages ship with `sideEffects: false`, which
 * tells bundlers (Rollup, esbuild) that their modules can be tree-shaken if unused.
 * But these shims ONLY have side effects — they set globals like
 * `globalThis.Buffer` and `globalThis.process`.  With `sideEffects: false`,
 * bundlers strip them, causing "Buffer is not defined" / "process is not defined"
 * at runtime on Cloudflare Workers.
 *
 * This script flips `sideEffects` to `true` in the shim package.json files so
 * bundlers preserve the polyfill initialization code.
 */

const fs = require('fs');
const path = require('path');

const shimDirs = [
  'vite-plugin-node-polyfills/shims/buffer',
  'vite-plugin-node-polyfills/shims/process',
  'vite-plugin-node-polyfills/shims/global',
];

for (const shimDir of shimDirs) {
  // pnpm hoists to node_modules at the root; also check nested .pnpm paths
  const candidates = [
    path.join(__dirname, '..', 'node_modules', shimDir, 'package.json'),
  ];

  // Also try the .pnpm store layout
  try {
    const pnpmDir = path.join(__dirname, '..', 'node_modules', '.pnpm');
    const entries = fs.readdirSync(pnpmDir);
    for (const entry of entries) {
      if (entry.startsWith(shimDir.split('/')[0])) {
        const pkgPath = path.join(pnpmDir, entry, 'node_modules', shimDir, 'package.json');
        candidates.push(pkgPath);
      }
    }
  } catch {
    // .pnpm directory may not exist
  }

  for (const pkgPath of candidates) {
    try {
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);

      if (pkg.sideEffects === false) {
        pkg.sideEffects = true;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
        console.log(`  ✔ Patched sideEffects → true in ${shimDir}`);
      }
    } catch {
      // File doesn't exist or can't be read — skip
    }
  }
}

console.log('Polyfill sideEffects patching complete.');
