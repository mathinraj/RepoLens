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
  },

  PAGE_TYPES: {
    REPO: 'repo',
    PR: 'pr',
    FILE: 'file',
    COMMIT: 'commit',
    UNKNOWN: 'unknown',
  },
};

// Expose for content scripts and service worker (non-module contexts)
if (typeof globalThis !== 'undefined') {
  globalThis.REPOLENS = REPOLENS;
}
