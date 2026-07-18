/**
 * RepoLens background service worker (Phase 5).
 * Routes panel open, page context, pre-fetch, and ASK → local backend.
 */

importScripts('../shared/constants.js');

const { MSG, MODES, BACKEND_URL } = self.REPOLENS;

self.addEventListener('error', (e) => {
  console.error('[RepoLens SW] Uncaught error:', e.message, e.filename, e.lineno);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[RepoLens SW] Unhandled rejection:', e.reason);
  e.preventDefault();
});

/** @type {Map<number, object>} tabId → latest page info */
const pageInfoByTab = new Map();

/** @type {Map<string, object>} pageKey → prefetch signals from backend */
const prefetchSignals = new Map();

/** @type {Set<string>} in-flight prefetch keys to avoid duplicate requests */
const prefetchInFlight = new Set();

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// ─── Pre-fetch on tab navigation ────────────────────────────────────────────

function makePageKey(page) {
  if (!page?.org || !page?.repo) return null;
  const parts = [page.type, page.org, page.repo];
  if (page.prNumber != null) parts.push(`pr${page.prNumber}`);
  if (page.filePath) parts.push(page.filePath);
  if (page.sha) parts.push(page.sha);
  return parts.join(':');
}

async function prefetchContext(page) {
  const key = makePageKey(page);
  if (!key || prefetchInFlight.has(key) || prefetchSignals.has(key)) return;

  prefetchInFlight.add(key);
  console.log('[RepoLens SW] Pre-fetching context for', key);

  try {
    const res = await fetch(`${BACKEND_URL}/prefetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageType: page.type,
        org: page.org,
        repo: page.repo,
        prNumber: page.prNumber,
        filePath: page.filePath,
        branch: page.branch,
        sha: page.sha,
      }),
    });
    const data = await res.json();
    if (data.ok && data.signals) {
      prefetchSignals.set(key, data.signals);
      console.log('[RepoLens SW] Pre-fetch done:', key, data.signals);
      broadcastPrefetchSignals(page, data.signals);
    }
  } catch (err) {
    console.warn('[RepoLens SW] Pre-fetch failed:', err.message);
  } finally {
    prefetchInFlight.delete(key);
  }
}

function broadcastPrefetchSignals(page, signals) {
  chrome.runtime.sendMessage({
    type: MSG.PREFETCH_DONE,
    page,
    signals,
  }).catch(() => {});
}

// ─── Message handling ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === MSG.PAGE_INFO) {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      pageInfoByTab.set(tabId, message.page);
      // Fire-and-forget pre-fetch
      if (message.page?.org && message.page?.repo) {
        prefetchContext(message.page);
      }
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
      const page = pageInfoByTab.get(tabId);
      const key = makePageKey(page);
      const signals = key ? prefetchSignals.get(key) : null;
      sendResponse({ page, signals: signals || null });
      return true;
    }

    if (typeof tabId === 'number') {
      chrome.tabs
        .sendMessage(tabId, { type: MSG.GET_PAGE_INFO })
        .then((res) => {
          if (res?.page) {
            pageInfoByTab.set(tabId, res.page);
            // Also fire prefetch if not done yet
            if (res.page?.org && res.page?.repo) {
              prefetchContext(res.page);
            }
          }
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

// ─── Keyboard shortcut ──────────────────────────────────────────────────────

chrome.commands?.onCommand?.addListener((command) => {
  if (command === 'toggle-panel') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      }
    });
  }
});

// ─── Ask channel ────────────────────────────────────────────────────────────

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
              retryable: true,
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

  const statusLabel = mode === MODES.ENHANCED ? 'Pulling deeper context…' : 'Asking Claude…';
  port.postMessage({ type: MSG.ASK_CHUNK, status: statusLabel });

  console.log('[RepoLens SW] Fetching from backend:', BACKEND_URL);
  const result = await callBackend({
    question,
    mode,
    page,
    pageScrape,
    cacheable: Boolean(message.cacheable),
  });

  if (result.error) {
    port.postMessage({
      type: MSG.ASK_ERROR,
      error: result.error,
      retryable: result.retryable || false,
    });
    return;
  }

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
    cacheable: payload.cacheable || false,
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
    return {
      error: data.error || `Backend returned ${response.status}`,
      retryable: data.retryable || response.status >= 500,
    };
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
