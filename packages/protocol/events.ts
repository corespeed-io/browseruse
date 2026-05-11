/**
 * Notification event types sent from server to clients.
 */

export const Events = {
  /** Extension connected to the server. */
  EXTENSION_CONNECTED: 'event.extensionConnected',
  /** Extension disconnected from the server. */
  EXTENSION_DISCONNECTED: 'event.extensionDisconnected',
  /** CDP session connection state changed. */
  SESSION_STATE_CHANGED: 'event.sessionStateChanged',
  /** Tab was created (forwarded from extension). */
  TAB_CREATED: 'event.tabCreated',
  /** Tab was removed (forwarded from extension). */
  TAB_REMOVED: 'event.tabRemoved',
  /** Tab was updated (forwarded from extension). */
  TAB_UPDATED: 'event.tabUpdated',
  /** Debugger was detached from a tab (user cancelled or tab closed). */
  DEBUGGER_DETACHED: 'event.debuggerDetached',
  /** CDP event forwarded from chrome.debugger. */
  DEBUGGER_EVENT: 'event.debuggerEvent',
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

export interface ExtensionConnectedEvent {
  clientId: string;
  version?: string;
}

export interface ExtensionDisconnectedEvent {
  clientId: string;
}

export interface SessionStateChangedEvent {
  connected: boolean;
  sessionId: string | null;
}

export interface TabCreatedEvent {
  tabId: number;
  url: string;
  title: string;
}

export interface TabRemovedEvent {
  tabId: number;
  windowId: number;
}

export interface TabUpdatedEvent {
  tabId: number;
  url?: string;
  title?: string;
  status?: string;
}

export interface DebuggerDetachedEvent {
  tabId: number;
  reason: string;
}

export interface DebuggerEventData {
  tabId: number;
  method: string;
  params?: Record<string, unknown>;
}
