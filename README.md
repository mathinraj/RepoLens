# RepoLens

Chrome extension that overlays an AI-powered Q&A panel on `github.intuit.com`. Detects repo, PR, file, and commit pages and answers context-aware questions without leaving GitHub.

> **Status:** Phase 1 complete — page detection + floating overlay button + side panel stub.

## Load the extension (unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `RepoLens-extension/` folder in this repo
5. Open any page on [github.intuit.com](https://github.intuit.com)
6. You should see the blue **RepoLens** button (bottom-right)

Click the button to open the side panel and confirm the detected page type (repo / PR / file / commit).

## Phase 1 checklist

| Check | What to verify |
|---|---|
| Repo home | Badge shows `REPO`, tooltip shows `org/repo` |
| PR page | Badge shows `#852` (or PR number), tooltip `PR #852` |
| File view | Badge shows `FILE`, tooltip `File: <filename>` |
| Commit view | Badge shows `SHA`, tooltip `Commit <shortsha>` |
| SPA nav | Navigate within GHE without full reload — badge updates |
| Side panel | FAB click opens panel with detected page details |

## Project layout

```
RepoLens-extension/        # Load this folder in Chrome
├── manifest.json
├── content/               # Overlay button + page scrape hook
├── sidepanel/             # Q&A panel (stub in Phase 1)
├── background/            # Service worker
├── shared/                # Page detector + constants
└── icons/
```

## Dev smoke test

```bash
node RepoLens-extension/shared/page-detector.test.js
```

## Next up

- **Phase 2** — Question chips + free-text input in the panel
- **Phase 3** — Local backend + Instant-mode Claude answers
- **Phase 4** — Enhanced mode
- **Phase 5** — Prefetch, caching, polish
