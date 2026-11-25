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
  const aiCheckLabel = document.getElementById('ai-check-label');
  const tokenInput = document.getElementById('github-token');
  const modelSelect = document.getElementById('model-select');
  const modelHint = document.getElementById('model-hint');
  const customWrap = document.getElementById('custom-wrap');
  const customInput = document.getElementById('custom-model');
  const prefetchToggle = document.getElementById('prefetch-toggle');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('status');
  const recheckBtn = document.getElementById('recheck-btn');

  const CUSTOM_VALUE = '__custom__';

  /** Unsaved per-provider edits, so switching providers keeps typed values. */
  const drafts = { keys: {}, models: {} };
  let providerId = DEFAULT_PROVIDER;
  let checkSeq = 0;

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
      name.textContent = p.label;
      const state = document.createElement('span');
      state.className = 'provider-state';
      state.textContent = drafts.keys[p.id] ? 'Key added' : 'No key';
      btn.append(name, state);

      btn.addEventListener('click', () => switchProvider(p.id));
      pickerEl.appendChild(btn);
    }
  }

  function stashCurrent() {
    drafts.keys[providerId] = keyInput.value.trim();
    drafts.models[providerId] = selectedModelValue();
  }

  function switchProvider(id) {
    if (id === providerId) return;
    stashCurrent();
    providerId = id;
    applyProvider();
    checkAi();
  }

  function applyProvider() {
    const p = provider();
    keyLabel.textContent = `${p.label} API key`;
    aiCheckLabel.textContent = `${p.label.split(' (')[0]} key`;
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
  });
  customInput.addEventListener('input', () => {
    drafts.models[providerId] = selectedModelValue();
  });
  keyInput.addEventListener('input', () => {
    drafts.keys[providerId] = keyInput.value.trim();
  });

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
      setCheck('ai', 'bad', 'Not set — required');
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
      setCheck('github', 'warn', 'Not set — public repos only (60 requests/hour)');
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

  // ─── Load / save ────────────────────────────────────────────────────────────
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
  }

  function flashStatus(text, ok = true) {
    statusEl.textContent = text;
    statusEl.style.color = ok ? '' : 'var(--danger)';
    statusEl.classList.add('is-visible');
    setTimeout(() => statusEl.classList.remove('is-visible'), 2200);
  }

  saveBtn.addEventListener('click', async () => {
    stashCurrent();
    const values = {
      [STORAGE.PROVIDER]: providerId,
      [STORAGE.GITHUB_TOKEN]: tokenInput.value.trim(),
      [STORAGE.PREFETCH]: prefetchToggle.checked,
    };
    for (const p of Object.values(PROVIDERS)) {
      values[p.keyStorage] = drafts.keys[p.id] || '';
      values[p.modelStorage] = drafts.models[p.id] || '';
    }
    await chrome.storage.local.set(values);

    const hasKey = Boolean(drafts.keys[providerId]);
    flashStatus(hasKey ? `Saved — using ${provider().label}` : 'Saved — add an API key to start', hasKey);
    renderPicker();
    runChecks();
  });

  recheckBtn.addEventListener('click', runChecks);

  document.querySelectorAll('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
    });
  });

  document.getElementById('privacy-link').href = `${SITE_URL}/privacy.html`;
  const feedbackLink = document.getElementById('feedback-link');
  const refreshFeedbackLink = () => globalThis.RepoLensSupport.feedbackUrl().then((url) => { feedbackLink.href = url; });
  chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refreshFeedbackLink(); });
  refreshFeedbackLink();

  (async function init() {
    await loadPrefs();
    applyProvider();
    await runChecks();
  })();
})();
