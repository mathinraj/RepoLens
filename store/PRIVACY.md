# RepoLens Privacy Policy

_Last updated: November 25, 2026_

RepoLens is a Chrome extension that answers questions about the GitHub page you are viewing. This policy explains what data it handles. In short: **RepoLens has no servers of its own and does not collect, sell, or share your data.** Everything runs in your browser and talks directly to GitHub and to the AI provider you choose (Anthropic, OpenAI, or Google) using credentials you provide.

## What RepoLens accesses

| Data | Why | Where it goes |
|---|---|---|
| The URL path of github.com pages you visit (e.g. `owner/repo/pull/12`) | To detect whether you are on a repo, pull request, file, or commit page and show the right suggested questions | Stays in your browser |
| Visible content of the current github.com page (PR title/description, file text, README, commit message) | Read **only when you ask a question**, to give the AI context | Sent to your selected AI provider with your question |
| Repository data from the GitHub API (README, diffs, file contents, comments, CODEOWNERS) | To give the AI accurate context for your question | Fetched from `api.github.com`, then sent to your selected AI provider with your question |
| Questions you type | To answer them | Sent to your selected AI provider |
| Your AI provider API key(s) and optional GitHub token | To call those services on your behalf | Stored in your browser; each key is sent only to the service that issued it |
| Conversation history (your questions and answers, up to 30 per page) | So answers are still there when you come back to a page | Stored in your browser only |
| Preferences (provider, model, mode, pre-fetch toggle, where the on-page lens is hidden) | To remember your settings | Stored in your browser only |
| Key lock credential ID (only if you turn on Touch ID / Windows Hello protection) | To ask your device to verify it's you before keys are shown or changed | Stored in your browser only. Verification is done by your operating system; RepoLens never receives your fingerprint, face, or PIN |

## Where data is stored

All data RepoLens stores is kept in `chrome.storage.local` on your device. It is **not** synced to your Google account and is never sent to the RepoLens developer.

## Third parties

RepoLens sends data only to these services, and only to do what you asked:

- **Your selected AI provider** receives your question plus the page and repository context needed to answer it, authenticated with your own API key. Only the provider you select in Preferences receives data, and its handling of that data is governed by its own terms:
  - Anthropic (`api.anthropic.com`): <https://www.anthropic.com/legal/privacy>
  - OpenAI (`api.openai.com`): <https://openai.com/policies/privacy-policy>
  - Google Gemini API (`generativelanguage.googleapis.com`): <https://ai.google.dev/gemini-api/terms> and <https://policies.google.com/privacy>. Note that Google may use data sent with free-tier Gemini API keys to improve its products; see Google's terms.
- **GitHub** (`api.github.com`): receives read-only API requests for the repository you are viewing, authenticated with your GitHub token if you provided one. See <https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement>.

If you enable **Pre-fetch page context** and have set a GitHub token, RepoLens requests basic context for repository pages from the GitHub API in the background as you browse github.com. This data goes only to GitHub and is not sent to any AI provider until you ask a question.

RepoLens contains no analytics, advertising, or tracking, and loads no remote code.

**Update check:** about twice a day, RepoLens asks GitHub (`api.github.com/repos/mathinraj/RepoLens/releases`) for the latest RepoLens release so it can tell you when an update or new release notes are available. The request contains no personal data and never includes your GitHub token.

## Feedback and uninstall survey

**Feedback** links (toolbar popup, Preferences, welcome and What's new pages) open the feedback form at `repolensio.vercel.app/feedback.html`. When RepoLens is uninstalled, Chrome opens a short survey at `repolensio.vercel.app/uninstall.html`. Both links carry these diagnostics in the URL: RepoLens version and store build, browser and version, operating system, selected AI provider and model, whether an API key and a GitHub token are set (yes/no), number of answers received, and days since install. They never include API keys, tokens, repository names, questions, or answers.

The pages show you those diagnostics, and you can untick them before sending. Nothing is sent unless you press **Send**. When you do, your message, the diagnostics you chose to include, and your email address (only if you enter one) are delivered to the developer by email through [EmailJS](https://www.emailjs.com/legal/privacy-policy/). The website is hosted on Vercel, which may keep standard request logs (including page URLs) as described in [Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

## Your control

- **Clear a conversation:** use the **Clear** button in the side panel.
- **Remove credentials:** delete them on the RepoLens Settings page.
- **Key lock:** optionally require Touch ID or Windows Hello before keys are shown or changed on the Preferences page. It protects the page, not the stored data: keys are not encrypted.
- **Delete everything:** uninstall the extension; Chrome deletes all of its stored data.
- **Revoke access:** revoke your AI key with its provider ([Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys), [Google AI Studio](https://aistudio.google.com/app/apikey)) or the GitHub token at <https://github.com/settings/tokens>.

## Data use commitments

RepoLens does not sell user data, does not use or transfer it for purposes unrelated to answering your questions, and does not use it to determine creditworthiness or for lending.

## Changes

If this policy changes, the updated version will be published at this URL with a new "Last updated" date.

## Contact

Questions about this policy: use the [feedback form](https://repolensio.vercel.app/feedback.html).
