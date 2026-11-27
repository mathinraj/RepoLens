# Chrome Web Store submission kit

**Live listing:** <https://chromewebstore.google.com/detail/repolens-%E2%80%93-ai-answers-for/khjmcbpiaknmadpolbifmjacjieeogci> (item ID `khjmcbpiaknmadpolbifmjacjieeogci`).

Copy-paste text for each field in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), plus the assets still to produce.

## Upload

```bash
scripts/build-zip.sh        # → dist/repolens-<version>-chrome.zip and dist/repolens-<version>-edge.zip
```

Upload the `-chrome` zip to the Chrome Web Store and the `-edge` zip to Microsoft Edge Add-ons. The listing text below works for both stores.

## Releasing a new version

1. Bump `version` in `RepoLens-extension/manifest.json` (e.g. `1.0.1`).
2. `scripts/build-zip.sh` → `dist/repolens-<version>-chrome.zip` and `dist/repolens-<version>-edge.zip`.
3. Upload each zip to its store and submit for review.
4. **After the stores approve it**, publish a GitHub release at <https://github.com/mathinraj/RepoLens/releases>:
   - Tag: `v<version>` (e.g. `v1.0.1`), matching the manifest version exactly.
   - Notes: short user-facing bullets in Markdown. The extension's What's new page shows them.
   - Don't mark it as a pre-release or draft; those are ignored.

The extension compares the latest GitHub release with the installed version to show "vX is available". Publishing the release before the stores approve it shows that notice to users who can't get the update yet.

---

## Store listing tab

**Name** (from manifest, max 75 characters): `RepoLens – AI Answers for GitHub Repos & PRs`. `short_name` stays `RepoLens` for places Chrome has little room.

**Summary** (from manifest, max 132 chars):
> Ask AI about any GitHub repo, PR, file, or commit in a side panel. Bring your own Claude, ChatGPT (OpenAI), or Gemini key.

**Category:** Developer Tools (Productivity → Developer Tools)

**Language:** English

**Description:**

```
Ever opened a giant pull request and thought "what am I even looking at?"

RepoLens rides along on github.com. Open a repository, folder, pull request, file, or commit, and a small lens appears in the corner. Click it and a side panel opens that already knows what you're looking at, ready to summarize, explain, and dig in.

WHAT YOU CAN ASK
• Repositories: What does this repo do? What's the tech stack? Where are the entry points?
• Pull requests: Summarize this PR. What's the risk? Does it touch auth, payments, or schemas? Are there enough tests?
• Files: Explain this file. What depends on it? Who owns it?
• Commits: What changed, and why? How far does it reach?
Tap a suggested question or type your own.

TWO MODES
• Instant: a fast answer from the page, the diff, and the README.
• Deep: also reads changed files, review comments, linked issues, configs, and CODEOWNERS for a thorough answer.

YOUR AI, YOUR KEY
• Works with Anthropic Claude, OpenAI (ChatGPT models), and Google Gemini. A free Gemini key works.
• Pick the AI and model for each question right from the side panel.
• Compare: add two or more keys and send one question to several AIs, then flip between their answers in tabs.
• Usage is billed to your own account with each provider. No RepoLens account, no subscription.
• Optional GitHub token for private repositories and higher GitHub limits.

CONVERSATIONS THAT STICK
• One conversation per repository, shared across its pages, and still there when you come back.
• Prefer one history per page? Switch it in Settings.

PRIVATE BY DESIGN
• No RepoLens servers. The extension talks directly to GitHub and the AI you choose.
• Your keys stay in this browser and are never synced.
• Optional lock: require Touch ID or Windows Hello before keys can be viewed or changed.
• Page content is read only when you ask a question. No analytics, no tracking.

SETUP
1. Install RepoLens. A welcome page walks you through setup.
2. Pick a provider and paste its API key (console.anthropic.com, platform.openai.com, or aistudio.google.com).
3. Optionally add a GitHub token.
4. Open any github.com page and click the lens, or press Ctrl/Cmd+Shift+L.

Prefer a clean page? Hide the lens on one repo or everywhere from the toolbar popup. The toolbar icon and shortcut keep working.

RepoLens is an independent project and is not affiliated with or endorsed by GitHub, Anthropic, OpenAI, or Google.
```

**Assets still to produce:**

| Asset | Size | Required | Suggested content |
|---|---|:---:|---|
| Store icon | 128×128 PNG | Yes | `RepoLens-extension/icons/icon-128.png` (already exists) |
| Screenshot 1 | 1280×800 PNG/JPEG | Yes (1–5) | A PR page with the panel open showing a summary answer |
| Screenshot 2 | 1280×800 | Recommended | Repo page with suggested question chips |
| Screenshot 3 | 1280×800 | Recommended | Deep mode answer on a PR |
| Screenshot 4 | 1280×800 | Recommended | Preferences page with keys connected (blur the keys) |
| Small promo tile | 440×280 PNG/JPEG | Yes | Logo + "AI answers for GitHub" |
| Marquee promo tile | 1400×560 | Optional | Only needed if you want to be featured |

Use public repositories in screenshots; don't show private or company code.

**Official URL:** `repolensio.vercel.app` (appears only after the site is verified in Google Search Console with the developer account)

**Homepage URL:** `https://repolensio.vercel.app`

**Support URL:** `https://repolensio.vercel.app/feedback.html`

**Mature content:** No

---

## Privacy practices tab

**Single purpose description:**
```
RepoLens answers the user's questions about the GitHub page they are viewing (a repository, pull request, file, or commit) in a side panel, using AI.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `sidePanel` | The extension's entire UI (suggested questions, answers, conversation) is shown in Chrome's side panel next to the GitHub page. |
| `storage` | Stores the user's AI provider API key(s), optional GitHub token, preferences, and conversation history (per repository or per page) locally on the device. |
| Host `https://github.com/*` | A content script detects the page type (repo, PR, file, commit) from the URL to show the RepoLens button and relevant questions, and reads the visible page content when the user asks a question. |
| Host `https://api.github.com/*` | Fetches read-only repository context (README, PR diff, file contents, comments) for the page the user is asking about. |
| Host `https://api.anthropic.com/*` | When the user selects Anthropic Claude, sends their question and page context to the Claude API with their own API key to generate the answer. |
| Host `https://api.openai.com/*` | When the user selects OpenAI, sends their question and page context to the OpenAI API with their own API key to generate the answer. |
| Host `https://generativelanguage.googleapis.com/*` | When the user selects Google Gemini, sends their question and page context to the Gemini API with their own API key to generate the answer. |

**Host permission justification** (the dashboard asks for one combined answer):
```
RepoLens only works on GitHub and only talks to the services the user chooses. github.com: a content script detects the page type (repo, pull request, file, commit) from the URL to show the RepoLens button and relevant questions, and reads the visible page content only when the user asks a question. api.github.com: fetches read-only context for that page (README, diff, file contents, review comments), optionally with the user's own token, and checks GitHub Releases for RepoLens updates. api.anthropic.com, api.openai.com and generativelanguage.googleapis.com: when the user asks a question, RepoLens sends it with the page context to the AI provider(s) the user selected (Claude, ChatGPT, or Gemini), using the user's own API key. Each key is sent only to the provider that issued it. There is no RepoLens server, and no data goes anywhere else. Access is limited to these five hosts; RepoLens does not request access to other websites.
```

**Remote code:** `No, I am not using remote code.` (All JavaScript, including marked and DOMPurify, is bundled in the package.)

**Data usage — check these boxes:**

- [x] **Authentication information** — the user's AI provider API key(s) and optional GitHub token (stored locally, sent only to the issuing service)
- [x] **Website content** — GitHub page text and repository data, sent to the user's selected AI provider only when the user asks a question

Leave all other categories unchecked (no personally identifiable info, health, financial, personal communications, location, web history, or user activity is collected).

The feedback and uninstall pages on repolensio.vercel.app receive basic diagnostics in the URL (version, browser, OS, provider, model, yes/no for key and token, answer count, days installed). Messages are only sent when the user presses Send on the website. This is disclosed in the privacy policy.

**Certify all three:**
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://repolensio.vercel.app/privacy.html` (source: `docs/privacy.html`; keep it in sync with `store/PRIVACY.md`).

---

## Test instructions (Distribution tab → "Test instructions")

Reviewers need a working key or they will reject the item as non-functional. Create a **dedicated** API key with a low spend limit (any one provider is enough — a free-tier Gemini key works), paste it below, and revoke it after approval.

```
1. After install, the RepoLens welcome page opens. Click "Open Settings". Select "<PROVIDER>", and paste this API key (it saves automatically):
   <PASTE REVIEW-ONLY KEY HERE>
   The status should show "Valid". No GitHub token is needed for public repositories.
2. Open https://github.com/markedjs/marked/pull/3600
3. Click the blue lens button in the bottom-right corner (or the toolbar icon).
4. In the side panel, click "Summarize this PR in plain English". An answer appears within a few seconds.
5. Optional: click "Go Deep" on the answer for a fuller analysis.
```

---

## Pre-submit checklist

- [ ] Developer account registered ($5 one-time) with 2-step verification enabled
- [ ] Site deployed to Vercel (root directory `docs/`) and https://repolensio.vercel.app/privacy.html loads
- [ ] Screenshots and small promo tile created
- [ ] Review-only AI key created with a spend limit
- [ ] `scripts/build-zip.sh` run, `-chrome` zip uploaded to Chrome Web Store, `-edge` zip uploaded to [Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge/overview) (free developer account)
- [ ] EmailJS: allowed origins include `repolensio.vercel.app`; a test message from `/feedback.html` arrives
- [ ] Loaded `RepoLens-extension/` unpacked and tested: install → Preferences opens → key validates for each provider → answer on a public PR with each provider → answer on a repo page → Deep mode
- [ ] Company approval obtained for publishing under your name, if applicable
