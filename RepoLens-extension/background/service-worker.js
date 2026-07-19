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

// ─── Side panel scoping ─────────────────────────────────────────────────────
//
// Chrome's side panel open/close state is per WINDOW, and the manifest's
// `default_path` makes it enabled on every tab by default. We scope VISIBILITY
// to github.intuit.com by disabling the panel on non-GitHub tabs. GitHub tabs
// stay enabled (via the manifest default), which is important: it lets us call
// `open()` SYNCHRONOUSLY inside a user gesture without needing an async
// setOptions() first (awaiting before open() throws "user gesture" errors).

const PANEL_PATH = 'sidepanel/panel.html';
const GITHUB_HOST = self.REPOLENS.HOST || 'github.intuit.com';

function isGitHubUrl(url) {
  try {
    return new URL(url).hostname === GITHUB_HOST;
  } catch {
    return false;
  }
}

// Enable the panel on GitHub tabs, disable it everywhere else.
function applyPanelScope(tabId, url) {
  if (!chrome.sidePanel?.setOptions || typeof tabId !== 'number') return;
  if (isGitHubUrl(url)) {
    chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => {});
  } else {
    chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    applyPanelScope(tabId, changeInfo.url);
  } else if (changeInfo.status === 'complete' && tab?.url) {
    applyPanelScope(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => {
    applyPanelScope(tabId, tab?.url || '');
  }).catch(() => {});
});

// ─── Panel open-state tracking (for toggle) ─────────────────────────────────
// The panel connects a long-lived port when it loads and tells us its windowId.
// We use that to know whether the panel is currently open in a given window, so
// clicking the toolbar icon can toggle it closed.

/** @type {Map<number, chrome.runtime.Port>} windowId → panel port */
const openPanelPorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'repolens-panel') return;
  let winId = null;
  port.onMessage.addListener((msg) => {
    if (msg?.type === MSG.PANEL_HELLO && typeof msg.windowId === 'number') {
      winId = msg.windowId;
      openPanelPorts.set(winId, port);
    }
  });
  port.onDisconnect.addListener(() => {
    if (winId != null && openPanelPorts.get(winId) === port) {
      openPanelPorts.delete(winId);
    }
  });
});

function togglePanel(tab) {
  if (!tab?.id) return;
  const winId = tab.windowId;
  const existing = typeof winId === 'number' ? openPanelPorts.get(winId) : null;
  if (existing) {
    // Panel is open in this window — ask it to close itself.
    try {
      existing.postMessage({ type: MSG.PANEL_CLOSE });
    } catch {
      openPanelPorts.delete(winId);
    }
    return;
  }
  // Panel is closed — open it. Must be synchronous to preserve the user gesture.
  if (chrome.sidePanel?.open) {
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      console.warn('[RepoLens SW] sidePanel.open failed (toolbar):', err.message);
    });
  }
}

// Toolbar icon click — toggles the panel open/closed.
chrome.action.onClicked.addListener((tab) => {
  togglePanel(tab);
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

// Circuit breaker: when the backend is unreachable, back off instead of spamming
let prefetchPausedUntil = 0;
const PREFETCH_BACKOFF_MS = 30_000;

async function prefetchContext(page) {
  const key = makePageKey(page);
  if (!key || prefetchInFlight.has(key) || prefetchSignals.has(key)) return;
  if (Date.now() < prefetchPausedUntil) return; // backend recently unreachable

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
    // Backend unreachable — pause prefetch for a while (does not affect the panel)
    prefetchPausedUntil = Date.now() + PREFETCH_BACKOFF_MS;
    console.warn(`[RepoLens SW] Pre-fetch failed (backend down?) — pausing ${PREFETCH_BACKOFF_MS / 1000}s:`, err.message);
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
      // Open synchronously (no await) — the content-script click gesture is
      // carried through this message, and the GitHub tab is already enabled.
      chrome.sidePanel
        .open({ tabId })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.warn('[RepoLens SW] sidePanel.open failed (FAB):', err.message);
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

// onCommand passes the active tab as the 2nd arg — use it so open() stays synchronous.
chrome.commands?.onCommand?.addListener((command, tab) => {
  if (command === 'toggle-panel') {
    togglePanel(tab);
  }
});

// ─── Ask channel ────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'repolens-ask') return;

  console.log('[RepoLens SW] Ask port connected');
  let aborted = false;

  function safeSend(msg) {
    if (aborted) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch {
      aborted = true;
      return false;
    }
  }

  port.onDisconnect.addListener(() => {
    console.log('[RepoLens SW] Ask port disconnected');
    aborted = true;
  });

  port.onMessage.addListener((message) => {
    if (!message || message.type !== MSG.ASK) return;
    console.log('[RepoLens SW] Received ASK:', message.question?.slice(0, 40));

    handleAskMessage(message, safeSend)
      .then(() => {
        console.log('[RepoLens SW] ASK handler completed');
      })
      .catch((err) => {
        if (!aborted) {
          console.error('[RepoLens SW] ASK handler error:', err);
          safeSend({
            type: MSG.ASK_ERROR,
            error: humanizeBackendError(err),
            retryable: true,
          });
        }
      });
  });
});

async function handleAskMessage(message, safeSend) {
  const question = String(message.question || '').trim();
  if (!question) {
    safeSend({ type: MSG.ASK_ERROR, error: 'Question is empty.' });
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

  console.log('[RepoLens SW] Fetching from backend:', BACKEND_URL);
  const result = await callBackend({
    question,
    mode,
    page,
    pageScrape,
    cacheable: Boolean(message.cacheable),
  });

  if (result.error) {
    safeSend({
      type: MSG.ASK_ERROR,
      error: result.error,
      retryable: result.retryable || false,
    });
    return;
  }

  if (result.answer) {
    if (!safeSend({ type: MSG.ASK_CHUNK, text: result.answer })) return;
  }
  safeSend({ type: MSG.ASK_DONE, meta: result.meta || {} });
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
