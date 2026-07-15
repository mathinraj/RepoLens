/**
 * Static (and later dynamic) question sets per GitHub page type.
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
   * Phase 5 will analyze context and inject 1–2 dynamic questions.
   * Stubbed here so the panel API stays stable.
   * @param {string} pageType
   * @param {object} [_context]
   * @returns {string[]}
   */
  function generateDynamicQuestions(pageType, _context) {
    return [];
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
