# RepoLens

Chrome extension that overlays an AI-powered Q&A panel on `github.intuit.com`. Detects repo, PR, file, and commit pages and answers context-aware questions without leaving GitHub.

> **Status:** Phase 2 complete — context-aware question chips, free-text ask, Instant/Enhanced mode toggle. Answers are stubbed until Phase 3 backend.

## Load the extension (unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** (or **Reload** if already loaded)
4. Select the `RepoLens-extension/` folder in this repo
5. Open any page on [github.intuit.com](https://github.intuit.com)
6. Click the blue **RepoLens** button (bottom-right)

## Phase 2 checklist

| Check | What to verify |
|---|---|
| PR page | Panel shows PR questions (Summarize, impact/risk, tests, …) |
| Repo home | Panel shows repo questions (what does it do, tech stack, …) |
| File / commit | Matching question chips for that page type |
| Chip click | Skeleton → stub answer with page context |
| Free-text | Type a question + Enter / Send works |
| Mode toggle | Instant / Enhanced switch; choice persists |
| Enhance | After Instant stub, button re-asks in Enhanced mode |
| Navigation | Chips update when you move between page types |

## Project layout

```
RepoLens-extension/        # Load this folder in Chrome
├── manifest.json
├── content/               # Overlay button + page detection
├── sidepanel/             # Q&A panel (Phase 2 UI)
├── background/            # Service worker (ASK stub)
├── shared/                # Detector, questions, constants
└── icons/
```

## Dev smoke tests

```bash
node RepoLens-extension/shared/page-detector.test.js
node RepoLens-extension/shared/questions.test.js
```

## Next up

- **Phase 3** — Local backend + Instant-mode Claude streaming answers
- **Phase 4** — Enhanced mode with broader GitHub MCP context
- **Phase 5** — Prefetch, caching, dynamic questions, polish
