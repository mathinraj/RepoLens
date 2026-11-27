/**
 * Where the floating on-page lens is hidden: on specific repos or everywhere.
 * The toolbar popup and keyboard shortcut keep working regardless.
 */
(function (root) {
  const { STORAGE } = root.REPOLENS;

  /** "Org/Repo" → "org/repo"; null when the page isn't inside a repo. */
  function repoKey(page) {
    if (!page?.org || !page?.repo) return null;
    return `${page.org}/${page.repo}`.toLowerCase();
  }

  /** @returns {{ all: boolean, repos: string[] }} */
  function normalize(value) {
    return {
      all: Boolean(value?.all),
      repos: Array.isArray(value?.repos) ? value.repos.filter((r) => typeof r === 'string') : [],
    };
  }

  /** 'all' | 'repo' | 'shown' */
  function stateFor(value, page) {
    const v = normalize(value);
    if (v.all) return 'all';
    const key = repoKey(page);
    return key && v.repos.includes(key) ? 'repo' : 'shown';
  }

  async function get() {
    const { [STORAGE.LENS_HIDDEN]: value } = await chrome.storage.local.get(STORAGE.LENS_HIDDEN);
    return normalize(value);
  }

  async function save(value) {
    await chrome.storage.local.set({ [STORAGE.LENS_HIDDEN]: normalize(value) });
  }

  async function setAll(hidden) {
    const v = await get();
    await save({ ...v, all: hidden });
  }

  async function setRepo(key, hidden) {
    if (!key) return;
    const v = await get();
    const repos = v.repos.filter((r) => r !== key);
    if (hidden) repos.push(key);
    repos.sort();
    await save({ ...v, repos });
  }

  /** Apply a popup choice ('shown' | 'repo' | 'all') for the current page. */
  async function choose(state, page) {
    const key = repoKey(page);
    const v = await get();
    let repos = v.repos;
    if (key && state !== 'all') {
      repos = repos.filter((r) => r !== key);
      if (state === 'repo') repos.push(key);
      repos.sort();
    }
    await save({ all: state === 'all', repos });
  }

  root.RepoLensLens = { repoKey, normalize, stateFor, get, setAll, setRepo, choose };
})(globalThis);
