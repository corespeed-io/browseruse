/**
 * Page-level handlers: screenshot, eval, getUrl, getTitle.
 */

export async function handlePageScreenshot(params: {
  tabId?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
}): Promise<{ data: string; format: string }> {
  // Get the window for the tab (or current window)
  let windowId: number | undefined;
  if (params.tabId !== undefined) {
    const tab = await chrome.tabs.get(params.tabId);
    windowId = tab.windowId;
    // Ensure the tab is active in its window for captureVisibleTab
    if (!tab.active) {
      await chrome.tabs.update(params.tabId, { active: true });
      // Brief delay for the tab to render
      await new Promise(r => setTimeout(r, 150));
    }
  }

  const format = params.format ?? 'png';
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, {
    format,
    quality: params.quality,
  });

  // Strip the data URL prefix to return raw base64
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return { data: base64, format };
}

export async function handlePageEval(params: {
  tabId: number;
  expression: string;
}): Promise<{ result: unknown }> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: params.tabId },
    func: (expr: string) => {
      // eslint-disable-next-line no-eval
      return eval(expr);
    },
    args: [params.expression],
    world: 'MAIN',
  });

  const frame = results[0];
  if (!frame) {
    return { result: undefined };
  }
  return { result: frame.result };
}

export async function handlePageGetUrl(params: { tabId: number }): Promise<{ url: string }> {
  const tab = await chrome.tabs.get(params.tabId);
  return { url: tab.url ?? '' };
}

export async function handlePageGetTitle(params: { tabId: number }): Promise<{ title: string }> {
  const tab = await chrome.tabs.get(params.tabId);
  return { title: tab.title ?? '' };
}
