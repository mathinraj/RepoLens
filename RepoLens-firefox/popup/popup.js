/**
 * RepoLens toolbar popup — page status, open/close the in-page panel, settings.
 */
(function () {
  const { MSG, STORAGE, PROVIDERS, DEFAULT_PROVIDER, HOST, PAGE_TYPES, RATE, MORE_APPS } = globalThis.REPOLENS;
  const { detectPage } = globalThis.RepoLensPageDetector;
  const Lens = globalThis.RepoLensLens;
  const Support = globalThis.RepoLensSupport;

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

  const noticeShown = renderNotice().catch(() => {});

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

  // The panel is a drawer inside the GitHub page (content/content.js), so the
  // popup asks that tab's content script to show or hide it.
  function setDrawer(open) {
    chrome.tabs
      .sendMessage(tab.id, { type: MSG.DRAWER_TOGGLE, open })
      .then(() => window.close())
      .catch(() => showError('Reload this GitHub tab, then try again. RepoLens can\'t reach tabs opened before it was installed.'));
  }

  const openPanel = () => setDrawer(true);
  const closePanel = () => setDrawer(false);

  // Firefox may install without the site access listed in the manifest; the
  // lens and answers need it, so offer to grant it here.
  const permBanner = document.getElementById('perm-banner');
  const origins = chrome.runtime.getManifest().host_permissions || [];

  async function renderPermissions() {
    const granted = await chrome.permissions.contains({ origins }).catch(() => true);
    permBanner.classList.toggle('is-hidden', granted);
  }

  document.getElementById('perm-btn').addEventListener('click', () => {
    chrome.permissions.request({ origins }).then((ok) => {
      if (ok) permBanner.classList.add('is-hidden');
    });
  });

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

  // ─── On-page lens visibility ──────────────────────────────────────────────
  const lensHintEl = document.getElementById('lens-hint');
  const lensButtons = document.querySelectorAll('[data-lens]');

  async function renderLens() {
    const page = currentPage();
    const key = Lens.repoKey(page);
    const state = Lens.stateFor(await Lens.get(), page);

    lensButtons.forEach((btn) => {
      const active = btn.dataset.lens === state;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
      btn.disabled = btn.dataset.lens === 'repo' && !key;
    });
    if (state === 'all') lensHintEl.textContent = 'Hidden on every page';
    else if (state === 'repo') lensHintEl.textContent = `Hidden on ${key}`;
    else lensHintEl.textContent = key ? `Shown on ${key}` : 'Shown on GitHub pages';
  }

  lensButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      await Lens.choose(btn.dataset.lens, currentPage());
      renderLens();
    });
  });

  // ─── Rate prompt ──────────────────────────────────────────────────────────
  const rateEl = document.getElementById('rate-prompt');

  async function renderRate() {
    const s = await chrome.storage.local.get([STORAGE.ANSWER_COUNT, STORAGE.INSTALLED_AT, STORAGE.RATE_PROMPT]);
    const ask = Support.shouldAskForRating({
      answers: s[STORAGE.ANSWER_COUNT] || 0,
      installedAt: s[STORAGE.INSTALLED_AT] || 0,
      prompt: s[STORAGE.RATE_PROMPT] || null,
    });
    // One prompt at a time: an update / What's new notice wins.
    await noticeShown;
    const noticeVisible = !document.getElementById('notice').classList.contains('is-hidden');
    rateEl.classList.toggle('is-hidden', !ask || noticeVisible);
  }

  document.getElementById('rate-now').addEventListener('click', async () => {
    await chrome.storage.local.set({ [STORAGE.RATE_PROMPT]: { rated: true } });
    chrome.tabs.create({ url: Support.reviewUrl() });
    window.close();
  });

  document.getElementById('rate-later').addEventListener('click', async () => {
    const remindAt = Date.now() + RATE.REMIND_DAYS * 86_400_000;
    await chrome.storage.local.set({ [STORAGE.RATE_PROMPT]: { remindAt } });
    rateEl.classList.add('is-hidden');
  });

  // ─── More from the developer ──────────────────────────────────────────────
  const moreBtn = document.getElementById('more-btn');
  const moreEl = document.getElementById('more-apps');
  const moreList = document.getElementById('more-list');

  for (const app of MORE_APPS) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'more-app';
    a.href = app.url;
    a.target = '_blank';
    a.rel = 'noopener';
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL(app.icon);
    icon.alt = '';
    icon.width = 28;
    icon.height = 28;
    const text = document.createElement('span');
    text.className = 'more-text';
    const name = document.createElement('span');
    name.className = 'more-name';
    name.textContent = app.name;
    const desc = document.createElement('span');
    desc.className = 'more-desc';
    desc.textContent = app.desc;
    text.append(name, desc);
    a.append(icon, text);
    li.appendChild(a);
    moreList.appendChild(li);
  }

  moreBtn.addEventListener('click', () => {
    const open = !moreEl.classList.toggle('is-hidden');
    moreBtn.setAttribute('aria-expanded', String(open));
    moreBtn.classList.toggle('is-active', open);
  });

  function currentPage() {
    try {
      const url = new URL(tab?.url || '');
      if (url.hostname === HOST) return detectPage(url.pathname);
    } catch {
      // not a GitHub tab
    }
    return null;
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
      const state = await chrome.tabs.sendMessage(tab.id, { type: MSG.DRAWER_STATE }).catch(() => null);
      panelOpen = Boolean(state?.open);
    }
    renderPermissions();
    renderPage();
    const hasKey = await renderSetup();
    if (!hasKey && !panelOpen) {
      setPrimary('Add API key', openSettings);
    }
    renderShortcut();
    renderLens();
    renderRate();
  })();
})();
