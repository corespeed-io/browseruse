/**
 * Popup script — connection status and server URL configuration.
 */

const statusEl = document.getElementById('status')!;
const dotEl = document.getElementById('dot')!;
const statusTextEl = document.getElementById('statusText')!;
const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn')!;
const reconnectBtn = document.getElementById('reconnectBtn')!;
const versionEl = document.getElementById('version')!;

versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

function setConnected(connected: boolean): void {
  if (connected) {
    statusEl.className = 'status connected';
    dotEl.className = 'dot green';
    statusTextEl.textContent = 'Connected';
  } else {
    statusEl.className = 'status disconnected';
    dotEl.className = 'dot red';
    statusTextEl.textContent = 'Disconnected';
  }
}

// Load saved URL
chrome.storage.local.get('serverUrl', (data) => {
  if (data.serverUrl) {
    urlInput.value = data.serverUrl;
  }
});

// Get current connection status
chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
  if (chrome.runtime.lastError) {
    setConnected(false);
    return;
  }
  setConnected(response?.connected ?? false);
});

// Listen for state changes
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'connection-state') {
    setConnected(message.connected);
  }
  if (message.type === 'ws-state') {
    setConnected(message.connected);
  }
});

// Save URL
saveBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) return;
  chrome.storage.local.set({ serverUrl: url });
});

// Reconnect
reconnectBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (url) {
    // Setting the URL triggers reconnect in offscreen.ts
    chrome.storage.local.set({ serverUrl: url });
  }
});
