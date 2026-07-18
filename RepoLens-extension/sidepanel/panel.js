/**
 * RepoLens side panel — Q&A UI with streaming, caching, and polish (Phase 5).
 */
(function () {
  const { MSG, PAGE_TYPES, MODES } = globalThis.REPOLENS;
  const { getQuestionChips, STATIC_QUESTIONS } = globalThis.RepoLensQuestions;

  const badgeEl = document.getElementById('page-badge');
  const labelEl = document.getElementById('page-label');
  const chipsEl = document.getElementById('question-chips');
  const emptyEl = document.getElementById('questions-empty');
  const answerEl = document.getElementById('answer-area');
  const activeQEl = document.getElementById('active-question');
  const enhanceBtn = document.getElementById('enhance-btn');
  const copyBtn = document.getElementById('copy-btn');
  const formEl = document.getElementById('ask-form');
  const inputEl = document.getElementById('question-input');
  const sendBtn = document.getElementById('send-btn');
  const statusEl = document.getElementById('answer-status');
  const modeBtns = document.querySelectorAll('.mode-btn');

  /** @type {object|null} */
  let currentPage = null;
  /** @type {string} */
  let currentMode = MODES.INSTANT;
  /** @type {string|null} */
  let lastQuestion = null;
  /** @type {string|null} */
  let lastMode = null;
  /** @type {boolean} */
  let isAsking = false;
  /** @type {number|null} */
  let activeTabId = null;
  /** @type {string} */
  let streamedText = '';
  /** @type {chrome.runtime.Port|null} */
  let askPort = null;

  // —— Mode toggle ——
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

  // —— Page rendering ——
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
    return page.label || '';
  }

  function renderPage(page, signals) {
    const prevIdentity = pageIdentity(currentPage);
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

    if (prevIdentity && prevIdentity !== pageIdentity(page)) {
      resetAnswer();
    }
  }

  function renderChips(chips) {
    chipsEl.innerHTML = '';
    if (!chips.length) {
      emptyEl.classList.remove('is-hidden');
      return;
    }
    emptyEl.classList.add('is-hidden');

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

  function highlightChip(question) {
    chipsEl.querySelectorAll('.question-chip').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.question === question);
    });
  }

  // —— Answer UI ——
  function setStatus(text) {
    if (!statusEl) return;
    if (text) {
      statusEl.textContent = text;
      statusEl.classList.remove('is-hidden');
    } else {
      statusEl.textContent = '';
      statusEl.classList.add('is-hidden');
    }
  }

  function resetAnswer() {
    lastQuestion = null;
    lastMode = null;
    streamedText = '';
    activeQEl.classList.add('is-hidden');
    activeQEl.textContent = '';
    enhanceBtn.classList.add('is-hidden');
    copyBtn.classList.add('is-hidden');
    setStatus('');
    answerEl.innerHTML =
      '<div class="answer-placeholder">Pick a suggested question or type your own to get started.</div>';
    highlightChip(null);
  }

  function showSkeleton(question, mode) {
    lastQuestion = question;
    lastMode = mode;
    streamedText = '';
    activeQEl.textContent = question;
    activeQEl.classList.remove('is-hidden');
    enhanceBtn.classList.add('is-hidden');
    copyBtn.classList.add('is-hidden');
    highlightChip(question);

    const isEnhanced = mode === MODES.ENHANCED;
    setStatus(isEnhanced ? 'Pulling broader context…' : 'Connecting…');
    answerEl.innerHTML = `
      <div class="skeleton${isEnhanced ? ' is-enhanced' : ''}" aria-label="Loading answer">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        ${isEnhanced ? '<div class="skeleton-line"></div><div class="skeleton-line"></div>' : ''}
      </div>
    `;
  }

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

  function renderStreamedAnswer() {
    answerEl.innerHTML = `<div class="answer-body">${renderMarkdown(streamedText || '…')}</div>`;
    answerEl.scrollTop = answerEl.scrollHeight;
  }

  function showError(message, retryable = false) {
    setStatus('');
    copyBtn.classList.add('is-hidden');
    let html = `<div class="answer-error">${escapeHtml(message)}</div>`;
    if (retryable && lastQuestion) {
      html += `<button type="button" class="retry-btn" id="retry-btn">Retry</button>`;
    }
    answerEl.innerHTML = html;
    enhanceBtn.classList.add('is-hidden');

    if (retryable && lastQuestion) {
      const retryEl = document.getElementById('retry-btn');
      if (retryEl) {
        retryEl.addEventListener('click', () => {
          askQuestion(lastQuestion, { fromChip: true, forceMode: lastMode });
        });
      }
    }
  }

  function finishAsk(mode, meta) {
    setStatus('');
    if (!streamedText.trim()) {
      showError('Received an empty answer from Claude.', true);
      return;
    }
    renderStreamedAnswer();

    const modeLabel = meta?.mode || mode;
    if (meta?.model) {
      const tip = document.createElement('div');
      tip.className = 'answer-meta';
      tip.textContent = [
        meta.model,
        modeLabel === MODES.ENHANCED ? 'enhanced' : 'instant',
        meta.cached ? 'cached' : null,
        meta.hasGithubContext === false ? 'page-scrape only' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      answerEl.appendChild(tip);
    }

    if (modeLabel === MODES.ENHANCED) {
      const badge = document.createElement('div');
      badge.className = 'enhanced-badge';
      badge.textContent = 'Enhanced answer — deeper context used';
      answerEl.insertBefore(badge, answerEl.firstChild);
      enhanceBtn.classList.add('is-hidden');
    } else {
      enhanceBtn.classList.remove('is-hidden');
    }

    // Show copy button
    copyBtn.classList.remove('is-hidden');
  }

  function setAsking(value) {
    isAsking = value;
    sendBtn.disabled = value;
    setChipsDisabled(value);
  }

  // —— Cacheable check ——
  function isStaticQuestion(question, pageType) {
    const statics = STATIC_QUESTIONS[pageType] || [];
    return statics.includes(question);
  }

  // —— Ask flow (streaming port) ——
  function askQuestion(question, { fromChip = false, forceMode } = {}) {
    const q = (question || '').trim();
    if (!q || isAsking) return;

    const mode = forceMode || currentMode;
    setAsking(true);
    showSkeleton(q, mode);

    if (!fromChip) inputEl.value = '';

    if (askPort) {
      try {
        askPort.disconnect();
      } catch {
        // ignore
      }
      askPort = null;
    }

    const port = chrome.runtime.connect({ name: 'repolens-ask' });
    askPort = port;

    port.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;

      if (msg.type === MSG.ASK_CHUNK) {
        if (msg.status) {
          setStatus(msg.status);
          return;
        }
        if (typeof msg.text === 'string') {
          if (!streamedText) {
            answerEl.innerHTML = '<div class="answer-body"></div>';
          }
          streamedText += msg.text;
          const streamLabel = mode === MODES.ENHANCED ? 'Streaming enhanced answer…' : 'Streaming…';
          setStatus(streamLabel);
          renderStreamedAnswer();
        }
        return;
      }

      if (msg.type === MSG.ASK_DONE) {
        finishAsk(mode, msg.meta);
        setAsking(false);
        try {
          port.disconnect();
        } catch {
          // ignore
        }
        if (askPort === port) askPort = null;
        return;
      }

      if (msg.type === MSG.ASK_ERROR) {
        showError(msg.error || 'Ask failed', msg.retryable !== false);
        setAsking(false);
        try {
          port.disconnect();
        } catch {
          // ignore
        }
        if (askPort === port) askPort = null;
      }
    });

    port.onDisconnect.addListener(() => {
      if (askPort === port) askPort = null;
      if (isAsking && !streamedText) {
        const err = chrome.runtime.lastError?.message;
        showError(err || 'Connection to background worker closed.', true);
        setAsking(false);
      } else if (isAsking && streamedText) {
        finishAsk(mode, {});
        setAsking(false);
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

  enhanceBtn.addEventListener('click', () => {
    if (!lastQuestion) return;
    setMode(MODES.ENHANCED);
    askQuestion(lastQuestion, { fromChip: true, forceMode: MODES.ENHANCED });
  });

  // —— Copy answer ——
  copyBtn.addEventListener('click', () => {
    if (!streamedText) return;
    navigator.clipboard.writeText(streamedText).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('is-copied');
      setTimeout(() => {
        copyBtn.textContent = orig;
        copyBtn.classList.remove('is-copied');
      }, 1500);
    }).catch(() => {});
  });

  // —— Page info loading ——
  async function loadPageInfo() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      activeTabId = tab?.id ?? null;
      if (!tab?.id) {
        renderPage(null);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: MSG.GET_PAGE_INFO,
        tabId: tab.id,
      });
      renderPage(response?.page || null, response?.signals || null);
    } catch (err) {
      console.warn('[RepoLens] Could not load page info:', err);
      renderPage(null);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.PAGE_INFO && message.page) {
      renderPage(message.page);
    }
    // Re-render chips when prefetch signals arrive
    if (message?.type === MSG.PREFETCH_DONE && message.signals && currentPage) {
      currentPage.signals = { ...(currentPage.signals || {}), ...message.signals };
      renderChips(getQuestionChips(currentPage.type, currentPage));
    }
  });

  if (globalThis.marked?.setOptions) {
    globalThis.marked.setOptions({
      gfm: true,
      breaks: true,
    });
  }

  loadPageInfo();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadPageInfo();
  });
})();
