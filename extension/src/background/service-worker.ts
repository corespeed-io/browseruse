/**
 * Service worker — main background script for the Chrome extension.
 *
 * Ensures the offscreen document stays alive, routes incoming JSON-RPC
 * requests from the server (relayed via offscreen) to appropriate handlers,
 * and sends responses back.
 */

import { handleTabsList, handleTabCreate, handleTabClose, handleTabNavigate, handleTabActivate, handleTabReload } from './tab-handlers';
import { handlePageScreenshot, handlePageEval, handlePageGetUrl, handlePageGetTitle } from './page-handlers';
import { handleGetCookies, handleSetCookie, handleDeleteCookies } from './network-handlers';
import { Methods, ErrorCodes, makeSuccess, makeError } from '@browseruse/protocol';

// ---------------------------------------------------------------------------
// Offscreen document management
// ---------------------------------------------------------------------------

let offscreenCreating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) return;

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.WEB_RTC as any],
    justification: 'Maintain persistent WebSocket connection to browseruse server',
  });

  await offscreenCreating;
  offscreenCreating = null;
}

// Create offscreen document on install/startup
chrome.runtime.onInstalled.addListener(() => { ensureOffscreen(); });
chrome.runtime.onStartup.addListener(() => { ensureOffscreen(); });

// Also ensure it exists when the service worker wakes up
ensureOffscreen();

// ---------------------------------------------------------------------------
// Connection state tracking
// ---------------------------------------------------------------------------

let wsConnected = false;

// ---------------------------------------------------------------------------
// Message routing from offscreen document
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages from our own extension
  if (sender.id !== chrome.runtime.id) return;

  if (message.type === 'ws-state') {
    wsConnected = message.connected;
    // Notify popup about state change
    chrome.runtime.sendMessage({ type: 'connection-state', connected: wsConnected }).catch(() => {});
    return;
  }

  if (message.type === 'ws-message') {
    handleServerMessage(message.data);
    return;
  }

  if (message.type === 'get-status') {
    sendResponse({ connected: wsConnected });
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
  [Methods.PAGE_SCREENSHOT]: handlePageScreenshot,
  [Methods.PAGE_EVAL]: handlePageEval,
  [Methods.PAGE_GET_URL]: handlePageGetUrl,
  [Methods.PAGE_GET_TITLE]: handlePageGetTitle,
  [Methods.NETWORK_GET_COOKIES]: handleGetCookies,
  [Methods.NETWORK_SET_COOKIE]: handleSetCookie,
  [Methods.NETWORK_DELETE_COOKIES]: handleDeleteCookies,
};

// DOM methods are forwarded to the content script
const DOM_METHODS = new Set([
  Methods.DOM_QUERY, Methods.DOM_QUERY_ALL, Methods.DOM_CLICK,
  Methods.DOM_TYPE, Methods.DOM_GET_TEXT, Methods.DOM_GET_HTML,
]);

async function handleServerMessage(raw: string): Promise<void> {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  // Only handle requests (have id + method)
  if (!msg.id || !msg.method) return;

  const { id, method, params } = msg;

  try {
    let result: unknown;

    if (DOM_METHODS.has(method)) {
      result = await forwardToContentScript(method, params ?? {});
    } else if (handlers[method]) {
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
// Content script communication
// ---------------------------------------------------------------------------

async function forwardToContentScript(method: string, params: Record<string, unknown>): Promise<unknown> {
  const tabId = params.tabId as number;
  if (tabId === undefined) {
    throw { code: ErrorCodes.INVALID_PARAMS, message: 'Missing tabId param' };
  }

  // Send message to content script in the target tab
  const response = await chrome.tabs.sendMessage(tabId, { method, params });

  if (response?.error) {
    throw { code: response.error.code ?? ErrorCodes.INTERNAL_ERROR, message: response.error.message };
  }

  return response?.result;
}

// ---------------------------------------------------------------------------
// Send response back to server via offscreen
// ---------------------------------------------------------------------------

function sendToServer(msg: object): void {
  chrome.runtime.sendMessage({ type: 'ws-send', data: JSON.stringify(msg) }).catch(() => {
    // Offscreen may not be ready
  });
}
