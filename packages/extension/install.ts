/**
 * Install script for the browseruse Chrome extension.
 *
 * The extension now uses a direct WebSocket connection to the REPL server,
 * so native messaging host setup is no longer required. This script handles
 * any remaining install tasks (currently: cleanup of legacy native host).
 *
 * Usage:
 *   bun packages/extension/install.ts [--cleanup]
 */

import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { platform, homedir } from 'os';

const HOST_NAME = 'com.browseruse.host';

function getNativeHostDir(): string | null {
  const os = platform();
  const home = homedir();

  switch (os) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
    case 'linux':
      return join(home, '.config', 'google-chrome', 'NativeMessagingHosts');
    default:
      return null;
  }
}

function cleanupLegacyNativeHost(): void {
  const hostDir = getNativeHostDir();
  if (!hostDir) return;

  const manifestPath = join(hostDir, `${HOST_NAME}.json`);
  if (existsSync(manifestPath)) {
    try {
      unlinkSync(manifestPath);
      console.log(`Removed legacy native messaging host manifest: ${manifestPath}`);
    } catch (e: any) {
      console.warn(`Warning: could not remove ${manifestPath}: ${e.message}`);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--cleanup')) {
    cleanupLegacyNativeHost();
    console.log('Cleanup complete.');
    return;
  }

  // Clean up any legacy native messaging host
  cleanupLegacyNativeHost();

  console.log('browseruse extension install complete.');
  console.log('');
  console.log('The extension now connects directly via WebSocket to the REPL server.');
  console.log('No native messaging host registration is needed.');
  console.log('');
  console.log('To use:');
  console.log('  1. Start the REPL server: browseruse --start');
  console.log('  2. Load the extension in Chrome (chrome://extensions, developer mode)');
  console.log('  3. The extension will auto-connect to ws://127.0.0.1:9876/ws');
}

main();
