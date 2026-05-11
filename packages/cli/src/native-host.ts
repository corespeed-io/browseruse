/**
 * Native messaging host bridge.
 *
 * Chrome spawns this process when the extension calls `chrome.runtime.connectNative()`.
 * It bridges Chrome's native messaging protocol (4-byte length-prefixed JSON on
 * stdin/stdout) with the REPL server's WebSocket endpoint.
 *
 * Usage: bun packages/cli/src/native-host.ts
 */

const WS_URL = 'ws://127.0.0.1:9876/ws';

// ---------------------------------------------------------------------------
// Native messaging I/O helpers (stdin/stdout, 4-byte LE length prefix)
// ---------------------------------------------------------------------------

/**
 * Read a single native message from stdin.
 * Returns null when stdin is closed.
 */
async function readNativeMessage(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | null> {
  // Read exactly 4 bytes for the length prefix
  let header = new Uint8Array(4);
  let headerOffset = 0;

  while (headerOffset < 4) {
    const { value, done } = await reader.read();
    if (done || !value) return null;

    const needed = 4 - headerOffset;
    const toCopy = Math.min(value.length, needed);
    header.set(value.subarray(0, toCopy), headerOffset);
    headerOffset += toCopy;

    // If we got extra bytes beyond the header, we need to account for them
    if (value.length > needed) {
      // This shouldn't happen with Chrome's native messaging, but handle it
      const extra = value.subarray(needed);
      const msgLen = new DataView(header.buffer).getUint32(0, true);
      const body = new Uint8Array(msgLen);
      body.set(extra, 0);
      let bodyOffset = extra.length;

      while (bodyOffset < msgLen) {
        const { value: chunk, done: chunkDone } = await reader.read();
        if (chunkDone || !chunk) return null;
        const chunkToCopy = Math.min(chunk.length, msgLen - bodyOffset);
        body.set(chunk.subarray(0, chunkToCopy), bodyOffset);
        bodyOffset += chunkToCopy;
      }

      return new TextDecoder().decode(body);
    }
  }

  const msgLen = new DataView(header.buffer).getUint32(0, true);
  if (msgLen === 0) return null;

  // Read the message body
  const body = new Uint8Array(msgLen);
  let bodyOffset = 0;

  while (bodyOffset < msgLen) {
    const { value, done } = await reader.read();
    if (done || !value) return null;
    const toCopy = Math.min(value.length, msgLen - bodyOffset);
    body.set(value.subarray(0, toCopy), bodyOffset);
    bodyOffset += toCopy;
  }

  return new TextDecoder().decode(body);
}

/**
 * Write a native message to stdout (4-byte LE length prefix + JSON).
 */
function writeNativeMessage(data: string): void {
  const encoded = new TextEncoder().encode(data);
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, encoded.length, true);

  const output = new Uint8Array(4 + encoded.length);
  output.set(header, 0);
  output.set(encoded, 4);

  Bun.write(Bun.stdout, output);
}

// ---------------------------------------------------------------------------
// WebSocket connection to REPL server
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let connected = false;

function connectWebSocket(): void {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected = true;
    // Send handshake identifying as extension relay
    ws!.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 'native-host-handshake',
      method: 'session.handshake',
      params: { clientType: 'extension', version: '0.3.0' },
    }));
  };

  ws.onmessage = (event) => {
    // Forward server messages to Chrome extension via stdout
    const data = typeof event.data === 'string' ? event.data : event.data.toString();
    writeNativeMessage(data);
  };

  ws.onclose = () => {
    connected = false;
    // Attempt to reconnect after a short delay
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    // onclose will handle reconnection
  };
}

// ---------------------------------------------------------------------------
// Main: read stdin, relay to WebSocket; WebSocket replies go to stdout
// ---------------------------------------------------------------------------

connectWebSocket();

const reader = Bun.stdin.stream().getReader();

(async () => {
  while (true) {
    const msg = await readNativeMessage(reader);
    if (msg === null) {
      // stdin closed — Chrome disconnected the native host
      if (ws) ws.close();
      process.exit(0);
    }

    // Forward from extension to WebSocket server
    if (ws && connected) {
      ws.send(msg);
    }
  }
})();
