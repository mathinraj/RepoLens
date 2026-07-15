/**
 * Detect GitHub Enterprise page type from a pathname.
 * Returns structured page info for the overlay badge and Q&A context.
 */
(function (root) {
  const TYPES = (root.REPOLENS && root.REPOLENS.PAGE_TYPES) || {
    REPO: 'repo',
    PR: 'pr',
    FILE: 'file',
    COMMIT: 'commit',
    UNKNOWN: 'unknown',
  };

  // Order matters: more specific patterns first
  const PATTERNS = [
    {
      type: TYPES.PR,
      regex: /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(files|commits|checks))?\/?$/,
    },
    {
      type: TYPES.FILE,
      regex: /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/,
    },
    {
      type: TYPES.COMMIT,
      regex: /^\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]{7,40})\/?$/i,
    },
    {
      // Repo home (and optionally tree root). Excludes known GitHub namespaces.
      type: TYPES.REPO,
      regex: /^\/([^/]+)\/([^/]+)(?:\/(?:tree\/[^/]+)?\/?)?$/,
      excludeOrgs: new Set([
        'settings',
        'orgs',
        'organizations',
        'marketplace',
        'explore',
        'notifications',
        'search',
        'topics',
        'login',
        'logout',
        'signup',
        'sessions',
        'account',
        'apps',
        'enterprise',
        'gist',
        'pulls',
        'issues',
        'codespaces',
        'sponsors',
        'stars',
        'trending',
      ]),
    },
  ];

  /**
   * @param {string} pathname - e.g. window.location.pathname
   * @returns {{
   *   type: string,
   *   org?: string,
   *   repo?: string,
   *   prNumber?: number,
   *   branch?: string,
   *   filePath?: string,
   *   sha?: string,
   *   url: string,
   *   label: string
   * }}
   */
  function detectPage(pathname) {
    const path = (pathname || '').replace(/\/+$/, '') || '/';
    const url = typeof location !== 'undefined' ? location.href : path;

    for (const pattern of PATTERNS) {
      const match = path.match(pattern.regex);
      if (!match) continue;

      if (pattern.type === TYPES.PR) {
        const info = {
          type: TYPES.PR,
          org: match[1],
          repo: match[2],
          prNumber: Number(match[3]),
          url,
        };
        info.label = `PR #${info.prNumber}`;
        return info;
      }

      if (pattern.type === TYPES.FILE) {
        const filePath = match[4];
        const fileName = filePath.split('/').pop() || filePath;
        return {
          type: TYPES.FILE,
          org: match[1],
          repo: match[2],
          branch: match[3],
          filePath,
          url,
          label: `File: ${fileName}`,
        };
      }

      if (pattern.type === TYPES.COMMIT) {
        const sha = match[3];
        return {
          type: TYPES.COMMIT,
          org: match[1],
          repo: match[2],
          sha,
          url,
          label: `Commit ${sha.slice(0, 7)}`,
        };
      }

      if (pattern.type === TYPES.REPO) {
        const org = match[1];
        const repo = match[2];
        // Skip non-repo paths like /settings/profile or /orgs/foo
        if (pattern.excludeOrgs && pattern.excludeOrgs.has(org)) {
          continue;
        }
        // Skip repo sub-pages we don't handle yet (issues, actions, etc.)
        // Tree root (/org/repo/tree/branch) is allowed as repo context.
        const remainder = path.slice(`/${org}/${repo}`.length);
        if (
          remainder &&
          !/^\/?$/.test(remainder) &&
          !/^\/tree\/[^/]+\/?$/.test(remainder)
        ) {
          continue;
        }
        return {
          type: TYPES.REPO,
          org,
          repo,
          url,
          label: `${org}/${repo}`,
        };
      }
    }

    return {
      type: TYPES.UNKNOWN,
      url,
      label: 'This page',
    };
  }

  /**
   * Human-readable summary for tooltips / badges.
   * @param {ReturnType<typeof detectPage>} page
   */
  function formatPageBadge(page) {
    if (!page || page.type === TYPES.UNKNOWN) return 'Ask about this page';
    if (page.type === TYPES.PR) return page.label;
    if (page.type === TYPES.FILE) return page.label;
    if (page.type === TYPES.COMMIT) return page.label;
    if (page.type === TYPES.REPO) return page.label;
    return page.label || 'RepoLens';
  }

  const api = { detectPage, formatPageBadge };

  root.RepoLensPageDetector = api;

  // Also support ES module import style when bundled later
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
