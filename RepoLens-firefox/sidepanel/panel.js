/**
 * RepoLens sidebar — conversation UI with typing effect, per-page history
 * (persisted via chrome.storage.local), streaming progress, and mode toggle.
 */
(function () {
  const { MSG, PAGE_TYPES, MODES, STORAGE } = globalThis.REPOLENS;
  const { getQuestionChips, STATIC_QUESTIONS } = globalThis.RepoLensQuestions;
  const { repoFromPath } = globalThis.RepoLensPageDetector;

  const badgeEl = document.getElementById('page-badge');
  const labelEl = document.getElementById('page-label');
  const chipsEl = document.getElementById('question-chips');
  const emptyChipsEl = document.getElementById('questions-empty');
  const questionsToggle = document.getElementById('questions-toggle');
  const questionsBody = document.getElementById('questions-body');
  const settingsBtn = document.getElementById('settings-btn');
  const convoEl = document.getElementById('conversation');
  const convoHeaderEl = document.getElementById('conversation-header');
  const emptyStateEl = document.getElementById('empty-state');
  const clearBtn = document.getElementById('clear-btn');
  const formEl = document.getElementById('ask-form');
  const inputEl = document.getElementById('question-input');
  const sendBtn = document.getElementById('send-btn');
  const modeBtns = document.querySelectorAll('.mode-btn');

  const STORAGE_PREFIX = 'repolens:thread:';
  const MAX_TURNS = 30;

  /** @type {object|null} */
  let currentPage = null;
  /** @type {string} */
  let currentMode = MODES.INSTANT;
  /** @type {boolean} */
  let isAsking = false;
  /** @type {number|null} */
  let activeTabId = null;
  /** @type {chrome.runtime.Port|null} */
  let askPort = null;
  /** @type {number|null} */
  let typingTimer = null;
  /** @type {Array<object>} conversation turns for the current page */
  let thread = [];
  /** @type {string|null} storage key for the current page */
  let storageKey = null;
  /** @type {object|null} turn currently awaiting a response */
  let inFlightTurn = null;
  /** @type {string|null} storage key of the page where the in-flight ask started */
  let inFlightPageKey = null;
  /** 'repo': one conversation per repo; 'page': one per page */
  let historyScope = 'repo';
  const historyScopeReady = chrome.storage.local.get(STORAGE.HISTORY_SCOPE).then((s) => {
    if (s[STORAGE.HISTORY_SCOPE] === 'page') historyScope = 'page';
  }).catch(() => {});

  // ─── Mode toggle ────────────────────────────────────────────────────────────
  function setMode(mode, { persist = true } = {}) {
    currentMode = mode === MODES.DEEP ? MODES.DEEP : MODES.INSTANT;
    modeBtns.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.mode === currentMode);
    });
    if (persist) {
      chrome.storage.local.set({ repolensMode: currentMode }).catch(() => {});
    }
  }

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // ─── Mode tooltip on hover ──────────────────────────────────────────────────
  const modeTipEl = document.getElementById('mode-tip');
  let modeTipTimer = null;

  const MODE_TIPS = {
    instant: {
      [PAGE_TYPES.PR]:     'Uses the PR title, file list, and a truncated diff. Best for quick questions about the change.',
      [PAGE_TYPES.FILE]:   'Uses the visible file content from the page. Best for quick questions about this file.',
      [PAGE_TYPES.COMMIT]: 'Uses the commit message and a truncated patch. Best for quick questions about this commit.',
      [PAGE_TYPES.REPO]:   'Uses the README and top-level file listing. Best for a quick overview of the repo.',
      _default:            'Fast answers using only this page\'s visible context.',
    },
    deep: {
      [PAGE_TYPES.PR]:     'Fetches all changed files, review comments, linked issues, plus the full repo context — README, directory tree, configs, manifests, and CODEOWNERS.',
      [PAGE_TYPES.FILE]:   'Fetches the full file plus importers, recent commit history, and broader repo context via the GitHub API.',
      [PAGE_TYPES.COMMIT]: 'Fetches the full commit context plus repo-level config files, CODEOWNERS, and recent PRs.',
      [PAGE_TYPES.REPO]:   'Fetches config files (Dockerfile, CI, tsconfig…), CODEOWNERS, recent merged PRs, and full repo structure via the GitHub API.',
      _default:            'Full context fetched via the GitHub API. Best for thorough, architectural questions.',
    },
  };

  const DEEP_WARNING = '<span class="mode-tip-warn">⚠ Uses more tokens and takes longer.</span>';

  function getModeTip(mode) {
    const pageType = currentPage?.type || PAGE_TYPES.UNKNOWN;
    const tips = MODE_TIPS[mode];
    if (!tips) return '';
    const tip = tips[pageType] || tips._default;
    if (mode === 'deep') return tip + '\n' + DEEP_WARNING;
    return tip;
  }

  modeBtns.forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      clearTimeout(modeTipTimer);
      const tip = getModeTip(btn.dataset.mode);
      if (tip && modeTipEl) {
        modeTipEl.innerHTML = tip;
        modeTipEl.style.opacity = '1';
        modeTipEl.style.transform = 'translateY(0)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      modeTipTimer = setTimeout(() => {
        if (modeTipEl) {
          modeTipEl.style.opacity = '0';
          modeTipEl.style.transform = 'translateY(-2px)';
        }
      }, 80);
    });
  });

  chrome.storage.local.get(['repolensMode']).then((stored) => {
    if (stored.repolensMode) setMode(stored.repolensMode, { persist: false });
  });

  // ─── Collapsible suggested questions ─────────────────────────────────────────
  function setQuestionsCollapsed(collapsed, { persist = true } = {}) {
    questionsBody.classList.toggle('is-collapsed', collapsed);
    questionsToggle.setAttribute('aria-expanded', String(!collapsed));
    questionsToggle.classList.toggle('is-collapsed', collapsed);
    if (persist) {
      chrome.storage.local.set({ repolensQuestionsCollapsed: collapsed }).catch(() => {});
    }
  }

  questionsToggle.addEventListener('click', () => {
    setQuestionsCollapsed(!questionsBody.classList.contains('is-collapsed'));
  });

  chrome.storage.local.get(['repolensQuestionsCollapsed']).then((stored) => {
    if (stored.repolensQuestionsCollapsed) setQuestionsCollapsed(true, { persist: false });
  });

  // ─── Settings / preferences ──────────────────────────────────────────────────
  function openPreferences() {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'), '_blank');
    }
  }

  settingsBtn.addEventListener('click', openPreferences);

  // ─── AI picker: one AI for chat, or compare several ─────────────────────────
  const { PROVIDERS, DEFAULT_PROVIDER } = globalThis.REPOLENS;
  const aiBtn = document.getElementById('ai-btn');
  const aiBtnLabel = document.getElementById('ai-btn-label');
  const aiMenu = document.getElementById('ai-menu');
  const aiList = document.getElementById('ai-list');
  const aiHint = document.getElementById('ai-hint');
  const aiSegEl = aiMenu.querySelector('.ai-seg');
  const aiSegBtns = aiMenu.querySelectorAll('[data-ai-mode]');

  const ai = { provider: DEFAULT_PROVIDER, keys: {}, models: {}, compare: { on: false, providers: [] } };
  /** providerId → [{ id, label }] once fetched for the model menus */
  const modelLists = {};
  const AI_KEYS = [
    STORAGE.PROVIDER,
    STORAGE.COMPARE,
    ...Object.values(PROVIDERS).flatMap((p) => [p.keyStorage, p.modelStorage]),
  ];

  const keyedProviders = () => Object.values(PROVIDERS).filter((p) => ai.keys[p.id]);
  const modelOf = (id) => ai.models[id] || PROVIDERS[id].defaultModel;
  const shortName = (id) => PROVIDERS[id]?.short || id;

  function compareIds() {
    const keyed = keyedProviders().map((p) => p.id);
    const chosen = ai.compare.providers.filter((id) => keyed.includes(id));
    return chosen.length >= 2 ? chosen : keyed;
  }

  const comparing = () => ai.compare.on && keyedProviders().length >= 2;

  /** The Settings provider, or the first one with a key if that one has none. */
  function chatProvider() {
    if (ai.keys[ai.provider]) return ai.provider;
    return keyedProviders()[0]?.id || ai.provider;
  }

  /** What the next question is sent to. */
  function currentTargets() {
    const ids = comparing() ? compareIds() : [chatProvider()];
    return ids.map((id) => ({ providerId: id, model: modelOf(id) }));
  }

  function joinNames(ids) {
    const names = ids.map(shortName);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  }

  function renderAiButton() {
    if (!keyedProviders().length) {
      aiBtnLabel.textContent = 'Add an API key';
      inputEl.placeholder = 'Ask about this page…';
      return;
    }
    if (comparing()) {
      const ids = compareIds();
      aiBtnLabel.textContent = `Compare · ${ids.length} AIs`;
      inputEl.placeholder = `Ask ${joinNames(ids)}…`;
      return;
    }
    const id = chatProvider();
    aiBtnLabel.textContent = `${shortName(id)} · ${modelOf(id)}`;
    inputEl.placeholder = 'Ask about this page…';
  }

  function modelSelect(p) {
    const select = document.createElement('select');
    select.className = 'ai-model';
    select.setAttribute('aria-label', `${p.short} model`);
    const add = (value, text) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    };
    add('', `Default · ${p.defaultModel}`);
    const saved = ai.models[p.id];
    const listed = (modelLists[p.id] || []).filter((m) => m.id !== p.defaultModel);
    if (saved && saved !== p.defaultModel && !listed.some((m) => m.id === saved)) add(saved, saved);
    for (const m of listed) add(m.id, m.id);
    select.value = saved && saved !== p.defaultModel ? saved : '';
    select.addEventListener('change', () => {
      chrome.storage.local.set({ [p.modelStorage]: select.value }).catch(() => {});
    });
    return select;
  }

  function renderAiMenu() {
    const keyed = keyedProviders();
    const missing = Object.values(PROVIDERS).filter((p) => !ai.keys[p.id]);
    const several = keyed.length >= 2;
    const compare = comparing();

    // The One AI / Compare switch only means something with two or more keys.
    aiSegEl.classList.toggle('is-hidden', !several);
    aiSegBtns.forEach((btn) => {
      const on = (btn.dataset.aiMode === 'compare') === compare;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', String(on));
    });

    if (!several) aiHint.textContent = `Pick the ${shortName(keyed[0].id)} model for your questions.`;
    else if (compare) aiHint.textContent = 'Each question goes to every AI you tick, and each one bills its own key.';
    else aiHint.textContent = 'Pick the AI and model for your next questions.';

    const chosen = compare ? compareIds() : [chatProvider()];
    const rows = keyed.map((p) => {
      const li = document.createElement('li');
      li.className = 'ai-row';
      const label = document.createElement('label');
      label.className = 'ai-pick';
      if (several) {
        const input = document.createElement('input');
        input.type = compare ? 'checkbox' : 'radio';
        input.name = 'ai-pick';
        input.value = p.id;
        input.checked = chosen.includes(p.id);
        input.addEventListener('change', () => onPick(p.id, input));
        label.appendChild(input);
      }
      const name = document.createElement('span');
      name.className = 'ai-name';
      name.textContent = p.short;
      label.appendChild(name);
      li.append(label, modelSelect(p));
      return li;
    });

    if (missing.length) {
      const li = document.createElement('li');
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'ai-add';
      add.innerHTML = '<span class="ai-add-icon" aria-hidden="true">+</span>';
      const text = document.createElement('span');
      text.textContent = `Add ${joinNames(missing.map((p) => p.id)).replace(' and ', ' or ')}`;
      const sub = document.createElement('small');
      sub.textContent = several ? 'Use every AI you have a key for' : 'Switch AIs or compare their answers';
      text.appendChild(sub);
      add.appendChild(text);
      add.addEventListener('click', openPreferences);
      li.appendChild(add);
      rows.push(li);
    }
    aiList.replaceChildren(...rows);
  }

  function onPick(id, input) {
    if (!comparing()) {
      chrome.storage.local.set({ [STORAGE.PROVIDER]: id }).catch(() => {});
      return;
    }
    let ids = compareIds().filter((x) => x !== id);
    if (input.checked) ids.push(id);
    if (ids.length < 2) {
      input.checked = true;
      aiHint.textContent = 'Compare needs at least two AIs.';
      return;
    }
    ids = Object.keys(PROVIDERS).filter((x) => ids.includes(x));
    chrome.storage.local.set({ [STORAGE.COMPARE]: { on: true, providers: ids } }).catch(() => {});
  }

  aiSegBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = btn.dataset.aiMode === 'compare';
      chrome.storage.local.set({ [STORAGE.COMPARE]: { ...ai.compare, on } }).catch(() => {});
    });
  });

  function loadModelLists() {
    for (const p of keyedProviders()) {
      if (modelLists[p.id]) continue;
      modelLists[p.id] = [];
      globalThis.RepoLensProviders.listModels(p.id, ai.keys[p.id])
        .then((models) => {
          modelLists[p.id] = models;
          if (!aiMenu.classList.contains('is-hidden')) renderAiMenu();
        })
        .catch(() => { delete modelLists[p.id]; });
    }
  }

  function setAiMenu(open) {
    if (open && !keyedProviders().length) {
      openPreferences();
      return;
    }
    aiMenu.classList.toggle('is-hidden', !open);
    aiBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      renderAiMenu();
      loadModelLists();
    }
  }

  aiBtn.addEventListener('click', () => setAiMenu(aiMenu.classList.contains('is-hidden')));
  document.getElementById('ai-settings').addEventListener('click', openPreferences);
  document.addEventListener('pointerdown', (e) => {
    if (!aiMenu.classList.contains('is-hidden') && !aiMenu.contains(e.target) && !aiBtn.contains(e.target)) setAiMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !aiMenu.classList.contains('is-hidden')) {
      setAiMenu(false);
      aiBtn.focus();
    }
  });

  async function loadAi() {
    const s = await chrome.storage.local.get(AI_KEYS).catch(() => ({}));
    ai.provider = PROVIDERS[s[STORAGE.PROVIDER]] ? s[STORAGE.PROVIDER] : DEFAULT_PROVIDER;
    for (const p of Object.values(PROVIDERS)) {
      if (ai.keys[p.id] !== (s[p.keyStorage] || '')) delete modelLists[p.id];
      ai.keys[p.id] = s[p.keyStorage] || '';
      ai.models[p.id] = typeof s[p.modelStorage] === 'string' ? s[p.modelStorage] : '';
    }
    const c = s[STORAGE.COMPARE] || {};
    ai.compare = { on: Boolean(c.on), providers: Array.isArray(c.providers) ? c.providers : [] };
    renderAiButton();
    if (!aiMenu.classList.contains('is-hidden')) renderAiMenu();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => AI_KEYS.includes(k))) loadAi();
  });
  loadAi();

  // ─── Page identity ──────────────────────────────────────────────────────────
  function pageIdentity(page) {
    if (!page) return '';
    if (page.org && page.repo) {
      if (page.type === PAGE_TYPES.PR) return `${page.org}/${page.repo}#${page.prNumber}`;
      if (page.type === PAGE_TYPES.FILE) return `${page.org}/${page.repo}:${page.filePath}`;
      if (page.type === PAGE_TYPES.COMMIT) {
        return `${page.org}/${page.repo}@${String(page.sha).slice(0, 7)}`;
      }
      return `${page.org}/${page.repo}`;
    }
    return pagePath(page);
  }

  function pagePath(page) {
    try {
      return new URL(page.url).pathname;
    } catch {
      return '';
    }
  }

  function repoOf(page) {
    if (!page) return null;
    if (page.org && page.repo) return { org: page.org, repo: page.repo };
    return repoFromPath(pagePath(page));
  }

  function keyFor(page) {
    if (historyScope === 'repo') {
      const r = repoOf(page);
      if (r) return `${STORAGE_PREFIX}${r.org}/${r.repo}`.toLowerCase();
    }
    const id = pageIdentity(page);
    return id ? STORAGE_PREFIX + id : null;
  }

  // ─── Persistence ────────────────────────────────────────────────────────────
  async function loadThread(page) {
    const key = keyFor(page);
    storageKey = key;
    if (!key) {
      thread = [];
      return;
    }
    try {
      // Repo-home history from before repo-wide history used the repo's original casing.
      const r = historyScope === 'repo' ? repoOf(page) : null;
      const legacyKey = r ? `${STORAGE_PREFIX}${r.org}/${r.repo}` : null;
      const stored = await chrome.storage.local.get(legacyKey && legacyKey !== key ? [key, legacyKey] : [key]);
      thread = Array.isArray(stored[key]) ? stored[key] : [];
      if (!thread.length && legacyKey !== key && Array.isArray(stored[legacyKey])) {
        thread = stored[legacyKey];
        await chrome.storage.local.set({ [key]: thread });
        await chrome.storage.local.remove(legacyKey);
      }
    } catch {
      thread = [];
    }
  }

  function saveThread() {
    if (!storageKey) return;
    const trimmed = thread.slice(-MAX_TURNS);
    chrome.storage.local.set({ [storageKey]: trimmed }).catch(() => {});
  }

  // ─── Page rendering ─────────────────────────────────────────────────────────
  function renderPage(page, signals) {
    currentPage = page;
    if (signals && page) {
      page.signals = { ...(page.signals || {}), ...signals };
    }

    if (!page) {
      badgeEl.textContent = 'Unknown';
      badgeEl.dataset.type = PAGE_TYPES.UNKNOWN;
      labelEl.textContent = 'No GitHub page detected';
      renderChips([]);
      return;
    }

    badgeEl.textContent = page.type;
    badgeEl.dataset.type = page.type;
    labelEl.textContent = page.label || pageIdentity(page) || 'Current page';
    labelEl.title = pageIdentity(page);
    renderChips(getQuestionChips(page.type, page));
  }

  function renderChips(chips) {
    chipsEl.innerHTML = '';
    if (!chips.length) {
      emptyChipsEl.classList.remove('is-hidden');
      return;
    }
    emptyChipsEl.classList.add('is-hidden');

    for (const chip of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'question-chip' + (chip.dynamic ? ' is-dynamic' : '');
      btn.textContent = chip.text;
      btn.dataset.question = chip.text;
      btn.disabled = isAsking;
      btn.addEventListener('click', () => askQuestion(chip.text, { fromChip: true }));
      chipsEl.appendChild(btn);
    }
  }

  function setChipsDisabled(disabled) {
    chipsEl.querySelectorAll('.question-chip').forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  // ─── Markdown ───────────────────────────────────────────────────────────────
  // Answers are model output over untrusted repo content — always sanitize.
  function renderMarkdown(src) {
    let html;
    if (globalThis.marked?.parse) {
      try {
        html = globalThis.marked.parse(src, { async: false, breaks: true });
      } catch (err) {
        console.warn('[RepoLens] marked parse failed:', err);
      }
    }
    if (html == null) html = fallbackMarkdown(src);
    return globalThis.DOMPurify ? globalThis.DOMPurify.sanitize(html) : fallbackMarkdown(src);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fallbackMarkdown(src) {
    const escaped = escapeHtml(src);
    let html = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return html
      .split(/\n{2,}/)
      .map((block) =>
        block.startsWith('<pre>') ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`
      )
      .join('');
  }

  // ─── Conversation rendering ─────────────────────────────────────────────────
  function scrollToBottom() {
    convoEl.scrollTop = convoEl.scrollHeight;
  }

  function updateChrome() {
    const hasTurns = thread.length > 0;
    convoHeaderEl.classList.toggle('is-hidden', !hasTurns);
    emptyStateEl.classList.toggle('is-hidden', hasTurns);
  }

  function metaLine(meta, mode) {
    const modeLabel = meta?.mode || mode;
    return [
      meta?.model,
      modeLabel === MODES.DEEP ? 'deep' : 'instant',
      meta?.cached ? 'cached' : null,
      meta?.hasGithubContext === false ? 'page-scrape only' : null,
    ].filter(Boolean).join(' · ');
  }

  /**
   * Build a turn's DOM element. Returns { el, bodyEl }.
   */
  function buildTurnEl(turn) {
    const el = document.createElement('div');
    el.className = 'turn';
    el.dataset.turnId = turn.id;

    const q = document.createElement('div');
    q.className = 'turn-question';
    const qText = document.createElement('span');
    qText.className = 'q-text';
    qText.textContent = turn.question;
    q.appendChild(qText);
    // In a repo-wide conversation, show which page each question was asked on.
    if (historyScope === 'repo' && turn.pageLabel) {
      const where = document.createElement('div');
      where.className = 'q-page';
      where.textContent = turn.pageLabel;
      q.appendChild(where);
    }
    el.appendChild(q);

    if (turn.compare && Array.isArray(turn.results)) {
      const built = buildCompareAnswer(turn);
      el.appendChild(built.answerEl);
      return { el, bodyEl: built.bodyEl, answerEl: built.answerEl };
    }

    const answer = document.createElement('div');
    answer.className = 'turn-answer';

    if (turn.mode === MODES.DEEP && turn.status === 'done') {
      const badge = document.createElement('div');
      badge.className = 'enhanced-badge';
      badge.textContent = 'Deep — full context used';
      answer.appendChild(badge);
    }

    const body = document.createElement('div');
    body.className = 'answer-body';
    answer.appendChild(body);

    if (turn.status === 'pending') {
      body.innerHTML =
        '<div class="progress"><span></span><span></span><span></span>' +
        `<em>${turn.mode === MODES.DEEP ? 'Pulling full context' : 'Generating answer'}</em></div>`;
    } else if (turn.status === 'error') {
      body.innerHTML = `<div class="answer-error">${escapeHtml(turn.error || 'Something went wrong.')}</div>`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry-btn';
      if (turn.needsSetup) {
        retry.textContent = 'Open Preferences';
        retry.addEventListener('click', openPreferences);
      } else {
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => retryTurn(turn));
      }
      answer.appendChild(retry);
    } else {
      body.innerHTML = renderMarkdown(turn.answer || '');
      answer.appendChild(buildActions(turn));
      if (metaLine(turn.meta, turn.mode)) {
        const meta = document.createElement('div');
        meta.className = 'answer-meta';
        meta.textContent = metaLine(turn.meta, turn.mode);
        answer.appendChild(meta);
      }
    }

    el.appendChild(answer);
    return { el, bodyEl: body, answerEl: answer };
  }

  const activeResult = (turn) => turn.results.find((r) => r.providerId === turn.active) || turn.results[0];

  /** Tabs, one per AI, and the selected AI's answer underneath. */
  function buildCompareAnswer(turn) {
    const answer = document.createElement('div');
    answer.className = 'turn-answer is-compare';

    const tabs = document.createElement('div');
    tabs.className = 'compare-tabs';
    tabs.setAttribute('role', 'tablist');
    const current = activeResult(turn);
    for (const r of turn.results) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'compare-tab' + (r === current ? ' is-active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(r === current));
      tab.title = r.meta?.model || r.model || '';
      const dot = document.createElement('span');
      dot.className = `tab-dot is-${r.status}`;
      dot.setAttribute('aria-hidden', 'true');
      tab.append(dot, shortName(r.providerId));
      tab.addEventListener('click', () => {
        if (turn.active === r.providerId) return;
        turn.active = r.providerId;
        if (turn.status !== 'pending') saveThread();
        rerenderTurn(turn);
      });
      tabs.appendChild(tab);
    }
    answer.appendChild(tabs);

    if (turn.mode === MODES.DEEP && current.status === 'done') {
      const badge = document.createElement('div');
      badge.className = 'enhanced-badge';
      badge.textContent = 'Deep — full context used';
      answer.appendChild(badge);
    }

    const body = document.createElement('div');
    body.className = 'answer-body';
    answer.appendChild(body);

    if (current.status === 'pending') {
      body.innerHTML =
        '<div class="progress"><span></span><span></span><span></span>' +
        `<em>${escapeHtml(shortName(current.providerId))} is ${turn.mode === MODES.DEEP ? 'reading the full context' : 'answering'}</em></div>`;
    } else if (current.status === 'error') {
      body.innerHTML = `<div class="answer-error">${escapeHtml(current.error || 'Something went wrong.')}</div>`;
      if (turn.status !== 'pending') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'retry-btn';
        retry.textContent = `Retry with ${shortName(current.providerId)}`;
        retry.addEventListener('click', () => askQuestion(turn.question, {
          fromChip: true,
          forceMode: turn.mode,
          targets: [{ providerId: current.providerId, model: current.model }],
        }));
        answer.appendChild(retry);
      }
    } else {
      body.innerHTML = renderMarkdown(current.answer || '');
      answer.appendChild(buildActions({
        ...turn,
        answer: current.answer,
        compareTargets: turn.results.map((r) => ({ providerId: r.providerId, model: r.model })),
      }));
      const line = metaLine(current.meta, turn.mode);
      if (line) {
        const meta = document.createElement('div');
        meta.className = 'answer-meta';
        meta.textContent = line;
        answer.appendChild(meta);
      }
    }
    return { answerEl: answer, bodyEl: body };
  }

  function rerenderTurn(turn, { type = false } = {}) {
    const old = convoEl.querySelector(`.turn[data-turn-id="${CSS.escape(turn.id)}"]`);
    if (!old) return;
    const { el, bodyEl } = buildTurnEl(turn);
    el.classList.add('no-enter');
    old.replaceWith(el);
    const text = turn.compare ? activeResult(turn).answer : turn.answer;
    if (type && text) typeAnswer(bodyEl, text);
  }

  function buildActions(turn) {
    const row = document.createElement('div');
    row.className = 'answer-actions';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'action-btn copy-btn';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(turn.answer || '').then(() => {
        copy.textContent = 'Copied!';
        copy.classList.add('is-copied');
        setTimeout(() => {
          copy.textContent = 'Copy';
          copy.classList.remove('is-copied');
        }, 1500);
      }).catch(() => {});
    });
    row.appendChild(copy);

    if (turn.mode === MODES.INSTANT) {
      const deepen = document.createElement('button');
      deepen.type = 'button';
      deepen.className = 'action-btn enhance-btn';
      deepen.textContent = 'Go Deep';
      deepen.title = 'Re-ask with full repository context';
      deepen.disabled = isAsking;
      deepen.addEventListener('click', () => {
        setMode(MODES.DEEP);
        askQuestion(turn.question, { fromChip: true, forceMode: MODES.DEEP, targets: turn.compareTargets });
      });
      row.appendChild(deepen);
    }

    return row;
  }

  /**
   * Render the whole thread. If animateId is set, the matching turn's answer is
   * typed out; all others render instantly.
   */
  function renderThread(animateId) {
    stopTyping();
    convoEl.querySelectorAll('.turn').forEach((n) => n.remove());
    updateChrome();

    for (const turn of thread) {
      const { el, bodyEl } = buildTurnEl(turn);
      convoEl.appendChild(el);
      const text = turn.compare && turn.results ? activeResult(turn).answer : turn.answer;
      if (animateId && turn.id === animateId && turn.status === 'done' && text) {
        typeAnswer(bodyEl, text);
      }
    }
    scrollToBottom();
  }

  // ─── Typewriter effect ──────────────────────────────────────────────────────
  function stopTyping() {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
  }

  function typeAnswer(bodyEl, fullText) {
    stopTyping();
    const total = fullText.length;
    // Aim to finish in ~1.8s regardless of length, with a sensible minimum speed.
    const perTick = Math.max(3, Math.ceil(total / 110));
    let i = 0;

    bodyEl.classList.add('is-typing');
    typingTimer = setInterval(() => {
      i = Math.min(total, i + perTick);
      bodyEl.innerHTML = renderMarkdown(fullText.slice(0, i)) + '<span class="type-cursor"></span>';
      scrollToBottom();
      if (i >= total) {
        stopTyping();
        bodyEl.classList.remove('is-typing');
        bodyEl.innerHTML = renderMarkdown(fullText);
        scrollToBottom();
      }
    }, 16);
  }

  // ─── Ask flow ───────────────────────────────────────────────────────────────
  function setAsking(value) {
    isAsking = value;
    sendBtn.disabled = value;
    setChipsDisabled(value);
    convoEl.querySelectorAll('.action-btn.enhance-btn').forEach((b) => {
      b.disabled = value;
    });
  }

  function isStaticQuestion(question, pageType) {
    return (STATIC_QUESTIONS[pageType] || []).includes(question);
  }

  function newId() {
    return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function retryTurn(turn) {
    // Remove the errored turn, then re-ask the same AI(s).
    thread = thread.filter((t) => t.id !== turn.id);
    const targets = turn.compare && turn.results
      ? turn.results.map((r) => ({ providerId: r.providerId, model: r.model }))
      : turn.providerId ? [{ providerId: turn.providerId, model: modelOf(turn.providerId) }] : undefined;
    askQuestion(turn.question, { fromChip: true, forceMode: turn.mode, targets });
  }

  function askQuestion(question, { fromChip = false, forceMode, targets } = {}) {
    const q = (question || '').trim();
    if (!q || isAsking) return;

    const mode = forceMode || currentMode;
    if (!fromChip) inputEl.value = '';

    const asked = targets && targets.length ? targets : currentTargets();
    const compare = asked.length > 1;
    const turn = {
      id: newId(),
      question: q,
      mode,
      pageLabel: currentPage?.label || '',
      providerId: asked[0].providerId,
      answer: '',
      meta: null,
      status: 'pending',
    };
    if (compare) {
      turn.compare = true;
      turn.results = asked.map((t) => ({ providerId: t.providerId, model: t.model, status: 'pending', answer: '', meta: null }));
      turn.active = asked[0].providerId;
    }
    thread.push(turn);
    renderThread();
    setAsking(true);

    inFlightTurn = turn;
    inFlightPageKey = storageKey;
    const askPageKey = storageKey;

    if (askPort) {
      try { askPort.disconnect(); } catch { /* ignore */ }
      askPort = null;
    }

    const port = chrome.runtime.connect({ name: 'repolens-ask' });
    askPort = port;
    /** providerId → streamed text ('_' when the worker didn't name a provider) */
    const streamed = {};
    const textFor = (pid) => streamed[pid] || '';
    const resultFor = (pid) => turn.results?.find((r) => r.providerId === pid);
    let settled = false;

    // Compare turns stay pending until every AI has answered or failed; each
    // answer is shown as it lands, and the first one to land is selected.
    const landResult = (r) => {
      const isFirst = !turn.results.some((x) => x !== r && x.status === 'done');
      if (isFirst && r.status === 'done') turn.active = r.providerId;
      if (thread.some((t) => t.id === turn.id)) {
        rerenderTurn(turn, { type: r.status === 'done' && turn.active === r.providerId });
      }
    };

    const finalize = (status, extra = {}) => {
      if (settled) return;
      settled = true;
      if (compare) {
        for (const r of turn.results) {
          if (r.status !== 'pending') continue;
          if (textFor(r.providerId)) {
            r.status = 'done';
            r.answer = textFor(r.providerId);
            r.meta = r.meta || {};
          } else {
            r.status = 'error';
            r.error = extra.error || 'No answer arrived.';
          }
        }
        status = turn.results.some((r) => r.status === 'done') ? 'done' : 'error';
        if (activeResult(turn).status !== 'done') {
          const done = turn.results.find((r) => r.status === 'done');
          if (done) turn.active = done.providerId;
        }
        if (status === 'error') {
          extra = {
            ...extra,
            error: turn.results.map((r) => `${shortName(r.providerId)}: ${r.error}`).join('\n'),
            retryable: true,
          };
        }
      }
      turn.status = status;
      if (status === 'done' && !compare) {
        turn.answer = extra.answer || textFor(turn.providerId) || textFor('_');
        turn.meta = extra.meta || {};
      } else if (status === 'error') {
        turn.error = extra.error || 'Ask failed';
        turn.retryable = extra.retryable !== false;
        turn.needsSetup = Boolean(extra.needsSetup);
      }

      if (inFlightTurn === turn) {
        inFlightTurn = null;
        inFlightPageKey = null;
      }
      setAsking(false);

      const turnInThread = thread.some((t) => t.id === turn.id);

      if (turnInThread) {
        if (status === 'done') {
          saveThread();
          // A compare turn has already typed its first answer as it landed.
          if (compare) rerenderTurn(turn);
          else renderThread(turn.id);
        } else {
          renderThread();
        }
      } else if (askPageKey) {
        chrome.storage.local.get([askPageKey]).then((stored) => {
          const origThread = Array.isArray(stored[askPageKey]) ? stored[askPageKey] : [];
          origThread.push(turn);
          const trimmed = origThread.slice(-MAX_TURNS);
          chrome.storage.local.set({ [askPageKey]: trimmed }).catch(() => {});
          if (storageKey === askPageKey) {
            thread = trimmed;
            renderThread(status === 'done' ? turn.id : undefined);
          }
        });
      }

      try { port.disconnect(); } catch { /* ignore */ }
      if (askPort === port) askPort = null;
    };

    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type || settled) return;
      const pid = msg.providerId || '_';
      if (msg.type === MSG.ASK_CHUNK) {
        if (typeof msg.text === 'string') streamed[pid] = textFor(pid) + msg.text;
        return;
      }
      if (msg.type === MSG.ASK_DONE) {
        const r = resultFor(msg.providerId);
        if (!compare) finalize('done', { answer: textFor(pid), meta: msg.meta });
        else if (r) {
          Object.assign(r, { status: 'done', answer: textFor(pid), meta: msg.meta || {} });
          landResult(r);
        }
        return;
      }
      if (msg.type === MSG.ASK_ERROR) {
        const extra = { error: msg.error, retryable: msg.retryable, needsSetup: msg.needsSetup };
        const r = resultFor(msg.providerId);
        if (!compare) finalize('error', extra);
        else if (r) {
          Object.assign(r, { status: 'error', error: msg.error || 'Ask failed' });
          landResult(r);
        } else {
          finalize('error', extra);
        }
        return;
      }
      if (msg.type === MSG.ASK_FINISHED) {
        if (compare || Object.values(streamed).some(Boolean)) finalize('done');
        else finalize('error', { error: 'No answer arrived.', retryable: true });
      }
    });

    port.onDisconnect.addListener(() => {
      if (askPort === port) askPort = null;
      if (settled) return;
      const err = chrome.runtime.lastError?.message;
      const anyText = Object.values(streamed).some(Boolean);
      if (compare || anyText) finalize('done', { error: err || 'Connection closed.' });
      else finalize('error', { error: err || 'Connection closed.', retryable: true });
    });

    const cacheable = fromChip && isStaticQuestion(q, currentPage?.type);
    port.postMessage({
      type: MSG.ASK,
      question: q,
      mode,
      page: currentPage,
      tabId: activeTabId,
      cacheable,
      targets: asked,
    });
  }

  // ─── Events ─────────────────────────────────────────────────────────────────
  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    askQuestion(inputEl.value, { fromChip: false });
  });

  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      askQuestion(inputEl.value, { fromChip: false });
    }
  });

  clearBtn.addEventListener('click', () => {
    thread = [];
    stopTyping();
    if (storageKey) chrome.storage.local.remove(storageKey).catch(() => {});
    renderThread();
  });

  // ─── Page info loading ──────────────────────────────────────────────────────
  async function switchToPage(page, signals, { force = false } = {}) {
    await historyScopeReady;
    const prevKey = storageKey;
    const nextKey = keyFor(page);
    renderPage(page, signals);
    if (force || nextKey !== prevKey) {
      await loadThread(page);
      if (inFlightTurn && inFlightPageKey === nextKey) {
        const alreadyPresent = thread.some((t) => t.id === inFlightTurn.id);
        if (!alreadyPresent) {
          thread.push(inFlightTurn);
        }
      }
      renderThread();
    }
  }

  async function loadPageInfo() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTabId = tab?.id ?? null;
      if (!tab?.id) {
        await switchToPage(null);
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: MSG.GET_PAGE_INFO,
        tabId: tab.id,
      });
      await switchToPage(response?.page || null, response?.signals || null);
    } catch (err) {
      console.warn('[RepoLens] Could not load page info:', err);
      await switchToPage(null);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.PAGE_INFO && message.page) {
      switchToPage(message.page);
    }
    if (message?.type === MSG.PREFETCH_DONE && message.signals && currentPage) {
      currentPage.signals = { ...(currentPage.signals || {}), ...message.signals };
      renderChips(getQuestionChips(currentPage.type, currentPage));
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE.HISTORY_SCOPE]) return;
    historyScope = changes[STORAGE.HISTORY_SCOPE].newValue === 'page' ? 'page' : 'repo';
    switchToPage(currentPage, null, { force: true });
  });

  if (globalThis.marked?.setOptions) {
    globalThis.marked.setOptions({ gfm: true, breaks: true });
  }

  // Reload page + history when switching tabs or navigating within a tab
  chrome.tabs.onActivated.addListener((info) => {
    activeTabId = info.tabId;
    loadPageInfo();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // changeInfo.url is only present for github.com (no "tabs" permission).
    if (tabId === activeTabId && (changeInfo.url || changeInfo.status === 'complete')) {
      loadPageInfo();
    }
  });

  loadPageInfo();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadPageInfo();
  });
})();
