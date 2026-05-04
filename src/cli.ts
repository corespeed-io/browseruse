#!/usr/bin/env bun
/**
 * browseruse CLI — TypeScript entry point.
 *
 * Usage:
 *   browseruse '<js>'              Eval JS in the REPL
 *   browseruse launch [--profile <name>] [--headless]
 *   browseruse browsers            List detected browsers
 *   browseruse tabs                List page targets
 *   browseruse connect [opts]      Connect session
 *   browseruse eval '<js>'         Eval JS explicitly
 *   browseruse screenshot [--output <path>]
 *   browseruse --status            Health check
 *   browseruse --start             Start REPL server
 *   browseruse --stop              Stop REPL server
 *   browseruse --restart           Restart REPL server
 *   browseruse --logs              Tail server log
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { runServer } from './repl.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.BROWSERUSE_PORT ?? process.env.CDP_REPL_PORT ?? 9876);
const HOST = '127.0.0.1';
const URL_BASE = `http://${HOST}:${PORT}`;
const LOG_FILE = process.env.BROWSERUSE_LOG ?? '/tmp/browseruse.log';
const REPL_PATH = join(dirname(new URL(import.meta.url).pathname), 'repl.ts');

// ---------------------------------------------------------------------------
// Bun bootstrap
// ---------------------------------------------------------------------------

function ensureBun(): void {
  // We're already running in Bun if this file is executing, so nothing needed.
  // This function exists for documentation parity with the bash version.
}

// ---------------------------------------------------------------------------
// REPL lifecycle
// ---------------------------------------------------------------------------

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startRepl(): Promise<void> {
  if (await isUp()) return;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BROWSERUSE_PORT: String(PORT),
  };

  // Detect compiled binary mode: if we're NOT running from a .ts source,
  // spawn ourselves with --serve instead of invoking bun on repl.ts.
  const isCompiledBinary = !process.argv[0]?.endsWith('.ts');
  const cmd = isCompiledBinary
    ? [process.execPath, '--serve']
    : ['bun', REPL_PATH];

  // Spawn REPL in background
  const logFile = Bun.file(LOG_FILE);
  const proc = Bun.spawn(cmd, {
    env,
    stdout: logFile,
    stderr: logFile,
    // stdin not needed
  });

  // Detach — don't wait for it
  proc.unref();

  // Poll until ready (up to 10s)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await isUp()) return;
    await Bun.sleep(100);
  }

  console.error(`browseruse: REPL failed to start on ${URL_BASE} (see ${LOG_FILE})`);
  process.exit(1);
}

async function stopRepl(): Promise<void> {
  if (!(await isUp())) return;
  try {
    await fetch(`${URL_BASE}/quit`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function postEval(code: string): Promise<void> {
  const res = await fetch(`${URL_BASE}/eval`, {
    method: 'POST',
    body: code,
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (res.ok) {
    if (body) console.log(body);
  } else {
    if (body) process.stderr.write(body);
    process.exit(1);
  }
}

async function getJSON(path: string): Promise<void> {
  const res = await fetch(`${URL_BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  if (res.ok) {
    console.log(body);
  } else {
    process.stderr.write(body + '\n');
    process.exit(1);
  }
}

async function postJSON(path: string, data?: object): Promise<string> {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: 'POST',
    body: data ? JSON.stringify(data) : '',
    headers: data ? { 'content-type': 'application/json' } : {},
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (res.ok) {
    return body;
  } else {
    process.stderr.write(body + '\n');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdLaunch(args: string[]): Promise<void> {
  const opts: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && i + 1 < args.length) {
      opts.profile = args[++i];
    } else if (args[i] === '--headless') {
      opts.headless = true;
    } else if (args[i] === '--port' && i + 1 < args.length) {
      opts.port = Number(args[++i]);
    }
  }
  const result = await postJSON('/launch', opts);
  console.log(result);
}

async function cmdConnect(args: string[]): Promise<void> {
  const opts: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile-dir' && i + 1 < args.length) {
      opts.profileDir = args[++i];
    } else if (args[i] === '--ws-url' && i + 1 < args.length) {
      opts.wsUrl = args[++i];
    } else if (args[i] === '--timeout' && i + 1 < args.length) {
      opts.timeoutMs = Number(args[++i]);
    } else if (args[i] === '--no-auto-launch') {
      opts.noAutoLaunch = true;
    }
  }
  const result = await postJSON('/connect', Object.keys(opts).length > 0 ? opts : undefined);
  console.log(result);
}

async function cmdScreenshot(args: string[]): Promise<void> {
  let output = '/tmp/screenshot.png';
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--output' || args[i] === '-o') && i + 1 < args.length) {
      output = args[++i]!;
    }
  }
  // Use eval to take screenshot and write to file
  const code = `
const { data } = await session.Page.captureScreenshot({ format: 'png' });
const buf = Buffer.from(data, 'base64');
await Bun.write(${JSON.stringify(output)}, buf);
return ${JSON.stringify(output)};
`;
  await postEval(code);
}

async function cmdStatus(): Promise<void> {
  if (await isUp()) {
    await getJSON('/health');
  } else {
    console.log('{"ok":false,"error":"down"}');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Read from stdin
    await startRepl();
    const code = await Bun.stdin.text();
    if (code.trim()) {
      await postEval(code);
    }
    return;
  }

  const cmd = args[0]!;

  // Lifecycle commands (don't need REPL auto-start)
  switch (cmd) {
    case '--serve':
      runServer();
      return;
    case '--status':
      await cmdStatus();
      return;
    case '--start':
      await startRepl();
      await getJSON('/health');
      return;
    case '--stop':
      if (await isUp()) {
        await stopRepl();
        console.log('{"ok":true,"stopped":true}');
      } else {
        console.log('{"ok":true,"stopped":false,"note":"already down"}');
      }
      return;
    case '--restart':
      await stopRepl();
      await Bun.sleep(200);
      await startRepl();
      await getJSON('/health');
      return;
    case '--logs':
      const proc = Bun.spawn(['tail', '-f', LOG_FILE], {
        stdout: 'inherit',
        stderr: 'inherit',
      });
      await proc.exited;
      return;
    case '--help':
    case '-h':
      printUsage();
      return;
    case '--version':
    case '-v':
      console.log('browseruse 0.1.0');
      return;
  }

  // Commands that need the REPL running
  await startRepl();

  switch (cmd) {
    case 'launch':
      await cmdLaunch(args.slice(1));
      break;
    case 'browsers':
      await getJSON('/browsers');
      break;
    case 'tabs':
      await getJSON('/tabs');
      break;
    case 'connect':
      await cmdConnect(args.slice(1));
      break;
    case 'eval':
      if (args.length < 2) {
        // Read from stdin
        const code = await Bun.stdin.text();
        if (code.trim()) await postEval(code);
      } else {
        await postEval(args.slice(1).join(' '));
      }
      break;
    case 'screenshot':
      await cmdScreenshot(args.slice(1));
      break;
    default:
      // Bare string — treat as eval (backward compat)
      await postEval(args.join(' '));
      break;
  }
}

function printUsage(): void {
  const usage = `browseruse — Launch, connect, and control Chrome via CDP.

Usage:
  browseruse '<js>'                    Eval JS in the persistent REPL
  browseruse eval '<js>'               Same, explicit subcommand
  browseruse launch [options]          Launch a managed Chrome browser
  browseruse browsers                  List detected browsers (JSON)
  browseruse tabs                      List page targets (JSON)
  browseruse connect [options]         Connect session to a browser
  browseruse screenshot [--output f]   Capture screenshot

  browseruse --status                  Health check (JSON)
  browseruse --start                   Start REPL server
  browseruse --stop                    Stop REPL + managed browser
  browseruse --restart                 Restart REPL server
  browseruse --logs                    Tail server log

Launch options:
  --profile <name>    Profile name (default: 'default')
  --headless          Run headless
  --port <num>        Debugging port (default: ephemeral)

Connect options:
  --profile-dir <p>   Connect to specific browser profile dir
  --ws-url <url>      Connect to specific WebSocket URL
  --timeout <ms>      Connection timeout (default: 5000)
  --no-auto-launch    Don't auto-launch if no browser detected

Env vars:
  BROWSERUSE_PORT     REPL server port (default: 9876)
  BROWSERUSE_LOG      Log file path (default: /tmp/browseruse.log)
`;
  console.log(usage);
}

main().catch(e => {
  console.error(`browseruse: ${e.message ?? e}`);
  process.exit(1);
});
