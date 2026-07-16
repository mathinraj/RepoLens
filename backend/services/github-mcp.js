/**
 * GitHub context fetcher for RepoLens.
 *
 * Mirrors the GitHub MCP tool surface used in Cursor
 * (get_file_contents, pull_request_read, get_commit, …) via the
 * GitHub Enterprise REST API so the local backend can run standalone.
 */

const { cache } = require('../cache/memory-cache');

const API_BASE = (process.env.GITHUB_API_BASE || 'https://github.intuit.com/api/v3').replace(
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
  const files = await ghFetch(`/repos/${org}/${repo}/pulls/${prNumber}/files?per_page=100`);
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

function hasGithubToken() {
  return Boolean(TOKEN);
}

module.exports = {
  getRepoContext,
  getPRContext,
  getFileContext,
  getCommitContext,
  getInstantContext,
  hasGithubToken,
  API_BASE,
};
