/**
 * RepoLens side panel — Phase 2 Q&A UI.
 * Asks are routed through the service worker (stubbed until Phase 3 backend).
 */
(function () {
  const { MSG, PAGE_TYPES, MODES } = globalThis.REPOLENS;
  const { getQuestionChips } = globalThis.RepoLensQuestions;

  const badgeEl = document.getElementById('page-badge');
  const labelEl = document.getElementById('page-label');
  const chipsEl = document.getElementById('question-chips');
  const emptyEl = document.getElementById('questions-empty');
  const answerEl = document.getElementById('answer-area');
  const activeQEl = document.getElementById('active-question');
  const enhanceBtn = document.getElementById('enhance-btn');
  const formEl = document.getElementById('ask-form');
  const inputEl = document.getElementById('question-input');
  const sendBtn = document.getElementById('send-btn');
  const modeBtns = document.querySelectorAll('.mode-btn');

  /** @type {object|null} */
  let currentPage = null;
  /** @type {string} */
  let currentMode = MODES.INSTANT;
  /** @type {string|null} */
  let lastQuestion = null;
  /** @type {boolean} */
  let isAsking = false;
  /** @type {number|null} */
  let activeTabId = null;
  /** @type {'idle'|'loading'|'answered'|'error'} */
  let answerState = 'idle';

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

  function renderPage(page) {
    const prevIdentity = pageIdentity(currentPage);
    currentPage = page;

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

    const chips = getQuestionChips(page.type, page);
    renderChips(chips);

    // Reset answer when navigating to a different page context
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
  function resetAnswer() {
    answerState = 'idle';
    lastQuestion = null;
    activeQEl.classList.add('is-hidden');
    activeQEl.textContent = '';
    enhanceBtn.classList.add('is-hidden');
    answerEl.innerHTML =
      '<div class="answer-placeholder">Pick a suggested question or type your own to get started.</div>';
    highlightChip(null);
  }

  function showSkeleton(question) {
    answerState = 'loading';
    lastQuestion = question;
    activeQEl.textContent = question;
    activeQEl.classList.remove('is-hidden');
    enhanceBtn.classList.add('is-hidden');
    highlightChip(question);
    answerEl.innerHTML = `
      <div class="skeleton" aria-label="Loading answer">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    `;
  }

  function showAnswer(markdown, { mode, stub } = {}) {
    answerState = 'answered';
    // Lightweight markdown: paragraphs + inline code + fenced blocks
    answerEl.innerHTML = `<div class="answer-body">${renderMarkdown(markdown)}</div>`;
    if (stub) {
      answerEl.innerHTML +=
        '<div class="answer-meta">UI flow wired — answers arrive in Phase 3 when the backend is connected.</div>';
    }
    // Show enhance after an Instant answer
    if (mode === MODES.INSTANT && !stub) {
      enhanceBtn.classList.remove('is-hidden');
    } else if (mode === MODES.INSTANT && stub) {
      // Still show it so the Phase 4 UX is visible in the panel
      enhanceBtn.classList.remove('is-hidden');
    } else {
      enhanceBtn.classList.add('is-hidden');
    }
  }

  function showError(message) {
    answerState = 'error';
    answerEl.innerHTML = `<div class="answer-error">${escapeHtml(message)}</div>`;
    enhanceBtn.classList.add('is-hidden');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Minimal markdown renderer for Phase 2 (full marked.js in Phase 3).
   */
  function renderMarkdown(src) {
    const escaped = escapeHtml(src);
    // Fenced code blocks
    let html = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold / italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Paragraphs on blank lines
    html = html
      .split(/\n{2,}/)
      .map((block) => {
        if (block.startsWith('<pre>')) return block;
        return `<p>${block.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');
    return html;
  }

  // —— Ask flow ——
  async function askQuestion(question, { fromChip = false, forceMode } = {}) {
    const q = (question || '').trim();
    if (!q || isAsking) return;

    const mode = forceMode || currentMode;
    isAsking = true;
    sendBtn.disabled = true;
    setChipsDisabled(true);
    showSkeleton(q);

    if (!fromChip) {
      inputEl.value = '';
    }

    try {
      const payload = {
        type: MSG.ASK,
        question: q,
        mode,
        page: currentPage,
        tabId: activeTabId,
      };

      const response = await chrome.runtime.sendMessage(payload);

      if (!response?.ok) {
        showError(response?.error || 'Something went wrong asking that question.');
        return;
      }

      if (response.stub) {
        showAnswer(response.answer || buildStubAnswer(q, mode), {
          mode,
          stub: true,
        });
        return;
      }

      showAnswer(response.answer || '', { mode, stub: false });
    } catch (err) {
      console.warn('[RepoLens] Ask failed:', err);
      showError('Could not reach the RepoLens background worker. Try reloading the extension.');
    } finally {
      isAsking = false;
      sendBtn.disabled = false;
      setChipsDisabled(false);
    }
  }

  function buildStubAnswer(question, mode) {
    const page = currentPage;
    const where = page?.label || 'this page';
    const modeLabel = mode === MODES.ENHANCED ? 'Enhanced' : 'Instant';
    return [
      `**${modeLabel} mode** is ready for: _${question}_`,
      '',
      `Context locked onto **${where}**.`,
      page?.org && page?.repo
        ? `Repo: \`${page.org}/${page.repo}\`${
            page.prNumber != null ? ` · PR \`#${page.prNumber}\`` : ''
          }${page.filePath ? ` · File \`${page.filePath}\`` : ''}${
            page.sha ? ` · Commit \`${String(page.sha).slice(0, 7)}\`` : ''
          }`
        : '',
      '',
      'The ask pipeline is wired end-to-end. Phase 3 will stream a real Claude answer here using GitHub MCP context.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    askQuestion(inputEl.value, { fromChip: false });
  });

  // Enter to send, Shift+Enter for newline
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
      renderPage(response?.page || null);
    } catch (err) {
      console.warn('[RepoLens] Could not load page info:', err);
      renderPage(null);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.PAGE_INFO && message.page) {
      renderPage(message.page);
    }
  });

  loadPageInfo();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadPageInfo();
  });
})();
