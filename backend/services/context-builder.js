/**
 * Assembles Claude system + user messages from GitHub context + question.
 */

const repoPrompt = require('../prompts/repo');
const prPrompt = require('../prompts/pr');
const filePrompt = require('../prompts/file');
const commitPrompt = require('../prompts/commit');

const PROMPTS = {
  repo: repoPrompt,
  pr: prPrompt,
  file: filePrompt,
  commit: commitPrompt,
  unknown: repoPrompt,
};

const INSTANT_CONTEXT_CAP = 60_000;

function pickSystemPrompt(pageType) {
  return PROMPTS[pageType] || PROMPTS.unknown;
}

function formatContextBlock(context, pageScrape) {
  const parts = [];

  if (context) {
    parts.push('## GitHub context');
    parts.push('```json');
    parts.push(JSON.stringify(summarizeForPrompt(context), null, 2));
    parts.push('```');

    // Prefer raw text bodies outside JSON for readability / token efficiency
    if (context.readme?.content) {
      parts.push('\n## README\n');
      parts.push(context.readme.content);
    }
    if (context.manifests?.length) {
      for (const m of context.manifests) {
        parts.push(`\n## ${m.path}\n`);
        parts.push('```');
        parts.push(m.content);
        parts.push('```');
      }
    }
    if (context.diff) {
      parts.push('\n## Diff\n');
      parts.push('```diff');
      parts.push(context.diff);
      parts.push('```');
    }
    if (context.type === 'file' && context.content) {
      parts.push(`\n## File: ${context.filePath}\n`);
      parts.push('```');
      parts.push(context.content);
      parts.push('```');
    }
    if (context.body && context.type === 'pr') {
      parts.push('\n## PR description\n');
      parts.push(context.body);
    }
    if (context.message && context.type === 'commit') {
      parts.push('\n## Commit message\n');
      parts.push(context.message);
    }
  }

  if (pageScrape && Object.keys(pageScrape).length) {
    parts.push('\n## Page scrape (from the browser)\n');
    parts.push('```json');
    parts.push(JSON.stringify(pageScrape, null, 2));
    parts.push('```');
  }

  let text = parts.join('\n');
  if (text.length > INSTANT_CONTEXT_CAP) {
    text = `${text.slice(0, INSTANT_CONTEXT_CAP)}\n\n…[context truncated for Instant mode]`;
  }
  return text;
}

/** Strip bulky fields already rendered as raw text sections */
function summarizeForPrompt(context) {
  const clone = { ...context };
  delete clone.diff;
  delete clone.content;
  if (clone.readme) {
    clone.readme = { path: clone.readme.path, chars: clone.readme.content?.length || 0 };
  }
  if (clone.manifests) {
    clone.manifests = clone.manifests.map((m) => ({
      path: m.path,
      chars: m.content?.length || 0,
    }));
  }
  if (clone.body) clone.body = truncate(clone.body, 2_000);
  if (clone.message) clone.message = truncate(clone.message, 1_000);
  if (Array.isArray(clone.listing)) {
    clone.listing = clone.listing.slice(0, 80);
  }
  if (Array.isArray(clone.files) && clone.files.length > 80) {
    clone.files = clone.files.slice(0, 80);
    clone.filesTruncated = true;
  }
  return clone;
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  return `${text.slice(0, max)}…`;
}

/**
 * @param {{
 *   pageType: string,
 *   question: string,
 *   mode: 'instant'|'enhanced',
 *   githubContext: object|null,
 *   pageScrape?: object|null,
 *   page?: object|null
 * }} input
 */
function buildMessages(input) {
  const {
    pageType,
    question,
    mode = 'instant',
    githubContext,
    pageScrape,
    page,
  } = input;

  const system = pickSystemPrompt(pageType);
  const contextBlock = formatContextBlock(githubContext, pageScrape);

  const pageLine = page
    ? `Page: type=${page.type || pageType}` +
      (page.org ? ` org=${page.org}` : '') +
      (page.repo ? ` repo=${page.repo}` : '') +
      (page.prNumber != null ? ` pr=#${page.prNumber}` : '') +
      (page.filePath ? ` file=${page.filePath}` : '') +
      (page.sha ? ` sha=${page.sha}` : '') +
      (page.branch ? ` branch=${page.branch}` : '')
    : `Page type: ${pageType}`;

  const userContent = [
    pageLine,
    `Mode: ${mode}`,
    '',
    contextBlock || '(No GitHub context available — answer cautiously from the question alone.)',
    '',
    '## Question',
    question,
  ].join('\n');

  return {
    system,
    messages: [{ role: 'user', content: userContent }],
  };
}

module.exports = { buildMessages, pickSystemPrompt, formatContextBlock };
