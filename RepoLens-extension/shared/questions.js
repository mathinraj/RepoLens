/**
 * Static + dynamic question sets per GitHub page type (Phase 5).
 */
(function (root) {
  const TYPES = (root.REPOLENS && root.REPOLENS.PAGE_TYPES) || {
    REPO: 'repo',
    PR: 'pr',
    FILE: 'file',
    COMMIT: 'commit',
    UNKNOWN: 'unknown',
  };

  const STATIC_QUESTIONS = {
    [TYPES.REPO]: [
      'What does this repo do?',
      "What's the tech stack / architecture?",
      'Where are the main entry points?',
      'What are the key modules and what do they do?',
    ],
    [TYPES.PR]: [
      'Summarize this PR in plain English',
      "What's the impact / risk of this change?",
      'Does this touch anything critical (auth, payments, schemas)?',
      'Are there sufficient tests for this change?',
      'Why was this change made?',
    ],
    [TYPES.FILE]: [
      "Explain this file's purpose and responsibility",
      'What calls this file / what does this file depend on?',
      'Any code quality issues or risks here?',
      'Who owns this file?',
    ],
    [TYPES.COMMIT]: [
      'What does this commit change and why?',
      "What's the scope of impact?",
    ],
    [TYPES.UNKNOWN]: [],
  };

  /**
   * @param {string} pageType
   * @returns {string[]}
   */
  function getQuestionsForPageType(pageType) {
    return STATIC_QUESTIONS[pageType] || STATIC_QUESTIONS[TYPES.UNKNOWN];
  }

  /**
   * Analyze page signals and generate 1-2 dynamic questions.
   * @param {string} pageType
   * @param {object} [context] - page info object with optional signals
   * @returns {string[]}
   */
  function generateDynamicQuestions(pageType, context) {
    const questions = [];
    const signals = context?.signals || {};

    if (pageType === TYPES.PR) {
      const fileCount = signals.changedFiles || 0;

      if (signals.hasMigrations) {
        questions.push(
          fileCount > 0
            ? `This PR touches ${fileCount} files including a migration — what's the migration impact?`
            : 'This PR includes a database migration — what are the risks?'
        );
      }

      if (!signals.hasTests && fileCount > 2) {
        questions.push('No test files in this PR — what should be tested?');
      }

      if (fileCount > 10) {
        questions.push(`This PR changes ${fileCount} files — can you break down the changes by area?`);
      }

      if (signals.hasConfig) {
        questions.push('This PR modifies config/infra files — what could break?');
      }

      if (signals.prTitle && /\b(revert|rollback|hotfix)\b/i.test(signals.prTitle)) {
        questions.push('This looks like a revert/hotfix — what was the original issue?');
      }

      if (signals.draft) {
        questions.push('This is a draft PR — what seems incomplete or in-progress?');
      }
    }

    if (pageType === TYPES.FILE) {
      const ext = signals.extension || context?.filePath?.split('.').pop() || '';
      if (/^(test|spec)/.test(context?.filePath?.split('/').pop() || '') || /test|spec/i.test(ext)) {
        questions.push('What does this test cover and are there any gaps?');
      }
      if (/\.(yml|yaml|json|toml|properties|xml)$/i.test(context?.filePath || '')) {
        questions.push('What does this configuration control?');
      }
      if (signals.contentLength > 15_000) {
        questions.push('This is a large file — should it be split up?');
      }
    }

    if (pageType === TYPES.REPO) {
      if (signals.manifestCount > 1) {
        questions.push('This repo has multiple package manifests — is it a monorepo?');
      }
      if (!signals.hasReadme) {
        questions.push('There is no README — can you summarize what this repo does from the code?');
      }
    }

    return questions.slice(0, 2);
  }

  /**
   * Blend dynamic questions first, then static (deduped).
   * @param {string} pageType
   * @param {object} [context]
   * @returns {{ text: string, dynamic: boolean }[]}
   */
  function getQuestionChips(pageType, context) {
    const dynamic = generateDynamicQuestions(pageType, context).map((text) => ({
      text,
      dynamic: true,
    }));
    const seen = new Set(dynamic.map((q) => q.text));
    const staticQs = getQuestionsForPageType(pageType)
      .filter((text) => !seen.has(text))
      .map((text) => ({ text, dynamic: false }));
    return [...dynamic, ...staticQs];
  }

  const api = {
    STATIC_QUESTIONS,
    getQuestionsForPageType,
    generateDynamicQuestions,
    getQuestionChips,
  };

  root.RepoLensQuestions = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
