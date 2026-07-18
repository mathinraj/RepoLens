/**
 * RepoLens local backend — Express entry point.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const askRouter = require('./routes/ask');
const { hasClaudeAuth, getProvider, DEFAULT_MODEL } = require('./services/claude');
const { hasGithubToken, API_BASE, getInstantContext } = require('./services/github-mcp');

const PORT = Number(process.env.PORT || 3847);
const app = express();

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '2mb' }));

// Request logging
app.use((req, _res, next) => {
  if (req.path !== '/health' && req.path !== '/prefetch') {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'repolens-backend',
    model: DEFAULT_MODEL,
    claudeProvider: getProvider(),
    claudeAuth: hasClaudeAuth(),
    githubToken: hasGithubToken(),
    githubApi: API_BASE,
  });
});

app.use('/ask', askRouter);

/**
 * POST /prefetch — warm the GitHub context cache for a page.
 * Called by the service worker on navigation (fire-and-forget).
 */
app.post('/prefetch', async (req, res) => {
  const { pageType, org, repo, prNumber, filePath, branch, sha } = req.body || {};
  if (!hasGithubToken() || !org || !repo) {
    res.json({ ok: false, reason: 'missing token or org/repo' });
    return;
  }
  console.log(`[PREFETCH] ${pageType} ${org}/${repo}`);
  try {
    const ctx = await getInstantContext({ pageType, org, repo, prNumber, filePath, branch, sha });
    const signals = buildPrefetchSignals(ctx);
    res.json({ ok: true, signals });
  } catch (err) {
    console.warn('[PREFETCH] failed:', err.message);
    res.json({ ok: false, error: err.message });
  }
});

function buildPrefetchSignals(ctx) {
  if (!ctx) return {};
  const signals = { type: ctx.type };
  if (ctx.type === 'pr') {
    signals.changedFiles = ctx.changedFiles || ctx.files?.length || 0;
    signals.additions = ctx.additions || 0;
    signals.deletions = ctx.deletions || 0;
    signals.draft = ctx.draft || false;
    if (ctx.files) {
      signals.fileTypes = [...new Set(
        ctx.files.map((f) => {
          const ext = f.filename?.split('.').pop();
          return ext || 'other';
        })
      )].slice(0, 20);
      signals.hasMigrations = ctx.files.some((f) =>
        /migrat|schema|flyway|liquibase|alembic/i.test(f.filename || '')
      );
      signals.hasTests = ctx.files.some((f) =>
        /test|spec|__tests__/i.test(f.filename || '')
      );
      signals.hasConfig = ctx.files.some((f) =>
        /config|\.env|\.yml|\.yaml|Dockerfile|Jenkinsfile/i.test(f.filename || '')
      );
    }
  } else if (ctx.type === 'repo') {
    signals.language = ctx.language || '';
    signals.description = ctx.description || '';
    signals.hasReadme = Boolean(ctx.readme);
    signals.manifestCount = ctx.manifests?.length || 0;
    signals.fileCount = ctx.listing?.length || 0;
  } else if (ctx.type === 'file') {
    const ext = ctx.filePath?.split('.').pop() || '';
    signals.extension = ext;
    signals.contentLength = ctx.content?.length || 0;
  }
  return signals;
}

app.use((err, _req, res, _next) => {
  console.error('[RepoLens] Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`\n🔭 RepoLens backend listening on http://localhost:${PORT}`);
  console.log(`   Health:  GET  http://localhost:${PORT}/health`);
  console.log(`   Ask:     POST http://localhost:${PORT}/ask`);
  const provider = getProvider();
  console.log(
    `   Claude:  provider=${provider}` +
      (provider === 'cli'
        ? ' (Claude Code CLI — run `claude auth login` if needed)'
        : hasClaudeAuth()
          ? ' (API key loaded)'
          : ' (MISSING ANTHROPIC_API_KEY)')
  );
  console.log(`   GitHub:  ${hasGithubToken() ? `token loaded (${API_BASE})` : 'MISSING GITHUB_TOKEN'}`);
  console.log(`   Model:   ${DEFAULT_MODEL}\n`);
});
