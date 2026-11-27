/**
 * Shared config for the RepoLens extension.
 * Kept as a plain script (not ES module) so content scripts can load it via manifest.
 */
const REPOLENS = {
  EXTENSION_NAME: 'RepoLens',
  HOST: 'github.com',
  GITHUB_API: 'https://api.github.com',
  SITE_URL: 'https://repolensio.vercel.app',
  REPO_URL: 'https://github.com/mathinraj/RepoLens',
  RELEASES_URL: 'https://github.com/mathinraj/RepoLens/releases',
  CHANGELOG_URL: 'https://repolensio.vercel.app/changelog.html',
  CHROME_STORE_URL: 'https://chromewebstore.google.com/detail/khjmcbpiaknmadpolbifmjacjieeogci',
  RELEASES_API: 'https://api.github.com/repos/mathinraj/RepoLens/releases',
  SAMPLE_PR_URL: 'https://github.com/markedjs/marked/pull/3600',

  /** Which store this build is for. This is the Firefox build (RepoLens-firefox/). */
  STORE: 'firefox',
  /** Firefox Add-ons listing, e.g. 'https://addons.mozilla.org/firefox/addon/repolens/'. Empty until listed. */
  AMO_URL: '',
  /**
   * WebAuthn relying party for the key lock. Firefox rejects moz-extension://
   * origins, and since Firefox 150 accepts a domain the extension has host
   * permission for. Credentials are bound to it, so it must never change.
   */
  WEBAUTHN_RP_ID: 'repolensio.vercel.app',
  WEBAUTHN_MIN_FIREFOX: 150,

  /**
   * AI providers. Each has its own key + model storage slot so switching
   * providers never loses credentials.
   */
  PROVIDERS: {
    anthropic: {
      id: 'anthropic',
      label: 'Anthropic Claude',
      short: 'Claude',
      apiBase: 'https://api.anthropic.com',
      defaultModel: 'claude-sonnet-4-6',
      keyPlaceholder: 'sk-ant-…',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      keyHost: 'console.anthropic.com',
      keyStorage: 'repolensAnthropicKey',
      modelStorage: 'repolensModel',
    },
    openai: {
      id: 'openai',
      label: 'OpenAI (ChatGPT models)',
      short: 'ChatGPT',
      apiBase: 'https://api.openai.com',
      defaultModel: 'gpt-4.1',
      keyPlaceholder: 'sk-…',
      keyUrl: 'https://platform.openai.com/api-keys',
      keyHost: 'platform.openai.com',
      keyStorage: 'repolensOpenAIKey',
      modelStorage: 'repolensModelOpenAI',
    },
    gemini: {
      id: 'gemini',
      label: 'Google Gemini',
      short: 'Gemini',
      apiBase: 'https://generativelanguage.googleapis.com',
      defaultModel: 'gemini-2.5-flash',
      keyPlaceholder: 'AIza…',
      keyUrl: 'https://aistudio.google.com/app/apikey',
      keyHost: 'aistudio.google.com',
      keyStorage: 'repolensGeminiKey',
      modelStorage: 'repolensModelGemini',
    },
  },
  DEFAULT_PROVIDER: 'anthropic',

  /** chrome.storage.local keys. Secrets live in local (never sync) storage. */
  STORAGE: {
    PROVIDER: 'repolensProvider',
    GITHUB_TOKEN: 'repolensGithubToken',
    PREFETCH: 'repolensPrefetch',
    PIN_PROMPT_DISMISSED: 'repolensPinPromptDismissed',
    INSTALLED_AT: 'repolensInstalledAt',
    ANSWER_COUNT: 'repolensAnswerCount',
    /** { version, url, name, checkedAt } from the latest GitHub release */
    LATEST_RELEASE: 'repolensLatestRelease',
    /** { from, to, seen } set when the extension updates */
    WHATS_NEW: 'repolensWhatsNew',
    /** { all: boolean, repos: ['org/repo', …] } — where the on-page lens is hidden */
    LENS_HIDDEN: 'repolensLensHidden',
    /** { rated: true } or { remindAt: epoch ms } */
    RATE_PROMPT: 'repolensRatePrompt',
    /** { credentialId, enabledAt } while the Touch ID / Windows Hello key lock is on */
    KEY_LOCK: 'repolensKeyLock',
    /** 'repo' (default): one conversation per repo; 'page': one per page */
    HISTORY_SCOPE: 'repolensHistoryScope',
    /** { on: boolean, providers: [providerId, …] } for comparing answers in the panel */
    COMPARE: 'repolensCompare',
  },

  /** When the popup asks for a store rating. */
  RATE: {
    MIN_ANSWERS: 10,
    MIN_DAYS: 3,
    REMIND_DAYS: 14,
  },

  /**
   * "More from the developer" in the popup. Bundled (never fetched remotely)
   * so store reviewers see exactly what ships.
   */
  MORE_APPS: [
    {
      name: 'TouchLock',
      desc: 'Lock your browser with Touch ID, Windows Hello, or a PIN',
      url: 'https://touchlock.vercel.app',
      icon: 'icons/apps/touchlock.png',
    },
    {
      name: 'SpendTrak',
      desc: 'Privacy-first expense tracker that syncs with Google Drive',
      url: 'https://spendtrak.vercel.app',
      icon: 'icons/apps/spendtrak.png',
    },
    {
      name: 'Bing it',
      desc: 'Smart auto-searcher with human-like typing',
      url: 'https://bingit.vercel.app',
      icon: 'icons/apps/bingit.png',
    },
    {
      name: 'AutoPrompt for Copilot',
      desc: 'Batch prompts for Copilot, with 5,700+ built in',
      url: 'https://auto-prompt-for-copilot.vercel.app',
      icon: 'icons/apps/autoprompt.png',
    },
  ],

  /** Message types exchanged between content script, panel, and service worker */
  MSG: {
    PAGE_INFO: 'REPOLENS_PAGE_INFO',
    OPEN_PANEL: 'REPOLENS_OPEN_PANEL',
    GET_PAGE_INFO: 'REPOLENS_GET_PAGE_INFO',
    ASK: 'REPOLENS_ASK',
    ASK_CHUNK: 'REPOLENS_ASK_CHUNK',
    ASK_PROGRESS: 'REPOLENS_ASK_PROGRESS',
    ASK_DONE: 'REPOLENS_ASK_DONE',
    ASK_ERROR: 'REPOLENS_ASK_ERROR',
    /** Sent once every provider in an ask has answered or failed */
    ASK_FINISHED: 'REPOLENS_ASK_FINISHED',
    SCRAPE_PAGE: 'REPOLENS_SCRAPE_PAGE',
    PREFETCH_DONE: 'REPOLENS_PREFETCH_DONE',
    PANEL_HELLO: 'REPOLENS_PANEL_HELLO',
    PANEL_CLOSE: 'REPOLENS_PANEL_CLOSE',
    PANEL_STATE: 'REPOLENS_PANEL_STATE',
    PANEL_OPENED: 'REPOLENS_PANEL_OPENED',
    CLOSE_PANEL: 'REPOLENS_CLOSE_PANEL',
  },

  PAGE_TYPES: {
    REPO: 'repo',
    PR: 'pr',
    FILE: 'file',
    COMMIT: 'commit',
    UNKNOWN: 'unknown',
  },

  MODES: {
    INSTANT: 'instant',
    DEEP: 'deep',
  },
};

// Expose for content scripts and service worker (non-module contexts)
if (typeof globalThis !== 'undefined') {
  globalThis.REPOLENS = REPOLENS;
}
