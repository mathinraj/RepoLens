/**
 * RepoLens content script — page detection + floating overlay button.
 */
(function () {
  const { MSG, PAGE_TYPES } = globalThis.REPOLENS;
  const { detectPage, formatPageBadge } = globalThis.RepoLensPageDetector;

  const ROOT_ID = 'repolens-root';
  let currentPage = null;
  let lastPath = null;

  function getPageInfo() {
    return detectPage(window.location.pathname);
  }

  function shortBadge(page) {
    switch (page.type) {
      case PAGE_TYPES.PR:
        return `#${page.prNumber}`;
      case PAGE_TYPES.FILE:
        return 'FILE';
      case PAGE_TYPES.COMMIT:
        return 'SHA';
      case PAGE_TYPES.REPO:
        return 'REPO';
      default:
        return '?';
    }
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="repolens-fab-wrap">
        <div class="repolens-tooltip" role="tooltip"></div>
        <button type="button" class="repolens-fab" aria-label="Open RepoLens" title="Open RepoLens">
          <span class="repolens-badge" aria-hidden="true"></span>
          <svg viewBox="6 6 116 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="56" cy="55" r="34" fill="none" stroke="#38BDF8" stroke-width="9"/>
            <path d="m81 80 25 25" stroke="#38BDF8" stroke-width="12" stroke-linecap="round"/>
            <path d="M56 26v10M56 74v10M27 55h10M75 55h10" stroke="#2DD4BF" stroke-width="6" stroke-linecap="round"/>
            <path d="m50 43-12 12 12 12M62 43l12 12-12 12" fill="none" stroke="#F8FAFC" stroke-width="7" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;

    const button = root.querySelector('.repolens-fab');
    button.addEventListener('click', onFabClick);

    document.documentElement.appendChild(root);
    return root;
  }

  function updateUi(page) {
    currentPage = page;
    const root = ensureRoot();
    const tooltip = root.querySelector('.repolens-tooltip');
    const badge = root.querySelector('.repolens-badge');
    const button = root.querySelector('.repolens-fab');

    const label = formatPageBadge(page);
    tooltip.textContent = `RepoLens · ${label}`;
    tooltip.classList.add('is-visible');
    // Fade tooltip after first inject so it doesn't stay forever
    window.clearTimeout(updateUi._tipTimer);
    updateUi._tipTimer = window.setTimeout(() => {
      tooltip.classList.remove('is-visible');
    }, 2800);

    badge.textContent = shortBadge(page);
    badge.dataset.type = page.type;

    const aria =
      page.type === PAGE_TYPES.UNKNOWN
        ? 'Open RepoLens'
        : `Open RepoLens — ${label}`;
    button.setAttribute('aria-label', aria);
    button.title = aria;
  }

  function publishPageInfo(page) {
    try {
      chrome.runtime.sendMessage({
        type: MSG.PAGE_INFO,
        page,
      });
    } catch {
      // Extension context may be invalidated after reload — ignore
    }
  }

  function collectPageSignals(page) {
    const signals = {};
    try {
      if (page.type === PAGE_TYPES.PR) {
        const fileRows = document.querySelectorAll(
          '.file-info .Truncate-text, .Diff-file-header a, [data-file-type]'
        );
        const names = [];
        fileRows.forEach((el) => {
          const name = el.textContent?.trim();
          if (name && names.length < 40 && !names.includes(name)) names.push(name);
        });
        signals.changedFiles = names.length || 0;
        if (names.length) {
          signals.fileTypes = [...new Set(names.map((n) => n.split('.').pop()))].slice(0, 15);
          signals.hasMigrations = names.some((n) => /migrat|schema|flyway|liquibase|alembic/i.test(n));
          signals.hasTests = names.some((n) => /test|spec|__tests__/i.test(n));
          signals.hasConfig = names.some((n) => /config|\.env|\.yml|\.yaml|Dockerfile/i.test(n));
        }
        const titleEl = document.querySelector('.js-issue-title, bdi.js-issue-title');
        if (titleEl) signals.prTitle = titleEl.textContent.trim().slice(0, 200);
      } else if (page.type === PAGE_TYPES.FILE) {
        const ext = page.filePath?.split('.').pop() || '';
        signals.extension = ext;
      }
    } catch {
      // non-critical
    }
    return signals;
  }

  function refresh(force = false) {
    const path = window.location.pathname;
    if (!force && path === lastPath) return;
    lastPath = path;

    const page = getPageInfo();
    page.signals = collectPageSignals(page);
    updateUi(page);
    publishPageInfo(page);
  }

  function onFabClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const page = currentPage || getPageInfo();
    chrome.runtime.sendMessage({
      type: MSG.OPEN_PANEL,
      page,
    });
  }

  /**
   * Lightweight DOM scrape for Instant-mode fallback / supplement.
   */
  function scrapePage() {
    const page = currentPage || getPageInfo();
    const scrape = { pageType: page.type, url: location.href };

    try {
      if (page.type === PAGE_TYPES.PR) {
        const title =
          document.querySelector('.js-issue-title')?.textContent?.trim() ||
          document.querySelector('bdi.js-issue-title')?.textContent?.trim() ||
          document.title;
        const body =
          document.querySelector('.comment-body')?.innerText?.trim() ||
          document.querySelector('[data-testid="pull-request-body"]')?.innerText?.trim() ||
          '';
        scrape.title = title;
        scrape.body = body.slice(0, 8000);
        const fileRows = document.querySelectorAll(
          '.file-info .Truncate-text, .Diff-file-header a, [data-file-type]'
        );
        const files = [];
        fileRows.forEach((el) => {
          const name = el.textContent?.trim();
          if (name && files.length < 40 && !files.includes(name)) files.push(name);
        });
        if (files.length) scrape.changedFilesHint = files;
      } else if (page.type === PAGE_TYPES.FILE) {
        const lines = document.querySelectorAll(
          '.blob-code-inner, td.blob-code, .react-code-text, [data-code-text]'
        );
        let text = '';
        lines.forEach((el) => {
          if (text.length > 20_000) return;
          text += `${el.textContent || ''}\n`;
        });
        if (!text) {
          text = document.querySelector('.blob-wrapper, #read-only-cursor-text-area')
            ?.textContent || '';
        }
        scrape.filePath = page.filePath;
        scrape.content = text.slice(0, 20_000);
      } else if (page.type === PAGE_TYPES.REPO) {
        const readme =
          document.querySelector('#readme .markdown-body')?.innerText ||
          document.querySelector('article.markdown-body')?.innerText ||
          '';
        scrape.readme = readme.slice(0, 12_000);
        scrape.description =
          document.querySelector('p.f4.my-3')?.textContent?.trim() ||
          document.querySelector('[data-pjax="#repo-content-pjax-container"] p')
            ?.textContent?.trim() ||
          '';
      } else if (page.type === PAGE_TYPES.COMMIT) {
        scrape.message =
          document.querySelector('.commit-title, .commit-desc')?.innerText?.trim() ||
          document.querySelector('.js-details-container .commit-title')?.textContent?.trim() ||
          '';
        scrape.message = String(scrape.message).slice(0, 4000);
      }
    } catch (err) {
      scrape.scrapeError = String(err?.message || err);
    }

    return scrape;
  }

  // Respond when panel/background asks for current page context
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === MSG.GET_PAGE_INFO) {
      const page = currentPage || getPageInfo();
      sendResponse({ page });
      return true;
    }
    if (message && message.type === MSG.SCRAPE_PAGE) {
      sendResponse({ scrape: scrapePage() });
      return true;
    }
    return false;
  });

  // GitHub Enterprise uses Turbo / pjax for SPA navigations
  document.addEventListener('turbo:load', () => refresh(true));
  document.addEventListener('turbo:render', () => refresh(true));
  document.addEventListener('pjax:end', () => refresh(true));
  document.addEventListener('pjax:complete', () => refresh(true));

  // Fallback: watch History API + soft URL polling
  const pushState = history.pushState;
  const replaceState = history.replaceState;

  history.pushState = function (...args) {
    const result = pushState.apply(this, args);
    queueMicrotask(() => refresh());
    return result;
  };

  history.replaceState = function (...args) {
    const result = replaceState.apply(this, args);
    queueMicrotask(() => refresh());
    return result;
  };

  window.addEventListener('popstate', () => refresh());

  // Soft polling catches edge cases where events don't fire
  window.setInterval(() => refresh(), 1000);

  // Initial inject
  refresh(true);
})();
