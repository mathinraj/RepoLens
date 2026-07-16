/**
 * RepoLens background service worker.
 * Routes panel open, page context, and ASK → local backend.
 */

importScripts('../shared/constants.js');

const { MSG, MODES, BACKEND_URL } = self.REPOLENS;

// Prevent unhandled errors from killing the service worker silently
self.addEventListener('error', (e) => {
  console.error('[RepoLens SW] Uncaught error:', e.message, e.filename, e.lineno);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[RepoLens SW] Unhandled rejection:', e.reason);
  e.preventDefault();
});

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

  return false;
});

/**
 * Ask channel from the side panel via port.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'repolens-ask') return;

  console.log('[RepoLens SW] Ask port connected');
  let aborted = false;

  port.onDisconnect.addListener(() => {
    console.log('[RepoLens SW] Ask port disconnected');
    aborted = true;
  });

  port.onMessage.addListener((message) => {
    if (!message || message.type !== MSG.ASK) return;
    console.log('[RepoLens SW] Received ASK:', message.question?.slice(0, 40));

    handleAskMessage(message, port)
      .then(() => {
        console.log('[RepoLens SW] ASK handler completed');
      })
      .catch((err) => {
        console.error('[RepoLens SW] ASK handler error:', err);
        if (!aborted) {
          try {
            port.postMessage({
              type: MSG.ASK_ERROR,
              error: humanizeBackendError(err),
            });
          } catch (postErr) {
            console.error('[RepoLens SW] Failed to post error:', postErr);
          }
        }
      });
  });
});

async function handleAskMessage(message, port) {
  const question = String(message.question || '').trim();
  if (!question) {
    port.postMessage({ type: MSG.ASK_ERROR, error: 'Question is empty.' });
    return;
  }

  const mode =
    message.mode === MODES.ENHANCED ? MODES.ENHANCED : MODES.INSTANT;
  const page =
    message.page ||
    (typeof message.tabId === 'number' ? pageInfoByTab.get(message.tabId) : null);

  let pageScrape = message.pageScrape || null;
  if (!pageScrape && typeof message.tabId === 'number') {
    try {
      pageScrape = await requestPageScrape(message.tabId);
    } catch (err) {
      console.warn('[RepoLens SW] Page scrape failed:', err);
    }
  }

  // Send status update to panel
  port.postMessage({ type: MSG.ASK_CHUNK, status: 'Asking Claude…' });

  console.log('[RepoLens SW] Fetching from backend:', BACKEND_URL);
  const result = await callBackend({ question, mode, page, pageScrape });

  if (result.error) {
    port.postMessage({ type: MSG.ASK_ERROR, error: result.error });
    return;
  }

  // Send the full answer as a single chunk, then done
  if (result.answer) {
    port.postMessage({ type: MSG.ASK_CHUNK, text: result.answer });
  }
  port.postMessage({ type: MSG.ASK_DONE, meta: result.meta || {} });
}

async function requestPageScrape(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: MSG.SCRAPE_PAGE,
    });
    return res?.scrape || null;
  } catch {
    return null;
  }
}

async function callBackend(payload) {
  const page = payload.page || {};
  const body = {
    pageType: page.type || 'unknown',
    org: page.org,
    repo: page.repo,
    prNumber: page.prNumber,
    filePath: page.filePath,
    branch: page.branch,
    sha: page.sha,
    question: payload.question,
    mode: payload.mode,
    pageScrape: payload.pageScrape,
    page,
  };

  console.log('[RepoLens SW] POST /ask');

  let response;
  try {
    response = await fetch(`${BACKEND_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[RepoLens SW] Fetch failed:', err);
    throw Object.assign(
      new Error(
        `Cannot reach RepoLens backend at ${BACKEND_URL}. Start it with: cd backend && npm start`
      ),
      { cause: err }
    );
  }

  console.log('[RepoLens SW] Backend response status:', response.status);

  const data = await response.json();

  if (!response.ok || data.error) {
    return { error: data.error || `Backend returned ${response.status}` };
  }

  return {
    answer: data.answer || '',
    meta: data.meta || {},
  };
}

function humanizeBackendError(err) {
  const msg = String(err?.message || err);
  if (/Failed to fetch|NetworkError|Network request failed|fetch/i.test(msg)) {
    return `Cannot reach RepoLens backend at ${BACKEND_URL}. Start it with: cd backend && npm start`;
  }
  return msg;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  pageInfoByTab.delete(tabId);
});
