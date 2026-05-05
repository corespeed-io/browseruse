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

import { join, dirname } from 'path';

// ---------------------------------------------------------------------------
// ANSI color helpers (zero-dep)
// ---------------------------------------------------------------------------

const isTTY = !!(process.stdout.isTTY);

function makeFormatter(open: string, close: string): (s: string) => string {
  if (!isTTY) return (s: string) => s;
  return (s: string) => `${open}${s}${close}`;
}

const bold   = makeFormatter('\x1b[1m', '\x1b[22m');
const dim    = makeFormatter('\x1b[2m', '\x1b[22m');
const red    = makeFormatter('\x1b[31m', '\x1b[39m');
const green  = makeFormatter('\x1b[32m', '\x1b[39m');
const yellow = makeFormatter('\x1b[33m', '\x1b[39m');
const cyan   = makeFormatter('\x1b[36m', '\x1b[39m');

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function error(msg: string, detail?: string): void {
  console.error(`${red('error')}: ${msg}`);
  if (detail) console.error(dim(detail));
}

function hint(msg: string): string {
  return dim(`  hint: ${msg}`);
}

// ---------------------------------------------------------------------------
// formatTable — dynamic-width table renderer
// ---------------------------------------------------------------------------

type TableOptions = {
  headers: string[];
  rows: string[][];
  maxWidth?: number;
};

function formatTable({ headers, rows, maxWidth }: TableOptions): string {
  if (rows.length === 0) return dim('  (none)');

  const termWidth = maxWidth ?? (process.stdout.columns || 120);

  // Calculate column widths from content
  const colWidths = headers.map((h, i) => {
    const dataMax = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, dataMax);
  });

  // Shrink last column if total exceeds terminal width
  const separatorWidth = (headers.length - 1) * 3; // " │ " between columns
  const available = termWidth - separatorWidth;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  if (totalWidth > available && colWidths.length > 1) {
    const lastIdx = colWidths.length - 1;
    const otherWidth = colWidths.slice(0, lastIdx).reduce((a, b) => a + b, 0);
    colWidths[lastIdx] = Math.max(10, available - otherWidth);
  }

  function truncate(s: string, width: number): string {
    if (s.length <= width) return s;
    return s.slice(0, width - 1) + '\u2026';
  }

  function padRight(s: string, width: number): string {
    const visible = stripAnsi(s).length;
    return s + ' '.repeat(Math.max(0, width - visible));
  }

  const headerLine = headers
    .map((h, i) => padRight(bold(h), colWidths[i] + bold(h).length - h.length))
    .join(dim(' \u2502 '));
  const separator = colWidths.map(w => '\u2500'.repeat(w)).join(dim('\u2500\u253c\u2500'));
  const dataLines = rows.map(row =>
    row.map((cell, i) => padRight(truncate(cell, colWidths[i]), colWidths[i])).join(dim(' \u2502 '))
  );

  return [headerLine, separator, ...dataLines].join('\n');
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.BROWSERUSE_PORT ?? process.env.CDP_REPL_PORT ?? 9876);
const HOST = '127.0.0.1';
const URL_BASE = `http://${HOST}:${PORT}`;
const LOG_FILE = process.env.BROWSERUSE_LOG ?? '/tmp/browseruse.log';
const REPL_PATH = join(dirname(new URL(import.meta.url).pathname), 'repl.ts');

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
  });

  // Detach — don't wait for it
  proc.unref();

  // Poll until ready (up to 10s)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await isUp()) return;
    await Bun.sleep(100);
  }

  error(`REPL failed to start on ${URL_BASE}`);
  console.error(dim(`  Check ${LOG_FILE} for details.`));
  console.error(hint(`is port ${PORT} already in use? override with BROWSERUSE_PORT=<port>`));
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
    error('Eval failed', body);
    console.error(hint('run `browseruse --status` to check the server'));
    process.exit(1);
  }
}

async function getJSON(path: string): Promise<string> {
  const res = await fetch(`${URL_BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  if (res.ok) {
    return body;
  } else {
    error(`Request to ${path} failed (HTTP ${res.status})`, body);
    console.error(hint('run `browseruse --status` to check the server'));
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
    error(`Request to ${path} failed (HTTP ${res.status})`, body);
    console.error(hint('run `browseruse --status` to check the server'));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Uptime formatter
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function cmdServe(_args: string[]): Promise<void> {
  const { runServer } = await import('./repl.ts');
  runServer();
}

async function cmdStatus(args: string[]): Promise<void> {
  const jsonFlag = args.includes('--json');
  if (await isUp()) {
    const body = await getJSON('/health');
    if (jsonFlag) {
      console.log(body);
      return;
    }
    const health = JSON.parse(body);
    const uptime = health.uptime != null ? formatUptime(health.uptime) : 'unknown';
    console.log(`${green('\u25cf')} REPL server is ${green('running')}`);
    console.log(`  ${dim('Uptime:')}    ${uptime}`);
    console.log(`  ${dim('Port:')}      ${PORT}`);
    console.log(`  ${dim('Connected:')} ${health.connected ? green('yes') : yellow('no')}`);
    if (health.sessionId) {
      console.log(`  ${dim('Session:')}   ${health.sessionId}`);
    }
    if (health.managed) {
      const m = health.managed;
      console.log(`  ${dim('Browser:')}   PID ${m.pid}, port ${m.port}, profile ${dim(m.profile)}`);
    }
  } else {
    if (jsonFlag) {
      console.log('{"ok":false,"error":"down"}');
      process.exit(1);
    }
    console.log(`${red('\u25cf')} REPL server is ${red('not running')}`);
    console.error(hint('run `browseruse --start` to start the server'));
    process.exit(1);
  }
}

async function cmdStart(_args: string[]): Promise<void> {
  await startRepl();
  console.log(`${green('\u25cf')} REPL server started on ${URL_BASE}`);
}

async function cmdStop(_args: string[]): Promise<void> {
  if (await isUp()) {
    await stopRepl();
    console.log(`${dim('\u25cf')} REPL server stopped`);
  } else {
    console.log(`${dim('\u25cf')} REPL server is already stopped`);
  }
}

async function cmdRestart(_args: string[]): Promise<void> {
  await stopRepl();
  await Bun.sleep(200);
  await startRepl();
  console.log(`${green('\u25cf')} REPL server restarted on ${URL_BASE}`);
}

async function cmdLogs(_args: string[]): Promise<void> {
  const proc = Bun.spawn(['tail', '-f', LOG_FILE], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.exited;
}

async function cmdEval(args: string[]): Promise<void> {
  if (args.length < 1) {
    const code = await Bun.stdin.text();
    if (code.trim()) await postEval(code);
  } else {
    await postEval(args.join(' '));
  }
}

async function cmdBrowsers(args: string[]): Promise<void> {
  const body = await getJSON('/browsers');
  if (args.includes('--json')) {
    console.log(body);
    return;
  }
  const browsers: Array<{ name: string; port: number; profileDir: string; wsUrl: string }> = JSON.parse(body);
  console.log(formatTable({
    headers: ['NAME', 'PORT', 'PROFILE DIR', 'WS URL'],
    rows: browsers.map(b => [b.name, String(b.port), b.profileDir, b.wsUrl]),
  }));
}

async function cmdTabs(args: string[]): Promise<void> {
  const res = await fetch(`${URL_BASE}/tabs`, { signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  if (!res.ok) {
    error('Not connected to a browser', body);
    console.error(hint('run `browseruse connect` to connect to a browser'));
    process.exit(1);
  }
  if (args.includes('--json')) {
    console.log(body);
    return;
  }
  const tabs: Array<{ targetId: string; type: string; title: string; url: string }> = JSON.parse(body);
  console.log(formatTable({
    headers: ['TARGET ID', 'TYPE', 'TITLE', 'URL'],
    rows: tabs.map(t => [t.targetId, t.type, t.title, t.url]),
  }));
}

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

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

type Command = {
  name: string;
  description: string;
  group: 'lifecycle' | 'commands';
  needsRepl: boolean;
  run: (args: string[]) => Promise<void>;
};

const commands: Command[] = [
  // Lifecycle — no REPL auto-start
  { name: '--serve',   description: 'Run REPL server (internal)',      group: 'lifecycle', needsRepl: false, run: cmdServe },
  { name: '--status',  description: 'Health check',                    group: 'lifecycle', needsRepl: false, run: cmdStatus },
  { name: '--start',   description: 'Start REPL server',              group: 'lifecycle', needsRepl: false, run: cmdStart },
  { name: '--stop',    description: 'Stop REPL + managed browser',    group: 'lifecycle', needsRepl: false, run: cmdStop },
  { name: '--restart', description: 'Restart REPL server',            group: 'lifecycle', needsRepl: false, run: cmdRestart },
  { name: '--logs',    description: 'Tail server log',                group: 'lifecycle', needsRepl: false, run: cmdLogs },
  // Commands — auto-start REPL
  { name: 'launch',    description: 'Launch a managed Chrome browser', group: 'commands', needsRepl: true,  run: cmdLaunch },
  { name: 'browsers',  description: 'List detected browsers',         group: 'commands', needsRepl: true,  run: cmdBrowsers },
  { name: 'tabs',      description: 'List page targets',              group: 'commands', needsRepl: true,  run: cmdTabs },
  { name: 'connect',   description: 'Connect session to a browser',   group: 'commands', needsRepl: true,  run: cmdConnect },
  { name: 'eval',      description: 'Eval JS explicitly',             group: 'commands', needsRepl: true,  run: cmdEval },
  { name: 'screenshot',description: 'Capture screenshot',             group: 'commands', needsRepl: true,  run: cmdScreenshot },
];

const commandMap = new Map(commands.map(c => [c.name, c]));

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
  const lines = [
    `${bold('browseruse')} \u2014 Launch, connect, and control Chrome via CDP.`,
    '',
    bold('Usage:'),
    `  ${cyan("browseruse '<js>'")}                    Eval JS in the persistent REPL`,
    `  ${cyan("browseruse eval '<js>'")}               Same, explicit subcommand`,
    '',
    bold('Server:'),
    `  ${cyan('browseruse --status')} ${dim('[--json]')}        Health check`,
    `  ${cyan('browseruse --start')}                   Start REPL server`,
    `  ${cyan('browseruse --stop')}                    Stop REPL + managed browser`,
    `  ${cyan('browseruse --restart')}                 Restart REPL server`,
    `  ${cyan('browseruse --logs')}                    Tail server log`,
    '',
    bold('Commands:'),
    `  ${cyan('browseruse launch')} ${dim('[options]')}        Launch a managed Chrome browser`,
    `  ${cyan('browseruse browsers')} ${dim('[--json]')}       List detected browsers`,
    `  ${cyan('browseruse tabs')} ${dim('[--json]')}           List page targets`,
    `  ${cyan('browseruse connect')} ${dim('[options]')}       Connect session to a browser`,
    `  ${cyan('browseruse screenshot')} ${dim('[--output f]')} Capture screenshot`,
    '',
    bold('Launch options:'),
    `  --profile <name>    Profile name (default: 'default')`,
    `  --headless          Run headless`,
    `  --port <num>        Debugging port (default: ephemeral)`,
    '',
    bold('Connect options:'),
    `  --profile-dir <p>   Connect to specific browser profile dir`,
    `  --ws-url <url>      Connect to specific WebSocket URL`,
    `  --timeout <ms>      Connection timeout (default: 5000)`,
    `  --no-auto-launch    Don't auto-launch if no browser detected`,
    '',
    bold('Environment:'),
    `  BROWSERUSE_PORT     REPL server port (default: 9876)`,
    `  BROWSERUSE_LOG      Log file path (default: /tmp/browseruse.log)`,
  ];
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // No args: read from stdin
  if (args.length === 0) {
    await startRepl();
    const code = await Bun.stdin.text();
    if (code.trim()) {
      await postEval(code);
    }
    return;
  }

  const cmd = args[0]!;
  const rest = args.slice(1);

  // Fast-path: help / version (no server needed, no dynamic imports)
  if (cmd === '--help' || cmd === '-h') { printUsage(); return; }
  if (cmd === '--version' || cmd === '-v') { console.log('browseruse 0.3.0'); return; }

  // Command registry lookup
  const command = commandMap.get(cmd);
  if (command) {
    if (command.needsRepl) await startRepl();
    await command.run(rest);
    return;
  }

  // Default: bare string — treat as eval (backward compat)
  await startRepl();
  await postEval(args.join(' '));
}

main().catch(e => {
  const msg = e.message ?? String(e);
  if (msg.includes('ECONNREFUSED') || msg.includes('ConnectionRefused') || msg.includes('fetch failed')) {
    error('Cannot connect to REPL server');
    console.error(hint('run `browseruse --start` to start the server'));
  } else {
    error(msg);
  }
  process.exit(1);
});
