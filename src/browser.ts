/**
 * Browser launch, discovery, lifecycle, and profile management.
 *
 * Manages a single "managed browser" — a Chrome/Chromium instance launched by
 * browseruse with `--remote-debugging-port` and a persistent user-data-dir
 * under `~/.browseruse/profiles/<name>/`.
 *
 * Port tracking: the active debugging port is written to `~/.browseruse/cdp-port`
 * so other processes can discover and connect to the managed browser.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LaunchOptions = {
  /** Profile name. Defaults to 'default'. Maps to ~/.browseruse/profiles/<name>/ */
  profile?: string;
  /** Explicit port. If 0 or omitted, picks an ephemeral port. */
  port?: number;
  /** Run headless (no visible window). Default: false. */
  headless?: boolean;
  /** Extra Chrome flags. */
  extraArgs?: string[];
};

export type ManagedBrowser = {
  pid: number;
  port: number;
  profile: string;
  profileDir: string;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const BROWSERUSE_DIR = join(homedir(), '.browseruse');
const PROFILES_DIR = join(BROWSERUSE_DIR, 'profiles');
const PORT_FILE = join(BROWSERUSE_DIR, 'cdp-port');
const PID_FILE = join(BROWSERUSE_DIR, 'cdp-pid');

function profileDir(name: string): string {
  return join(PROFILES_DIR, name);
}

// ---------------------------------------------------------------------------
// Chrome executable discovery
// ---------------------------------------------------------------------------

type ChromeCandidate = { name: string; path: string };

function getChromeCandidates(): ChromeCandidate[] {
  const candidates: ChromeCandidate[] = [];

  if (process.platform === 'darwin') {
    candidates.push(
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Google Chrome Canary', path: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' },
      { name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
      { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { name: 'Brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      { name: 'Arc', path: '/Applications/Arc.app/Contents/MacOS/Arc' },
      { name: 'Vivaldi', path: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi' },
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
      { name: 'Google Chrome Stable', path: '/usr/bin/google-chrome-stable' },
      { name: 'Chromium', path: '/usr/bin/chromium' },
      { name: 'Chromium Browser', path: '/usr/bin/chromium-browser' },
      { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
      { name: 'Brave', path: '/usr/bin/brave-browser' },
    );
  } else if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    candidates.push(
      { name: 'Google Chrome', path: join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Google Chrome (x86)', path: join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Google Chrome (Local)', path: join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Microsoft Edge', path: join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'Brave', path: join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
      { name: 'Chromium', path: join(localAppData, 'Chromium', 'Application', 'chrome.exe') },
    );
  }

  return candidates;
}

/**
 * Find the first available Chrome/Chromium executable on this system.
 * Returns the absolute path, or throws if none found.
 */
export function findChromePath(): string {
  const candidates = getChromeCandidates();
  for (const { path } of candidates) {
    if (existsSync(path)) return path;
  }
  // On macOS, also try `which` for Homebrew-installed chromium
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      const result = Bun.spawnSync(['which', 'google-chrome']);
      const path = result.stdout.toString().trim();
      if (path && existsSync(path)) return path;
    } catch { /* ignore */ }
    try {
      const result = Bun.spawnSync(['which', 'chromium']);
      const path = result.stdout.toString().trim();
      if (path && existsSync(path)) return path;
    } catch { /* ignore */ }
  }
  const names = candidates.map(c => c.name).join(', ');
  throw new Error(`No Chrome/Chromium executable found. Searched: ${names}. Install Chrome or set the path manually.`);
}

// ---------------------------------------------------------------------------
// Chrome launch flags
// ---------------------------------------------------------------------------

const DEFAULT_FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-client-side-phishing-detection',
  '--disable-default-apps',
  '--disable-extensions-except=',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-translate',
  '--metrics-recording-only',
  '--safebrowsing-disable-auto-update',
  '--password-store=basic',
  '--use-mock-keychain',
];

// ---------------------------------------------------------------------------
// Launch & lifecycle
// ---------------------------------------------------------------------------

/**
 * Launch a Chrome browser with remote debugging enabled and a persistent profile.
 * Returns the ManagedBrowser info once DevToolsActivePort is available.
 */
export async function launchBrowser(opts: LaunchOptions = {}): Promise<ManagedBrowser> {
  const profile = opts.profile ?? 'default';
  const userDataDir = profileDir(profile);
  const port = opts.port ?? 0; // 0 = let Chrome pick an ephemeral port

  // Ensure directories exist
  mkdirSync(BROWSERUSE_DIR, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });

  const chromePath = findChromePath();

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...DEFAULT_FLAGS,
  ];

  if (opts.headless) {
    args.push('--headless=new');
  }

  if (opts.extraArgs) {
    args.push(...opts.extraArgs);
  }

  // Remove stale DevToolsActivePort before launch
  const dtapPath = join(userDataDir, 'DevToolsActivePort');
  try { unlinkSync(dtapPath); } catch { /* ignore */ }

  const proc = Bun.spawn([chromePath, ...args], {
    stdout: 'ignore',
    stderr: 'ignore',
    // Detach so browser survives if this process exits
  });

  const pid = proc.pid;

  // Wait for DevToolsActivePort file (up to 30s)
  const deadline = Date.now() + 30_000;
  let actualPort = 0;
  while (Date.now() < deadline) {
    try {
      const text = readFileSync(dtapPath, 'utf-8').trim();
      const [portStr] = text.split('\n');
      actualPort = Number(portStr);
      if (Number.isFinite(actualPort) && actualPort > 0) break;
    } catch { /* file not yet written */ }
    await Bun.sleep(100);
  }

  if (!actualPort) {
    // Kill the process if we can't get the port
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    throw new Error(`Chrome launched but DevToolsActivePort not written after 30s. Profile: ${userDataDir}`);
  }

  // Write port and pid files for discovery
  writeFileSync(PORT_FILE, String(actualPort), 'utf-8');
  writeFileSync(PID_FILE, String(pid), 'utf-8');

  return { pid, port: actualPort, profile, profileDir: userDataDir };
}

/**
 * Check if a managed browser is still alive.
 * Returns its info if alive, or undefined if not.
 */
export function getManagedBrowser(): ManagedBrowser | undefined {
  try {
    const port = Number(readFileSync(PORT_FILE, 'utf-8').trim());
    const pid = Number(readFileSync(PID_FILE, 'utf-8').trim());
    if (!Number.isFinite(port) || !Number.isFinite(pid)) return undefined;

    // Check if process is alive (signal 0 = existence check)
    try { process.kill(pid, 0); } catch { return undefined; }

    // Determine profile from DevToolsActivePort presence
    // Check all profile dirs for a matching port
    const profiles = existsSync(PROFILES_DIR)
      ? Bun.spawnSync(['ls', PROFILES_DIR]).stdout.toString().trim().split('\n').filter(Boolean)
      : [];

    for (const name of profiles) {
      const dir = profileDir(name);
      const dtapPath = join(dir, 'DevToolsActivePort');
      try {
        const text = readFileSync(dtapPath, 'utf-8').trim();
        const [portStr] = text.split('\n');
        if (Number(portStr) === port) {
          return { pid, port, profile: name, profileDir: dir };
        }
      } catch { /* skip */ }
    }

    // Fallback: we know port and pid but not which profile
    return { pid, port, profile: 'unknown', profileDir: '' };
  } catch {
    return undefined;
  }
}

/**
 * Gracefully close the managed browser.
 * Sends SIGTERM, waits up to 5s, then SIGKILL if needed.
 */
export async function closeManagedBrowser(): Promise<boolean> {
  const browser = getManagedBrowser();
  if (!browser) return false;

  try {
    process.kill(browser.pid, 'SIGTERM');
  } catch {
    // Already dead
    cleanup();
    return true;
  }

  // Wait up to 5s for exit
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { process.kill(browser.pid, 0); } catch {
      // Process gone
      cleanup();
      return true;
    }
    await Bun.sleep(200);
  }

  // Force kill
  try { process.kill(browser.pid, 'SIGKILL'); } catch { /* ignore */ }
  cleanup();
  return true;
}

function cleanup(): void {
  try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}
