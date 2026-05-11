/**
 * Build script for the browseruse Chrome extension.
 *
 * Uses esbuild to bundle TypeScript source files into extension/dist/.
 * Copies static assets (manifest.json, HTML, icons) to dist.
 *
 * Usage: bun extension/build.ts
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const EXT_DIR = import.meta.dir;
const ROOT = join(EXT_DIR, '..');
const DIST = join(EXT_DIR, 'dist');
const SRC = join(EXT_DIR, 'src');
const PROTOCOL_DIR = join(ROOT, 'packages', 'protocol');

// Clean dist
if (existsSync(DIST)) rmSync(DIST, { recursive: true });
mkdirSync(DIST, { recursive: true });

// Bundle TypeScript entry points
await build({
  entryPoints: [
    join(SRC, 'background/service-worker.ts'),
    join(SRC, 'offscreen/offscreen.ts'),
    join(SRC, 'content/content-script.ts'),
    join(SRC, 'popup/popup.ts'),
  ],
  outdir: DIST,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
  // Preserve directory structure in output
  outbase: SRC,
  // Resolve @browseruse/protocol to the workspace package
  alias: {
    '@browseruse/protocol': join(PROTOCOL_DIR, 'index.ts'),
  },
});

// Copy static assets
cpSync(join(EXT_DIR, 'manifest.json'), join(DIST, 'manifest.json'));
cpSync(join(EXT_DIR, 'icons'), join(DIST, 'icons'), { recursive: true });
cpSync(join(SRC, 'offscreen/offscreen.html'), join(DIST, 'offscreen/offscreen.html'));
cpSync(join(SRC, 'popup/popup.html'), join(DIST, 'popup/popup.html'));

console.log('Extension built → extension/dist/');
