/**
 * RepoLens What's new — release notes from GitHub Releases + update prompt.
 */
(function () {
  const { STORAGE, RELEASES_URL, CHANGELOG_URL } = globalThis.REPOLENS;
  const Releases = globalThis.RepoLensReleases;

  const $ = (id) => document.getElementById(id);
  const current = Releases.currentVersion();

  $('all-releases').href = RELEASES_URL;
  $('changelog-link').href = CHANGELOG_URL;
  globalThis.RepoLensSupport.feedbackUrl('feature').then((url) => {
    $('feedback-link').href = url;
  });

  function renderMarkdown(src) {
    const html = globalThis.marked.parse(src || '', { async: false, gfm: true, breaks: true });
    return globalThis.DOMPurify.sanitize(html);
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function renderReleases(list) {
    const root = $('releases');
    root.innerHTML = '';
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No release notes published for this version yet.';
      root.appendChild(p);
      return;
    }
    for (const r of list) {
      const article = document.createElement('article');
      article.className = 'release' + (r.version === current ? ' is-current' : '');

      const head = document.createElement('div');
      head.className = 'release-head';
      const title = document.createElement('h2');
      const link = document.createElement('a');
      link.href = r.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = r.name || `v${r.version}`;
      title.appendChild(link);
      const meta = document.createElement('span');
      meta.className = 'release-meta';
      meta.textContent = [r.version === current ? 'Installed' : '', formatDate(r.publishedAt)].filter(Boolean).join(' · ');
      head.append(title, meta);

      const body = document.createElement('div');
      body.className = 'release-body';
      body.innerHTML = renderMarkdown(r.body || '_No notes for this release._');
      body.querySelectorAll('a[href]').forEach((a) => {
        a.target = '_blank';
        a.rel = 'noopener';
      });

      article.append(head, body);
      root.appendChild(article);
    }
  }

  function renderError() {
    const root = $('releases');
    root.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.append('Couldn\u2019t load release notes. ');
    const a = document.createElement('a');
    a.href = RELEASES_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Read them on GitHub';
    p.appendChild(a);
    root.appendChild(p);
  }

  async function renderUpdate() {
    await Releases.checkForUpdate();
    const update = await Releases.availableUpdate();
    if (!update) return;

    $('update').classList.remove('is-hidden');
    $('update-title').textContent = `RepoLens v${update.version} is available`;
    $('update-btn').addEventListener('click', async () => {
      const btn = $('update-btn');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const result = await chrome.runtime.requestUpdateCheck();
        const status = typeof result === 'string' ? result : result?.status;
        if (status === 'update_available') {
          btn.textContent = 'Restarting…';
          setTimeout(() => chrome.runtime.reload(), 500);
          return;
        }
        $('update-text').textContent =
          status === 'throttled'
            ? 'Checked too recently. Try again in a few minutes.'
            : 'The store hasn\u2019t delivered it to your browser yet. It will install automatically, usually within a few hours.';
      } catch {
        $('update-text').textContent = 'Couldn\u2019t check for updates right now.';
      }
      btn.textContent = 'Update now';
      btn.disabled = false;
    });
  }

  (async function init() {
    const { [STORAGE.WHATS_NEW]: whatsNew } = await chrome.storage.local.get(STORAGE.WHATS_NEW);
    const from = whatsNew?.to === current ? whatsNew.from : null;
    $('sub').textContent = from ? `Updated from v${from} to v${current}` : `You're on v${current}`;

    if (whatsNew && !whatsNew.seen) {
      chrome.storage.local.set({ [STORAGE.WHATS_NEW]: { ...whatsNew, seen: true } });
    }

    renderUpdate();
    try {
      let list = await Releases.releasesBetween(from, current);
      if (!from) list = list.slice(0, 5);
      renderReleases(list);
    } catch {
      renderError();
    }
  })();
})();
