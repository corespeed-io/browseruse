/**
 * WebSocket connection manager for JSON-RPC 2.0 communication.
 *
 * Manages connected clients (agents and extension), routes JSON-RPC messages,
 * and forwards extension-bound methods to the Chrome extension.
 */

import type { ServerWebSocket } from 'bun';
import type { Session } from './session.ts';
import { getManagedBrowser } from './browser.ts';
import {
  type JsonRpcRequest,
  type JsonRpcId,
  isRequest,
  makeSuccess,
  makeError,
  makeNotification,
  Methods,
  SERVER_METHODS,
  EXTENSION_METHODS,
  Events,
  ErrorCodes,
} from '@browseruse/protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClientType = 'extension' | 'agent' | 'cli';

export interface ClientInfo {
  id: string;
  type: ClientType;
  version?: string;
  ws: ServerWebSocket<WsData>;
}

export interface WsData {
  clientId: string;
}

type PendingForward = {
  resolve: (result: unknown) => void;
  reject: (error: { code: number; message: string; data?: unknown }) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Client Registry
// ---------------------------------------------------------------------------

const clients = new Map<string, ClientInfo>();
let extensionClient: ClientInfo | undefined;
let nextClientNum = 1;
const pendingForwards = new Map<string, PendingForward>();
let forwardIdCounter = 1;

const FORWARD_TIMEOUT_MS = 30_000;

export function getExtensionConnected(): boolean {
  return extensionClient !== undefined;
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle handlers
// ---------------------------------------------------------------------------

export function handleWsOpen(ws: ServerWebSocket<WsData>): void {
  const clientId = `client-${nextClientNum++}`;
  ws.data = { clientId };
  // Client registered on handshake, not on open.
}

export function handleWsClose(ws: ServerWebSocket<WsData>, session: Session, startedAt: number): void {
  const clientId = ws.data?.clientId;
  if (!clientId) return;

  const client = clients.get(clientId);
  if (!client) return;

  if (extensionClient?.id === clientId) {
    extensionClient = undefined;
    // Notify remaining clients that extension disconnected
    broadcast(makeNotification(Events.EXTENSION_DISCONNECTED, { clientId }));
    // Reject all pending forwards
    for (const [fwdId, pending] of pendingForwards) {
      clearTimeout(pending.timer);
      pending.reject({ code: ErrorCodes.EXTENSION_NOT_CONNECTED, message: 'Extension disconnected' });
      pendingForwards.delete(fwdId);
    }
  }

  clients.delete(clientId);
}

export function handleWsMessage(
  ws: ServerWebSocket<WsData>,
  message: string | Buffer,
  session: Session,
  startedAt: number,
): void {
  const raw = typeof message === 'string' ? message : message.toString();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ws.send(JSON.stringify(makeError(null, ErrorCodes.PARSE_ERROR, 'Parse error')));
    return;
  }

  // Handle responses from the extension (forwarded results)
  if (isForwardResponse(parsed)) {
    handleForwardResponse(parsed as any);
    return;
  }

  if (!isRequest(parsed)) {
    ws.send(JSON.stringify(makeError(null, ErrorCodes.INVALID_REQUEST, 'Invalid request')));
    return;
  }

  handleRequest(ws, parsed, session, startedAt);
}

// ---------------------------------------------------------------------------
// Request routing
// ---------------------------------------------------------------------------

async function handleRequest(
  ws: ServerWebSocket<WsData>,
  req: JsonRpcRequest,
  session: Session,
  startedAt: number,
): Promise<void> {
  const { id, method, params } = req;

  try {
    if (SERVER_METHODS.has(method)) {
      const result = await handleServerMethod(ws, method, params ?? {}, session, startedAt);
      ws.send(JSON.stringify(makeSuccess(id, result)));
    } else if (EXTENSION_METHODS.has(method)) {
      const result = await forwardToExtension(id, method, params ?? {});
      ws.send(JSON.stringify(makeSuccess(id, result)));
    } else {
      ws.send(JSON.stringify(makeError(id, ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`)));
    }
  } catch (err: any) {
    const code = err.code ?? ErrorCodes.INTERNAL_ERROR;
    const message = err.message ?? 'Internal error';
    ws.send(JSON.stringify(makeError(id, code, message, err.data)));
  }
}

// ---------------------------------------------------------------------------
// Server-handled methods
// ---------------------------------------------------------------------------

async function handleServerMethod(
  ws: ServerWebSocket<WsData>,
  method: string,
  params: Record<string, unknown>,
  session: Session,
  startedAt: number,
): Promise<unknown> {
  switch (method) {
    case Methods.SESSION_HANDSHAKE: {
      const clientType = (params.clientType as ClientType) ?? 'agent';
      const version = params.version as string | undefined;
      const clientId = ws.data.clientId;

      const client: ClientInfo = { id: clientId, type: clientType, version, ws };
      clients.set(clientId, client);

      if (clientType === 'extension') {
        extensionClient = client;
        // Notify others that extension connected
        broadcastExcept(clientId, makeNotification(Events.EXTENSION_CONNECTED, { clientId, version }));
      }

      return {
        serverVersion: '0.3.0',
        sessionConnected: session.isConnected(),
        clientId,
      };
    }

    case Methods.SESSION_PING:
      return { pong: true, timestamp: Date.now() };

    case Methods.SESSION_STATUS: {
      const managed = getManagedBrowser();
      return {
        connected: session.isConnected(),
        sessionId: session.getActiveSession() ?? null,
        managedBrowser: managed ? { pid: managed.pid, port: managed.port, profile: managed.profile } : null,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        extensionConnected: extensionClient !== undefined,
      };
    }

    case Methods.SESSION_CDP_RAW: {
      const cdpMethod = params.method as string;
      const cdpParams = (params.params as Record<string, unknown>) ?? {};
      const tabId = params.tabId as number | undefined;
      if (!cdpMethod) {
        throw { code: ErrorCodes.INVALID_PARAMS, message: 'Missing "method" param' };
      }

      // If a direct CDP session is connected, use it
      if (session.isConnected()) {
        try {
          const result = await session._call(cdpMethod, cdpParams);
          return result;
        } catch (err: any) {
          throw { code: ErrorCodes.CDP_ERROR, message: err.message ?? String(err) };
        }
      }

      // Otherwise, forward to extension's debugger if available
      if (extensionClient && tabId !== undefined) {
        return forwardToExtension(
          'cdp-raw',
          Methods.DEBUGGER_SEND_COMMAND,
          { tabId, method: cdpMethod, params: cdpParams },
        );
      }

      throw { code: ErrorCodes.NOT_CONNECTED, message: 'No CDP session or extension debugger available' };
    }

    default:
      throw { code: ErrorCodes.METHOD_NOT_FOUND, message: `Unknown server method: ${method}` };
  }
}

// ---------------------------------------------------------------------------
// Extension forwarding
// ---------------------------------------------------------------------------

function forwardToExtension(
  _originalId: JsonRpcId,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!extensionClient) {
    return Promise.reject({ code: ErrorCodes.EXTENSION_NOT_CONNECTED, message: 'No extension connected' });
  }

  const fwdId = `fwd-${forwardIdCounter++}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingForwards.delete(fwdId);
      reject({ code: ErrorCodes.EXTENSION_TIMEOUT, message: `Extension did not respond within ${FORWARD_TIMEOUT_MS}ms` });
    }, FORWARD_TIMEOUT_MS);

    pendingForwards.set(fwdId, { resolve, reject, timer });

    // Send to extension with our internal forward ID
    const msg = {
      jsonrpc: '2.0' as const,
      id: fwdId,
      method,
      params,
    };
    extensionClient!.ws.send(JSON.stringify(msg));
  });
}

function isForwardResponse(msg: unknown): boolean {
  const m = msg as any;
  return (
    m?.jsonrpc === '2.0' &&
    typeof m.id === 'string' &&
    (m.id as string).startsWith('fwd-') &&
    (m.result !== undefined || m.error !== undefined)
  );
}

function handleForwardResponse(msg: { id: string; result?: unknown; error?: { code: number; message: string; data?: unknown } }): void {
  const pending = pendingForwards.get(msg.id);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingForwards.delete(msg.id);

  if (msg.error) {
    pending.reject(msg.error);
  } else {
    pending.resolve(msg.result);
  }
}

// ---------------------------------------------------------------------------
// Broadcasting
// ---------------------------------------------------------------------------

function broadcast(msg: object): void {
  const raw = JSON.stringify(msg);
  for (const client of clients.values()) {
    try { client.ws.send(raw); } catch { /* ignore dead sockets */ }
  }
}

function broadcastExcept(excludeClientId: string, msg: object): void {
  const raw = JSON.stringify(msg);
  for (const client of clients.values()) {
    if (client.id === excludeClientId) continue;
    try { client.ws.send(raw); } catch { /* ignore dead sockets */ }
  }
}
