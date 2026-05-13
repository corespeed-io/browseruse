/**
 * Method name constants and typed params/returns for each RPC method.
 */

// ---------------------------------------------------------------------------
// Session methods
// ---------------------------------------------------------------------------

export interface HandshakeParams {
  clientType: 'extension' | 'agent' | 'cli';
  version?: string;
}

export interface HandshakeResult {
  serverVersion: string;
  sessionConnected: boolean;
  clientId: string;
}

export interface PingResult {
  pong: true;
  timestamp: number;
}

export interface StatusResult {
  connected: boolean;
  sessionId: string | null;
  managedBrowser: { pid: number; port: number; profile: string } | null;
  uptime: number;
  extensionConnected: boolean;
}

export interface CdpRawParams {
  method: string;
  params?: Record<string, unknown>;
  tabId?: number;
}

// ---------------------------------------------------------------------------
// Tab methods
// ---------------------------------------------------------------------------

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  index: number;
}

export interface TabsListResult {
  tabs: TabInfo[];
}

export interface TabCreateParams {
  url?: string;
  active?: boolean;
}

export interface TabCreateResult {
  tab: TabInfo;
}

export interface TabCloseParams {
  tabId: number;
}

export interface TabNavigateParams {
  tabId: number;
  url: string;
}

export interface TabNavigateResult {
  tab: TabInfo;
}

export interface TabActivateParams {
  tabId: number;
}

export interface TabReloadParams {
  tabId: number;
}

// ---------------------------------------------------------------------------
// Debugger methods
// ---------------------------------------------------------------------------

export interface DebuggerAttachParams {
  tabId: number;
}

export interface DebuggerAttachResult {
  ok: true;
  tabId: number;
}

export interface DebuggerDetachParams {
  tabId: number;
}

export interface DebuggerDetachResult {
  ok: true;
  tabId: number;
}

export interface DebuggerSendCommandParams {
  tabId: number;
  method: string;
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Method name constants
// ---------------------------------------------------------------------------

export const Methods = {
  // Session
  SESSION_HANDSHAKE: 'session.handshake',
  SESSION_PING: 'session.ping',
  SESSION_STATUS: 'session.status',
  SESSION_CDP_RAW: 'session.cdpRaw',

  // Tabs
  TABS_LIST: 'tabs.list',
  TABS_CREATE: 'tabs.create',
  TABS_CLOSE: 'tabs.close',
  TABS_NAVIGATE: 'tabs.navigate',
  TABS_ACTIVATE: 'tabs.activate',
  TABS_RELOAD: 'tabs.reload',

  // Debugger
  DEBUGGER_ATTACH: 'debugger.attach',
  DEBUGGER_DETACH: 'debugger.detach',
  DEBUGGER_SEND_COMMAND: 'debugger.sendCommand',
} as const;

export type MethodName = (typeof Methods)[keyof typeof Methods];

/** Methods that are handled directly by the server (not forwarded to the extension). */
export const SERVER_METHODS = new Set<string>([
  Methods.SESSION_HANDSHAKE,
  Methods.SESSION_PING,
  Methods.SESSION_STATUS,
  Methods.SESSION_CDP_RAW,
]);

/** Methods that must be forwarded to the Chrome extension. */
export const EXTENSION_METHODS = new Set<string>([
  Methods.TABS_LIST,
  Methods.TABS_CREATE,
  Methods.TABS_CLOSE,
  Methods.TABS_NAVIGATE,
  Methods.TABS_ACTIVATE,
  Methods.TABS_RELOAD,
  Methods.DEBUGGER_ATTACH,
  Methods.DEBUGGER_DETACH,
  Methods.DEBUGGER_SEND_COMMAND,
]);
