const express = require('express');
const { getInstantContext, getEnhancedContext, hasGithubToken } = require('../services/github-mcp');
const { buildMessages } = require('../services/context-builder');
const { streamCompletion, hasClaudeAuth, getProvider, DEFAULT_MODEL } = require('../services/claude');
const { cache } = require('../cache/memory-cache');

const router = express.Router();

const ANSWER_CACHE_TTL = 5 * 60 * 1000;

function pageKey(page) {
  if (!page?.org || !page?.repo) return null;
  const parts = [page.org, page.repo];
  if (page.prNumber != null) parts.push(`pr${page.prNumber}`);
  if (page.filePath) parts.push(page.filePath);
  if (page.sha) parts.push(page.sha);
  return parts.join('/');
}

function answerCacheKey(page, question, mode) {
  const pk = pageKey(page);
  if (!pk) return null;
  return `answer:${pk}:${mode}:${question}`;
}

/**
 * POST /ask
 * Body: { pageType, org, repo, prNumber?, filePath?, branch?, sha?, question, mode, pageScrape?, cacheable? }
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
    cacheable = false,
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

  // Check answer cache for cacheable (chip) questions
  const aCacheKey = cacheable ? answerCacheKey(resolvedPage, q, resolvedMode) : null;
  if (aCacheKey) {
    const cached = cache.get(aCacheKey);
    if (cached) {
      console.log(`[ASK] Answer cache HIT for "${q.slice(0, 40)}"`);
      res.json(cached);
      return;
    }
  }

  try {
    let githubContext = null;
    let contextError = null;

    if (hasGithubToken() && resolvedPage.org && resolvedPage.repo) {
      const contextPage = {
        pageType: resolvedType,
        org: resolvedPage.org,
        repo: resolvedPage.repo,
        prNumber: resolvedPage.prNumber ?? prNumber,
        filePath: resolvedPage.filePath ?? filePath,
        branch: resolvedPage.branch ?? branch,
        sha: resolvedPage.sha ?? sha,
      };
      try {
        if (resolvedMode === 'enhanced') {
          console.log('[ASK] Fetching enhanced context…');
          githubContext = await getEnhancedContext(contextPage);
        } else {
          githubContext = await getInstantContext(contextPage);
        }
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

    const response = {
      ok: true,
      answer: result.fullText,
      meta: {
        model: result.model || DEFAULT_MODEL,
        mode: resolvedMode,
        provider: result.provider || getProvider(),
        hasGithubContext: Boolean(githubContext),
        contextError,
        cached: false,
      },
    };

    // Cache the answer for chip questions
    if (aCacheKey) {
      const cachedResponse = { ...response, meta: { ...response.meta, cached: true } };
      cache.set(aCacheKey, cachedResponse, ANSWER_CACHE_TTL);
    }

    res.json(response);
  } catch (err) {
    console.error('[RepoLens] /ask error:', err?.message || err);
    const status = err.status || 500;
    const isRateLimit = status === 429 || /rate.limit/i.test(err.message || '');
    res.status(status).json({
      error: isRateLimit
        ? 'Claude is rate-limited. Please wait a moment and try again.'
        : (err.message || 'Ask failed'),
      retryable: isRateLimit || status >= 500,
    });
  }
});

module.exports = router;
