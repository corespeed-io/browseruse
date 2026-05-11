/**
 * REPL server integration tests.
 *
 * Spawns the REPL server on a random port, exercises HTTP endpoints, then
 * shuts it down via POST /quit.
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
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

beforeAll(async () => {
  port = randomPort();
  baseUrl = `http://127.0.0.1:${port}`;

  proc = Bun.spawn(['bun', 'packages/cli/src/repl.ts'], {
    env: { ...process.env, BROWSERUSE_PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await waitForHealth(baseUrl);
});

afterAll(async () => {
  try {
    await fetch(`${baseUrl}/quit`, { method: 'POST' });
  } catch { /* server may already be down */ }
  // Give the process a moment to exit
  await Bun.sleep(200);
  try { proc.kill(); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  test('returns ok and connection status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(body.connected).toBe(false);
    expect(body.sessionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Eval
// ---------------------------------------------------------------------------

describe('POST /eval', () => {
  test('evaluates a simple expression', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: '1+1',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('2');
  });

  test('evaluates a statement with explicit return', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: 'const x = 42; return x;',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('42');
  });

  test('supports await expressions', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: "await Promise.resolve('hi')",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('hi');
  });

  test('returns 400 on empty body', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: '',
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 on whitespace-only body', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: '   ',
    });
    expect(res.status).toBe(400);
  });

  test('returns 500 on runtime error', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: 'undefinedVariable.foo',
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  test('globals persist across eval requests', async () => {
    // Set a global
    const set = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: 'globalThis.__testVal = 99; return "ok";',
    });
    expect(set.status).toBe(200);

    // Read it back
    const get = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: 'globalThis.__testVal',
    });
    expect(get.status).toBe(200);
    const text = await get.text();
    expect(text).toBe('99');
  });

  test('returns empty string for undefined result', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: 'undefined',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });

  test('returns JSON for object results', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: '({a: 1, b: 2})',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ a: 1, b: 2 });
  });

  test('returns JSON for array results', async () => {
    const res = await fetch(`${baseUrl}/eval`, {
      method: 'POST',
      body: '[1, 2, 3]',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Browsers
// ---------------------------------------------------------------------------

describe('GET /browsers', () => {
  test('returns a JSON array', async () => {
    const res = await fetch(`${baseUrl}/browsers`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tabs (no browser connected)
// ---------------------------------------------------------------------------

describe('GET /tabs', () => {
  test('returns 400 when not connected', async () => {
    const res = await fetch(`${baseUrl}/tabs`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

describe('unknown routes', () => {
  test('GET /nonexistent returns 404', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);
  });

  test('POST /nonexistent returns 404', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Quit (run last — tears down the server)
// ---------------------------------------------------------------------------

describe('POST /quit', () => {
  test('returns ok and server goes down', async () => {
    const res = await fetch(`${baseUrl}/quit`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Server should become unreachable
    await Bun.sleep(300);
    let reachable = true;
    try {
      await fetch(`${baseUrl}/health`);
    } catch {
      reachable = false;
    }
    expect(reachable).toBe(false);
  });
});
