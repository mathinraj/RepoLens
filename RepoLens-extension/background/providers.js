/**
 * LLM provider adapters (Anthropic, OpenAI, Gemini) behind one interface:
 *   streamCompletion(providerId, { apiKey, system, messages, maxTokens, model }, { onChunk, signal })
 *   listModels(providerId, apiKey)
 * All calls use the user's own key, straight from the browser.
 */
(function (root) {
  const { PROVIDERS } = root.REPOLENS;

  function httpError(message, status) {
    return Object.assign(new Error(message.trim()), {
      status,
      retryable: status === 429 || status >= 500,
    });
  }

  /** Map an HTTP failure to a user-facing message. */
  async function apiError(res, providerLabel, extractDetail) {
    const body = await res.text().catch(() => '');
    let detail = '';
    try {
      detail = extractDetail(JSON.parse(body)) || '';
    } catch {
      detail = body.slice(0, 300);
    }
    const s = res.status;
    if (s === 401 || (s === 400 && /api key not valid|invalid api key|api_key_invalid/i.test(detail))) {
      return httpError(`${providerLabel} API key is invalid. Update it in RepoLens Preferences.`, 401);
    }
    if (s === 403) return httpError(`${providerLabel} API key lacks permission. ${detail}`, s);
    if (s === 404) return httpError(`Model not available for this ${providerLabel} key. Pick another in Preferences. ${detail}`, s);
    if (s === 429) {
      return /quota|billing|insufficient/i.test(detail)
        ? httpError(`${providerLabel} quota exceeded or billing not set up. ${detail}`, 402)
        : httpError(`${providerLabel} is rate-limited. Please wait a moment and try again.`, s);
    }
    if (s === 529 || s === 503) return httpError(`${providerLabel} is overloaded right now. Please try again shortly.`, s);
    return httpError(`${providerLabel} API ${s}: ${detail || res.statusText}`, s);
  }

  /** Yield parsed JSON payloads from an SSE response body. */
  async function* readSse(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
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
        try {
          yield JSON.parse(payload);
        } catch {
          // ignore partial / non-JSON lines
        }
      }
    }
  }

  // ─── Anthropic ──────────────────────────────────────────────────────────────

  const anthropic = {
    label: 'Anthropic',
    headers(apiKey) {
      return {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    },
    detail: (j) => j?.error?.message,

    async stream({ apiKey, system, messages, maxTokens, model }, { onChunk, signal }) {
      const res = await fetch(`${PROVIDERS.anthropic.apiBase}/v1/messages`, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true }),
        signal,
      });
      if (!res.ok) throw await apiError(res, this.label, this.detail);

      let fullText = '';
      for await (const event of readSse(res)) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text;
          onChunk?.(event.delta.text);
        } else if (event.type === 'error') {
          throw httpError(event.error?.message || 'Anthropic stream error', 500);
        }
      }
      return fullText;
    },

    async listModels(apiKey) {
      const res = await fetch(`${PROVIDERS.anthropic.apiBase}/v1/models?limit=100`, {
        headers: this.headers(apiKey),
      });
      if (!res.ok) throw await apiError(res, this.label, this.detail);
      const data = await res.json();
      return (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
    },
  };

  // ─── OpenAI ─────────────────────────────────────────────────────────────────

  // /v1/models also returns embeddings, audio, image, moderation, etc.
  const OPENAI_CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/i;
  const OPENAI_NON_CHAT = /audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|dall-e|whisper|codex|computer-use|-\d{4}-\d{2}-\d{2}$/i;

  const openai = {
    label: 'OpenAI',
    headers(apiKey) {
      return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
    },
    detail: (j) => j?.error?.message,

    async stream({ apiKey, system, messages, maxTokens, model }, { onChunk, signal }) {
      const res = await fetch(`${PROVIDERS.openai.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          model,
          // max_completion_tokens includes reasoning tokens on o-series models.
          max_completion_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
          stream: true,
        }),
        signal,
      });
      if (!res.ok) throw await apiError(res, this.label, this.detail);

      let fullText = '';
      for await (const event of readSse(res)) {
        if (event.error) throw httpError(event.error.message || 'OpenAI stream error', 500);
        const text = event.choices?.[0]?.delta?.content;
        if (text) {
          fullText += text;
          onChunk?.(text);
        }
      }
      return fullText;
    },

    async listModels(apiKey) {
      const res = await fetch(`${PROVIDERS.openai.apiBase}/v1/models`, { headers: this.headers(apiKey) });
      if (!res.ok) throw await apiError(res, this.label, this.detail);
      const data = await res.json();
      return (data.data || [])
        .filter((m) => OPENAI_CHAT_MODEL.test(m.id) && !OPENAI_NON_CHAT.test(m.id))
        .sort((a, b) => (b.created || 0) - (a.created || 0))
        .map((m) => ({ id: m.id, label: m.id }));
    },
  };

  // ─── Google Gemini ──────────────────────────────────────────────────────────

  const GEMINI_NON_CHAT = /embedding|aqa|imagen|image|tts|audio|live|veo|learnlm|robotics/i;

  const gemini = {
    label: 'Gemini',
    headers(apiKey) {
      return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
    },
    detail: (j) => j?.error?.message,

    async stream({ apiKey, system, messages, maxTokens, model }, { onChunk, signal }) {
      const url = `${PROVIDERS.gemini.apiBase}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          // Thinking tokens count against maxOutputTokens on 2.5+ models.
          generationConfig: { maxOutputTokens: maxTokens },
        }),
        signal,
      });
      if (!res.ok) throw await apiError(res, this.label, this.detail);

      let fullText = '';
      let blockReason = '';
      for await (const event of readSse(res)) {
        if (event.error) throw httpError(event.error.message || 'Gemini stream error', 500);
        if (event.promptFeedback?.blockReason) blockReason = event.promptFeedback.blockReason;
        const parts = event.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text && !part.thought) {
            fullText += part.text;
            onChunk?.(part.text);
          }
        }
      }
      if (!fullText && blockReason) {
        throw httpError(`Gemini blocked this request (${blockReason}).`, 400);
      }
      return fullText;
    },

    async listModels(apiKey) {
      const res = await fetch(`${PROVIDERS.gemini.apiBase}/v1beta/models?pageSize=1000`, {
        headers: this.headers(apiKey),
      });
      if (!res.ok) throw await apiError(res, this.label, this.detail);
      const data = await res.json();
      return (data.models || [])
        .filter(
          (m) =>
            (m.supportedGenerationMethods || []).includes('generateContent') &&
            /gemini/i.test(m.name) &&
            !GEMINI_NON_CHAT.test(m.name)
        )
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
    },
  };

  const ADAPTERS = { anthropic, openai, gemini };

  function adapter(providerId) {
    const a = ADAPTERS[providerId];
    if (!a) throw new Error(`Unknown AI provider: ${providerId}`);
    return a;
  }

  /**
   * @returns {Promise<{ fullText: string, model: string, provider: string }>}
   */
  async function streamCompletion(providerId, opts, handlers = {}) {
    const fullText = await adapter(providerId).stream(opts, handlers);
    return { fullText, model: opts.model, provider: providerId };
  }

  function listModels(providerId, apiKey) {
    return adapter(providerId).listModels(apiKey);
  }

  root.RepoLensProviders = { streamCompletion, listModels };
})(globalThis);
