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
const ENHANCED_CONTEXT_CAP = 150_000;

function pickSystemPrompt(pageType, mode) {
  const base = PROMPTS[pageType] || PROMPTS.unknown;
  if (mode === 'enhanced') {
    return base + '\n\nYou are in Enhanced mode with broader repository context. Give a thorough, in-depth answer. Reference specific files, code patterns, and cross-cutting concerns when relevant.';
  }
  return base;
}

function formatContextBlock(context, pageScrape, mode) {
  const parts = [];
  const isEnhanced = mode === 'enhanced';

  if (context) {
    parts.push('## GitHub context');
    parts.push('```json');
    parts.push(JSON.stringify(summarizeForPrompt(context), null, 2));
    parts.push('```');

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

    // ─── Enhanced-only sections ──────────────────────────────────
    if (isEnhanced && context.enhanced) {
      if (context.fullFileContents?.length) {
        parts.push('\n## Full content of changed files\n');
        for (const f of context.fullFileContents) {
          parts.push(`### ${f.path}\n`);
          parts.push('```');
          parts.push(f.content);
          parts.push('```\n');
        }
      }

      if (context.reviewComments?.length) {
        parts.push('\n## PR review comments\n');
        for (const c of context.reviewComments) {
          const loc = c.path ? ` (${c.path}${c.line ? `:${c.line}` : ''})` : '';
          parts.push(`- **${c.user}**${loc}: ${c.body}`);
        }
      }

      if (context.issueComments?.length) {
        parts.push('\n## PR conversation comments\n');
        for (const c of context.issueComments) {
          parts.push(`- **${c.user}**: ${c.body}`);
        }
      }

      if (context.linkedIssues?.length) {
        parts.push('\n## Linked issues\n');
        for (const issue of context.linkedIssues) {
          const labels = issue.labels?.length ? ` [${issue.labels.join(', ')}]` : '';
          parts.push(`### #${issue.number}: ${issue.title}${labels}\n`);
          if (issue.body) parts.push(issue.body + '\n');
        }
      }

      if (context.configFiles?.length) {
        parts.push('\n## Configuration files\n');
        for (const f of context.configFiles) {
          parts.push(`### ${f.path}\n`);
          parts.push('```');
          parts.push(f.content);
          parts.push('```\n');
        }
      }

      if (context.codeowners) {
        parts.push('\n## CODEOWNERS\n');
        parts.push('```');
        parts.push(context.codeowners);
        parts.push('```');
      }

      if (context.recentPRs?.length) {
        parts.push('\n## Recent merged PRs\n');
        for (const pr of context.recentPRs) {
          parts.push(`- #${pr.number} "${pr.title}" by ${pr.user} (merged ${pr.mergedAt})`);
        }
      }

      if (context.importers?.length) {
        parts.push('\n## Files that reference this file\n');
        for (const imp of context.importers) {
          parts.push(`- ${imp.path}`);
        }
      }

      if (context.recentCommits?.length) {
        parts.push('\n## Recent commits touching this file\n');
        for (const c of context.recentCommits) {
          parts.push(`- \`${c.sha}\` ${c.message} — ${c.author} (${c.date})`);
        }
      }
    }
  }

  if (pageScrape && Object.keys(pageScrape).length) {
    parts.push('\n## Page scrape (from the browser)\n');
    parts.push('```json');
    parts.push(JSON.stringify(pageScrape, null, 2));
    parts.push('```');
  }

  const cap = isEnhanced ? ENHANCED_CONTEXT_CAP : INSTANT_CONTEXT_CAP;
  let text = parts.join('\n');
  if (text.length > cap) {
    const label = isEnhanced ? 'Enhanced' : 'Instant';
    text = `${text.slice(0, cap)}\n\n…[context truncated for ${label} mode]`;
  }
  return text;
}

/** Strip bulky fields already rendered as raw text sections */
function summarizeForPrompt(context) {
  const clone = { ...context };
  delete clone.diff;
  delete clone.content;

  // Enhanced-only bulky fields rendered separately
  delete clone.fullFileContents;
  delete clone.configFiles;
  delete clone.codeowners;

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

  const system = pickSystemPrompt(pageType, mode);
  const contextBlock = formatContextBlock(githubContext, pageScrape, mode);

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
