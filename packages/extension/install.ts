/**
 * Install script for the browseruse native messaging host.
 *
 * Sets up the native messaging host manifest so Chrome can spawn the
 * native host bridge process when the extension calls connectNative().
 *
 * Usage:
 *   bun extension/install.ts [--extension-id <ID>]
 *
 * The script:
 * 1. Creates a wrapper shell script that invokes `bun native-host.ts`
 * 2. Generates the Chrome native messaging host manifest with correct paths
 * 3. Places the manifest in the platform-appropriate directory
 */

import { writeFileSync, mkdirSync, chmodSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { platform, homedir } from 'os';

const HOST_NAME = 'com.browseruse.host';
const DEFAULT_EXTENSION_ID = 'your-extension-id-here';

// Parse CLI args
function parseArgs(): { extensionId: string } {
  const args = process.argv.slice(2);
  let extensionId = DEFAULT_EXTENSION_ID;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--extension-id' && args[i + 1]) {
      extensionId = args[i + 1];
      i++;
    }
  }

  return { extensionId };
}

function getNativeHostDir(): string {
  const os = platform();
  const home = homedir();

  switch (os) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
    case 'linux':
      return join(home, '.config', 'google-chrome', 'NativeMessagingHosts');
    default:
      throw new Error(`Unsupported platform: ${os}. Only macOS and Linux are supported.`);
  }
}

function main(): void {
  const { extensionId } = parseArgs();
  const rootDir = resolve(import.meta.dir, '../..');
  const nativeHostScript = resolve(rootDir, 'packages', 'cli', 'src', 'native-host.ts');

  // 1. Create wrapper shell script
  const wrapperPath = resolve(rootDir, 'packages', 'extension', 'native-host-wrapper.sh');
  const wrapperContent = `#!/bin/sh
exec bun "${nativeHostScript}" "$@"
`;
  writeFileSync(wrapperPath, wrapperContent);
  chmodSync(wrapperPath, 0o755);
  console.log(`Created wrapper script: ${wrapperPath}`);

  // 2. Generate the native messaging host manifest
  const manifest = {
    name: HOST_NAME,
    description: 'browseruse native messaging host',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };

  // 3. Place manifest in the platform-appropriate directory
  const hostDir = getNativeHostDir();
  if (!existsSync(hostDir)) {
    mkdirSync(hostDir, { recursive: true });
  }

  const manifestPath = join(hostDir, `${HOST_NAME}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Installed native messaging host manifest: ${manifestPath}`);
  console.log(`\nExtension ID: ${extensionId}`);
  console.log(`Native host: ${wrapperPath}`);

  if (extensionId === DEFAULT_EXTENSION_ID) {
    console.log('\nWARNING: Using default extension ID. After loading the extension in Chrome,');
    console.log('re-run with: bun packages/extension/install.ts --extension-id <your-actual-extension-id>');
  }
}

main();
