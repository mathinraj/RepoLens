/**
 * Smoke tests for question sets.
 * Run: node RepoLens-extension/shared/questions.test.js
 */
const path = require('path');

global.REPOLENS = {
  PAGE_TYPES: {
    REPO: 'repo',
    PR: 'pr',
    FILE: 'file',
    COMMIT: 'commit',
    UNKNOWN: 'unknown',
  },
};

require(path.join(__dirname, 'questions.js'));
const { getQuestionsForPageType, getQuestionChips } = global.RepoLensQuestions;

const expectations = {
  repo: 4,
  pr: 5,
  file: 4,
  commit: 2,
  unknown: 0,
};

let failed = 0;

for (const [type, count] of Object.entries(expectations)) {
  const qs = getQuestionsForPageType(type);
  const chips = getQuestionChips(type);
  if (qs.length !== count || chips.length !== count) {
    failed += 1;
    console.error(`FAIL: ${type} expected ${count}, got qs=${qs.length} chips=${chips.length}`);
  } else {
    console.log(`ok  - ${type} (${count} questions)`);
  }
}

// PR set should include the demo question
const prQs = getQuestionsForPageType('pr');
if (!prQs.includes('Summarize this PR in plain English')) {
  failed += 1;
  console.error('FAIL: missing demo PR summary question');
} else {
  console.log('ok  - PR includes summary question');
}

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll question tests passed`);
