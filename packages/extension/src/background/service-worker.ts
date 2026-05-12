/**
 * Service worker — main background script for the Chrome extension.
 *
 * Uses native messaging (chrome.runtime.connectNative) to communicate with
 * the browseruse REPL server via the native host bridge. Routes JSON-RPC
 * requests to tab handlers (chrome.tabs) or debugger handlers (chrome.debugger).
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

const NATIVE_HOST_NAME = 'com.browseruse.host';

// ---------------------------------------------------------------------------
// Native messaging connection
// ---------------------------------------------------------------------------

let nativePort: chrome.runtime.Port | null = null;
let nativeConnected = false;

function connectNative(): void {
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (err) {
    nativeConnected = false;
    scheduleReconnect();
    return;
  }

  nativePort.onMessage.addListener((message) => {
    handleServerMessage(message);
  });

  nativePort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    nativeConnected = false;
    nativePort = null;
    // Notify popup
    chrome.runtime.sendMessage({ type: 'connection-state', connected: false }).catch(() => {});
    scheduleReconnect();
  });

  nativeConnected = true;
  // Notify popup
  chrome.runtime.sendMessage({ type: 'connection-state', connected: true }).catch(() => {});
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, 3000);
}

// Connect on startup
chrome.runtime.onInstalled.addListener(() => { connectNative(); });
chrome.runtime.onStartup.addListener(() => { connectNative(); });
connectNative();

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
// Send response back to server via native messaging
// ---------------------------------------------------------------------------

function sendToServer(msg: object): void {
  if (nativePort) {
    try {
      nativePort.postMessage(msg);
    } catch {
      // Port may be disconnected
    }
  }
}
