/**
 * RepoLens background service worker.
 * Routes panel open, page context, pre-fetch, and ASK → GitHub API + the
 * user's chosen AI provider (Anthropic, OpenAI, or Gemini).
 */

importScripts(
  '../shared/constants.js',
  '../shared/support.js',
  '../shared/releases.js',
  'github.js',
  'prompts.js',
  'providers.js'
);

const { MSG, MODES, STORAGE, PROVIDERS, DEFAULT_PROVIDER } = self.REPOLENS;
const GitHub = self.RepoLensGitHub;
const { buildMessages, sanitizeAnswer } = self.RepoLensPrompts;
const Providers = self.RepoLensProviders;

self.addEventListener('unhandledrejection', (e) => {
  console.error('[RepoLens SW] Unhandled rejection:', e.reason);
  e.preventDefault();
});

/** @type {Map<number, object>} tabId → latest page info */
const pageInfoByTab = new Map();

/** @type {Map<string, object>} pageKey → prefetch signals */
const prefetchSignals = new Map();

/** @type {Set<string>} in-flight prefetch keys to avoid duplicate requests */
const prefetchInFlight = new Set();

/** Mirror of the chrome.storage.local keys the worker cares about. */
const PREF_KEYS = [
  STORAGE.PROVIDER,
  STORAGE.PREFETCH,
  STORAGE.GITHUB_TOKEN,
  ...Object.values(PROVIDERS).flatMap((p) => [p.keyStorage, p.modelStorage]),
];
const stored = {};

const prefsReady = chrome.storage.local.get(PREF_KEYS).then((s) => {
  Object.assign(stored, s);
  GitHub.setToken(s[STORAGE.GITHUB_TOKEN] || '');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of PREF_KEYS) {
    if (changes[key]) stored[key] = changes[key].newValue;
  }
  if (changes[STORAGE.GITHUB_TOKEN]) {
    GitHub.setToken(changes[STORAGE.GITHUB_TOKEN].newValue || '');
    prefetchSignals.clear();
    answerCache.clear();
  }
});

function prefetchEnabled() {
  return stored[STORAGE.PREFETCH] !== false;
}

/** Active provider config + its key and model. */
function activeProvider() {
  const provider = PROVIDERS[stored[STORAGE.PROVIDER]] || PROVIDERS[DEFAULT_PROVIDER];
  return {
    provider,
    apiKey: stored[provider.keyStorage] || '',
    model: stored[provider.modelStorage] || provider.defaultModel,
  };
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.local.set({ [STORAGE.INSTALLED_AT]: Date.now() });
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') }).catch(() => {});
  }
  if (reason === chrome.runtime.OnInstalledReason.UPDATE && previousVersion) {
    const to = chrome.runtime.getManifest().version;
    if (previousVersion !== to) {
      await chrome.storage.local.set({ [STORAGE.WHATS_NEW]: { from: previousVersion, to, seen: false } });
    }
  }
  self.RepoLensReleases.checkForUpdate({ force: true });
});

chrome.runtime.onStartup.addListener(() => {
  self.RepoLensReleases.checkForUpdate();
});

// Installs from before INSTALLED_AT existed start counting from now.
chrome.storage.local.get(STORAGE.INSTALLED_AT).then((s) => {
  if (!s[STORAGE.INSTALLED_AT]) chrome.storage.local.set({ [STORAGE.INSTALLED_AT]: Date.now() });
});

// ─── Toolbar badge ──────────────────────────────────────────────────────────
// "!"   until the selected provider has an API key (takes priority)
// "NEW" after an update, until the What's new page is opened

async function syncBadge() {
  const missingKey = !activeProvider().apiKey;
  const { [STORAGE.WHATS_NEW]: whatsNew } = await chrome.storage.local.get(STORAGE.WHATS_NEW);
  const unseen = Boolean(whatsNew && !whatsNew.seen);

  let text = '';
  let color = '#bf8700';
  let title = 'RepoLens';
  if (missingKey) {
    text = '!';
    title = 'RepoLens — add an API key to start';
  } else if (unseen) {
    text = 'NEW';
    color = '#0969da';
    title = `RepoLens — updated to v${whatsNew.to}`;
  }
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setTitle({ title }).catch(() => {});
  if (text) {
    chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
    chrome.action.setBadgeTextColor({ color: '#ffffff' }).catch(() => {});
  }
}

// ─── Uninstall feedback URL ─────────────────────────────────────────────────
// Chrome opens a fixed URL on uninstall, so rebuild it whenever its params change.

async function syncUninstallUrl() {
  try {
    const url = await self.RepoLensSupport.uninstallUrl();
    await chrome.runtime.setUninstallURL(url.slice(0, 1023));
  } catch {
    // non-critical
  }
}

const UNINSTALL_PARAM_KEYS = new Set([
  STORAGE.PROVIDER,
  STORAGE.GITHUB_TOKEN,
  STORAGE.INSTALLED_AT,
  STORAGE.ANSWER_COUNT,
  ...Object.values(PROVIDERS).flatMap((p) => [p.keyStorage, p.modelStorage]),
]);

prefsReady.then(() => {
  syncBadge();
  syncUninstallUrl();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const changed = Object.keys(changes);
  if (changed.some((k) => k === STORAGE.WHATS_NEW || k === STORAGE.PROVIDER || Object.values(PROVIDERS).some((p) => p.keyStorage === k))) {
    syncBadge();
  }
  if (changed.some((k) => UNINSTALL_PARAM_KEYS.has(k))) syncUninstallUrl();
});

// ─── Side panel scoping ─────────────────────────────────────────────────────
//
// The panel is only enabled for tabs where the user EXPLICITLY opened it
// (via FAB, toolbar icon, or keyboard shortcut). Switching to any other tab
// auto-hides the panel. Switching back to a tracked tab re-opens it.

const PANEL_PATH = 'sidepanel/panel.html';
const GITHUB_HOST = self.REPOLENS.HOST || 'github.com';

/** @type {Set<number>} tabIds where the user explicitly opened the panel */
const panelEnabledTabs = new Set();

if (chrome.sidePanel?.setOptions) {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}

// Without the "tabs" permission, tab.url is only populated for github.com
// (our host permission); an empty url therefore means "not GitHub".
function isGitHubUrl(url) {
  try {
    return new URL(url).hostname === GITHUB_HOST;
  } catch {
    return false;
  }
}

function enablePanelForTab(tabId) {
  panelEnabledTabs.add(tabId);
  chrome.sidePanel?.setOptions?.({ tabId, path: PANEL_PATH, enabled: true }).catch(() => {});
}

function disablePanelForTab(tabId) {
  panelEnabledTabs.delete(tabId);
  chrome.sidePanel?.setOptions?.({ tabId, enabled: false }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (panelEnabledTabs.has(tabId)) {
    let url = null;
    if (changeInfo.url) url = changeInfo.url;
    else if (changeInfo.status === 'complete') url = tab?.url || '';
    if (url !== null && !isGitHubUrl(url)) disablePanelForTab(tabId);
    return;
  }
  if (changeInfo.status === 'loading') disablePanelForTab(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!panelEnabledTabs.has(tabId)) {
    chrome.sidePanel?.setOptions?.({ tabId, enabled: false }).catch(() => {});
  }
});

// ─── Panel open-state tracking (for toggle) ─────────────────────────────────

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
    if (winId != null && openPanelPorts.get(winId) === port) openPanelPorts.delete(winId);
  });
});

function closePanel(tabId, windowId) {
  disablePanelForTab(tabId);
  const port = typeof windowId === 'number' ? openPanelPorts.get(windowId) : null;
  if (port) {
    try {
      port.postMessage({ type: MSG.PANEL_CLOSE });
    } catch {
      openPanelPorts.delete(windowId);
    }
  }
}

function togglePanel(tab) {
  if (!tab?.id) return;

  if (panelEnabledTabs.has(tab.id)) {
    closePanel(tab.id, tab.windowId);
    return;
  }

  if (!isGitHubUrl(tab.url || '')) return;
  enablePanelForTab(tab.id);
  chrome.sidePanel?.open?.({ tabId: tab.id }).catch(() => disablePanelForTab(tab.id));
}

// The toolbar icon opens popup/popup.html (manifest default_popup), so
// action.onClicked never fires; the popup and keyboard shortcut drive the panel.
chrome.commands?.onCommand?.addListener((command, tab) => {
  if (command === 'toggle-panel') togglePanel(tab);
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

function toContextPage(page) {
  return {
    pageType: page.type,
    org: page.org,
    repo: page.repo,
    prNumber: page.prNumber,
    filePath: page.filePath,
    branch: page.branch,
    sha: page.sha,
  };
}

function buildPrefetchSignals(ctx) {
  if (!ctx) return {};
  const signals = { type: ctx.type };
  if (ctx.type === 'pr') {
    signals.changedFiles = ctx.changedFiles || ctx.files?.length || 0;
    signals.additions = ctx.additions || 0;
    signals.deletions = ctx.deletions || 0;
    signals.draft = ctx.draft || false;
    if (ctx.files) {
      const names = ctx.files.map((f) => f.filename || '');
      signals.fileTypes = [...new Set(names.map((n) => n.split('.').pop() || 'other'))].slice(0, 20);
      signals.hasMigrations = names.some((n) => /migrat|schema|flyway|liquibase|alembic/i.test(n));
      signals.hasTests = names.some((n) => /test|spec|__tests__/i.test(n));
      signals.hasConfig = names.some((n) => /config|\.env|\.yml|\.yaml|Dockerfile|Jenkinsfile/i.test(n));
    }
  } else if (ctx.type === 'repo') {
    signals.language = ctx.language || '';
    signals.description = ctx.description || '';
    signals.hasReadme = Boolean(ctx.readme);
    signals.manifestCount = ctx.manifests?.length || 0;
    signals.fileCount = ctx.listing?.length || 0;
  } else if (ctx.type === 'file') {
    signals.extension = ctx.filePath?.split('.').pop() || '';
    signals.contentLength = ctx.content?.length || 0;
  }
  return signals;
}

async function prefetchContext(page) {
  await prefsReady;
  // Unauthenticated GitHub quota (60 req/h) is too small to spend on prefetch.
  if (!prefetchEnabled() || !GitHub.hasToken()) return;
  const key = makePageKey(page);
  if (!key || prefetchInFlight.has(key) || prefetchSignals.has(key)) return;

  prefetchInFlight.add(key);
  try {
    const ctx = await GitHub.getInstantContext(toContextPage(page));
    const signals = buildPrefetchSignals(ctx);
    prefetchSignals.set(key, signals);
    chrome.runtime.sendMessage({ type: MSG.PREFETCH_DONE, page, signals }).catch(() => {});
  } catch {
    // non-critical — the ask path will surface real errors
  } finally {
    prefetchInFlight.delete(key);
  }
}

// ─── Message handling ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === MSG.PAGE_INFO) {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      pageInfoByTab.set(tabId, message.page);
      if (message.page?.org && message.page?.repo) prefetchContext(message.page);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === MSG.OPEN_PANEL) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'No tab id' });
      return true;
    }
    pageInfoByTab.set(tabId, message.page);
    enablePanelForTab(tabId);
    chrome.sidePanel
      .open({ tabId })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        disablePanelForTab(tabId);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  // ─── From the toolbar popup ───────────────────────────────────────────────
  if (message.type === MSG.PANEL_STATE) {
    sendResponse({ open: panelEnabledTabs.has(message.tabId) });
    return false;
  }

  if (message.type === MSG.PANEL_OPENED) {
    if (typeof message.tabId === 'number') panelEnabledTabs.add(message.tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG.CLOSE_PANEL) {
    if (typeof message.tabId === 'number') closePanel(message.tabId, message.windowId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG.GET_PAGE_INFO) {
    const tabId = message.tabId ?? sender.tab?.id;
    if (typeof tabId === 'number' && pageInfoByTab.has(tabId)) {
      const page = pageInfoByTab.get(tabId);
      const key = makePageKey(page);
      sendResponse({ page, signals: (key && prefetchSignals.get(key)) || null });
      return true;
    }
    if (typeof tabId === 'number') {
      chrome.tabs
        .sendMessage(tabId, { type: MSG.GET_PAGE_INFO })
        .then((res) => {
          if (res?.page) {
            pageInfoByTab.set(tabId, res.page);
            if (res.page.org && res.page.repo) prefetchContext(res.page);
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

// ─── Ask channel ────────────────────────────────────────────────────────────

const ANSWER_CACHE_TTL = 5 * 60 * 1000;
/** @type {Map<string, { value: object, expiresAt: number }>} */
const answerCache = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'repolens-ask') return;

  const controller = new AbortController();
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
    aborted = true;
    controller.abort();
  });

  port.onMessage.addListener((message) => {
    if (!message || message.type !== MSG.ASK) return;
    handleAskMessage(message, safeSend, controller.signal)
      .catch((err) => {
        if (aborted || err?.name === 'AbortError') return;
        console.error('[RepoLens SW] ASK error:', err);
        safeSend({
          type: MSG.ASK_ERROR,
          error: err?.message || String(err),
          retryable: err?.retryable !== false,
          status: err?.status,
        });
      })
      .finally(() => safeSend({ type: MSG.ASK_FINISHED }));
  });
});

// OpenAI o-series and Gemini 2.5+ count reasoning tokens against the output
// limit, so they need a larger budget than Claude for the same visible answer.
function maxTokensFor(providerId, mode) {
  const deep = mode === MODES.DEEP;
  if (providerId === 'anthropic') return deep ? 8192 : 2048;
  return deep ? 16384 : 8192;
}

/**
 * Providers to answer with. `message.targets` ([{ providerId, model? }]) comes
 * from the panel's AI picker; without it, the provider chosen in Settings.
 * Only providers with a saved key are used.
 */
function resolveTargets(message) {
  const requested = Array.isArray(message.targets) && message.targets.length
    ? message.targets
    : [{ providerId: activeProvider().provider.id }];
  const seen = new Set();
  const targets = [];
  for (const t of requested) {
    const provider = PROVIDERS[t?.providerId];
    if (!provider || seen.has(provider.id)) continue;
    seen.add(provider.id);
    const apiKey = stored[provider.keyStorage] || '';
    if (!apiKey) continue;
    const model = (typeof t.model === 'string' && t.model.trim()) || stored[provider.modelStorage] || provider.defaultModel;
    targets.push({ provider, apiKey, model });
  }
  return targets;
}

async function handleAskMessage(message, safeSend, signal) {
  await prefsReady;

  const question = String(message.question || '').trim();
  if (!question) {
    safeSend({ type: MSG.ASK_ERROR, error: 'Question is empty.', retryable: false });
    return;
  }
  const targets = resolveTargets(message);
  if (!targets.length) {
    const { provider } = activeProvider();
    safeSend({
      type: MSG.ASK_ERROR,
      error: `Add your ${provider.label} API key in RepoLens Settings (gear icon) to start asking.`,
      retryable: false,
      needsSetup: true,
    });
    return;
  }

  const mode = message.mode === MODES.DEEP ? MODES.DEEP : MODES.INSTANT;
  const page = message.page || (typeof message.tabId === 'number' ? pageInfoByTab.get(message.tabId) : null) || {};

  const pageKey = makePageKey(page);
  const cacheKeyFor = (t) =>
    message.cacheable && pageKey ? `${pageKey}:${mode}:${t.provider.id}:${t.model}:${question}` : null;

  // Serve cached answers first; only the rest need page and GitHub context.
  const pending = [];
  for (const t of targets) {
    const key = cacheKeyFor(t);
    const hit = key && answerCache.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      safeSend({ type: MSG.ASK_CHUNK, providerId: t.provider.id, text: hit.value.answer });
      safeSend({ type: MSG.ASK_DONE, providerId: t.provider.id, meta: { ...hit.value.meta, cached: true } });
    } else {
      pending.push(t);
    }
  }
  if (!pending.length) return;

  let pageScrape = message.pageScrape || null;
  if (!pageScrape && typeof message.tabId === 'number') {
    pageScrape = await requestPageScrape(message.tabId);
  }

  let githubContext = null;
  let contextError = null;
  if (page.org && page.repo) {
    try {
      const ctxPage = toContextPage(page);
      githubContext = mode === MODES.DEEP ? await GitHub.getDeepContext(ctxPage) : await GitHub.getInstantContext(ctxPage);
    } catch (err) {
      contextError = err.message || String(err);
    }
  }

  const { system, messages } = buildMessages({
    pageType: page.type || 'unknown',
    question,
    mode,
    githubContext,
    pageScrape,
    page,
  });

  // Port messages reset the service worker's 30s idle timer during long streams.
  let lastBeat = 0;
  const onChunk = () => {
    if (Date.now() - lastBeat > 5000) {
      lastBeat = Date.now();
      safeSend({ type: MSG.ASK_PROGRESS });
    }
  };

  async function answerWith({ provider, apiKey, model }) {
    const result = await Providers.streamCompletion(
      provider.id,
      { apiKey, system, messages, maxTokens: maxTokensFor(provider.id, mode), model },
      { signal, onChunk }
    );
    if (!result.fullText.trim()) {
      throw Object.assign(
        new Error(`${provider.label} returned an empty answer (the model may have used its whole token budget on reasoning). Try again or pick another model.`),
        { retryable: true }
      );
    }
    const answer = sanitizeAnswer(result.fullText);
    const meta = { model: result.model, provider: provider.id, mode, hasGithubContext: Boolean(githubContext), contextError, cached: false };
    const cacheKey = cacheKeyFor({ provider, model });
    if (cacheKey) {
      if (answerCache.size > 200) answerCache.clear();
      answerCache.set(cacheKey, { value: { answer, meta }, expiresAt: Date.now() + ANSWER_CACHE_TTL });
    }
    safeSend({ type: MSG.ASK_CHUNK, providerId: provider.id, text: answer });
    safeSend({ type: MSG.ASK_DONE, providerId: provider.id, meta });
  }

  const settled = await Promise.allSettled(pending.map(async (t) => {
    try {
      await answerWith(t);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      safeSend({
        type: MSG.ASK_ERROR,
        providerId: t.provider.id,
        error: err?.message || String(err),
        retryable: err?.retryable !== false,
        status: err?.status,
      });
      throw err;
    }
  }));

  // One question counts once toward the rate prompt, however many AIs answered.
  if (settled.some((s) => s.status === 'fulfilled')) {
    chrome.storage.local.get(STORAGE.ANSWER_COUNT).then((s) => {
      chrome.storage.local.set({ [STORAGE.ANSWER_COUNT]: (s[STORAGE.ANSWER_COUNT] || 0) + 1 });
    });
  }
}

async function requestPageScrape(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: MSG.SCRAPE_PAGE });
    return res?.scrape || null;
  } catch {
    return null;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  pageInfoByTab.delete(tabId);
  panelEnabledTabs.delete(tabId);
});
