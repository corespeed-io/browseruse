/**
 * Popup script — connection status display for native messaging mode.
 */

const statusEl = document.getElementById('status')!;
const dotEl = document.getElementById('dot')!;
const statusTextEl = document.getElementById('statusText')!;
const attachedCountEl = document.getElementById('attachedCount')!;
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

function updateStatus(response: { connected: boolean; attachedTabs?: number[] }): void {
  setConnected(response.connected);
  if (response.attachedTabs) {
    attachedCountEl.textContent = String(response.attachedTabs.length);
  }
}

// Get current connection status
chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
  if (chrome.runtime.lastError) {
    setConnected(false);
    return;
  }
  if (response) {
    updateStatus(response);
  }
});

// Listen for state changes
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'connection-state') {
    setConnected(message.connected);
  }
});
