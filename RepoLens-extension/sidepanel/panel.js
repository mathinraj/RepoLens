/**
 * RepoLens side panel — conversation UI with typing effect, per-page history
 * (persisted via chrome.storage.local), streaming progress, and mode toggle.
 */
(function () {
  const { MSG, PAGE_TYPES, MODES } = globalThis.REPOLENS;
  const { getQuestionChips, STATIC_QUESTIONS } = globalThis.RepoLensQuestions;

  const badgeEl = document.getElementById('page-badge');
  const labelEl = document.getElementById('page-label');
  const chipsEl = document.getElementById('question-chips');
  const emptyChipsEl = document.getElementById('questions-empty');
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

  // ─── Toggle: keep-alive port so the SW can close the panel on toolbar click ──
  try {
    const panelPort = chrome.runtime.connect({ name: 'repolens-panel' });
    chrome.windows.getCurrent().then((w) => {
      try {
        panelPort.postMessage({ type: MSG.PANEL_HELLO, windowId: w.id });
      } catch {
        // ignore
      }
    }).catch(() => {});
    panelPort.onMessage.addListener((msg) => {
      if (msg?.type === MSG.PANEL_CLOSE) {
        window.close();
      }
    });
  } catch {
    // ignore — toggle-close just won't be available
  }

  // ─── Mode toggle ────────────────────────────────────────────────────────────
  function setMode(mode, { persist = true } = {}) {
    currentMode = mode === MODES.ENHANCED ? MODES.ENHANCED : MODES.INSTANT;
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

  chrome.storage.local.get(['repolensMode']).then((stored) => {
    if (stored.repolensMode) setMode(stored.repolensMode, { persist: false });
  });

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
    return page.label || page.url || '';
  }

  function keyFor(page) {
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
      const stored = await chrome.storage.local.get([key]);
      thread = Array.isArray(stored[key]) ? stored[key] : [];
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
  function renderMarkdown(src) {
    if (globalThis.marked?.parse) {
      try {
        return globalThis.marked.parse(src, { async: false, breaks: true });
      } catch (err) {
        console.warn('[RepoLens] marked parse failed:', err);
      }
    }
    return fallbackMarkdown(src);
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
      modeLabel === MODES.ENHANCED ? 'enhanced' : 'instant',
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
    el.appendChild(q);

    const answer = document.createElement('div');
    answer.className = 'turn-answer';

    if (turn.mode === MODES.ENHANCED && turn.status === 'done') {
      const badge = document.createElement('div');
      badge.className = 'enhanced-badge';
      badge.textContent = 'Enhanced — deeper context used';
      answer.appendChild(badge);
    }

    const body = document.createElement('div');
    body.className = 'answer-body';
    answer.appendChild(body);

    if (turn.status === 'pending') {
      body.innerHTML =
        '<div class="progress"><span></span><span></span><span></span>' +
        `<em>${turn.mode === MODES.ENHANCED ? 'Pulling broader context' : 'Generating answer'}</em></div>`;
    } else if (turn.status === 'error') {
      body.innerHTML = `<div class="answer-error">${escapeHtml(turn.error || 'Something went wrong.')}</div>`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'retry-btn';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => retryTurn(turn));
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
      const enhance = document.createElement('button');
      enhance.type = 'button';
      enhance.className = 'action-btn enhance-btn';
      enhance.textContent = 'Enhance';
      enhance.title = 'Re-ask with broader repository context';
      enhance.disabled = isAsking;
      enhance.addEventListener('click', () => {
        setMode(MODES.ENHANCED);
        askQuestion(turn.question, { fromChip: true, forceMode: MODES.ENHANCED });
      });
      row.appendChild(enhance);
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
      if (animateId && turn.id === animateId && turn.status === 'done' && turn.answer) {
        typeAnswer(bodyEl, turn.answer);
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
    // Remove the errored turn, then re-ask.
    thread = thread.filter((t) => t.id !== turn.id);
    askQuestion(turn.question, { fromChip: true, forceMode: turn.mode });
  }

  function askQuestion(question, { fromChip = false, forceMode } = {}) {
    const q = (question || '').trim();
    if (!q || isAsking) return;

    const mode = forceMode || currentMode;
    if (!fromChip) inputEl.value = '';

    const turn = {
      id: newId(),
      question: q,
      mode,
      answer: '',
      meta: null,
      status: 'pending',
    };
    thread.push(turn);
    renderThread();
    setAsking(true);

    if (askPort) {
      try { askPort.disconnect(); } catch { /* ignore */ }
      askPort = null;
    }

    const port = chrome.runtime.connect({ name: 'repolens-ask' });
    askPort = port;
    let streamed = '';

    const finalize = (status, extra = {}) => {
      turn.status = status;
      if (status === 'done') {
        turn.answer = extra.answer || streamed;
        turn.meta = extra.meta || {};
      } else if (status === 'error') {
        turn.error = extra.error || 'Ask failed';
        turn.retryable = extra.retryable !== false;
      }
      setAsking(false);
      if (status === 'done') {
        saveThread();
        renderThread(turn.id); // animate this turn
      } else {
        renderThread();
      }
      try { port.disconnect(); } catch { /* ignore */ }
      if (askPort === port) askPort = null;
    };

    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === MSG.ASK_CHUNK) {
        if (typeof msg.text === 'string') streamed += msg.text;
        return;
      }
      if (msg.type === MSG.ASK_DONE) {
        finalize('done', { answer: streamed, meta: msg.meta });
        return;
      }
      if (msg.type === MSG.ASK_ERROR) {
        finalize('error', { error: msg.error, retryable: msg.retryable });
      }
    });

    port.onDisconnect.addListener(() => {
      if (askPort === port) askPort = null;
      if (turn.status === 'pending') {
        if (streamed) {
          finalize('done', { answer: streamed, meta: {} });
        } else {
          const err = chrome.runtime.lastError?.message;
          finalize('error', { error: err || 'Connection closed.', retryable: true });
        }
      }
    });

    const cacheable = fromChip && isStaticQuestion(q, currentPage?.type);
    port.postMessage({
      type: MSG.ASK,
      question: q,
      mode,
      page: currentPage,
      tabId: activeTabId,
      cacheable,
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
  async function switchToPage(page, signals) {
    const prevKey = storageKey;
    const nextKey = keyFor(page);
    renderPage(page, signals);
    if (nextKey !== prevKey) {
      await loadThread(page);
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

  if (globalThis.marked?.setOptions) {
    globalThis.marked.setOptions({ gfm: true, breaks: true });
  }

  // Reload page + history when switching tabs or navigating within a tab
  chrome.tabs.onActivated.addListener((info) => {
    activeTabId = info.tabId;
    loadPageInfo();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && changeInfo.url) {
      loadPageInfo();
    }
  });

  loadPageInfo();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadPageInfo();
  });
})();
