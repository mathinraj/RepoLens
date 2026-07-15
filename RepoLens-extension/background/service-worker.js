/**
 * RepoLens background service worker (Phase 1).
 * Routes panel open requests and keeps the latest page context in memory.
 */

importScripts('../shared/constants.js');

const { MSG } = self.REPOLENS;

/** @type {Map<number, object>} tabId → latest page info */
const pageInfoByTab = new Map();

chrome.runtime.onInstalled.addListener(() => {
  // Enable side panel to open via action click as a fallback
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
      return true; // async response
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

    // Ask the content script if we don't have cached info
    if (typeof tabId === 'number') {
      chrome.tabs
        .sendMessage(tabId, { type: MSG.GET_PAGE_INFO })
        .then((res) => sendResponse(res || { page: null }))
        .catch(() => sendResponse({ page: null }));
      return true;
    }

    sendResponse({ page: null });
    return true;
  }

  return false;
});

// Drop stale entries when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  pageInfoByTab.delete(tabId);
});
