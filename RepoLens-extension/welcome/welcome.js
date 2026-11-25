/**
 * RepoLens welcome page — live setup checklist and pin-to-toolbar prompt.
 */
(function () {
  const { STORAGE, PROVIDERS, DEFAULT_PROVIDER, SITE_URL, SAMPLE_PR_URL } = globalThis.REPOLENS;

  const $ = (id) => document.getElementById(id);

  $('version').textContent = `v${chrome.runtime.getManifest().version} · Free & open source`;
  $('privacy-link').href = `${SITE_URL}/privacy.html`;
  $('site-link').href = SITE_URL;

  globalThis.RepoLensSupport.feedbackUrl().then((url) => {
    $('feedback-link').href = url;
  });

  $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-github').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-try').addEventListener('click', () => chrome.tabs.create({ url: SAMPLE_PR_URL }));

  chrome.commands.getAll().then((commands) => {
    const toggle = commands.find((c) => c.name === 'toggle-panel');
    if (toggle?.shortcut) $('shortcut').textContent = toggle.shortcut;
  }).catch(() => {});

  // ─── Setup checklist ────────────────────────────────────────────────────────
  document.querySelectorAll('.task').forEach((li) => {
    li.dataset.n = li.querySelector('.task-mark').textContent;
  });

  function setTask(id, done, text) {
    const li = $(id);
    li.classList.toggle('is-done', done);
    li.querySelector('.task-mark').textContent = done ? '✓' : li.dataset.n;
    $(`${id}-text`).textContent = text;
  }

  async function refreshChecklist() {
    const keys = [STORAGE.PROVIDER, STORAGE.GITHUB_TOKEN];
    for (const p of Object.values(PROVIDERS)) keys.push(p.keyStorage);
    const s = await chrome.storage.local.get(keys);
    const provider = PROVIDERS[s[STORAGE.PROVIDER]] || PROVIDERS[DEFAULT_PROVIDER];

    const hasKey = Boolean(s[provider.keyStorage]);
    setTask(
      'task-key',
      hasKey,
      hasKey
        ? `Connected to ${provider.label}. You can switch providers any time in Settings.`
        : 'Use Claude, ChatGPT (OpenAI), or Gemini. A free Gemini key works too.'
    );
    $('btn-settings').textContent = hasKey ? 'Change' : 'Open Settings';
    $('btn-settings').classList.toggle('btn-primary', !hasKey);
    $('btn-settings').classList.toggle('btn-ghost', hasKey);
    $('btn-try').classList.toggle('btn-primary', hasKey);
    $('btn-try').classList.toggle('btn-ghost', !hasKey);

    const hasToken = Boolean(s[STORAGE.GITHUB_TOKEN]);
    setTask(
      'task-github',
      hasToken,
      hasToken
        ? 'Token added. Private repos and higher GitHub limits are enabled.'
        : 'Needed for private repos and higher GitHub limits. Public repos work without one.'
    );
    $('btn-github').textContent = hasToken ? 'Change' : 'Add token';
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') refreshChecklist();
  });
  refreshChecklist();

  // ─── Pin to toolbar ─────────────────────────────────────────────────────────
  const banner = $('pin-banner');

  async function isPinned() {
    try {
      return (await chrome.action.getUserSettings()).isOnToolbar === true;
    } catch {
      return null;
    }
  }

  function showPinned() {
    banner.classList.remove('is-hidden');
    $('pin-steps').classList.add('is-hidden');
    $('pin-done').classList.remove('is-hidden');
    setTimeout(() => banner.classList.add('is-fading'), 2500);
    setTimeout(() => banner.classList.add('is-hidden'), 2900);
  }

  async function initPinBanner() {
    const { [STORAGE.PIN_PROMPT_DISMISSED]: dismissed } = await chrome.storage.local.get(STORAGE.PIN_PROMPT_DISMISSED);
    const pinned = await isPinned();
    if (dismissed || pinned === null || pinned) return;

    banner.classList.remove('is-hidden');
    const timer = setInterval(async () => {
      if (await isPinned()) {
        clearInterval(timer);
        showPinned();
      }
    }, 1500);
    setTimeout(() => clearInterval(timer), 10 * 60 * 1000);
  }

  $('pin-dismiss').addEventListener('click', () => {
    chrome.storage.local.set({ [STORAGE.PIN_PROMPT_DISMISSED]: true });
    banner.classList.add('is-hidden');
  });

  initPinBanner();
})();
