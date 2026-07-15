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
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M4 6.5C4 5.12 5.12 4 6.5 4H10v6H4V6.5z" fill="currentColor" opacity="0.9"/>
            <path d="M14 4h3.5C18.88 4 20 5.12 20 6.5V10h-6V4z" fill="currentColor" opacity="0.75"/>
            <path d="M4 14h6v6H6.5C5.12 20 4 18.88 4 17.5V14z" fill="currentColor" opacity="0.75"/>
            <path d="M14 14h6v3.5c0 1.38-1.12 2.5-2.5 2.5H14v-6z" fill="currentColor" opacity="0.9"/>
            <circle cx="12" cy="12" r="2.25" fill="#ffffff"/>
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

  function refresh(force = false) {
    const path = window.location.pathname;
    if (!force && path === lastPath) return;
    lastPath = path;

    const page = getPageInfo();
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

  // Respond when panel/background asks for current page context
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === MSG.GET_PAGE_INFO) {
      const page = currentPage || getPageInfo();
      sendResponse({ page });
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
