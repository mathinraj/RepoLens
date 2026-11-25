/**
 * RepoLens toolbar popup — page status, open/close the side panel, settings.
 */
(function () {
  const { MSG, STORAGE, PROVIDERS, DEFAULT_PROVIDER, HOST, PAGE_TYPES } = globalThis.REPOLENS;
  const { detectPage } = globalThis.RepoLensPageDetector;

  const PANEL_PATH = 'sidepanel/panel.html';

  const versionEl = document.getElementById('version');
  const badgeEl = document.getElementById('page-badge');
  const labelEl = document.getElementById('page-label');
  const hintEl = document.getElementById('page-hint');
  const bannerEl = document.getElementById('setup-banner');
  const primaryBtn = document.getElementById('primary-btn');
  const shortcutEl = document.getElementById('shortcut');
  const errorEl = document.getElementById('error');
  const settingsBtn = document.getElementById('settings-btn');

  const BADGES = {
    [PAGE_TYPES.PR]: 'PR',
    [PAGE_TYPES.REPO]: 'Repo',
    [PAGE_TYPES.FILE]: 'File',
    [PAGE_TYPES.COMMIT]: 'Commit',
  };

  /** @type {chrome.tabs.Tab|null} */
  let tab = null;
  let panelOpen = false;
  let primaryAction = null;

  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  document.getElementById('help-link').href = chrome.runtime.getURL('welcome/welcome.html');
  globalThis.RepoLensSupport.feedbackUrl().then((url) => {
    document.getElementById('feedback-link').href = url;
  });

  // Update available (from GitHub Releases) takes priority over What's new.
  async function renderNotice() {
    const Releases = globalThis.RepoLensReleases;
    const noticeEl = document.getElementById('notice');
    const show = (text) => {
      document.getElementById('notice-text').textContent = text;
      noticeEl.href = chrome.runtime.getURL('whatsnew/whatsnew.html');
      noticeEl.classList.remove('is-hidden');
    };

    await Releases.checkForUpdate();
    const update = await Releases.availableUpdate();
    if (update) {
      show(`RepoLens v${update.version} is available`);
      return;
    }
    const { [STORAGE.WHATS_NEW]: whatsNew } = await chrome.storage.local.get(STORAGE.WHATS_NEW);
    if (whatsNew && !whatsNew.seen) show(`What's new in v${whatsNew.to}`);
  }

  renderNotice().catch(() => {});

  function openSettings() {
    chrome.runtime.openOptionsPage();
    window.close();
  }

  settingsBtn.addEventListener('click', openSettings);
  primaryBtn.addEventListener('click', () => primaryAction?.());

  function showError(text) {
    errorEl.textContent = text;
    errorEl.classList.remove('is-hidden');
  }

  function setPrimary(label, action, { disabled = false, secondary = false } = {}) {
    primaryBtn.textContent = label;
    primaryBtn.disabled = disabled;
    primaryBtn.classList.toggle('is-secondary', secondary);
    primaryAction = action;
  }

  function setStatus(id, state, text) {
    document.getElementById(`${id}-dot`).className = `dot is-${state}`;
    document.getElementById(`${id}-value`).textContent = text;
  }

  // sidePanel.open() needs the popup's user gesture, so it must run here
  // (synchronously in the click handler), not in the service worker.
  function openPanel() {
    if (!tab?.id) return;
    chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true });
    chrome.sidePanel
      .open({ tabId: tab.id })
      .then(() => chrome.runtime.sendMessage({ type: MSG.PANEL_OPENED, tabId: tab.id }))
      .then(() => window.close())
      .catch((err) => showError(`Couldn't open the panel: ${err.message}`));
  }

  function closePanel() {
    chrome.runtime
      .sendMessage({ type: MSG.CLOSE_PANEL, tabId: tab.id, windowId: tab.windowId })
      .finally(() => window.close());
  }

  function renderPage() {
    const url = tab?.url || '';
    let isGitHub = false;
    try {
      isGitHub = new URL(url).hostname === HOST;
    } catch {
      // url is empty for non-GitHub tabs (no "tabs" permission)
    }

    if (!isGitHub) {
      badgeEl.textContent = '—';
      badgeEl.dataset.type = 'none';
      labelEl.textContent = 'Not a GitHub page';
      hintEl.textContent = 'RepoLens works on github.com repos, pull requests, files, and commits.';
      setPrimary('Go to github.com', () => {
        chrome.tabs.update(tab.id, { url: `https://${HOST}/` });
        window.close();
      }, { secondary: true });
      return;
    }

    const page = detectPage(new URL(url).pathname);
    const known = page.type !== PAGE_TYPES.UNKNOWN;
    badgeEl.textContent = BADGES[page.type] || 'GitHub';
    badgeEl.dataset.type = page.type;
    labelEl.textContent = known ? page.label : 'GitHub';
    labelEl.title = known ? page.label : '';
    if (!known) hintEl.textContent = 'Open a repo, pull request, file, or commit for page-aware questions.';
    else if (panelOpen) hintEl.textContent = 'The RepoLens panel is open on this tab.';
    else hintEl.textContent = 'Ready — open the panel to ask about this page.';

    if (panelOpen) setPrimary('Close RepoLens panel', closePanel, { secondary: true });
    else setPrimary('Open RepoLens panel', openPanel);
  }

  async function renderSetup() {
    const keys = [STORAGE.PROVIDER, STORAGE.GITHUB_TOKEN];
    for (const p of Object.values(PROVIDERS)) keys.push(p.keyStorage, p.modelStorage);
    const s = await chrome.storage.local.get(keys);

    const provider = PROVIDERS[s[STORAGE.PROVIDER]] || PROVIDERS[DEFAULT_PROVIDER];
    const model = s[provider.modelStorage] || provider.defaultModel;
    const hasKey = Boolean(s[provider.keyStorage]);

    if (hasKey) {
      setStatus('ai', 'ok', `${provider.label.split(' (')[0]} · ${model}`);
    } else {
      setStatus('ai', 'bad', `${provider.label.split(' (')[0]} · no API key`);
    }
    bannerEl.classList.toggle('is-hidden', hasKey);

    if (s[STORAGE.GITHUB_TOKEN]) setStatus('gh', 'ok', 'Token set — private repos enabled');
    else setStatus('gh', 'warn', 'No token — public repos only');

    return hasKey;
  }

  async function renderShortcut() {
    try {
      const commands = await chrome.commands.getAll();
      const toggle = commands.find((c) => c.name === 'toggle-panel');
      shortcutEl.textContent = toggle?.shortcut ? `Shortcut: ${toggle.shortcut}` : '';
    } catch {
      shortcutEl.textContent = '';
    }
  }

  (async function init() {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) {
      const state = await chrome.runtime.sendMessage({ type: MSG.PANEL_STATE, tabId: tab.id }).catch(() => null);
      panelOpen = Boolean(state?.open);
    }
    renderPage();
    const hasKey = await renderSetup();
    if (!hasKey && !panelOpen) {
      setPrimary('Add API key', openSettings);
    }
    renderShortcut();
  })();
})();
