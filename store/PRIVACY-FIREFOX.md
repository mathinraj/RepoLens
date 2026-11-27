RepoLens Privacy Policy
Last updated: November 27, 2026

RepoLens is a Firefox add-on that answers questions about the GitHub page you are viewing. In short: RepoLens has no servers of its own and does not collect, sell, or share your data. Everything runs in your browser and talks directly to GitHub and to the AI provider you choose (Anthropic, OpenAI, or Google), using credentials you provide.

WHAT REPOLENS ACCESSES

- The URL path of github.com pages you visit (for example owner/repo/pull/12): used to detect whether you are on a repository, pull request, file, or commit page and to suggest relevant questions. It stays in your browser.
- Visible content of the current github.com page (pull request title and description, file text, README, commit message): read only when you ask a question, and sent to your selected AI provider with that question.
- Repository data from the GitHub API (README, diffs, file contents, review comments, CODEOWNERS): fetched from api.github.com to give the AI accurate context, then sent to your selected AI provider with your question.
- Questions you type: sent to your selected AI provider to answer them.
- Your AI provider API key(s) and optional GitHub token: stored in your browser. Each key is sent only to the service that issued it.
- Conversation history (up to 30 questions and answers per repository, or per page if you choose that in Settings): stored in your browser only.
- Preferences (provider, model, mode, pre-fetch, where the on-page lens is hidden): stored in your browser only.
- Key lock credential ID (only if you turn on Touch ID / Windows Hello protection): stored in your browser only. Verification is done by your operating system; RepoLens never receives your fingerprint, face, or PIN. The lock is registered under the name repolensio.vercel.app because Firefox requires a web domain for this; nothing is sent to that site.

WHERE DATA IS STORED

Everything RepoLens stores is kept in the add-on's local storage on your device. It is not synced to your Firefox account and is never sent to the RepoLens developer.

THIRD PARTIES

RepoLens sends data only to these services, and only to do what you asked:

- Your selected AI provider receives your question plus the page and repository context needed to answer it, authenticated with your own API key. Only the provider you pick receives data; when you use Compare, each provider you tick receives the same question and context. Each provider's handling of that data is governed by its own terms:
  - Anthropic (api.anthropic.com): https://www.anthropic.com/legal/privacy
  - OpenAI (api.openai.com): https://openai.com/policies/privacy-policy
  - Google Gemini API (generativelanguage.googleapis.com): https://ai.google.dev/gemini-api/terms and https://policies.google.com/privacy. Google may use data sent with free-tier Gemini API keys to improve its products.
- GitHub (api.github.com) receives read-only API requests for the repository you are viewing, authenticated with your GitHub token if you provided one: https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement

If you enable "Pre-fetch page context" and have set a GitHub token, RepoLens requests basic context for repository pages from the GitHub API in the background as you browse github.com. That data goes only to GitHub and is not sent to any AI provider until you ask a question.

Update check: about twice a day, RepoLens asks GitHub (api.github.com/repos/mathinraj/RepoLens/releases) for the latest RepoLens release, to tell you when an update or new release notes are available. The request contains no personal data and never includes your GitHub token.

RepoLens contains no analytics, advertising, or tracking, and loads no remote code.

FEEDBACK AND UNINSTALL SURVEY

Feedback links (toolbar popup, Settings, welcome and What's new pages) open the feedback form at repolensio.vercel.app/feedback.html. When RepoLens is uninstalled, Firefox opens a short survey at repolensio.vercel.app/uninstall.html. Both links carry these diagnostics: RepoLens version and build, browser and version, operating system, selected AI provider and model, whether an API key and a GitHub token are set (yes/no), number of answers received, and days since install. They never include API keys, tokens, repository names, questions, or answers.

Nothing is sent unless you press Send. When you do, your message, those diagnostics (attached automatically), and your email address (only if you enter one) are delivered to the developer by email through EmailJS (https://www.emailjs.com/legal/privacy-policy/). The website is hosted on Vercel, which may keep standard request logs, including page URLs (https://vercel.com/legal/privacy-policy).

YOUR CONTROL

- Clear a conversation: use the Clear button in the RepoLens panel.
- Remove credentials: delete them on the RepoLens Settings page.
- Key lock: optionally require Touch ID or Windows Hello before keys are shown or changed in Settings. It protects the page, not the stored data: keys are not encrypted.
- Delete everything: remove the add-on; Firefox deletes all of its stored data.
- Revoke access: revoke your AI key with its provider (console.anthropic.com, platform.openai.com, aistudio.google.com) or your GitHub token at https://github.com/settings/tokens.

DATA USE COMMITMENTS

RepoLens does not sell user data, does not use or transfer it for purposes unrelated to answering your questions, and does not use it to determine creditworthiness or for lending.

CHANGES

If this policy changes, the updated version will be published here and at https://repolensio.vercel.app/privacy.html with a new "Last updated" date.

CONTACT

Questions about this policy: https://repolensio.vercel.app/feedback.html
