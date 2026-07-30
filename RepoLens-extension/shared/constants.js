/**
 * Shared config for the RepoLens extension.
 * Kept as a plain script (not ES module) so content scripts can load it via manifest.
 */
const REPOLENS = {
  EXTENSION_NAME: 'RepoLens',
  BACKEND_URL: 'http://localhost:3847',
  HOST: 'github.intuit.com',

  /** Message types exchanged between content script, panel, and service worker */
  MSG: {
    PAGE_INFO: 'REPOLENS_PAGE_INFO',
    OPEN_PANEL: 'REPOLENS_OPEN_PANEL',
    GET_PAGE_INFO: 'REPOLENS_GET_PAGE_INFO',
    ASK: 'REPOLENS_ASK',
    ASK_CHUNK: 'REPOLENS_ASK_CHUNK',
    ASK_DONE: 'REPOLENS_ASK_DONE',
    ASK_ERROR: 'REPOLENS_ASK_ERROR',
    SCRAPE_PAGE: 'REPOLENS_SCRAPE_PAGE',
    PREFETCH_DONE: 'REPOLENS_PREFETCH_DONE',
    PANEL_HELLO: 'REPOLENS_PANEL_HELLO',
    PANEL_CLOSE: 'REPOLENS_PANEL_CLOSE',
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
    ENHANCED: 'enhanced',
    DEEP: 'deep',
  },
};

// Expose for content scripts and service worker (non-module contexts)
if (typeof globalThis !== 'undefined') {
  globalThis.REPOLENS = REPOLENS;
}
