/**
 * Feedback + uninstall links to the RepoLens site, carrying basic diagnostics.
 * Never include API keys, tokens, repository names, questions, or answers here.
 */
(function (root) {
  const { SITE_URL, REPO_URL, AMO_URL, STORAGE, PROVIDERS, DEFAULT_PROVIDER, STORE, RATE } = root.REPOLENS;

  function browser() {
    const ua = navigator.userAgent;
    const firefox = ua.match(/Firefox\/([\d.]+)/);
    if (firefox) return { name: 'firefox', version: firefox[1] };
    const edge = ua.match(/Edg\/([\d.]+)/);
    if (edge) return { name: 'edge', version: edge[1] };
    const chrome = ua.match(/Chrome\/([\d.]+)/);
    return { name: 'chrome', version: chrome ? chrome[1] : '' };
  }

  /** Short diagnostic params shared by the feedback and uninstall pages. */
  async function diagnostics() {
    const keys = [STORAGE.PROVIDER, STORAGE.GITHUB_TOKEN, STORAGE.INSTALLED_AT, STORAGE.ANSWER_COUNT];
    for (const p of Object.values(PROVIDERS)) keys.push(p.keyStorage, p.modelStorage);
    const s = await chrome.storage.local.get(keys);
    const provider = PROVIDERS[s[STORAGE.PROVIDER]] || PROVIDERS[DEFAULT_PROVIDER];

    let os = '';
    try {
      os = (await chrome.runtime.getPlatformInfo()).os;
    } catch {
      // not available in every context
    }

    const b = browser();
    const params = {
      v: chrome.runtime.getManifest().version,
      s: STORE,
      b: b.name,
      bv: b.version,
      os,
      p: provider.id,
      m: s[provider.modelStorage] || provider.defaultModel,
      k: s[provider.keyStorage] ? '1' : '0',
      gh: s[STORAGE.GITHUB_TOKEN] ? '1' : '0',
      a: String(s[STORAGE.ANSWER_COUNT] || 0),
    };
    if (s[STORAGE.INSTALLED_AT]) {
      params.d = String(Math.floor((Date.now() - s[STORAGE.INSTALLED_AT]) / 86_400_000));
    }
    return params;
  }

  /** @param {'bug'|'feature'|'question'|'other'} [type] */
  async function feedbackUrl(type = 'bug') {
    const params = new URLSearchParams({ type, ...(await diagnostics()) });
    return `${SITE_URL}/feedback.html?${params}`;
  }

  async function uninstallUrl() {
    const params = new URLSearchParams(await diagnostics());
    return `${SITE_URL}/uninstall.html?${params}`;
  }

  /**
   * Ask for a rating after RATE.MIN_ANSWERS answers and RATE.MIN_DAYS installed;
   * never again once rated, and not before a "Later" reminder date.
   */
  function shouldAskForRating({ answers = 0, installedAt = 0, prompt = null }, now = Date.now()) {
    if (prompt?.rated) return false;
    if (prompt?.remindAt && now < prompt.remindAt) return false;
    if (answers < RATE.MIN_ANSWERS || !installedAt) return false;
    return now - installedAt >= RATE.MIN_DAYS * 86_400_000;
  }

  /** Firefox Add-ons reviews page once the listing exists; the GitHub repo until then. */
  function reviewUrl() {
    return AMO_URL ? `${AMO_URL.replace(/\/?$/, '/')}reviews/` : REPO_URL;
  }

  root.RepoLensSupport = { feedbackUrl, uninstallUrl, shouldAskForRating, reviewUrl };
})(globalThis);
