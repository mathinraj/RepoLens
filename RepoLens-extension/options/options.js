/**
 * RepoLens preferences page.
 * Stores: repolensModel (string, '' = server default), repolensPrefetch (bool).
 */
(function () {
  const { BACKEND_URL } = globalThis.REPOLENS;

  const modelSelect = document.getElementById('model-select');
  const customWrap = document.getElementById('custom-wrap');
  const customInput = document.getElementById('custom-model');
  const prefetchToggle = document.getElementById('prefetch-toggle');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('status');
  const recheckBtn = document.getElementById('recheck-btn');

  const CUSTOM_VALUE = '__custom__';

  // Current Claude lineup (mid-2026) — used if the backend can't be reached.
  const FALLBACK_MODELS = [
    { id: 'claude-fable-5', label: 'Claude Fable 5', note: 'Highest tier — deep judgment' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'Frontier agentic coding' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Best speed / intelligence balance' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest, near-frontier' },
  ];

  let knownIds = new Set();
  let pendingStoredModel = null;

  function renderModels(models, defaultModel) {
    modelSelect.innerHTML = '';
    knownIds = new Set();

    // First option = the server default (rendered only once).
    const def = document.createElement('option');
    def.value = '';
    def.textContent = defaultModel
      ? `Default — ${defaultModel}`
      : 'Default (server setting)';
    modelSelect.appendChild(def);
    knownIds.add('');

    // Then each model, skipping the one that equals the default (avoid dupes).
    for (const m of models) {
      if (m.id === defaultModel) continue;
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.note ? `${m.label} — ${m.note}` : m.label;
      modelSelect.appendChild(opt);
      knownIds.add(m.id);
    }

    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_VALUE;
    customOpt.textContent = 'Custom…';
    modelSelect.appendChild(customOpt);

    if (pendingStoredModel !== null) {
      applyStoredSelection(pendingStoredModel);
    }
  }

  function applyStoredSelection(storedModel) {
    pendingStoredModel = storedModel;
    if (storedModel && !knownIds.has(storedModel)) {
      modelSelect.value = CUSTOM_VALUE;
      customInput.value = storedModel;
      customWrap.classList.remove('is-hidden');
    } else {
      modelSelect.value = storedModel || '';
      customWrap.classList.add('is-hidden');
    }
  }

  modelSelect.addEventListener('change', () => {
    customWrap.classList.toggle('is-hidden', modelSelect.value !== CUSTOM_VALUE);
  });

  // ─── Health checks ────────────────────────────────────────────────────────
  function setCheck(key, state, value) {
    const li = document.querySelector(`.check[data-key="${key}"]`);
    if (!li) return;
    const dot = li.querySelector('.dot');
    const val = li.querySelector('.check-value');
    dot.className = 'dot ' + (state === 'ok' ? 'is-ok' : state === 'bad' ? 'is-bad' : state === 'warn' ? 'is-warn' : 'is-pending');
    if (val && value != null) val.textContent = value;
  }

  function resetChecks() {
    ['backend', 'claude', 'github', 'model'].forEach((k) => setCheck(k, 'pending', k === 'backend' ? 'Checking…' : '—'));
  }

  async function runHealthCheck() {
    resetChecks();
    try {
      const res = await fetch(`${BACKEND_URL}/health`, { cache: 'no-store' });
      const h = await res.json();
      setCheck('backend', 'ok', `Connected (${h.claudeProvider || 'cli'})`);
      setCheck('claude', h.claudeAuth ? 'ok' : 'bad', h.claudeAuth ? 'Authenticated' : 'Not authenticated');
      setCheck('github', h.githubToken ? 'ok' : 'warn', h.githubToken ? 'Configured' : 'Missing (page-scrape only)');
      setCheck('model', 'ok', h.model || 'unknown');
      return h;
    } catch {
      setCheck('backend', 'bad', `Not reachable at ${BACKEND_URL}`);
      setCheck('claude', 'pending', 'Unknown');
      setCheck('github', 'pending', 'Unknown');
      setCheck('model', 'pending', 'Unknown');
      return null;
    }
  }

  async function loadModels() {
    try {
      const res = await fetch(`${BACKEND_URL}/models`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok && Array.isArray(data.models) && data.models.length) {
        renderModels(data.models, data.default || '');
        return;
      }
      throw new Error('bad response');
    } catch {
      renderModels(FALLBACK_MODELS, '');
    }
  }

  async function loadPrefs() {
    const stored = await chrome.storage.local.get(['repolensModel', 'repolensPrefetch']);
    applyStoredSelection(typeof stored.repolensModel === 'string' ? stored.repolensModel : '');
    prefetchToggle.checked = stored.repolensPrefetch !== false; // default ON
  }

  function flashStatus(text, ok = true) {
    statusEl.textContent = text;
    statusEl.style.color = ok ? '' : 'var(--danger)';
    statusEl.classList.add('is-visible');
    setTimeout(() => statusEl.classList.remove('is-visible'), 1800);
  }

  saveBtn.addEventListener('click', async () => {
    let model = modelSelect.value;
    if (model === CUSTOM_VALUE) model = customInput.value.trim();
    await chrome.storage.local.set({
      repolensModel: model || '',
      repolensPrefetch: prefetchToggle.checked,
    });
    flashStatus('Saved');
  });

  recheckBtn.addEventListener('click', () => {
    runHealthCheck();
    loadModels();
  });

  (async function init() {
    await Promise.all([runHealthCheck(), loadModels()]);
    await loadPrefs();
  })();
})();
