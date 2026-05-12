/**
 * Unix socket server for NDJSON control protocol.
 *
 * Listens on ~/.browseruse/browseruse.sock and accepts one-shot NDJSON
 * requests from local clients (e.g. Sarea, scripts, nc -U).
 *
 * Protocol:
 *   Client connects → sends one line of JSON (terminated by \n) →
 *   server responds with one line of JSON → connection closes.
 *
 * Request format:
 *   { "protocolVersion": 1, "operation": { "kind": "browseruse.<op>", "payload": { ... } } }
 *
 * Response format:
 *   { "ok": true, "result": { "kind": "<kind>", "data": { ... } } }
 *   { "ok": false, "error": { "code": "<code>", "message": "<msg>" } }
 */

import type { Session } from './session.ts';
import { listPageTargets } from './session.ts';
import { getExtensionConnected } from './ws-handler.ts';
import { homedir } from 'os';
import { join } from 'path';
import { unlinkSync, chmodSync, mkdirSync, existsSync } from 'fs';

const BROWSERUSE_DIR = join(homedir(), '.browseruse');
const SOCKET_PATH = join(BROWSERUSE_DIR, 'browseruse.sock');
const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Request {
  protocolVersion: number;
  operation: {
    kind: string;
    payload?: Record<string, unknown>;
    tabId?: number;
  };
}

interface Response {
  ok: boolean;
  error?: { code: string; message: string };
  result?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from repl.ts to avoid circular deps)
// ---------------------------------------------------------------------------

function isExpression(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  if (/[;\n]/.test(trimmed)) return false;
  if (/^(let|const|var|if|for|while|do|switch|class|function|throw|try|return|import|export)\b/.test(trimmed)) return false;
  return true;
}

function serialize(v: unknown): unknown {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? val.toString() : val));
  } catch {
    return String(v);
  }
}

async function runSnippet(code: string): Promise<unknown> {
  const body = isExpression(code) ? `return (${code});` : code;
  const wrapped = `(async () => { ${body} })()`;
  return await (0, eval)(wrapped);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(raw: string, session: Session, startedAt: number): Promise<Response> {
  let req: Request;
  try {
    req = JSON.parse(raw.trim());
  } catch {
    return { ok: false, error: { code: 'parse_error', message: 'Invalid JSON' } };
  }

  if (req.protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, error: { code: 'version_mismatch', message: `Expected protocol version ${PROTOCOL_VERSION}, got ${req.protocolVersion}` } };
  }

  if (!req.operation?.kind) {
    return { ok: false, error: { code: 'invalid_request', message: 'Missing operation.kind' } };
  }

  try {
    switch (req.operation.kind) {
      case 'browseruse.ping':
        return { ok: true, result: { kind: 'pong' } };

      case 'browseruse.status':
        return { ok: true, result: { kind: 'status', data: {
          connected: session.isConnected(),
          sessionId: session.getActiveSession() ?? null,
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          extensionConnected: getExtensionConnected(),
        }}};

      case 'browseruse.connect':
        await session.connect(req.operation.payload ?? {});
        return { ok: true, result: { kind: 'connected' } };

      case 'browseruse.eval': {
        const code = (req.operation.payload as any)?.code;
        if (!code || typeof code !== 'string') {
          return { ok: false, error: { code: 'invalid_params', message: 'Missing or invalid "code" in payload' } };
        }
        const result = await runSnippet(code);
        return { ok: true, result: { kind: 'eval', data: { value: serialize(result) } } };
      }

      case 'browseruse.tabs': {
        if (!session.isConnected()) {
          return { ok: false, error: { code: 'not_connected', message: 'Not connected to a browser' } };
        }
        const tabs = await listPageTargets(session);
        return { ok: true, result: { kind: 'tabs', data: tabs } };
      }

      case 'browseruse.cdpRaw': {
        const method = (req.operation.payload as any)?.method;
        const params = (req.operation.payload as any)?.params ?? {};
        if (!method || typeof method !== 'string') {
          return { ok: false, error: { code: 'invalid_params', message: 'Missing or invalid "method" in payload' } };
        }
        if (!session.isConnected()) {
          return { ok: false, error: { code: 'not_connected', message: 'Not connected to a browser' } };
        }
        const cdpResult = await session._call(method, params);
        return { ok: true, result: { kind: 'cdp', data: cdpResult } };
      }

      default:
        return { ok: false, error: { code: 'unknown_operation', message: `Unknown operation: ${req.operation.kind}` } };
    }
  } catch (e: any) {
    return { ok: false, error: { code: 'internal_error', message: e.message ?? String(e) } };
  }
}

// ---------------------------------------------------------------------------
// Socket server
// ---------------------------------------------------------------------------

/** Per-connection buffer to accumulate data until we see a newline. */
const buffers = new WeakMap<object, string>();

export function startControlSocket(session: Session, startedAt: number): void {
  // Ensure ~/.browseruse/ exists
  if (!existsSync(BROWSERUSE_DIR)) {
    mkdirSync(BROWSERUSE_DIR, { recursive: true });
  }

  // Remove stale socket file
  try { unlinkSync(SOCKET_PATH); } catch {}

  Bun.listen({
    unix: SOCKET_PATH,
    socket: {
      open(socket) {
        buffers.set(socket, '');
      },
      data(socket, data) {
        let buf = (buffers.get(socket) ?? '') + data.toString();
        const newlineIdx = buf.indexOf('\n');
        if (newlineIdx === -1) {
          // Haven't received a complete line yet, buffer and wait
          buffers.set(socket, buf);
          return;
        }

        const line = buf.slice(0, newlineIdx);
        buffers.delete(socket);

        handleRequest(line, session, startedAt)
          .then(response => {
            socket.write(JSON.stringify(response) + '\n');
            socket.end();
          })
          .catch(() => {
            socket.end();
          });
      },
      close() {},
      error(_socket, err) {
        // Log but don't crash
        if (process.env.DEBUG) {
          console.error('[control-socket] error:', err);
        }
      },
    },
  });

  // Restrict permissions to owner only
  chmodSync(SOCKET_PATH, 0o600);
}

export function getSocketPath(): string {
  return SOCKET_PATH;
}
