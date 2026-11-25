<div align="center">

<br>

# 🔍 RepoLens

**Your AI co-pilot for reading code on GitHub.**

*Understand any repo, pull request, file, or commit — without ever leaving the page.*

<br>

![Made for](https://img.shields.io/badge/made%20for-github.com-0969da?style=for-the-badge&logo=github)
![Powered by](https://img.shields.io/badge/AI-Claude%20%7C%20ChatGPT%20%7C%20Gemini-6e40c9?style=for-the-badge)
![Platform](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)

<br>

</div>

---

<div align="center">

### Ever opened a giant pull request and thought *"…what am I even looking at?"*

</div>

<br>

RepoLens quietly rides along on `github.com`. The moment you land on a repo, PR,
file, or commit, a small lens appears in the corner. Click it, and a panel slides in that
already *knows* what you're looking at — ready to summarize, explain, and dig in.

No copy-pasting into a chatbot. No context-switching. No "let me just read all 40 files first."
Just answers, streaming in, right where you're already working.

<br>

---

## 🎬 The 10-second flow

```
   You're on a PR   ──▶   Click the lens   ──▶   Pick a question   ──▶   Read the answer
   ( 40 files 😵 )        ( panel opens )        ( or type your own )      ( streams in ⚡ )
```

<br>

---

## 🧠 It reads the room

RepoLens knows the difference between a sprawling monorepo and a one-line commit — and asks
the right questions for each.

<table>
<tr>
<td width="50%" valign="top">

### 📦 On a **repo**
> *What does this repo do?*
> *What's the tech stack & architecture?*
> *Where are the main entry points?*
> *What are the key modules?*

</td>
<td width="50%" valign="top">

### 🔀 On a **pull request**
> *Summarize this PR in plain English.*
> *What's the risk of this change?*
> *Does it touch auth, payments, or schemas?*
> *Are there enough tests?*

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 📄 On a **file**
> *Explain this file's job.*
> *What depends on it?*
> *Any code-quality risks here?*
> *Who owns it?*

</td>
<td width="50%" valign="top">

### 📌 On a **commit**
> *What changed, and why?*
> *What's the scope of impact?*

</td>
</tr>
</table>

<br>

---

## ✨ Why it feels good to use

- **⚡ Answers stream live** — first words in under a second, no spinner-staring.
- **🎚️ Two gears** — *Instant* for a quick read of the page, *Enhanced* for full-repo depth (related files, PR comments, linked issues, ownership).
- **💬 Chips or free-text** — tap a suggested question or ask your own.
- **🔐 Bring your own key, no servers** — talks directly to GitHub and your chosen AI provider (Claude, ChatGPT, or Gemini) from your browser. Keys never leave your machine except to those APIs.
- **🪶 Stays out of the way** — a side panel that sits *beside* your code, not on top of it.

<br>

---

## 🚀 Get it running

1. Install RepoLens from the Chrome Web Store, or for development: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `RepoLens-extension/`.
2. The welcome page opens; click **Open Settings**, pick a provider, and paste its API key: [Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys), or [Google Gemini](https://aistudio.google.com/app/apikey).
3. Optionally add a **GitHub token** (see below).
4. Open any [github.com](https://github.com) page and click the blue lens on the page, the toolbar icon → **Open RepoLens panel**, or press <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>. Ask away 🎉

The toolbar popup also shows which AI provider and model are active, lets you hide the on-page lens on the current repo or everywhere, and has a **Settings** button.

<br>

---

## ⚙️ Dial it in

Everything lives on the Settings page (gear icon in the panel or popup), and changes save automatically:

| Setting | Needed? | What it's for |
|---|:---:|---|
| AI provider + API key | ✅ | Anthropic Claude, OpenAI, or Google Gemini; billed to your account with that provider. Keys for every provider are kept, so you can switch any time |
| GitHub token | — * | Private repos, higher API limits, code search in Deep mode, background pre-fetch |
| Model | — | Per provider. Defaults: `claude-sonnet-4-6`, `gpt-4.1`, `gemini-2.5-flash`. Lists the models your key can use |
| Pre-fetch | — | Warms GitHub context as you browse (needs a token) |
| Conversation per repo | — | On by default: every page of a repo (home, folders, files, PRs) shares one history; each repo keeps its own. Turn off for one history per page |
| On-page lens | — | Show or hide the floating lens everywhere, and un-hide repos you hid from the popup |
| Key lock | — | Require Touch ID / Windows Hello before keys are shown or changed, or providers switched. Guards the page only; keys aren't encrypted |

<sub>\* Without a token RepoLens works on public repos using GitHub's anonymous limit of 60 requests per hour. A Deep answer uses roughly 10–25 requests. Use a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with read-only *Contents*, *Pull requests*, *Issues* and *Metadata*.</sub>

> 🔐 Keys are stored in `chrome.storage.local` (never synced) and each sent only to the service that issued it (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.github.com`). There is no RepoLens server. See the [privacy policy](store/PRIVACY.md).

<br>

---

### 🔍 RepoLens

*What used to take 5–10 minutes of squinting at code now takes one click.*

</div>
