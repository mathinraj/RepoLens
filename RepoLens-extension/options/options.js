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
  const verifyBtn = document.getElementById('verify-btn');
  const verifyStatus = document.getElementById('verify-status');
  const modelChecks = document.getElementById('model-checks');
  const modelSummary = document.getElementById('model-summary');

  const CUSTOM_VALUE = '__custom__';

  /** @type {Array<{id,label,note}>} last-known candidate models */
  let currentModels = [];
  let currentDefault = '';

  // Current Claude lineup (mid-2026) — used if the backend can't be reached.
  const FALLBACK_MODELS = [
    { id: 'claude-fable-5', label: 'Claude Fable 5', note: 'Highest tier — deep judgment' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'Frontier agentic coding' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Best speed / intelligence balance' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest, near-frontier' },
  ];

  let knownIds = new Set();
  let pendingStoredModel = null;

  function renderModels(models, defaultModel, availableIds) {
    currentModels = models;
    currentDefault = defaultModel;
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
      // When we have verification results, only include available models.
      if (availableIds && !availableIds.has(m.id)) continue;
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

  // ─── Verify which models are actually usable ────────────────────────────────
  const STATUS_META = {
    ok: { pill: 'Available', icon: '✓' },
    bad: { pill: 'Unavailable', icon: '✕' },
    pending: { pill: 'Checking…', icon: '' },
  };

  function renderModelCheckRow(model, state, detail) {
    let li = modelChecks.querySelector(`li[data-id="${model.id}"]`);
    if (!li) {
      li = document.createElement('li');
      li.className = 'model-check';
      li.dataset.id = model.id;
      li.innerHTML =
        '<span class="mc-icon"></span>' +
        '<span class="mc-info"><span class="mc-label"></span><span class="mc-detail"></span></span>' +
        '<span class="mc-pill"></span>';
      modelChecks.appendChild(li);
    }
    const meta = STATUS_META[state] || STATUS_META.pending;
    li.className = 'model-check state-' + state;
    li.querySelector('.mc-icon').textContent = meta.icon;
    li.querySelector('.mc-label').textContent = model.label || model.id;
    li.querySelector('.mc-detail').textContent = detail || model.note || model.id;
    li.querySelector('.mc-pill').textContent = meta.pill;
  }

  async function verifyModel(model) {
    renderModelCheckRow(model, 'pending', 'Checking…');
    try {
      const res = await fetch(`${BACKEND_URL}/models/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.id }),
      });
      const data = await res.json();
      if (data.ok) {
        renderModelCheckRow(model, 'ok', `Verified${data.ms ? ` in ${(data.ms / 1000).toFixed(1)}s` : ''}`);
        return true;
      }
      renderModelCheckRow(model, 'bad', shortError(data.error) || 'Unavailable');
      return false;
    } catch {
      renderModelCheckRow(model, 'bad', 'Backend unreachable');
      return false;
    }
  }

  function shortError(msg) {
    if (!msg) return '';
    if (/not found|unknown model|does not exist|invalid model|not available/i.test(msg)) {
      return 'not available';
    }
    if (/auth|login|unauthorized/i.test(msg)) return 'auth error';
    if (/rate.limit/i.test(msg)) return 'rate-limited (try again)';
    return msg.slice(0, 60);
  }

  function setSummary(text, tone) {
    modelSummary.textContent = text;
    modelSummary.className = 'model-summary' + (tone ? ` tone-${tone}` : '');
    modelSummary.classList.toggle('is-hidden', !text);
  }

  async function verifyAllModels() {
    if (!currentModels.length) return;
    verifyBtn.disabled = true;
    verifyBtn.classList.add('is-busy');
    verifyStatus.textContent = '';
    modelChecks.classList.remove('is-hidden');
    modelChecks.innerHTML = '';
    setSummary(`Testing ${currentModels.length} model${currentModels.length === 1 ? '' : 's'}…`, 'pending');

    const available = new Set();
    // Test sequentially — each CLI call is a real request and can be slow.
    for (let i = 0; i < currentModels.length; i += 1) {
      /* eslint-disable no-await-in-loop */
      verifyStatus.textContent = `${i + 1} / ${currentModels.length}`;
      const ok = await verifyModel(currentModels[i]);
      if (ok) available.add(currentModels[i].id);
      /* eslint-enable no-await-in-loop */
    }
    verifyStatus.textContent = '';

    const count = available.size;
    setSummary(
      count > 0
        ? `${count} of ${currentModels.length} model${currentModels.length === 1 ? '' : 's'} available`
        : 'No listed models available — use Default or a custom slug',
      count > 0 ? 'ok' : 'bad'
    );

    // Preserve the user's current selection if still valid.
    const prevSelection = pendingStoredModel;
    renderModels(currentModels, currentDefault, available);
    if (prevSelection && (available.has(prevSelection) || prevSelection === '')) {
      applyStoredSelection(prevSelection);
    }

    verifyBtn.disabled = false;
    verifyBtn.classList.remove('is-busy');
  }

  verifyBtn.addEventListener('click', verifyAllModels);

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
