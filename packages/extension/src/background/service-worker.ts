/**
 * Service worker — main background script for the Chrome extension.
 *
 * Uses a direct WebSocket connection to the browseruse REPL server
 * (ws://127.0.0.1:9876/ws). Routes JSON-RPC requests to tab handlers
 * (chrome.tabs) or debugger handlers (chrome.debugger).
 */

import { handleTabsList, handleTabCreate, handleTabClose, handleTabNavigate, handleTabActivate, handleTabReload } from './tab-handlers';
import {
  attach as debuggerAttach,
  detach as debuggerDetach,
  sendCommand as debuggerSendCommand,
  getAttachedTabs,
  setEventCallback,
  setDetachCallback,
} from './debugger-handler';
import { Methods, ErrorCodes, Events, makeSuccess, makeError, makeNotification } from '@browseruse/protocol';

const WS_URL = 'ws://127.0.0.1:9876/ws';

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let nativeConnected = false;

function connectWebSocket(): void {
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    nativeConnected = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    ws!.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 'ext-handshake',
      method: 'session.handshake',
      params: { clientType: 'extension', version: '0.3.0' },
    }));
    nativeConnected = true;
    // Notify popup
    chrome.runtime.sendMessage({ type: 'connection-state', connected: true }).catch(() => {});
  };

  ws.onmessage = (event) => {
    try {
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      handleServerMessage(JSON.parse(data));
    } catch {
      // Ignore parse errors
    }
  };

  ws.onclose = () => {
    nativeConnected = false;
    ws = null;
    // Notify popup
    chrome.runtime.sendMessage({ type: 'connection-state', connected: false }).catch(() => {});
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this and handle reconnection
  };
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, 3000);
}

// Connect on startup
chrome.runtime.onInstalled.addListener(() => { connectWebSocket(); });
chrome.runtime.onStartup.addListener(() => { connectWebSocket(); });
connectWebSocket();

// ---------------------------------------------------------------------------
// Debugger event forwarding
// ---------------------------------------------------------------------------

setEventCallback((tabId, method, params) => {
  // Forward CDP events from chrome.debugger back to the server
  sendToServer(makeNotification(Events.DEBUGGER_EVENT, { tabId, method, params }));
});

setDetachCallback((tabId, reason) => {
  sendToServer(makeNotification(Events.DEBUGGER_DETACHED, { tabId, reason }));
});

// ---------------------------------------------------------------------------
// Message routing from popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (message.type === 'get-status') {
    sendResponse({
      connected: nativeConnected,
      attachedTabs: getAttachedTabs(),
    });
    return true;
  }
});

// ---------------------------------------------------------------------------
// JSON-RPC request handling
// ---------------------------------------------------------------------------

type MethodHandler = (params: any) => Promise<unknown>;

const handlers: Record<string, MethodHandler> = {
  [Methods.TABS_LIST]: handleTabsList,
  [Methods.TABS_CREATE]: handleTabCreate,
  [Methods.TABS_CLOSE]: handleTabClose,
  [Methods.TABS_NAVIGATE]: handleTabNavigate,
  [Methods.TABS_ACTIVATE]: handleTabActivate,
  [Methods.TABS_RELOAD]: handleTabReload,
  [Methods.DEBUGGER_ATTACH]: (params) => debuggerAttach(params.tabId),
  [Methods.DEBUGGER_DETACH]: (params) => debuggerDetach(params.tabId),
  [Methods.DEBUGGER_SEND_COMMAND]: (params) => debuggerSendCommand(params.tabId, params.method, params.params),
};

async function handleServerMessage(msg: any): Promise<void> {
  // Only handle requests (have id + method)
  if (!msg || !msg.id || !msg.method) return;

  const { id, method, params } = msg;

  try {
    let result: unknown;

    if (handlers[method]) {
      result = await handlers[method](params ?? {});
    } else {
      sendToServer(makeError(id, ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`));
      return;
    }

    sendToServer(makeSuccess(id, result));
  } catch (err: any) {
    sendToServer(makeError(id, err.code ?? ErrorCodes.INTERNAL_ERROR, err.message ?? String(err)));
  }
}

// ---------------------------------------------------------------------------
// Send response back to server via WebSocket
// ---------------------------------------------------------------------------

function sendToServer(msg: object): void {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // WebSocket may be closing
    }
  }
}
