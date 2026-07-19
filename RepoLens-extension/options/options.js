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
  const backendNote = document.getElementById('backend-note');

  const CUSTOM_VALUE = '__custom__';

  const FALLBACK_MODELS = [
    { id: '', label: 'Default (server setting)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — fast, balanced' },
    { id: 'claude-opus-4-1', label: 'Claude Opus 4.1 — most capable' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
  ];

  let knownIds = new Set();

  function renderModels(models, defaultModel) {
    modelSelect.innerHTML = '';
    knownIds = new Set();
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent =
        m.id === '' && defaultModel ? `${m.label} — ${defaultModel}` : m.label;
      modelSelect.appendChild(opt);
      knownIds.add(m.id);
    }
    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_VALUE;
    customOpt.textContent = 'Custom…';
    modelSelect.appendChild(customOpt);
  }

  function applyStoredSelection(storedModel) {
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

  async function loadModels() {
    try {
      const res = await fetch(`${BACKEND_URL}/models`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.models) && data.models.length) {
        renderModels(data.models, data.default);
        backendNote.textContent = `Backend connected · provider: ${data.provider}`;
        backendNote.classList.remove('is-error');
        return;
      }
      throw new Error('bad response');
    } catch {
      renderModels(FALLBACK_MODELS, '');
      backendNote.textContent =
        `Backend not reachable at ${BACKEND_URL} — showing default model list. Start it with ./start-backend.sh`;
      backendNote.classList.add('is-error');
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

  (async function init() {
    await loadModels();
    await loadPrefs();
  })();
})();
