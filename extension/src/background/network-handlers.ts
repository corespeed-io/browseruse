/**
 * Network/cookie handlers using Chrome Extensions API.
 */

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

function toCookieInfo(c: chrome.cookies.Cookie): CookieInfo {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate,
  };
}

export async function handleGetCookies(params: {
  url?: string;
  domain?: string;
}): Promise<{ cookies: CookieInfo[] }> {
  const query: chrome.cookies.GetAllDetails = {};
  if (params.url) query.url = params.url;
  if (params.domain) query.domain = params.domain;

  const cookies = await chrome.cookies.getAll(query);
  return { cookies: cookies.map(toCookieInfo) };
}

export async function handleSetCookie(params: {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
}): Promise<{ ok: true }> {
  await chrome.cookies.set({
    url: params.url,
    name: params.name,
    value: params.value,
    domain: params.domain,
    path: params.path,
    secure: params.secure,
    httpOnly: params.httpOnly,
    sameSite: params.sameSite,
    expirationDate: params.expirationDate,
  });
  return { ok: true };
}

export async function handleDeleteCookies(params: {
  url: string;
  name: string;
}): Promise<{ ok: true }> {
  await chrome.cookies.remove({
    url: params.url,
    name: params.name,
  });
  return { ok: true };
}
