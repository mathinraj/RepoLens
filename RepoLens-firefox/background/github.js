/**
 * GitHub REST context fetcher (runs in the service worker).
 * Works unauthenticated for public repos (60 req/h); a token raises the
 * limit and unlocks private repos.
 */
(function (root) {
  const API_BASE = root.REPOLENS.GITHUB_API;

  const TTL_PR_MS = 5 * 60 * 1000;
  const TTL_REPO_MS = 15 * 60 * 1000;

  const MAX_DIFF_CHARS = 48_000;
  const MAX_FILE_CHARS = 40_000;
  const MAX_README_CHARS = 24_000;
  const MAX_ENHANCED_DIFF_CHARS = 120_000;
  const MAX_ENHANCED_FILES = 25;

  let token = '';

  // ─── Cache ──────────────────────────────────────────────────────────────────
  const store = new Map();
  const cache = {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlMs) {
      if (store.size > 500) store.clear();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    clear() {
      store.clear();
    },
  };

  function setToken(value) {
    const next = String(value || '').trim();
    if (next !== token) cache.clear();
    token = next;
  }

  function hasToken() {
    return Boolean(token);
  }

  function authHeaders(accept) {
    const headers = {
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function ghFetch(path, { accept, cacheKey, ttlMs } = {}) {
    if (cacheKey) {
      const hit = cache.get(cacheKey);
      if (hit !== undefined) return hit;
    }

    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(accept) });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let message = `GitHub API ${res.status} for ${path}`;
      if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        message = token
          ? 'GitHub API rate limit reached. Try again later.'
          : 'GitHub API rate limit reached. Add a GitHub token in RepoLens Preferences for higher limits.';
      } else if (res.status === 404 && !token) {
        message = `GitHub API 404 for ${path} (private repo? add a GitHub token in Preferences)`;
      } else if (body) {
        message += `: ${body.slice(0, 200)}`;
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (accept && accept.includes('diff')) {
      data = await res.text();
    } else if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (cacheKey && ttlMs) cache.set(cacheKey, data, ttlMs);
    return data;
  }

  /** GET /user — used by the options page to validate a token. */
  async function getViewer(candidateToken) {
    const res = await fetch(`${API_BASE}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${candidateToken}`,
      },
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub API ${res.status}`), { status: res.status });
    return res.json();
  }

  function decodeContent(fileJson) {
    if (!fileJson || typeof fileJson.content !== 'string' || fileJson.encoding !== 'base64') {
      return '';
    }
    const binary = atob(fileJson.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  function truncate(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n\n…[truncated ${text.length - max} chars]`;
  }

  function encodePath(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  async function tryGetFile(org, repo, path, branch) {
    try {
      const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
      const json = await ghFetch(`/repos/${org}/${repo}/contents/${encodePath(path)}${q}`, {
        cacheKey: `file:${org}/${repo}:${branch || 'default'}:${path}`,
        ttlMs: TTL_REPO_MS,
      });
      if (Array.isArray(json)) return null;
      return { path: json.path || path, content: truncate(decodeContent(json), MAX_FILE_CHARS) };
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function getDirectoryListing(org, repo, path = '', branch) {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const suffix = path ? `/${encodePath(path)}` : '';
    const json = await ghFetch(`/repos/${org}/${repo}/contents${suffix}${q}`, {
      cacheKey: `dir:${org}/${repo}:${branch || 'default'}:${path || '/'}`,
      ttlMs: TTL_REPO_MS,
    });
    if (!Array.isArray(json)) return [];
    return json.map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
  }

  // ─── Instant context ────────────────────────────────────────────────────────

  async function getRepoContext(org, repo) {
    const repoMeta = await ghFetch(`/repos/${org}/${repo}`, {
      cacheKey: `repo:${org}/${repo}`,
      ttlMs: TTL_REPO_MS,
    });
    const defaultBranch = repoMeta.default_branch || 'main';
    const listing = await getDirectoryListing(org, repo, '', defaultBranch);

    let readme = null;
    for (const name of ['README.md', 'README.MD', 'README', 'Readme.md']) {
      if (listing.some((f) => f.name === name)) {
        readme = await tryGetFile(org, repo, name, defaultBranch);
        if (readme) {
          readme.content = truncate(readme.content, MAX_README_CHARS);
          break;
        }
      }
    }

    const manifestNames = [
      'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Cargo.toml',
      'go.mod', 'pyproject.toml', 'requirements.txt', 'Gemfile',
    ];
    const manifests = (
      await Promise.all(
        manifestNames
          .filter((name) => listing.some((f) => f.name === name))
          .map((name) => tryGetFile(org, repo, name, defaultBranch).catch(() => null))
      )
    ).filter(Boolean);

    return {
      type: 'repo',
      org,
      repo,
      description: repoMeta.description || '',
      defaultBranch,
      language: repoMeta.language || '',
      topics: repoMeta.topics || [],
      listing,
      readme,
      manifests,
    };
  }

  async function getPRContext(org, repo, prNumber) {
    const key = `pr:${org}/${repo}#${prNumber}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const pr = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}`);
    const files = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}/files?per_page=100`);
    let diff = '';
    try {
      diff = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}`, {
        accept: 'application/vnd.github.v3.diff',
      });
    } catch {
      diff = files.map((f) => `--- ${f.filename}\n${f.patch || '(binary or too large)'}`).join('\n\n');
    }

    const result = {
      type: 'pr',
      org,
      repo,
      prNumber: Number(prNumber),
      title: pr.title,
      body: pr.body || '',
      user: pr.user?.login || '',
      state: pr.state,
      draft: Boolean(pr.draft),
      base: pr.base?.ref,
      head: pr.head?.ref,
      headSha: pr.head?.sha,
      commits: pr.commits,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
      })),
      diff: truncate(diff, MAX_DIFF_CHARS),
      rawDiffLength: diff.length,
    };

    cache.set(key, result, TTL_PR_MS);
    return result;
  }

  async function getFileContext(org, repo, branch, filePath) {
    const file = await tryGetFile(org, repo, filePath, branch);
    if (!file) throw Object.assign(new Error(`File not found: ${filePath}`), { status: 404 });
    return { type: 'file', org, repo, branch: branch || 'HEAD', filePath, content: file.content };
  }

  async function getCommitContext(org, repo, sha) {
    const commit = await ghFetch(`/repos/${org}/${repo}/commits/${sha}`, {
      cacheKey: `commit:${org}/${repo}:${sha}`,
      ttlMs: TTL_PR_MS,
    });

    const files = (commit.files || []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ? truncate(f.patch, 8_000) : null,
    }));
    const patches = files
      .filter((f) => f.patch)
      .map((f) => `--- ${f.filename}\n${f.patch}`)
      .join('\n\n');

    return {
      type: 'commit',
      org,
      repo,
      sha: commit.sha,
      message: commit.commit?.message || '',
      author: commit.commit?.author?.name || commit.author?.login || '',
      date: commit.commit?.author?.date || '',
      stats: commit.stats || {},
      files: files.map(({ filename, status, additions, deletions }) => ({ filename, status, additions, deletions })),
      diff: truncate(patches, MAX_DIFF_CHARS),
    };
  }

  // ─── Enhanced (Deep) context ────────────────────────────────────────────────

  async function getEnhancedRepoContext(org, repo) {
    const base = await getRepoContext(org, repo);
    const branch = base.defaultBranch;

    const configNames = [
      'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
      '.github/workflows/ci.yml', '.github/workflows/ci.yaml', '.github/workflows/build.yml',
      'Jenkinsfile', 'application.yml', 'application.yaml', 'application.properties',
      'src/main/resources/application.yml', 'src/main/resources/application.properties',
      '.eslintrc.json', 'tsconfig.json', 'webpack.config.js', 'vite.config.ts', 'vite.config.js',
    ];
    const topLevel = new Set(base.listing.map((f) => f.name));
    const topDirs = new Set(base.listing.filter((f) => f.type === 'dir').map((f) => f.name));
    // Only request files whose top-level parent exists, to save API quota.
    const candidates = configNames.filter((name) => {
      const first = name.split('/')[0];
      return name.includes('/') ? topDirs.has(first) : topLevel.has(name);
    });
    const configFiles = (
      await Promise.all(candidates.map((name) => tryGetFile(org, repo, name, branch).catch(() => null)))
    ).filter(Boolean);

    const codeowners =
      (topLevel.has('CODEOWNERS') && (await tryGetFile(org, repo, 'CODEOWNERS', branch).catch(() => null))) ||
      (topDirs.has('.github') && (await tryGetFile(org, repo, '.github/CODEOWNERS', branch).catch(() => null))) ||
      null;

    let recentPRs = [];
    try {
      const prs = await ghFetch(
        `/repos/${org}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=5`,
        { cacheKey: `recent-prs:${org}/${repo}`, ttlMs: TTL_REPO_MS }
      );
      recentPRs = prs
        .filter((pr) => pr.merged_at)
        .map((pr) => ({ number: pr.number, title: pr.title, user: pr.user?.login || '', mergedAt: pr.merged_at }));
    } catch {
      // non-critical
    }

    return { ...base, enhanced: true, configFiles, codeowners: codeowners ? codeowners.content : null, recentPRs };
  }

  async function getEnhancedPRContext(org, repo, prNumber) {
    const base = await getPRContext(org, repo, prNumber);

    const sortedFiles = [...base.files]
      .filter((f) => f.status !== 'removed')
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, MAX_ENHANCED_FILES);
    const fullFileContents = (
      await Promise.all(sortedFiles.map((f) => tryGetFile(org, repo, f.filename, base.headSha || base.head).catch(() => null)))
    ).filter(Boolean);

    let reviewComments = [];
    try {
      const comments = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}/comments?per_page=50`, {
        cacheKey: `pr-comments:${org}/${repo}#${prNumber}`,
        ttlMs: TTL_PR_MS,
      });
      reviewComments = comments.map((c) => ({
        user: c.user?.login || '',
        body: truncate(c.body || '', 1_000),
        path: c.path || null,
        line: c.line || c.original_line || null,
      }));
    } catch {
      // non-critical
    }

    let issueComments = [];
    try {
      const comments = await ghFetch(`/repos/${org}/${repo}/issues/${prNumber}/comments?per_page=30`, {
        cacheKey: `pr-issue-comments:${org}/${repo}#${prNumber}`,
        ttlMs: TTL_PR_MS,
      });
      issueComments = comments.map((c) => ({ user: c.user?.login || '', body: truncate(c.body || '', 1_000) }));
    } catch {
      // non-critical
    }

    const linkedIssueNumbers = [];
    const issuePattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
    let match;
    while ((match = issuePattern.exec(base.body || '')) !== null) {
      linkedIssueNumbers.push(Number(match[1]));
    }
    const linkedIssues = (
      await Promise.all(
        linkedIssueNumbers.slice(0, 5).map((num) => ghFetch(`/repos/${org}/${repo}/issues/${num}`).catch(() => null))
      )
    )
      .filter(Boolean)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: truncate(issue.body || '', 1_500),
        state: issue.state,
        labels: (issue.labels || []).map((l) => l.name || l),
      }));

    let diff = base.diff;
    if (base.rawDiffLength > MAX_DIFF_CHARS) {
      try {
        const rawDiff = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}`, {
          accept: 'application/vnd.github.v3.diff',
        });
        diff = truncate(rawDiff, MAX_ENHANCED_DIFF_CHARS);
      } catch {
        // keep the instant diff
      }
    }

    return { ...base, enhanced: true, diff, fullFileContents, reviewComments, issueComments, linkedIssues };
  }

  async function getEnhancedFileContext(org, repo, branch, filePath) {
    const base = await getFileContext(org, repo, branch, filePath);

    // Code search requires authentication.
    let importers = [];
    if (token) {
      const fileName = filePath.split('/').pop().replace(/\.[^.]+$/, '');
      try {
        const searchResult = await ghFetch(
          `/search/code?q=${encodeURIComponent(`${fileName} repo:${org}/${repo}`)}&per_page=10`,
          { cacheKey: `importers:${org}/${repo}:${fileName}`, ttlMs: TTL_REPO_MS }
        );
        importers = (searchResult.items || [])
          .filter((item) => item.path !== filePath)
          .map((item) => ({ path: item.path, name: item.name }));
      } catch {
        // non-critical
      }
    }

    let recentCommits = [];
    try {
      const commits = await ghFetch(
        `/repos/${org}/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=5` +
          (branch ? `&sha=${encodeURIComponent(branch)}` : ''),
        { cacheKey: `file-commits:${org}/${repo}:${branch || 'default'}:${filePath}`, ttlMs: TTL_REPO_MS }
      );
      recentCommits = commits.map((c) => ({
        sha: c.sha?.slice(0, 7),
        message: truncate(c.commit?.message || '', 200),
        author: c.commit?.author?.name || c.author?.login || '',
        date: c.commit?.author?.date || '',
      }));
    } catch {
      // non-critical
    }

    return { ...base, enhanced: true, importers, recentCommits };
  }

  // ─── Entry points ───────────────────────────────────────────────────────────

  function missingRepo(page) {
    return { type: page.pageType || 'unknown', note: 'Missing org/repo — using page scrape only.' };
  }

  async function getInstantContext(page) {
    const { pageType, org, repo } = page;
    if (!org || !repo) return missingRepo(page);
    switch (pageType) {
      case 'pr':
        return getPRContext(org, repo, page.prNumber);
      case 'file':
        return getFileContext(org, repo, page.branch, page.filePath);
      case 'commit':
        return getCommitContext(org, repo, page.sha);
      default:
        return getRepoContext(org, repo);
    }
  }

  async function getDeepContext(page) {
    const { pageType, org, repo } = page;
    if (!org || !repo) return missingRepo(page);

    if (pageType === 'pr') {
      const [prCtx, repoCtx] = await Promise.all([
        getEnhancedPRContext(org, repo, page.prNumber),
        getEnhancedRepoContext(org, repo),
      ]);
      return {
        ...prCtx,
        deep: true,
        repoContext: {
          description: repoCtx.description,
          language: repoCtx.language,
          topics: repoCtx.topics,
          listing: repoCtx.listing,
          readme: repoCtx.readme,
          manifests: repoCtx.manifests,
          configFiles: repoCtx.configFiles,
          codeowners: repoCtx.codeowners,
          recentPRs: repoCtx.recentPRs,
        },
      };
    }
    if (pageType === 'file') return getEnhancedFileContext(org, repo, page.branch, page.filePath);
    if (pageType === 'commit') return getCommitContext(org, repo, page.sha);
    return getEnhancedRepoContext(org, repo);
  }

  root.RepoLensGitHub = { setToken, hasToken, getViewer, getInstantContext, getDeepContext };
})(globalThis);
