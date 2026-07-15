/**
 * Lightweight smoke tests for page detection.
 * Run: node RepoLens-extension/shared/page-detector.test.js
 */
const path = require('path');

// Load shared scripts into a fake global
global.REPOLENS = {
  PAGE_TYPES: {
    REPO: 'repo',
    PR: 'pr',
    FILE: 'file',
    COMMIT: 'commit',
    UNKNOWN: 'unknown',
  },
};

require(path.join(__dirname, 'page-detector.js'));
const { detectPage } = global.RepoLensPageDetector;

const cases = [
  {
    name: 'repo home',
    path: '/gotomarket-engageoptmz/qbdtipdservice',
    expect: { type: 'repo', org: 'gotomarket-engageoptmz', repo: 'qbdtipdservice' },
  },
  {
    name: 'repo home trailing slash',
    path: '/gotomarket-engageoptmz/qbdtipdservice/',
    expect: { type: 'repo', org: 'gotomarket-engageoptmz', repo: 'qbdtipdservice' },
  },
  {
    name: 'repo tree root',
    path: '/gotomarket-engageoptmz/qbdtipdservice/tree/main',
    expect: { type: 'repo', org: 'gotomarket-engageoptmz', repo: 'qbdtipdservice' },
  },
  {
    name: 'PR conversation',
    path: '/gotomarket-engageoptmz/qbdtipdservice/pull/852',
    expect: {
      type: 'pr',
      org: 'gotomarket-engageoptmz',
      repo: 'qbdtipdservice',
      prNumber: 852,
      label: 'PR #852',
    },
  },
  {
    name: 'PR files tab',
    path: '/gotomarket-engageoptmz/qbdtipdservice/pull/852/files',
    expect: { type: 'pr', prNumber: 852 },
  },
  {
    name: 'file view',
    path: '/acme/widget/blob/main/src/EcoboxController.java',
    expect: {
      type: 'file',
      org: 'acme',
      repo: 'widget',
      branch: 'main',
      filePath: 'src/EcoboxController.java',
      label: 'File: EcoboxController.java',
    },
  },
  {
    name: 'commit view',
    path: '/acme/widget/commit/abc1234def5678901234567890abcdef12345678',
    expect: {
      type: 'commit',
      sha: 'abc1234def5678901234567890abcdef12345678',
      label: 'Commit abc1234',
    },
  },
  {
    name: 'settings is not a repo',
    path: '/settings/profile',
    expect: { type: 'unknown' },
  },
  {
    name: 'issues page is unknown for now',
    path: '/acme/widget/issues/12',
    expect: { type: 'unknown' },
  },
];

let failed = 0;

for (const test of cases) {
  const result = detectPage(test.path);
  const ok = Object.entries(test.expect).every(
    ([key, value]) => result[key] === value
  );
  if (!ok) {
    failed += 1;
    console.error(`FAIL: ${test.name}`);
    console.error('  path   :', test.path);
    console.error('  expect :', test.expect);
    console.error('  got    :', result);
  } else {
    console.log(`ok  - ${test.name}`);
  }
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} tests passed`);
