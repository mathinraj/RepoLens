/**
 * Tests for the rate-prompt rules and review link.
 * Run: node RepoLens-extension/shared/support.test.js
 */
const path = require('path');
const assert = require('assert');

let manifest = {};
global.REPOLENS = {
  SITE_URL: 'https://example.test',
  REPO_URL: 'https://github.com/mathinraj/RepoLens',
  STORAGE: {},
  PROVIDERS: {},
  DEFAULT_PROVIDER: 'anthropic',
  STORE: 'chrome',
  RATE: { MIN_ANSWERS: 10, MIN_DAYS: 3, REMIND_DAYS: 14 },
};
global.chrome = { runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', getManifest: () => manifest } };

require(path.join(__dirname, 'support.js'));
const { shouldAskForRating, reviewUrl } = global.RepoLensSupport;

const DAY = 86_400_000;
const now = 100 * DAY;
const ready = { answers: 10, installedAt: now - 3 * DAY };

const tests = {
  'asks after 10 answers and 3 days': () => assert.strictEqual(shouldAskForRating(ready, now), true),
  'not before 10 answers': () => assert.strictEqual(shouldAskForRating({ ...ready, answers: 9 }, now), false),
  'not before 3 days': () => assert.strictEqual(shouldAskForRating({ ...ready, installedAt: now - 2 * DAY }, now), false),
  'not without an install date': () => assert.strictEqual(shouldAskForRating({ answers: 50 }, now), false),
  'never once rated': () => assert.strictEqual(shouldAskForRating({ ...ready, prompt: { rated: true } }, now), false),
  '"Later" waits until the reminder date': () => {
    assert.strictEqual(shouldAskForRating({ ...ready, prompt: { remindAt: now + 1 } }, now), false);
    assert.strictEqual(shouldAskForRating({ ...ready, prompt: { remindAt: now } }, now), true);
  },
  'unpacked builds link to the repo': () => {
    manifest = {};
    assert.strictEqual(reviewUrl(), global.REPOLENS.REPO_URL);
  },
  'store builds link to the store reviews': () => {
    manifest = { update_url: 'https://clients2.google.com/service/update2/crx' };
    assert.strictEqual(reviewUrl(), 'https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop/reviews');
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`ok  - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}\n${err.message}`);
  }
}
if (failed) process.exit(1);
