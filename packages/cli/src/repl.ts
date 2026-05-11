/**
 * browseruse REPL — HTTP server holding one persistent CDP Session.
 *
 * Endpoints (bind 127.0.0.1:9876 by default; override with $BROWSERUSE_PORT):
 *   POST /eval      body = raw JS to evaluate (NOT JSON-wrapped).
 *                   Top-level await supported. Single expression auto-returns.
 *                   Response: plain text result or error with status 500.
 *   GET  /health    {"ok":true,"uptime":<seconds>,"connected":<bool>,"sessionId":<string|null>}
 *   GET  /browsers  JSON array of detected browsers
 *   GET  /tabs      JSON array of page targets (requires connected session)
 *   POST /connect   Connect session. Body: JSON ConnectOptions or empty for auto.
 *   POST /launch    Launch managed browser. Body: JSON LaunchOptions or empty.
 *   POST /quit      Graceful shutdown. Returns {"ok":true} then exits.
 *   WS   /ws        JSON-RPC 2.0 WebSocket for agents and Chrome extension.
 *
 * State: `session`, the active sessionId, event subscribers, and any
 * `globalThis.<name>` you set persist across requests for the lifetime of
 * the process.
 */

import { Session, listPageTargets, resolveWsUrl, detectBrowsers } from './session.ts';
import { launchBrowser, getManagedBrowser, closeManagedBrowser } from './browser.ts';
import * as Generated from './generated.ts';
import { handleWsOpen, handleWsClose, handleWsMessage, type WsData } from './ws-handler.ts';

const session = new Session();
(globalThis as any).session = session;
(globalThis as any).listPageTargets = () => listPageTargets(session);
(globalThis as any).resolveWsUrl = resolveWsUrl;
(globalThis as any).detectBrowsers = detectBrowsers;
(globalThis as any).launchBrowser = launchBrowser;
(globalThis as any).getManagedBrowser = getManagedBrowser;
(globalThis as any).closeManagedBrowser = closeManagedBrowser;
(globalThis as any).CDP = Generated;

const PORT = Number(process.env.BROWSERUSE_PORT ?? process.env.CDP_REPL_PORT ?? 9876);
const startedAt = Date.now();

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

const TEXT = { 'content-type': 'text/plain; charset=utf-8' } as const;
const JSON_CT = { 'content-type': 'application/json; charset=utf-8' } as const;

function renderResult(v: unknown): string {
  const s = serialize(v);
  if (s === undefined || s === null) return '';
  if (typeof s === 'string') return s;
  if (Array.isArray(s) && s.length === 0) return '';
  if (typeof s === 'object' && s !== null && Object.keys(s as object).length === 0) return '';
  return JSON.stringify(s);
}

export function runServer(): void {
  const server = Bun.serve<WsData>({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(req, server) {
      const url = new URL(req.url);

      // WS /ws — upgrade to WebSocket
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req, { data: { clientId: '' } });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }

      // GET /health
      if (req.method === 'GET' && url.pathname === '/health') {
        return Response.json({
          ok: true,
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          connected: session.isConnected(),
          sessionId: session.getActiveSession() ?? null,
          managedBrowser: getManagedBrowser() ?? null,
        });
      }

      // GET /browsers
      if (req.method === 'GET' && url.pathname === '/browsers') {
        try {
          const browsers = await detectBrowsers();
          return new Response(JSON.stringify(browsers, null, 2), { headers: JSON_CT });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSON_CT });
        }
      }

      // GET /tabs
      if (req.method === 'GET' && url.pathname === '/tabs') {
        if (!session.isConnected()) {
          return new Response(JSON.stringify({ error: 'Not connected. POST /connect first.' }), { status: 400, headers: JSON_CT });
        }
        try {
          const tabs = await listPageTargets(session);
          return new Response(JSON.stringify(tabs, null, 2), { headers: JSON_CT });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: JSON_CT });
        }
      }

      // POST /connect
      if (req.method === 'POST' && url.pathname === '/connect') {
        try {
          const body = await req.text();
          const opts = body.trim() ? JSON.parse(body) : {};
          await session.connect(opts);
          return Response.json({
            ok: true,
            connected: true,
            sessionId: session.getActiveSession() ?? null,
            managedBrowser: getManagedBrowser() ?? null,
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: JSON_CT });
        }
      }

      // POST /launch
      if (req.method === 'POST' && url.pathname === '/launch') {
        try {
          const body = await req.text();
          const opts = body.trim() ? JSON.parse(body) : {};
          const browser = await launchBrowser(opts);
          return Response.json({ ok: true, ...browser });
        } catch (e: any) {
          return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: JSON_CT });
        }
      }

      // POST /eval
      if (req.method === 'POST' && url.pathname === '/eval') {
        const code = await req.text();
        if (!code.trim()) {
          return new Response('empty body\n', { status: 400, headers: TEXT });
        }
        try {
          const result = await runSnippet(code);
          const body = renderResult(result);
          return new Response(body, { status: 200, headers: TEXT });
        } catch (e: any) {
          const msg = (e?.stack ?? e?.message ?? String(e)) + '\n';
          return new Response(msg, { status: 500, headers: TEXT });
        }
      }

      // POST /quit
      if (req.method === 'POST' && url.pathname === '/quit') {
        setTimeout(async () => {
          await closeManagedBrowser();
          server.stop(true);
          session.close();
          process.exit(0);
        }, 50);
        return Response.json({ ok: true });
      }

      return new Response('not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        handleWsOpen(ws);
      },
      message(ws, message) {
        handleWsMessage(ws, message as string | Buffer, session, startedAt);
      },
      close(ws) {
        handleWsClose(ws, session, startedAt);
      },
    },
  });

  // Clean up managed browser on unexpected exit
  process.on('SIGINT', async () => {
    await closeManagedBrowser();
    session.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await closeManagedBrowser();
    session.close();
    process.exit(0);
  });

  console.log(JSON.stringify({
    ok: true,
    ready: true,
    port: server.port,
    message: `browseruse REPL listening on http://127.0.0.1:${server.port}`,
  }));
}

if (import.meta.main) {
  runServer();
}
