/**
 * RepoLens What's new — release notes from GitHub Releases + update prompt.
 */
(function () {
  const { STORAGE, RELEASES_URL, CHANGELOG_URL, AMO_URL } = globalThis.REPOLENS;
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

    // Loaded as a temporary add-on (about:debugging): Firefox can't update it,
    // so point at the download instead. Add-ons store installs update themselves.
    const self = await chrome.management.getSelf().catch(() => null);
    if (self?.installType === 'development') {
      const text = $('update-text');
      text.textContent =
        'Download the new Firefox zip, then load it again from about:debugging → This Firefox → Load Temporary Add-on.';
      if (AMO_URL) {
        const store = document.createElement('a');
        store.href = AMO_URL;
        store.target = '_blank';
        store.rel = 'noopener';
        store.textContent = 'Firefox Add-ons';
        text.append(' Or install it from ', store, ' to get updates automatically.');
      }
      const btn = $('update-btn');
      btn.textContent = 'Download';
      btn.addEventListener('click', () => {
        chrome.tabs.create({ url: update.url || `${RELEASES_URL}/latest` });
      });
      return;
    }

    // Firefox has no runtime.requestUpdateCheck; add-on updates are checked by
    // Firefox itself, and the user can trigger one from about:addons.
    $('update-text').textContent =
      'Firefox installs add-on updates automatically. To get it now, open about:addons, click the gear, and choose Check for Updates.';
    $('update-btn').classList.add('is-hidden');
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
