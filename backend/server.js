/**
 * RepoLens local backend — Express entry point.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const askRouter = require('./routes/ask');
const { hasClaudeAuth, getProvider, DEFAULT_MODEL } = require('./services/claude');
const { hasGithubToken, API_BASE } = require('./services/github-mcp');

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
  if (req.path !== '/health') {
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
