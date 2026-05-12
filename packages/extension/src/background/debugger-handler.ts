/**
 * Debugger handler — manages chrome.debugger lifecycle.
 *
 * Provides attach/detach/sendCommand for CDP access through the extension.
 * Tracks attached tabs and forwards CDP events and detach notifications.
 */

import { ErrorCodes } from '@browseruse/protocol';

const CDP_VERSION = '1.3';

/** Set of currently attached tab IDs. */
const attachedTabs = new Set<number>();

/** Callback for debugger events (CDP domain events). */
let onEventCallback: ((tabId: number, method: string, params?: Record<string, unknown>) => void) | null = null;

/** Callback for debugger detach (user cancelled or tab closed). */
let onDetachCallback: ((tabId: number, reason: string) => void) | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a callback for CDP events from chrome.debugger.onEvent.
 */
export function setEventCallback(cb: (tabId: number, method: string, params?: Record<string, unknown>) => void): void {
  onEventCallback = cb;
}

/**
 * Register a callback for debugger detach events.
 */
export function setDetachCallback(cb: (tabId: number, reason: string) => void): void {
  onDetachCallback = cb;
}

/**
 * Attach the debugger to a tab.
 */
export async function attach(tabId: number): Promise<{ ok: true; tabId: number }> {
  if (attachedTabs.has(tabId)) {
    return { ok: true, tabId };
  }

  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    attachedTabs.add(tabId);
    return { ok: true, tabId };
  } catch (err: any) {
    throw {
      code: ErrorCodes.DEBUGGER_ATTACH_FAILED,
      message: `Failed to attach debugger to tab ${tabId}: ${err.message ?? String(err)}`,
    };
  }
}

/**
 * Detach the debugger from a tab.
 */
export async function detach(tabId: number): Promise<{ ok: true; tabId: number }> {
  if (!attachedTabs.has(tabId)) {
    return { ok: true, tabId };
  }

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached — ignore
  }
  attachedTabs.delete(tabId);
  return { ok: true, tabId };
}

/**
 * Send a CDP command via chrome.debugger.sendCommand.
 * Auto-attaches to the tab if not already attached.
 */
export async function sendCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  // Auto-attach if not already attached
  if (!attachedTabs.has(tabId)) {
    await attach(tabId);
  }

  try {
    const result = await chrome.debugger.sendCommand({ tabId }, method, params ?? {});
    return result;
  } catch (err: any) {
    // If the debugger was detached (e.g. user cancelled), reflect that
    if (!attachedTabs.has(tabId)) {
      throw {
        code: ErrorCodes.DEBUGGER_DETACHED,
        message: `Debugger detached from tab ${tabId}`,
      };
    }
    throw {
      code: ErrorCodes.CDP_ERROR,
      message: `CDP error (${method}): ${err.message ?? String(err)}`,
    };
  }
}

/**
 * Check if a tab has the debugger attached.
 */
export function isAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}

/**
 * Get all currently attached tab IDs.
 */
export function getAttachedTabs(): number[] {
  return Array.from(attachedTabs);
}

// ---------------------------------------------------------------------------
// Chrome debugger event listeners
// ---------------------------------------------------------------------------

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;

  if (onEventCallback) {
    onEventCallback(tabId, method, params as Record<string, unknown> | undefined);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;

  attachedTabs.delete(tabId);

  if (onDetachCallback) {
    onDetachCallback(tabId, reason);
  }
});
