/**
 * GitHub context fetcher for RepoLens.
 *
 * Mirrors the GitHub MCP tool surface used in Cursor
 * (get_file_contents, pull_request_read, get_commit, …) via the
 * GitHub Enterprise REST API so the local backend can run standalone.
 */

const { cache } = require('../cache/memory-cache');

const API_BASE = (process.env.GITHUB_API_BASE || 'https://github.com/api/v3').replace(
  /\/$/,
  ''
);
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const TTL_PR_MS = 5 * 60 * 1000;
const TTL_REPO_MS = 15 * 60 * 1000;

const MAX_DIFF_CHARS = 48_000;
const MAX_FILE_CHARS = 40_000;
const MAX_README_CHARS = 24_000;

function authHeaders(extra = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'RepoLens/0.1',
    ...extra,
  };
  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }
  return headers;
}

async function ghFetch(path, { accept, cacheKey, ttlMs } = {}) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit;
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: authHeaders(accept ? { Accept: accept } : {}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(
      `GitHub API ${res.status} for ${path}: ${body.slice(0, 200) || res.statusText}`
    );
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

function decodeContent(fileJson) {
  if (!fileJson) return '';
  if (typeof fileJson.content === 'string' && fileJson.encoding === 'base64') {
    return Buffer.from(fileJson.content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  return '';
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated ${text.length - max} chars]`;
}

async function tryGetFile(org, repo, path, branch) {
  try {
    const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const json = await ghFetch(
      `/repos/${org}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${q}`,
      { cacheKey: `file:${org}/${repo}:${branch || 'default'}:${path}`, ttlMs: TTL_REPO_MS }
    );
    if (Array.isArray(json)) return null;
    return {
      path: json.path || path,
      content: truncate(decodeContent(json), MAX_FILE_CHARS),
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

async function getDirectoryListing(org, repo, path = '', branch) {
  const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const suffix = path
    ? `/${path.split('/').map(encodeURIComponent).join('/')}`
    : '';
  const json = await ghFetch(`/repos/${org}/${repo}/contents${suffix}${q}`, {
    cacheKey: `dir:${org}/${repo}:${branch || 'default'}:${path || '/'}`,
    ttlMs: TTL_REPO_MS,
  });
  if (!Array.isArray(json)) return [];
  return json.map((item) => ({
    name: item.name,
    path: item.path,
    type: item.type,
    size: item.size,
  }));
}

/**
 * Instant repo context: README + manifests + top-level listing.
 */
async function getRepoContext(org, repo) {
  const repoMeta = await ghFetch(`/repos/${org}/${repo}`, {
    cacheKey: `repo:${org}/${repo}`,
    ttlMs: TTL_REPO_MS,
  });
  const defaultBranch = repoMeta.default_branch || 'main';

  const listing = await getDirectoryListing(org, repo, '', defaultBranch);

  const readmeNames = ['README.md', 'README.MD', 'README', 'Readme.md'];
  let readme = null;
  for (const name of readmeNames) {
    if (listing.some((f) => f.name === name)) {
      readme = await tryGetFile(org, repo, name, defaultBranch);
      if (readme) {
        readme.content = truncate(readme.content, MAX_README_CHARS);
        break;
      }
    }
  }

  const manifestNames = [
    'package.json',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'requirements.txt',
    'Gemfile',
  ];
  const manifests = [];
  for (const name of manifestNames) {
    if (listing.some((f) => f.name === name)) {
      const file = await tryGetFile(org, repo, name, defaultBranch);
      if (file) manifests.push(file);
    }
  }

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

/**
 * Instant PR context: title, body, changed files, truncated diff.
 */
async function getPRContext(org, repo, prNumber) {
  const key = `pr:${org}/${repo}#${prNumber}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pr = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}`);
  const files = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}/files?per_page=300`);
  let diff = '';
  try {
    diff = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}`, {
      accept: 'application/vnd.github.v3.diff',
    });
  } catch {
    diff = files
      .map((f) => `--- ${f.filename}\n${f.patch || '(binary or too large)'}`)
      .join('\n\n');
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
  };

  cache.set(key, result, TTL_PR_MS);
  return result;
}

async function getFileContext(org, repo, branch, filePath) {
  const file = await tryGetFile(org, repo, filePath, branch);
  if (!file) {
    throw Object.assign(new Error(`File not found: ${filePath}`), { status: 404 });
  }
  return {
    type: 'file',
    org,
    repo,
    branch: branch || 'HEAD',
    filePath,
    content: file.content,
  };
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
    files: files.map(({ filename, status, additions, deletions }) => ({
      filename,
      status,
      additions,
      deletions,
    })),
    diff: truncate(patches, MAX_DIFF_CHARS),
  };
}

// ─── Enhanced context fetchers (Phase 4) ────────────────────────────────────

const MAX_ENHANCED_FILE_CHARS = 60_000;
const MAX_ENHANCED_DIFF_CHARS = 120_000;

/**
 * Enhanced repo context: everything from Instant, PLUS config files,
 * recent merged PRs, and CODEOWNERS.
 */
async function getEnhancedRepoContext(org, repo) {
  const base = await getRepoContext(org, repo);
  const branch = base.defaultBranch;

  const configNames = [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    '.github/workflows/ci.yml',
    '.github/workflows/ci.yaml',
    '.github/workflows/build.yml',
    'Jenkinsfile',
    'application.yml',
    'application.yaml',
    'application.properties',
    'src/main/resources/application.yml',
    'src/main/resources/application.properties',
    '.eslintrc.json',
    'tsconfig.json',
    'webpack.config.js',
    'vite.config.ts',
    'vite.config.js',
  ];

  const configFetches = configNames.map((name) =>
    tryGetFile(org, repo, name, branch).catch(() => null)
  );
  const configResults = await Promise.all(configFetches);
  const configFiles = configResults.filter(Boolean);

  const codeowners = await tryGetFile(org, repo, 'CODEOWNERS', branch).catch(() => null) ||
    await tryGetFile(org, repo, '.github/CODEOWNERS', branch).catch(() => null);

  let recentPRs = [];
  try {
    const prs = await ghFetch(
      `/repos/${org}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=5`,
      { cacheKey: `recent-prs:${org}/${repo}`, ttlMs: TTL_REPO_MS }
    );
    recentPRs = prs
      .filter((pr) => pr.merged_at)
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        user: pr.user?.login || '',
        mergedAt: pr.merged_at,
        additions: pr.additions,
        deletions: pr.deletions,
      }));
  } catch {
    // non-critical
  }

  return {
    ...base,
    enhanced: true,
    configFiles,
    codeowners: codeowners ? codeowners.content : null,
    recentPRs,
  };
}

/**
 * Enhanced PR context: everything from Instant, PLUS full content of
 * changed files, PR review comments, and linked issues.
 */
async function getEnhancedPRContext(org, repo, prNumber) {
  const base = await getPRContext(org, repo, prNumber);

  const sortedFiles = [...base.files]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));

  const fileFetches = sortedFiles.map((f) =>
    tryGetFile(org, repo, f.filename, base.head).catch(() => null)
  );
  const fileContents = (await Promise.all(fileFetches)).filter(Boolean);

  // PR review comments
  let reviewComments = [];
  try {
    const comments = await ghFetch(
      `/repos/${org}/${repo}/pulls/${prNumber}/comments?per_page=50`,
      { cacheKey: `pr-comments:${org}/${repo}#${prNumber}`, ttlMs: TTL_PR_MS }
    );
    reviewComments = comments.map((c) => ({
      user: c.user?.login || '',
      body: truncate(c.body || '', 1_000),
      path: c.path || null,
      line: c.line || c.original_line || null,
      createdAt: c.created_at,
    }));
  } catch {
    // non-critical
  }

  // Issue comments on the PR conversation
  let issueComments = [];
  try {
    const comments = await ghFetch(
      `/repos/${org}/${repo}/issues/${prNumber}/comments?per_page=30`,
      { cacheKey: `pr-issue-comments:${org}/${repo}#${prNumber}`, ttlMs: TTL_PR_MS }
    );
    issueComments = comments.map((c) => ({
      user: c.user?.login || '',
      body: truncate(c.body || '', 1_000),
      createdAt: c.created_at,
    }));
  } catch {
    // non-critical
  }

  // Parse linked issues from PR description (e.g., "fixes #123", "closes #456")
  const linkedIssueNumbers = [];
  const issuePattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  let match;
  while ((match = issuePattern.exec(base.body || '')) !== null) {
    linkedIssueNumbers.push(Number(match[1]));
  }

  let linkedIssues = [];
  if (linkedIssueNumbers.length > 0) {
    const issueFetches = linkedIssueNumbers.slice(0, 5).map((num) =>
      ghFetch(`/repos/${org}/${repo}/issues/${num}`).catch(() => null)
    );
    const issueResults = (await Promise.all(issueFetches)).filter(Boolean);
    linkedIssues = issueResults.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: truncate(issue.body || '', 1_500),
      state: issue.state,
      labels: (issue.labels || []).map((l) => l.name || l),
    }));
  }

  // Re-fetch diff with higher limit for enhanced mode
  let enhancedDiff = base.diff;
  if (base.diff?.includes('…[truncated')) {
    try {
      const rawDiff = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}`, {
        accept: 'application/vnd.github.v3.diff',
      });
      enhancedDiff = truncate(rawDiff, MAX_ENHANCED_DIFF_CHARS);
    } catch {
      // keep the instant diff
    }
  }

  return {
    ...base,
    enhanced: true,
    diff: enhancedDiff,
    fullFileContents: fileContents,
    reviewComments,
    issueComments,
    linkedIssues,
  };
}

/**
 * Enhanced file context: file content PLUS importers, recent commits,
 * and git blame summary.
 */
async function getEnhancedFileContext(org, repo, branch, filePath) {
  const base = await getFileContext(org, repo, branch, filePath);

  // Search for files that import/reference this file
  const fileName = filePath.split('/').pop().replace(/\.[^.]+$/, '');
  let importers = [];
  try {
    const searchResult = await ghFetch(
      `/search/code?q=${encodeURIComponent(fileName)}+repo:${org}/${repo}&per_page=10`,
      { cacheKey: `importers:${org}/${repo}:${fileName}`, ttlMs: TTL_REPO_MS }
    );
    importers = (searchResult.items || [])
      .filter((item) => item.path !== filePath)
      .map((item) => ({
        path: item.path,
        name: item.name,
      }));
  } catch {
    // search API might not be available
  }

  // Recent commits touching this file
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

  return {
    ...base,
    enhanced: true,
    importers,
    recentCommits,
  };
}

/**
 * Fetch the minimal Instant-mode context for a page type.
 * @param {{ pageType: string, org?: string, repo?: string, prNumber?: number, filePath?: string, branch?: string, sha?: string }} page
 */
async function getInstantContext(page) {
  const { pageType, org, repo } = page;
  if (!org || !repo) {
    return { type: pageType || 'unknown', note: 'Missing org/repo — using page scrape only.' };
  }

  switch (pageType) {
    case 'pr':
      return getPRContext(org, repo, page.prNumber);
    case 'file':
      return getFileContext(org, repo, page.branch, page.filePath);
    case 'commit':
      return getCommitContext(org, repo, page.sha);
    case 'repo':
      return getRepoContext(org, repo);
    default:
      return getRepoContext(org, repo);
  }
}

/**
 * Fetch broader Enhanced-mode context for a page type.
 */
async function getEnhancedContext(page) {
  const { pageType, org, repo } = page;
  if (!org || !repo) {
    return { type: pageType || 'unknown', note: 'Missing org/repo — using page scrape only.' };
  }

  switch (pageType) {
    case 'pr':
      return getEnhancedPRContext(org, repo, page.prNumber);
    case 'file':
      return getEnhancedFileContext(org, repo, page.branch, page.filePath);
    case 'commit':
      return getCommitContext(org, repo, page.sha);
    case 'repo':
      return getEnhancedRepoContext(org, repo);
    default:
      return getEnhancedRepoContext(org, repo);
  }
}

/**
 * Deep context: Enhanced PR context merged with Enhanced Repo context.
 * For non-PR pages, falls back to enhanced context.
 */
async function getDeepContext(page) {
  const { pageType, org, repo } = page;
  if (!org || !repo) {
    return { type: pageType || 'unknown', note: 'Missing org/repo — using page scrape only.' };
  }

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

  return getEnhancedContext(page);
}

function hasGithubToken() {
  return Boolean(TOKEN);
}

module.exports = {
  getRepoContext,
  getPRContext,
  getFileContext,
  getCommitContext,
  getInstantContext,
  getEnhancedRepoContext,
  getEnhancedPRContext,
  getEnhancedFileContext,
  getEnhancedContext,
  getDeepContext,
  hasGithubToken,
  API_BASE,
};
