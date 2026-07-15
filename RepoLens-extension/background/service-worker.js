/**
 * RepoLens background service worker.
 * Phase 1: panel open + page context cache
 * Phase 2: ASK routing (stub response until Phase 3 backend)
 */

importScripts('../shared/constants.js');

const { MSG, MODES } = self.REPOLENS;

/** @type {Map<number, object>} tabId → latest page info */
const pageInfoByTab = new Map();

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === MSG.PAGE_INFO) {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      pageInfoByTab.set(tabId, message.page);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === MSG.OPEN_PANEL) {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      pageInfoByTab.set(tabId, message.page);
      chrome.sidePanel
        .open({ tabId })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.warn('[RepoLens] Failed to open side panel:', err);
          sendResponse({ ok: false, error: String(err) });
        });
      return true;
    }
    sendResponse({ ok: false, error: 'No tab id' });
    return true;
  }

  if (message.type === MSG.GET_PAGE_INFO) {
    const tabId = message.tabId ?? sender.tab?.id;
    if (typeof tabId === 'number' && pageInfoByTab.has(tabId)) {
      sendResponse({ page: pageInfoByTab.get(tabId) });
      return true;
    }

    if (typeof tabId === 'number') {
      chrome.tabs
        .sendMessage(tabId, { type: MSG.GET_PAGE_INFO })
        .then((res) => {
          if (res?.page) pageInfoByTab.set(tabId, res.page);
          sendResponse(res || { page: null });
        })
        .catch(() => sendResponse({ page: null }));
      return true;
    }

    sendResponse({ page: null });
    return true;
  }

  if (message.type === MSG.ASK) {
    handleAsk(message)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.warn('[RepoLens] ASK failed:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      });
    return true; // async
  }

  return false;
});

/**
 * Phase 2: validate + acknowledge the ask.
 * Phase 3 will fetch GitHub MCP context and stream Claude here.
 */
async function handleAsk(message) {
  const question = String(message.question || '').trim();
  if (!question) {
    return { ok: false, error: 'Question is empty.' };
  }

  const mode =
    message.mode === MODES.ENHANCED ? MODES.ENHANCED : MODES.INSTANT;
  const page =
    message.page ||
    (typeof message.tabId === 'number' ? pageInfoByTab.get(message.tabId) : null);

  if (!page || page.type === 'unknown') {
    // Still allow free-text on unrecognized pages — Phase 3 can soft-fail
  }

  // Brief delay so the panel skeleton is visible during demos
  await sleep(350);

  const modeLabel = mode === MODES.ENHANCED ? 'Enhanced' : 'Instant';
  const where = page?.label || 'this page';
  const parts = [
    `**${modeLabel} mode** is ready for: _${question}_`,
    '',
    `Context locked onto **${where}**.`,
  ];

  if (page?.org && page?.repo) {
    let line = `Repo: \`${page.org}/${page.repo}\``;
    if (page.prNumber != null) line += ` · PR \`#${page.prNumber}\``;
    if (page.filePath) line += ` · File \`${page.filePath}\``;
    if (page.sha) line += ` · Commit \`${String(page.sha).slice(0, 7)}\``;
    parts.push(line);
  }

  parts.push(
    '',
    'The ask pipeline is wired end-to-end. Phase 3 will stream a real Claude answer here using GitHub MCP context.'
  );

  return {
    ok: true,
    stub: true,
    mode,
    answer: parts.join('\n'),
    page,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.tabs.onRemoved.addListener((tabId) => {
  pageInfoByTab.delete(tabId);
});
