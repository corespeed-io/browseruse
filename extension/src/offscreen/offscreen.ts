/**
 * Offscreen document — persistent WebSocket connection to the REPL server.
 *
 * Chrome Manifest V3 service workers cannot hold long-lived WebSocket connections
 * (they get terminated after ~30s of inactivity). The offscreen document runs as
 * a hidden page that keeps the WebSocket alive and relays JSON-RPC messages
 * between the server and the service worker via chrome.runtime messaging.
 */

const DEFAULT_URL = 'ws://127.0.0.1:9876/ws';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let serverUrl = DEFAULT_URL;

// Load stored URL
chrome.storage.local.get('serverUrl', (data) => {
  if (data.serverUrl) serverUrl = data.serverUrl;
  connect();
});

// Listen for URL changes from popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.serverUrl?.newValue) {
    serverUrl = changes.serverUrl.newValue;
    if (ws) {
      ws.close();
      ws = null;
    }
    reconnectAttempts = 0;
    connect();
  }
});

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(serverUrl);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    notifyServiceWorker({ type: 'ws-state', connected: true });

    // Send handshake
    const handshake = {
      jsonrpc: '2.0',
      id: 'handshake-1',
      method: 'session.handshake',
      params: { clientType: 'extension', version: chrome.runtime.getManifest().version },
    };
    ws!.send(JSON.stringify(handshake));
  };

  ws.onmessage = (event) => {
    // Forward server messages to the service worker
    notifyServiceWorker({ type: 'ws-message', data: event.data });
  };

  ws.onclose = () => {
    ws = null;
    notifyServiceWorker({ type: 'ws-state', connected: false });
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

function scheduleReconnect(): void {
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;
  setTimeout(connect, delay);
}

function notifyServiceWorker(msg: object): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Service worker may not be listening yet
  });
}

// Listen for messages from the service worker to send over WebSocket
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ws-send') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof message.data === 'string' ? message.data : JSON.stringify(message.data));
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'WebSocket not connected' });
    }
    return true; // async response
  }

  if (message.type === 'ws-status') {
    sendResponse({
      connected: ws?.readyState === WebSocket.OPEN,
      url: serverUrl,
    });
    return true;
  }
});
