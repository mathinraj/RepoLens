# RepoLens

Chrome extension that overlays an AI-powered Q&A panel on `github.intuit.com`. Detects repo, PR, file, and commit pages and answers context-aware questions without leaving GitHub.

> **Status:** Phase 3 complete — Instant-mode answers stream from a local backend (GitHub context + Claude).

## Quick start

### 1. Backend

```bash
# One-time: log into enterprise Claude via Claude Code CLI
claude auth login

cd backend
cp .env.example .env
# Edit .env — set GITHUB_TOKEN (Claude uses CLI login; no API key needed)
npm install
npm start
```

Health check: [http://localhost:3847/health](http://localhost:3847/health)

| Env var | Required | Purpose |
|---|---|---|
| `CLAUDE_PROVIDER` | No | `cli` (default, enterprise login) or `api` |
| `GITHUB_TOKEN` | Yes* | Read repos/PRs/files on `github.intuit.com` |
| `ANTHROPIC_API_KEY` | Only if `CLAUDE_PROVIDER=api` | Anthropic Console key |
| `PORT` | No | Default `3847` |
| `CLAUDE_MODEL` | No | Default `claude-sonnet-4-6` |

\*Without `GITHUB_TOKEN`, Instant mode still runs using a DOM page scrape (weaker answers).

**Why CLI?** Enterprise Claude accounts usually cannot mint `sk-ant-…` API keys. Claude Code CLI uses your SSO/login instead. The official Anthropic SDK still needs an API key — it won't help here.

### 2. Extension

1. Chrome → `chrome://extensions` → Developer mode
2. **Load unpacked** → select `RepoLens-extension/`
3. Open a page on [github.intuit.com](https://github.intuit.com)
4. Click the blue RepoLens button → ask a question

## Phase 3 checklist

| Check | What to verify |
|---|---|
| Backend up | `/health` shows `anthropic: true`, `githubToken: true` |
| PR Instant | “Summarize this PR…” streams a real answer |
| Streaming | Tokens appear incrementally in the panel |
| Repo / file / commit | Context-aware answers for each page type |
| No backend | Panel shows a clear “start the backend” error |

## Project layout

```
RepoLens-extension/     # Chrome extension (load unpacked)
backend/                # Express + Claude + GitHub API
plan.md
```

## Dev smoke tests

```bash
node RepoLens-extension/shared/page-detector.test.js
node RepoLens-extension/shared/questions.test.js
```

## Next up

- **Phase 4** — Enhanced mode with broader GitHub context
- **Phase 5** — Prefetch, caching, dynamic questions, polish
