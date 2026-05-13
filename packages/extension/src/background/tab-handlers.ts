/**
 * Tab management handlers using Chrome Extensions API.
 */

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  index: number;
}

function toTabInfo(tab: chrome.tabs.Tab): TabInfo {
  return {
    tabId: tab.id!,
    url: tab.url ?? '',
    title: tab.title ?? '',
    active: tab.active,
    windowId: tab.windowId,
    index: tab.index,
  };
}

export async function handleTabsList(): Promise<{ tabs: TabInfo[] }> {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.filter(t => t.id !== undefined).map(toTabInfo) };
}

export async function handleTabCreate(params: { url?: string; active?: boolean }): Promise<{ tab: TabInfo }> {
  const tab = await chrome.tabs.create({
    url: params.url,
    active: params.active ?? true,
  });
  return { tab: toTabInfo(tab) };
}

export async function handleTabClose(params: { tabId: number }): Promise<{ ok: true }> {
  await chrome.tabs.remove(params.tabId);
  return { ok: true };
}

export async function handleTabNavigate(params: { tabId: number; url: string }): Promise<{ tab: TabInfo }> {
  const tab = await chrome.tabs.update(params.tabId, { url: params.url });

  // Wait for the tab to finish loading
  await new Promise<void>((resolve) => {
    const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tabId === params.tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 30s
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });

  const updated = await chrome.tabs.get(params.tabId);
  return { tab: toTabInfo(updated) };
}

export async function handleTabActivate(params: { tabId: number }): Promise<{ ok: true }> {
  await chrome.tabs.update(params.tabId, { active: true });
  return { ok: true };
}

export async function handleTabReload(params: { tabId: number }): Promise<{ ok: true }> {
  await chrome.tabs.reload(params.tabId);
  return { ok: true };
}
