/**
 * End-to-end tests: REPL server + headless browser.
 *
 * Launches the REPL, starts a headless Chrome, connects, creates a page,
 * and exercises browser-level operations (tabs, navigation, screenshot, eval).
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Subprocess } from 'bun';

let port: number;
let proc: Subprocess;
let baseUrl: string;

function randomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

async function waitForHealth(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch { /* server not up yet */ }
    await Bun.sleep(100);
  }
  throw new Error(`REPL server did not become healthy within ${timeoutMs}ms`);
}

async function evalCode(code: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${baseUrl}/eval`, { method: 'POST', body: code });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  port = randomPort();
  baseUrl = `http://127.0.0.1:${port}`;

  proc = Bun.spawn(['bun', 'packages/cli/src/repl.ts'], {
    env: { ...process.env, BROWSERUSE_PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await waitForHealth(baseUrl);

  // Launch a headless browser
  const launchRes = await fetch(`${baseUrl}/launch`, {
    method: 'POST',
    body: JSON.stringify({ headless: true, profile: `test-${port}` }),
    headers: { 'content-type': 'application/json' },
  });

  if (!launchRes.ok) {
    const err = await launchRes.text();
    throw new Error(`Failed to launch browser: ${err}`);
  }

  const launchBody = await launchRes.json() as any;
  expect(launchBody.ok).toBe(true);
  expect(typeof launchBody.pid).toBe('number');
  expect(typeof launchBody.port).toBe('number');
  expect(typeof launchBody.profile).toBe('string');
  expect(typeof launchBody.profileDir).toBe('string');

  // Connect to the launched browser
  const connectRes = await fetch(`${baseUrl}/connect`, { method: 'POST', body: '' });
  if (!connectRes.ok) {
    const err = await connectRes.text();
    throw new Error(`Failed to connect to browser: ${err}`);
  }

  // Create a page target (headless Chrome may not have user-visible pages)
  // and attach to it so page-level commands work.
  const createRes = await evalCode(
    "const {targetId} = await session.domains.Target.createTarget({url: 'about:blank'}); await session.use(targetId); return targetId;"
  );
  if (createRes.status !== 200) {
    throw new Error(`Failed to create page target: ${createRes.text}`);
  }
}, 60_000); // generous timeout for browser launch

afterAll(async () => {
  try {
    await fetch(`${baseUrl}/quit`, { method: 'POST' });
  } catch { /* server may already be down */ }
  await Bun.sleep(500);
  try { proc.kill(); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Health after connection
// ---------------------------------------------------------------------------

describe('connected health', () => {
  test('GET /health shows connected: true after connect', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.connected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

describe('tabs', () => {
  test('GET /tabs returns array with at least one page', async () => {
    const res = await fetch(`${baseUrl}/tabs`);
    expect(res.status).toBe(200);
    const tabs = await res.json() as any[];
    expect(Array.isArray(tabs)).toBe(true);
    // We created a page target in beforeAll
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    for (const tab of tabs) {
      expect(typeof tab.targetId).toBe('string');
      expect(typeof tab.url).toBe('string');
      expect(typeof tab.type).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('navigation', () => {
  test('navigate to about:blank succeeds via eval', async () => {
    const { status } = await evalCode("await session.Page.navigate({url: 'about:blank'})");
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// CDP Runtime.evaluate via eval endpoint
// ---------------------------------------------------------------------------

describe('CDP Runtime.evaluate', () => {
  test('evaluates JavaScript in the browser context', async () => {
    const { status, text } = await evalCode(
      "await session.Runtime.evaluate({expression: '1 + 2', returnByValue: true})",
    );
    expect(status).toBe(200);
    const result = JSON.parse(text);
    expect(result.result.value).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

describe('screenshot', () => {
  test('captures a valid PNG screenshot', async () => {
    const screenshotPath = join(tmpdir(), `browseruse-test-${Date.now()}.png`);

    const { status, text } = await evalCode(`
      const {data} = await session.Page.captureScreenshot({format: 'png'});
      const buf = Buffer.from(data, 'base64');
      await Bun.write('${screenshotPath}', buf);
      return buf.length;
    `);
    expect(status).toBe(200);
    const size = Number(text);
    expect(size).toBeGreaterThan(0);
    expect(existsSync(screenshotPath)).toBe(true);

    // Verify PNG magic bytes: 0x89 P N G
    const file = Bun.file(screenshotPath);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4E);
    expect(bytes[3]).toBe(0x47);

    // Clean up
    try { unlinkSync(screenshotPath); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Quit cleanup
// ---------------------------------------------------------------------------

describe('quit', () => {
  test('POST /quit cleans up browser and server', async () => {
    // Get managed browser PID before quitting
    const healthRes = await fetch(`${baseUrl}/health`);
    const health = await healthRes.json() as any;
    const browserPid = health.managedBrowser?.pid;

    const res = await fetch(`${baseUrl}/quit`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);

    // Wait for cleanup
    await Bun.sleep(1000);

    // Server should be unreachable
    let serverReachable = true;
    try {
      await fetch(`${baseUrl}/health`);
    } catch {
      serverReachable = false;
    }
    expect(serverReachable).toBe(false);

    // Browser process should be gone (if we had its PID)
    if (browserPid) {
      let alive = true;
      try { process.kill(browserPid, 0); } catch { alive = false; }
      expect(alive).toBe(false);
    }
  });
});
