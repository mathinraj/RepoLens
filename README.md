<div align="center">

<br>

# 🔍 RepoLens

**Your AI co-pilot for reading code on GitHub.**

*Understand any repo, pull request, file, or commit — without ever leaving the page.*

<br>

![Made for](https://img.shields.io/badge/made%20for-github.intuit.com-0969da?style=for-the-badge&logo=github)
![Powered by](https://img.shields.io/badge/powered%20by-Claude-d97757?style=for-the-badge&logo=anthropic)
![Platform](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)

<br>

</div>

---

<div align="center">

### Ever opened a giant pull request and thought *"…what am I even looking at?"*

</div>

<br>

RepoLens quietly rides along on `github.intuit.com`. The moment you land on a repo, PR,
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
- **🔐 Uses your enterprise login** — authenticates through the Claude Code CLI, so no personal API key to manage.
- **🪶 Stays out of the way** — a side panel that sits *beside* your code, not on top of it.

<br>

---

## 🚀 Get it running

<table>
<tr>
<td valign="top" width="50%">

### ① The brain (backend)

```bash
# one-time enterprise Claude login
claude auth login

cd backend
cp .env.example .env      # set GITHUB_TOKEN
npm install
npm start
```

Healthy when
[localhost:3847/health](http://localhost:3847/health)
shows `anthropic: true` + `githubToken: true`.

</td>
<td valign="top" width="50%">

### ② The lens (extension)

1. Open `chrome://extensions`
2. Flip on **Developer mode**
3. **Load unpacked** → pick `RepoLens-extension/`
4. Open any [github.intuit.com](https://github.intuit.com) page
5. Click the blue lens and ask 🎉

</td>
</tr>
</table>

<br>

---

## ⚙️ Dial it in

Everything lives in `backend/.env`:

| Setting | Needed? | What it's for |
|---|:---:|---|
| `GITHUB_TOKEN` | ✅ * | Reads repos, PRs, and files on `github.intuit.com` |
| `CLAUDE_PROVIDER` | — | `cli` (default, SSO login) or `api` |
| `ANTHROPIC_API_KEY` | — | Only when `CLAUDE_PROVIDER=api` |
| `CLAUDE_MODEL` | — | Defaults to `claude-sonnet-4-6` |
| `PORT` | — | Defaults to `3847` |

<sub>\* No token? Instant mode still works by reading the page directly — answers are just a little thinner.</sub>

> 💡 **Why the CLI instead of an API key?** Enterprise Claude accounts usually can't mint
> `sk-ant-…` keys. The Claude Code CLI signs in with your SSO, so RepoLens borrows that —
> nothing personal to copy, paste, or leak.

<br>

<div align="center">

---

### 🔍 RepoLens

*What used to take 5–10 minutes of squinting at code now takes one click.*

</div>
