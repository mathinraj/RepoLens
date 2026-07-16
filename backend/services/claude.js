/**
 * Claude client for RepoLens.
 *
 * Providers:
 *   - cli (default): Claude Code CLI — uses your enterprise Claude login
 *                    (no ANTHROPIC_API_KEY needed)
 *   - api:           Anthropic Messages API — needs ANTHROPIC_API_KEY
 *
 * Set CLAUDE_PROVIDER=cli|api in backend/.env
 */

const { spawn } = require('child_process');

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const PROVIDER = (process.env.CLAUDE_PROVIDER || 'cli').toLowerCase();
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
}

function getProvider() {
  if (PROVIDER === 'api') return 'api';
  if (PROVIDER === 'cli') return 'cli';
  // Auto: prefer API key if present, otherwise CLI
  return getApiKey() ? 'api' : 'cli';
}

function hasClaudeAuth() {
  if (getProvider() === 'api') return Boolean(getApiKey());
  return true; // CLI uses local login; validated at request time
}

/**
 * Stream text deltas from Claude.
 * @param {{ system: string, messages: object[], maxTokens?: number, model?: string }} opts
 * @param {{ onChunk: (text: string) => void, signal?: AbortSignal }} handlers
 */
async function streamCompletion(opts, handlers = {}) {
  const provider = getProvider();
  if (provider === 'api') {
    return streamViaApi(opts, handlers);
  }
  return streamViaCli(opts, handlers);
}

// ─── Claude Code CLI (enterprise login) ─────────────────────────────────────

async function streamViaCli(opts, handlers = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const userText = (opts.messages || [])
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n\n');

  // Important: do NOT pass ANTHROPIC_API_KEY to the CLI child.
  // An API key forces Console billing and breaks enterprise SSO login.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_API_KEY;

  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--system-prompt',
    opts.system || 'You are RepoLens, an AI assistant embedded in GitHub.',
    '--model',
    model,
  ];

  console.log(`[Claude CLI] Spawning: ${CLAUDE_BIN} ${args.join(' ').slice(0, 120)}`);
  console.log(`[Claude CLI] Prompt length: ${userText.length} chars`);
  const startMs = Date.now();

  const child = spawn(CLAUDE_BIN, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdin.on('error', (err) => {
    console.warn(`[Claude CLI] stdin error: ${err.message}`);
  });

  const onAbort = () => {
    console.log('[Claude CLI] Aborting child process');
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  };
  if (handlers.signal) {
    if (handlers.signal.aborted) {
      console.warn('[Claude CLI] Signal already aborted before spawn!');
      onAbort();
    } else {
      handlers.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  child.stdin.write(userText);
  child.stdin.end();

  let fullText = '';
  let stderr = '';
  let buffer = '';

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    console.log(`[Claude CLI] stderr: ${text.trim().slice(0, 200)}`);
  });

  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          // Non-JSON line — treat as plain text fallback
          if (!trimmed.startsWith('{')) {
            fullText += `${trimmed}\n`;
            if (handlers.onChunk) handlers.onChunk(`${trimmed}\n`);
          }
          continue;
        }

        const delta = extractCliTextDelta(event);
        if (delta) {
          fullText += delta;
          if (handlers.onChunk) handlers.onChunk(delta);
        }
      }
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          Object.assign(
            new Error(
              `Claude CLI not found ("${CLAUDE_BIN}"). Install Claude Code or set CLAUDE_BIN.`
            ),
            { status: 500 }
          )
        );
        return;
      }
      reject(err);
    });

    child.on('close', (code, signal) => {
      const elapsed = Date.now() - startMs;
      console.log(`[Claude CLI] Exited code=${code} signal=${signal} elapsed=${elapsed}ms textLen=${fullText.length}`);
      if (stderr.trim()) {
        console.log(`[Claude CLI] Full stderr: ${stderr.trim().slice(0, 500)}`);
      }

      if (handlers.signal?.aborted) {
        resolve();
        return;
      }
      if (code !== 0 && !fullText) {
        const hint = stderr.trim().slice(0, 500) || `claude exited with code ${code}`;
        const needsAuth = /auth login|re-authenticate|not.*logged|unauthorized|managed settings/i.test(hint);
        reject(
          Object.assign(
            new Error(
              needsAuth
                ? `Claude CLI auth failed. Run: claude auth login\n${hint}`
                : `Claude CLI failed (exit ${code}): ${hint}`
            ),
            { status: needsAuth ? 401 : 500 }
          )
        );
        return;
      }
      resolve();
    });
  });

  if (!fullText.trim()) {
    throw Object.assign(
      new Error(
        'Claude CLI returned an empty answer. Try: claude auth login && claude /status'
      ),
      { status: 502 }
    );
  }

  return { fullText, model, provider: 'cli', usage: undefined };
}

/**
 * Parse Claude Code stream-json events into text deltas.
 * Format varies slightly by CLI version — be defensive.
 */
function extractCliTextDelta(event) {
  if (!event || typeof event !== 'object') return '';

  // stream-json assistant message content blocks
  if (event.type === 'assistant' && event.message?.content) {
    return event.message.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('');
  }

  // content_block_delta (API-shaped)
  if (
    event.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta' &&
    event.delta.text
  ) {
    return event.delta.text;
  }

  // Some versions emit { type: 'text', text: '...' }
  if (event.type === 'text' && typeof event.text === 'string') {
    return event.text;
  }

  // Result event sometimes has the full result (avoid double-counting if we streamed)
  // Skip 'result' — we accumulate deltas instead.

  // Nested delta
  if (typeof event.delta === 'string') return event.delta;
  if (typeof event.text === 'string' && event.type === 'stream_event') {
    return event.text;
  }

  return '';
}

// ─── Anthropic Messages API (optional) ──────────────────────────────────────

async function streamViaApi(opts, handlers = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw Object.assign(
      new Error('ANTHROPIC_API_KEY is not set (CLAUDE_PROVIDER=api)'),
      { status: 500 }
    );
  }

  const model = opts.model || DEFAULT_MODEL;
  const maxTokens =
    opts.maxTokens || Number(process.env.CLAUDE_MAX_TOKENS_INSTANT || 2048);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: opts.system,
      messages: opts.messages,
      stream: true,
    }),
    signal: handlers.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Claude API ${res.status}: ${body.slice(0, 400) || res.statusText}`),
      { status: res.status }
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let usage;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        typeof event.delta.text === 'string'
      ) {
        fullText += event.delta.text;
        if (handlers.onChunk) handlers.onChunk(event.delta.text);
      }
      if (event.type === 'message_delta' && event.usage) {
        usage = { ...usage, ...event.usage };
      }
      if (event.type === 'message_start' && event.message?.usage) {
        usage = { ...usage, ...event.message.usage };
      }
    }
  }

  return { fullText, model, provider: 'api', usage };
}

module.exports = {
  streamCompletion,
  hasClaudeAuth,
  hasAnthropicKey: hasClaudeAuth, // backwards-compatible alias
  getProvider,
  DEFAULT_MODEL,
};
