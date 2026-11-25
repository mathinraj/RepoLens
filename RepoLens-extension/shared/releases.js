/**
 * Release info from GitHub Releases (github.com/mathinraj/RepoLens/releases).
 * Used for "update available" and the What's new page. Requests are
 * unauthenticated and never include the user's GitHub token.
 */
(function (root) {
  const { RELEASES_API, STORAGE } = root.REPOLENS;

  const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;

  /** "v1.2.3" / "1.2.3" → "1.2.3"; anything else → null */
  function normalizeVersion(tag) {
    const m = String(tag || '').trim().match(/^v?(\d+(?:\.\d+){0,3})$/i);
    return m ? m[1] : null;
  }

  /** >0 if a is newer than b, <0 if older, 0 if equal. */
  function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function currentVersion() {
    return chrome.runtime.getManifest().version;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-cache' });
    if (!res.ok) throw Object.assign(new Error(`GitHub releases ${res.status}`), { status: res.status });
    return res.json();
  }

  /**
   * Refresh the cached latest release (at most every 12h unless forced).
   * @returns {Promise<{version,url,name,checkedAt}|null>}
   */
  async function checkForUpdate({ force = false } = {}) {
    const { [STORAGE.LATEST_RELEASE]: cached } = await chrome.storage.local.get(STORAGE.LATEST_RELEASE);
    if (!force && cached?.checkedAt && Date.now() - cached.checkedAt < CHECK_EVERY_MS) return cached;

    try {
      const rel = await fetchJson(`${RELEASES_API}/latest`);
      const version = normalizeVersion(rel.tag_name);
      const latest = version
        ? { version, url: rel.html_url, name: rel.name || `v${version}`, checkedAt: Date.now() }
        : { checkedAt: Date.now() };
      await chrome.storage.local.set({ [STORAGE.LATEST_RELEASE]: latest });
      return latest;
    } catch {
      // 404 = no published releases yet; remember the check either way.
      const latest = { ...(cached || {}), checkedAt: Date.now() };
      await chrome.storage.local.set({ [STORAGE.LATEST_RELEASE]: latest });
      return latest;
    }
  }

  /** The cached latest release if it is newer than the installed version. */
  async function availableUpdate() {
    const { [STORAGE.LATEST_RELEASE]: latest } = await chrome.storage.local.get(STORAGE.LATEST_RELEASE);
    return latest?.version && compareVersions(latest.version, currentVersion()) > 0 ? latest : null;
  }

  /**
   * Published releases with from < version <= to, newest first.
   * @returns {Promise<Array<{version,name,url,body,publishedAt}>>}
   */
  async function releasesBetween(from, to) {
    const list = await fetchJson(`${RELEASES_API}?per_page=30`);
    return list
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => ({
        version: normalizeVersion(r.tag_name),
        name: r.name,
        url: r.html_url,
        body: r.body || '',
        publishedAt: r.published_at,
      }))
      .filter((r) => r.version && compareVersions(r.version, to) <= 0 && (!from || compareVersions(r.version, from) > 0))
      .sort((a, b) => compareVersions(b.version, a.version));
  }

  root.RepoLensReleases = { checkForUpdate, availableUpdate, releasesBetween, compareVersions, currentVersion };
})(globalThis);
