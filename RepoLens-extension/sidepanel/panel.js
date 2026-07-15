/**
 * Phase 1 stub panel — shows detected page info.
 * Phase 2 will add question chips and the ask flow.
 */
(function () {
  const { MSG, PAGE_TYPES } = globalThis.REPOLENS;

  const badgeEl = document.getElementById('page-badge');
  const labelEl = document.getElementById('page-label');
  const detailsEl = document.getElementById('page-details');

  function render(page) {
    if (!page) {
      badgeEl.textContent = 'Unknown';
      badgeEl.dataset.type = PAGE_TYPES.UNKNOWN;
      labelEl.textContent = 'No GitHub page detected yet.';
      detailsEl.innerHTML = '';
      return;
    }

    badgeEl.textContent = page.type;
    badgeEl.dataset.type = page.type;
    labelEl.textContent = page.label || 'Current page';

    const rows = [
      ['Type', page.type],
      page.org && ['Org', page.org],
      page.repo && ['Repo', page.repo],
      page.prNumber != null && ['PR', String(page.prNumber)],
      page.branch && ['Branch', page.branch],
      page.filePath && ['File', page.filePath],
      page.sha && ['SHA', page.sha],
      page.url && ['URL', page.url],
    ].filter(Boolean);

    detailsEl.innerHTML = rows
      .map(
        ([k, v]) =>
          `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`
      )
      .join('');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadPageInfo() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!tab?.id) {
        render(null);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: MSG.GET_PAGE_INFO,
        tabId: tab.id,
      });
      render(response?.page || null);
    } catch (err) {
      console.warn('[RepoLens] Could not load page info:', err);
      render(null);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.PAGE_INFO && message.page) {
      render(message.page);
    }
  });

  loadPageInfo();
  // Refresh when the user switches back to the panel
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadPageInfo();
  });
})();
