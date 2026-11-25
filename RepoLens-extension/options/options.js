/**
 * RepoLens preferences page — AI provider + credentials, model, background behavior.
 */
(function () {
  const { STORAGE, PROVIDERS, DEFAULT_PROVIDER, SITE_URL } = globalThis.REPOLENS;
  const GitHub = globalThis.RepoLensGitHub;
  const Providers = globalThis.RepoLensProviders;

  const pickerEl = document.getElementById('provider-picker');
  const keyInput = document.getElementById('api-key');
  const keyLabel = document.getElementById('api-key-label');
  const keyLink = document.getElementById('api-key-link');
  const tokenInput = document.getElementById('github-token');
  const modelSelect = document.getElementById('model-select');
  const modelHint = document.getElementById('model-hint');
  const customWrap = document.getElementById('custom-wrap');
  const customInput = document.getElementById('custom-model');
  const prefetchToggle = document.getElementById('prefetch-toggle');
  const toastEl = document.getElementById('toast');

  const CUSTOM_VALUE = '__custom__';

  /** Per-provider values, so switching providers keeps each key and model. */
  const drafts = { keys: {}, models: {} };
  /** Last values written to storage, to save (and re-check) only what changed. */
  const saved = {};
  let providerId = DEFAULT_PROVIDER;
  let checkSeq = 0;

  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

  const provider = () => PROVIDERS[providerId];

  // ─── Provider picker ────────────────────────────────────────────────────────
  function renderPicker() {
    pickerEl.innerHTML = '';
    for (const p of Object.values(PROVIDERS)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'provider-option' + (p.id === providerId ? ' is-active' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(p.id === providerId));
      btn.dataset.provider = p.id;

      const name = document.createElement('span');
      name.className = 'provider-name';
      name.textContent = p.label.split(' (')[0];
      const state = document.createElement('span');
      state.className = 'provider-state';
      const hasKey = Boolean(drafts.keys[p.id]);
      state.classList.toggle('has-key', hasKey);
      state.textContent = hasKey ? 'Key added' : 'No key';
      btn.append(name, state);

      btn.addEventListener('click', () => switchProvider(p.id));
      pickerEl.appendChild(btn);
    }
  }

  function stashCurrent() {
    drafts.keys[providerId] = keyInput.value.trim();
    drafts.models[providerId] = selectedModelValue();
  }

  async function switchProvider(id) {
    if (id === providerId) return;
    if (!(await requireUnlock())) return;
    stashCurrent();
    providerId = id;
    applyProvider();
    save();
  }

  function applyProvider() {
    const p = provider();
    keyLabel.textContent = `${p.label.split(' (')[0]} API key`;
    keyLink.href = p.keyUrl;
    keyLink.textContent = p.keyHost;
    keyInput.placeholder = p.keyPlaceholder;
    keyInput.value = drafts.keys[providerId] || '';
    customInput.placeholder = `e.g. ${p.defaultModel}`;
    renderPicker();
    renderModels([]);
  }

  // ─── Model list ─────────────────────────────────────────────────────────────
  function selectedModelValue() {
    const v = modelSelect.value;
    return v === CUSTOM_VALUE ? customInput.value.trim() : v;
  }

  function renderModels(models) {
    const p = provider();
    const current = drafts.models[providerId] || '';
    modelSelect.innerHTML = '';

    const def = document.createElement('option');
    def.value = '';
    def.textContent = `Default — ${p.defaultModel}`;
    modelSelect.appendChild(def);

    const known = new Set(['']);
    for (const m of models) {
      if (m.id === p.defaultModel) continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id;
      modelSelect.appendChild(opt);
      known.add(m.id);
    }

    const custom = document.createElement('option');
    custom.value = CUSTOM_VALUE;
    custom.textContent = 'Custom…';
    modelSelect.appendChild(custom);

    if (current && !known.has(current)) {
      modelSelect.value = CUSTOM_VALUE;
      customInput.value = current;
    } else {
      modelSelect.value = current;
    }
    customWrap.classList.toggle('is-hidden', modelSelect.value !== CUSTOM_VALUE);
  }

  modelSelect.addEventListener('change', () => {
    customWrap.classList.toggle('is-hidden', modelSelect.value !== CUSTOM_VALUE);
    drafts.models[providerId] = selectedModelValue();
    if (modelSelect.value === CUSTOM_VALUE) customInput.focus();
    else save();
  });
  customInput.addEventListener('input', () => {
    drafts.models[providerId] = selectedModelValue();
    scheduleSave();
  });
  keyInput.addEventListener('input', () => {
    drafts.keys[providerId] = keyInput.value.trim();
    scheduleSave();
  });
  tokenInput.addEventListener('input', () => scheduleSave());
  prefetchToggle.addEventListener('change', () => save());

  // ─── Status checks ──────────────────────────────────────────────────────────
  function setCheck(key, state, value) {
    const li = document.querySelector(`.check[data-key="${key}"]`);
    if (!li) return;
    li.querySelector('.dot').className = `dot is-${state}`;
    li.querySelector('.check-value').textContent = value;
  }

  async function checkAi() {
    const seq = ++checkSeq;
    const id = providerId;
    const apiKey = keyInput.value.trim();
    if (!apiKey) {
      setCheck('ai', 'bad', 'Required — paste a key to start asking');
      modelHint.textContent = 'Add an API key to load the models available to you.';
      renderModels([]);
      return;
    }
    setCheck('ai', 'pending', 'Checking…');
    try {
      const models = await Providers.listModels(id, apiKey);
      if (seq !== checkSeq) return;
      setCheck('ai', 'ok', `Valid — ${models.length} models available`);
      modelHint.textContent = 'Used for both Instant and Deep answers.';
      renderModels(models);
    } catch (err) {
      if (seq !== checkSeq) return;
      setCheck('ai', 'bad', err.status === 401 ? 'Invalid key' : err.message.slice(0, 90));
      renderModels([]);
    }
  }

  async function checkGitHub() {
    const token = tokenInput.value.trim();
    if (!token) {
      setCheck('github', 'warn', 'Not set — public repos only, 60 GitHub requests per hour');
      return;
    }
    setCheck('github', 'pending', 'Checking…');
    try {
      const viewer = await GitHub.getViewer(token);
      setCheck('github', 'ok', `Connected as @${viewer.login}`);
    } catch (err) {
      setCheck('github', 'bad', err.status === 401 ? 'Invalid or expired token' : err.message.slice(0, 80));
    }
  }

  function runChecks() {
    return Promise.all([checkAi(), checkGitHub()]);
  }

  // ─── Load / auto-save ───────────────────────────────────────────────────────
  function currentValues() {
    const values = {
      [STORAGE.PROVIDER]: providerId,
      [STORAGE.GITHUB_TOKEN]: tokenInput.value.trim(),
      [STORAGE.PREFETCH]: prefetchToggle.checked,
    };
    for (const p of Object.values(PROVIDERS)) {
      values[p.keyStorage] = drafts.keys[p.id] || '';
      values[p.modelStorage] = drafts.models[p.id] || '';
    }
    return values;
  }

  async function loadPrefs() {
    const keys = [STORAGE.PROVIDER, STORAGE.GITHUB_TOKEN, STORAGE.PREFETCH];
    for (const p of Object.values(PROVIDERS)) keys.push(p.keyStorage, p.modelStorage);
    const s = await chrome.storage.local.get(keys);

    for (const p of Object.values(PROVIDERS)) {
      drafts.keys[p.id] = s[p.keyStorage] || '';
      drafts.models[p.id] = typeof s[p.modelStorage] === 'string' ? s[p.modelStorage] : '';
    }
    providerId = PROVIDERS[s[STORAGE.PROVIDER]] ? s[STORAGE.PROVIDER] : DEFAULT_PROVIDER;
    tokenInput.value = s[STORAGE.GITHUB_TOKEN] || '';
    prefetchToggle.checked = s[STORAGE.PREFETCH] !== false;
    Object.assign(saved, currentValues());
  }

  let toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1600);
  }

  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }

  async function save() {
    clearTimeout(saveTimer);
    stashCurrent();
    const values = currentValues();
    const changed = Object.keys(values).filter((k) => values[k] !== saved[k]);
    if (!changed.length) return;
    Object.assign(saved, values);
    await chrome.storage.local.set(values);
    toast('Saved');
    renderPicker();
    if (changed.includes(STORAGE.PROVIDER) || changed.includes(provider().keyStorage)) checkAi();
    if (changed.includes(STORAGE.GITHUB_TOKEN)) checkGitHub();
  }

  window.addEventListener('pagehide', () => save());

  const revealButtons = document.querySelectorAll('.reveal-btn');

  function setRevealed(btn, show) {
    document.getElementById(btn.dataset.target).type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
  }

  revealButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const show = document.getElementById(btn.dataset.target).type === 'password';
      if (show && !(await requireUnlock())) return;
      setRevealed(btn, show);
    });
  });

  // ─── Touch ID / Windows Hello key lock ──────────────────────────────────────
  const KeyLock = globalThis.RepoLensKeyLock;
  const RELOCK_AFTER_MS = 5 * 60 * 1000;
  const lockToggle = document.getElementById('key-lock-toggle');
  const lockMsg = document.getElementById('key-lock-msg');
  const lockReset = document.getElementById('key-lock-reset');
  const lockBar = document.getElementById('lock-bar');
  const lockBarText = document.getElementById('lock-bar-text');
  const lockBarBtn = document.getElementById('lock-bar-btn');
  const secretInputs = [keyInput, tokenInput];

  let lockCredential = null;
  let unlocked = false;
  let relockTimer = 0;
  let verifying = null;

  const isLocked = () => Boolean(lockCredential) && !unlocked;

  document.querySelectorAll('.auth-name').forEach((el) => { el.textContent = KeyLock.authName(); });

  function showLockMsg(text, ok = false) {
    lockMsg.textContent = text;
    lockMsg.classList.toggle('is-ok', ok);
    lockMsg.classList.toggle('is-hidden', !text);
  }

  function applyLockUi() {
    const locked = isLocked();
    for (const input of secretInputs) {
      input.readOnly = locked;
      input.classList.toggle('is-locked', locked);
    }
    if (locked) revealButtons.forEach((btn) => setRevealed(btn, false));

    lockBar.classList.toggle('is-hidden', !lockCredential);
    lockBar.classList.toggle('is-unlocked', !locked);
    lockBarText.textContent = locked
      ? `Keys are locked with ${KeyLock.authName()}.`
      : 'Keys unlocked. They lock again after 5 minutes without activity.';
    lockBarBtn.textContent = locked ? 'Unlock' : 'Lock now';
    lockToggle.checked = Boolean(lockCredential);
    lockReset.classList.toggle('is-hidden', !lockCredential);
  }

  function relock() {
    clearTimeout(relockTimer);
    unlocked = false;
    applyLockUi();
  }

  function touchActivity() {
    if (!unlocked || !lockCredential) return;
    clearTimeout(relockTimer);
    relockTimer = setTimeout(relock, RELOCK_AFTER_MS);
  }

  ['pointerdown', 'keydown', 'input'].forEach((type) => document.addEventListener(type, touchActivity, true));

  /** Resolves true when the lock is off, already unlocked, or the user verifies. */
  async function requireUnlock({ fresh = false } = {}) {
    if (!lockCredential || (unlocked && !fresh)) return true;
    if (verifying) return verifying;
    verifying = (async () => {
      try {
        await KeyLock.verify(lockCredential);
        unlocked = true;
        showLockMsg('');
        touchActivity();
        return true;
      } catch (err) {
        showLockMsg(KeyLock.friendlyError(err));
        return false;
      } finally {
        verifying = null;
        applyLockUi();
      }
    })();
    return verifying;
  }

  lockBarBtn.addEventListener('click', () => (isLocked() ? requireUnlock() : relock()));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE.KEY_LOCK]) return;
    const next = changes[STORAGE.KEY_LOCK].newValue?.credentialId || null;
    if (next === lockCredential) return;
    lockCredential = next;
    unlocked = false;
    applyLockUi();
  });

  // Locked inputs are read-only; trying to edit one asks to unlock first.
  for (const input of secretInputs) {
    const unlockThenFocus = async () => {
      if (isLocked() && (await requireUnlock())) input.focus();
    };
    input.addEventListener('click', unlockThenFocus);
    input.addEventListener('keydown', (e) => {
      if (!isLocked() || e.key === 'Tab' || e.key === 'Shift' || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      unlockThenFocus();
    });
    input.addEventListener('paste', (e) => {
      if (!isLocked()) return;
      e.preventDefault();
      unlockThenFocus();
    });
  }

  lockToggle.addEventListener('change', async () => {
    const wantOn = lockToggle.checked;
    lockToggle.checked = Boolean(lockCredential);
    lockToggle.disabled = true;
    try {
      if (wantOn) {
        if (!(await KeyLock.isAvailable())) {
          showLockMsg(`${KeyLock.authName()} isn't available on this device. RepoLens needs a built-in fingerprint, face, or PIN sign-in (Touch ID or Windows Hello).`);
          return;
        }
        showLockMsg(`Waiting for ${KeyLock.authName()}…`, true);
        lockCredential = await KeyLock.enable();
        unlocked = true;
        touchActivity();
        showLockMsg(`Lock is on. Keys now need ${KeyLock.authName()} to view or change.`, true);
      } else {
        if (!(await requireUnlock({ fresh: true }))) return;
        await KeyLock.disable();
        lockCredential = null;
        unlocked = false;
        clearTimeout(relockTimer);
        showLockMsg('Lock is off.', true);
      }
    } catch (err) {
      showLockMsg(KeyLock.friendlyError(err));
    } finally {
      lockToggle.disabled = false;
      applyLockUi();
    }
  });

  // Recovery when the OS credential is gone (e.g. Windows Hello was reset):
  // anyone can clear the keys, but nobody can read them without verifying.
  lockReset.addEventListener('click', async () => {
    const ok = window.confirm('Remove all saved API keys and the GitHub token, and turn the lock off? You will need to paste your keys again.');
    if (!ok) return;
    const remove = [STORAGE.KEY_LOCK, STORAGE.GITHUB_TOKEN, ...Object.values(PROVIDERS).map((p) => p.keyStorage)];
    await chrome.storage.local.remove(remove);
    lockCredential = null;
    unlocked = false;
    await loadPrefs();
    applyProvider();
    applyLockUi();
    showLockMsg('Keys removed and lock turned off.', true);
    runChecks();
  });

  // ─── Conversation history scope ─────────────────────────────────────────────
  const scopeToggle = document.getElementById('history-scope-toggle');
  const scopeHint = document.getElementById('history-scope-hint');

  function renderScopeHint() {
    scopeHint.textContent = scopeToggle.checked
      ? 'Questions on any page of a repo (home, folders, files, PRs) share one history. Each repo keeps its own.'
      : 'Each page (a PR, a file, a folder) keeps its own history.';
  }

  chrome.storage.local.get(STORAGE.HISTORY_SCOPE).then((s) => {
    scopeToggle.checked = s[STORAGE.HISTORY_SCOPE] !== 'page';
    renderScopeHint();
  });

  scopeToggle.addEventListener('change', async () => {
    renderScopeHint();
    await chrome.storage.local.set({ [STORAGE.HISTORY_SCOPE]: scopeToggle.checked ? 'repo' : 'page' });
    toast('Saved');
  });

  // ─── On-page lens ───────────────────────────────────────────────────────────
  const Lens = globalThis.RepoLensLens;
  const lensToggle = document.getElementById('lens-toggle');
  const lensRepos = document.getElementById('lens-repos');
  const lensReposRow = document.getElementById('lens-repos-row');
  const lensReposHint = document.getElementById('lens-repos-hint');

  async function renderLens() {
    const { all, repos } = await Lens.get();
    lensToggle.checked = !all;
    lensReposRow.classList.toggle('is-hidden', !repos.length);
    lensReposHint.textContent = all
      ? 'Kept for when you turn the lens back on.'
      : 'Hidden from the toolbar popup. Show it again here.';
    lensRepos.replaceChildren(...repos.map((repo) => {
      const li = document.createElement('li');
      const name = document.createElement('code');
      name.textContent = repo;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'repo-show-btn';
      btn.textContent = 'Show';
      btn.setAttribute('aria-label', `Show the lens on ${repo}`);
      btn.addEventListener('click', () => Lens.setRepo(repo, false).then(() => toast('Saved')));
      li.append(name, btn);
      return li;
    }));
  }

  lensToggle.addEventListener('change', () => Lens.setAll(!lensToggle.checked).then(() => toast('Saved')));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE.LENS_HIDDEN]) renderLens();
  });
  renderLens();

  document.getElementById('privacy-link').href = `${SITE_URL}/privacy.html`;
  const feedbackLink = document.getElementById('feedback-link');
  const refreshFeedbackLink = () => globalThis.RepoLensSupport.feedbackUrl().then((url) => { feedbackLink.href = url; });
  chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refreshFeedbackLink(); });
  refreshFeedbackLink();

  (async function init() {
    await loadPrefs();
    lockCredential = await KeyLock.credentialId();
    applyProvider();
    applyLockUi();
    await runChecks();
  })();
})();
