/**
 * Tests for on-page lens visibility.
 * Run: node RepoLens-extension/shared/lens.test.js
 */
const path = require('path');
const assert = require('assert');

let store = {};
global.REPOLENS = { STORAGE: { LENS_HIDDEN: 'repolensLensHidden' } };
global.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (values) => Object.assign(store, values),
    },
  },
};

require(path.join(__dirname, 'lens.js'));
const Lens = global.RepoLensLens;

const pr = { type: 'pr', org: 'MarkedJS', repo: 'Marked', prNumber: 1 };
const other = { type: 'repo', org: 'foo', repo: 'bar' };
const unknown = { type: 'unknown' };

const tests = {
  'repoKey is lowercase org/repo': () => {
    assert.strictEqual(Lens.repoKey(pr), 'markedjs/marked');
    assert.strictEqual(Lens.repoKey(unknown), null);
  },
  'default is shown': () => {
    assert.strictEqual(Lens.stateFor(undefined, pr), 'shown');
    assert.strictEqual(Lens.stateFor(undefined, unknown), 'shown');
  },
  'hide on repo only affects that repo': async () => {
    store = {};
    await Lens.choose('repo', pr);
    const v = await Lens.get();
    assert.deepStrictEqual(v, { all: false, repos: ['markedjs/marked'] });
    assert.strictEqual(Lens.stateFor(v, pr), 'repo');
    assert.strictEqual(Lens.stateFor(v, other), 'shown');
  },
  'hide everywhere keeps the repo list; show clears both for the page': async () => {
    store = {};
    await Lens.choose('repo', pr);
    await Lens.choose('all', other);
    let v = await Lens.get();
    assert.strictEqual(Lens.stateFor(v, other), 'all');
    assert.strictEqual(Lens.stateFor(v, unknown), 'all');
    assert.deepStrictEqual(v.repos, ['markedjs/marked']);
    await Lens.choose('shown', pr);
    v = await Lens.get();
    assert.deepStrictEqual(v, { all: false, repos: [] });
  },
  'setRepo and setAll from Settings': async () => {
    store = {};
    await Lens.setRepo('foo/bar', true);
    await Lens.setRepo('foo/bar', true);
    await Lens.setAll(true);
    assert.deepStrictEqual(await Lens.get(), { all: true, repos: ['foo/bar'] });
    await Lens.setRepo('foo/bar', false);
    await Lens.setAll(false);
    assert.deepStrictEqual(await Lens.get(), { all: false, repos: [] });
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log(`ok  - ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL: ${name}\n${err.message}`);
    }
  }
  if (failed) process.exit(1);
})();
