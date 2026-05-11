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
// DOM methods
// ---------------------------------------------------------------------------

export interface DomQueryParams {
  tabId: number;
  selector: string;
}

export interface DomQueryResult {
  found: boolean;
  text?: string;
  tagName?: string;
  attributes?: Record<string, string>;
}

export interface DomQueryAllParams {
  tabId: number;
  selector: string;
}

export interface DomQueryAllResult {
  count: number;
  elements: Array<{
    index: number;
    text: string;
    tagName: string;
    attributes: Record<string, string>;
  }>;
}

export interface DomClickParams {
  tabId: number;
  selector: string;
}

export interface DomTypeParams {
  tabId: number;
  selector: string;
  text: string;
  clear?: boolean;
}

export interface DomGetTextParams {
  tabId: number;
  selector: string;
}

export interface DomGetTextResult {
  text: string;
}

export interface DomGetHtmlParams {
  tabId: number;
  selector: string;
  outer?: boolean;
}

export interface DomGetHtmlResult {
  html: string;
}

// ---------------------------------------------------------------------------
// Page methods
// ---------------------------------------------------------------------------

export interface PageScreenshotParams {
  tabId?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface PageScreenshotResult {
  data: string; // base64
  format: string;
}

export interface PageEvalParams {
  tabId: number;
  expression: string;
}

export interface PageEvalResult {
  result: unknown;
}

export interface PageGetUrlParams {
  tabId: number;
}

export interface PageGetUrlResult {
  url: string;
}

export interface PageGetTitleParams {
  tabId: number;
}

export interface PageGetTitleResult {
  title: string;
}

// ---------------------------------------------------------------------------
// Network / Cookie methods
// ---------------------------------------------------------------------------

export interface CookieInfo {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expirationDate?: number;
}

export interface NetworkGetCookiesParams {
  url?: string;
  domain?: string;
}

export interface NetworkGetCookiesResult {
  cookies: CookieInfo[];
}

export interface NetworkSetCookieParams {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
}

export interface NetworkDeleteCookiesParams {
  url: string;
  name: string;
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

  // DOM
  DOM_QUERY: 'dom.query',
  DOM_QUERY_ALL: 'dom.queryAll',
  DOM_CLICK: 'dom.click',
  DOM_TYPE: 'dom.type',
  DOM_GET_TEXT: 'dom.getText',
  DOM_GET_HTML: 'dom.getHtml',

  // Page
  PAGE_SCREENSHOT: 'page.screenshot',
  PAGE_EVAL: 'page.eval',
  PAGE_GET_URL: 'page.getUrl',
  PAGE_GET_TITLE: 'page.getTitle',

  // Network
  NETWORK_GET_COOKIES: 'network.getCookies',
  NETWORK_SET_COOKIE: 'network.setCookie',
  NETWORK_DELETE_COOKIES: 'network.deleteCookies',
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
  Methods.DOM_QUERY,
  Methods.DOM_QUERY_ALL,
  Methods.DOM_CLICK,
  Methods.DOM_TYPE,
  Methods.DOM_GET_TEXT,
  Methods.DOM_GET_HTML,
  Methods.PAGE_SCREENSHOT,
  Methods.PAGE_EVAL,
  Methods.PAGE_GET_URL,
  Methods.PAGE_GET_TITLE,
  Methods.NETWORK_GET_COOKIES,
  Methods.NETWORK_SET_COOKIE,
  Methods.NETWORK_DELETE_COOKIES,
]);
