/**
 * Strips generic assistant "process narration" preamble from answers so the
 * panel shows only the substantive response.
 *
 * Targets things like:
 *   "Let me look at the PR..."   "I'll fetch the Jira ticket..."
 *   "Looking at the diff..."      "First, let me check the files..."
 *   "I tried to fetch ... but"    "Sure! Here's..."
 */

// A leading line is narration if it matches any of these.
const NARRATION_LINE = [
  /^(let me|let's|lets)\b/i,
  /^(i'?ll|i will|i'?m going to|i am going to|i'?d like to|i want to)\b/i,
  /^(first,?\s+(let me|i'?ll|i will))\b/i,
  /^(now,?\s+(let me|i'?ll|i will))\b/i,
  /^(looking at|let me look|let me check|let me examine|let me analyze|let me review|let me start|let me search|let me fetch|let me pull|let me gather|let me dig|let me explore)\b/i,
  /^(i need to|i'?ll need to|i should|allow me to)\b/i,
  /^(i (?:tried|have tried|'?ve tried|attempted|was unable|wasn'?t able|can'?t|cannot|couldn'?t|don'?t have|do not have)\b.*\b(fetch|access|retriev|find|load|read|open|jira|ticket|tool|mcp|api)\b)/i,
  /^(sure|okay|ok|alright|great|certainly|of course|got it|understood)[\s!,.:-]+(let me|i'?ll|i will|here|so\b)/i,
  /^(here'?s (?:what|my|the) (?:i|analysis|breakdown|summary)\b)/i,
];

// A leading SENTENCE (within the first paragraph) that is pure narration.
const NARRATION_SENTENCE =
  /^((?:let me|let's|i'?ll|i will|i'?m going to|first,?\s+let me|now,?\s+let me|looking at|let me (?:look|check|examine|analyze|review|fetch|pull|gather|search|start|explore))[^.!?\n]*[.!?]+)\s+/i;

function isNarrationLine(line) {
  const t = line.trim();
  if (!t) return false;
  return NARRATION_LINE.some((re) => re.test(t));
}

// If a narration line carries real content after a ":"/"." split, keep that
// remainder instead of dropping the whole line.
function remainderAfterNarration(line) {
  const t = line.trim();
  const m = t.match(/^[^:.!?\n]*[:.!?]\s+(.*)$/);
  if (m && m[1] && m[1].trim().length >= 25) return m[1].trim();
  return null;
}

/**
 * @param {string} text
 * @returns {string}
 */
function sanitizeAnswer(text) {
  if (!text || typeof text !== 'string') return text || '';

  const original = text;
  let lines = text.replace(/\r\n/g, '\n').split('\n');

  // Drop leading blank + full narration lines (but keep any real trailing content).
  while (lines.length) {
    const first = lines[0].trim();
    if (first === '') {
      lines.shift();
      continue;
    }
    if (isNarrationLine(first)) {
      const remainder = remainderAfterNarration(first);
      if (remainder) {
        lines[0] = remainder; // keep the substantive part, stop stripping
        break;
      }
      lines.shift();
      continue;
    }
    break;
  }

  let out = lines.join('\n').trim();

  // Strip up to two leading narration sentences that share the first paragraph
  // with real content (e.g. "Let me summarize. This PR adds X.").
  for (let i = 0; i < 2; i += 1) {
    const stripped = out.replace(NARRATION_SENTENCE, '');
    if (stripped === out) break;
    out = stripped.trimStart();
  }

  // If sanitizing nuked everything, fall back to the original.
  if (!out.trim()) return original.trim();

  return out;
}

module.exports = { sanitizeAnswer };
