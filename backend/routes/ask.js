const express = require('express');
const { getInstantContext, hasGithubToken } = require('../services/github-mcp');
const { buildMessages } = require('../services/context-builder');
const { streamCompletion, hasClaudeAuth, getProvider, DEFAULT_MODEL } = require('../services/claude');

const router = express.Router();

/**
 * POST /ask
 * Body: { pageType, org, repo, prNumber?, filePath?, branch?, sha?, question, mode, pageScrape? }
 * Response: JSON with { answer, meta }
 */
router.post('/', async (req, res) => {
  const {
    pageType = 'unknown',
    org,
    repo,
    prNumber,
    filePath,
    branch,
    sha,
    question,
    mode = 'instant',
    pageScrape,
    page,
  } = req.body || {};

  const q = String(question || '').trim();
  console.log(`[ASK] question="${q.slice(0, 60)}" mode=${mode} page=${pageType} org=${org} repo=${repo}`);

  if (!q) {
    res.status(400).json({ error: 'question is required' });
    return;
  }

  if (!hasClaudeAuth()) {
    res.status(500).json({
      error:
        getProvider() === 'api'
          ? 'ANTHROPIC_API_KEY is not configured (CLAUDE_PROVIDER=api)'
          : 'Claude auth not available. Run: claude auth login',
    });
    return;
  }

  const resolvedMode = mode === 'enhanced' ? 'enhanced' : 'instant';
  const resolvedPage = page || {
    type: pageType,
    org,
    repo,
    prNumber,
    filePath,
    branch,
    sha,
  };
  const resolvedType = resolvedPage.type || pageType;

  try {
    let githubContext = null;
    let contextError = null;

    if (hasGithubToken() && resolvedPage.org && resolvedPage.repo) {
      try {
        githubContext = await getInstantContext({
          pageType: resolvedType,
          org: resolvedPage.org,
          repo: resolvedPage.repo,
          prNumber: resolvedPage.prNumber ?? prNumber,
          filePath: resolvedPage.filePath ?? filePath,
          branch: resolvedPage.branch ?? branch,
          sha: resolvedPage.sha ?? sha,
        });
      } catch (err) {
        contextError = err.message || String(err);
        console.warn('[RepoLens] GitHub context failed:', contextError);
      }
    } else if (!hasGithubToken()) {
      console.log('[ASK] No GITHUB_TOKEN — using page scrape only');
    }

    const { system, messages } = buildMessages({
      pageType: resolvedType,
      question: q,
      mode: resolvedMode,
      githubContext,
      pageScrape: pageScrape || null,
      page: resolvedPage,
    });

    const maxTokens =
      resolvedMode === 'enhanced'
        ? Number(process.env.CLAUDE_MAX_TOKENS_ENHANCED || 4096)
        : Number(process.env.CLAUDE_MAX_TOKENS_INSTANT || 2048);

    console.log('[ASK] Calling Claude…');

    const result = await streamCompletion(
      { system, messages, maxTokens },
      { onChunk: null }
    );

    console.log(`[ASK] Done — ${result.fullText.length} chars`);

    res.json({
      ok: true,
      answer: result.fullText,
      meta: {
        model: result.model || DEFAULT_MODEL,
        mode: resolvedMode,
        provider: result.provider || getProvider(),
        hasGithubContext: Boolean(githubContext),
        contextError,
      },
    });
  } catch (err) {
    console.error('[RepoLens] /ask error:', err?.message || err);
    res.status(err.status || 500).json({
      error: err.message || 'Ask failed',
    });
  }
});

module.exports = router;
