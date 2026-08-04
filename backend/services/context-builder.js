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
const DEEP_CONTEXT_CAP = 300_000;

const ANTI_PREAMBLE = `

OUTPUT RULES (strict):
- Answer the question directly. Start with the answer — no preamble, no filler, no sign-off.
- NEVER narrate your process. Do not write phrases like "Let me...", "I'll look at...", "Let me check/fetch/examine...", "Looking at...", "First, I'll...", "I'm going to...", "Based on my search...".
- NEVER mention tools, fetching, retrieving, Jira, MCP, or that you are an AI/assistant.
- You already have ALL needed context in this message. Do NOT attempt to use tools or fetch anything external.
- If something needed is missing from the provided context, state briefly what is missing in one short clause — do not describe attempts to obtain it.
- Do not restate the question. Do not add "Let me know if..." style closers.`;

function pickSystemPrompt(pageType, mode) {
  const base = PROMPTS[pageType] || PROMPTS.unknown;
  let modeHint = '';
  if (mode === 'deep') {
    modeHint = '\n\nYou are in Deep Context mode with the FULL repository context alongside the PR/page context. Give the most thorough, comprehensive answer possible. Cross-reference between the PR changes and repo structure, README, configs, manifests, and CODEOWNERS. Identify architectural implications, patterns, and potential impacts across the codebase.';
  }
  return base + modeHint + ANTI_PREAMBLE;
}

function formatContextBlock(context, pageScrape, mode) {
  const parts = [];
  const isDeep = mode === 'deep';

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

    // ─── Deep-mode sections ───────────────────────────────────────
    if (isDeep && context.enhanced) {
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

    // ─── Deep-only: merged repo context alongside PR context ─────
    if (isDeep && context.deep && context.repoContext) {
      const rc = context.repoContext;
      parts.push('\n# Repository context\n');

      if (rc.description) {
        parts.push(`**Description:** ${rc.description}\n`);
      }
      if (rc.language) {
        parts.push(`**Primary language:** ${rc.language}`);
      }
      if (rc.topics?.length) {
        parts.push(`**Topics:** ${rc.topics.join(', ')}\n`);
      }

      if (rc.listing?.length) {
        parts.push('\n## Repository file tree\n');
        for (const item of rc.listing) {
          const icon = item.type === 'dir' ? '📁' : '📄';
          parts.push(`- ${icon} ${item.path}`);
        }
      }

      if (rc.readme?.content) {
        parts.push('\n## Repository README\n');
        parts.push(rc.readme.content);
      }

      if (rc.manifests?.length) {
        for (const m of rc.manifests) {
          parts.push(`\n## Repo manifest: ${m.path}\n`);
          parts.push('```');
          parts.push(m.content);
          parts.push('```');
        }
      }

      if (rc.configFiles?.length) {
        parts.push('\n## Repo configuration files\n');
        for (const f of rc.configFiles) {
          parts.push(`### ${f.path}\n`);
          parts.push('```');
          parts.push(f.content);
          parts.push('```\n');
        }
      }

      if (rc.codeowners) {
        parts.push('\n## Repo CODEOWNERS\n');
        parts.push('```');
        parts.push(rc.codeowners);
        parts.push('```');
      }

      if (rc.recentPRs?.length) {
        parts.push('\n## Recent merged PRs in repo\n');
        for (const pr of rc.recentPRs) {
          parts.push(`- #${pr.number} "${pr.title}" by ${pr.user} (merged ${pr.mergedAt})`);
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

  const cap = isDeep ? DEEP_CONTEXT_CAP : INSTANT_CONTEXT_CAP;
  const label = isDeep ? 'Deep' : 'Instant';
  let text = parts.join('\n');
  if (text.length > cap) {
    text = `${text.slice(0, cap)}\n\n…[context truncated for ${label} mode]`;
  }
  return text;
}

/** Strip bulky fields already rendered as raw text sections */
function summarizeForPrompt(context) {
  const clone = { ...context };
  delete clone.diff;
  delete clone.content;

  delete clone.fullFileContents;
  delete clone.configFiles;
  delete clone.codeowners;
  delete clone.repoContext;

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
 *   mode: 'instant'|'deep',
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
