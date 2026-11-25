/**
 * Feedback + uninstall forms. Messages are delivered by EmailJS
 * (https://www.emailjs.com) to the developer's inbox.
 * The public key below is designed to be public; restrict allowed origins
 * to repolensio.vercel.app in the EmailJS dashboard.
 */
(function () {
  const EMAILJS = {
    serviceId: 'service_em2o2a6',
    // TouchLock's template (its subject says "TouchLock"). Replace with the
    // RepoLens template ID once it exists in the EmailJS dashboard.
    templateId: 'template_6595ut4',
    publicKey: 'R2Yro3gG1FbXS9fJm',
    endpoint: 'https://api.emailjs.com/api/v1.0/email/send',
  };
  const PRODUCT = 'RepoLens';

  const PROVIDERS = { anthropic: 'Anthropic Claude', openai: 'OpenAI', gemini: 'Google Gemini' };
  const BROWSERS = { chrome: 'Chrome', edge: 'Edge' };

  const form = document.getElementById('feedback-form');
  if (!form) return;
  const page = form.dataset.page; // "feedback" | "uninstall"
  const params = new URLSearchParams(location.search);

  const clean = (v, max = 60) => String(v || '').replace(/[^\w .:/@+-]/g, '').slice(0, max);

  /** Human-readable diagnostics from the extension's URL params. */
  function readDiagnostics() {
    const rows = [];
    const add = (label, value) => value && rows.push([label, value]);
    add('RepoLens version', clean(params.get('v'), 20));
    const b = BROWSERS[params.get('b')] || clean(params.get('b'), 20);
    add('Browser', [b, clean(params.get('bv'), 30)].filter(Boolean).join(' '));
    add('Operating system', clean(params.get('os'), 20));
    add('Store build', clean(params.get('s'), 20));
    add('AI provider', PROVIDERS[params.get('p')] || clean(params.get('p'), 20));
    add('Model', clean(params.get('m')));
    if (params.has('k')) add('API key set', params.get('k') === '1' ? 'Yes' : 'No');
    if (params.has('gh')) add('GitHub token set', params.get('gh') === '1' ? 'Yes' : 'No');
    if (params.has('a')) add('Answers received', clean(params.get('a'), 10));
    if (params.has('d')) add('Days installed', clean(params.get('d'), 10));
    return rows;
  }

  const diagnostics = readDiagnostics();
  const diagWrap = document.getElementById('diagnostics');
  const diagList = document.getElementById('diagnostics-list');
  const diagToggle = document.getElementById('include-diagnostics');

  if (diagnostics.length && diagWrap) {
    diagWrap.classList.remove('is-hidden');
    for (const [label, value] of diagnostics) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      diagList.append(dt, dd);
    }
  }

  // Preselect the feedback type from ?type=
  const type = params.get('type');
  if (type) {
    const radio = form.querySelector(`input[name="type"][value="${CSS.escape(type)}"]`);
    if (radio) radio.checked = true;
  }

  const statusEl = document.getElementById('form-status');
  const submitBtn = form.querySelector('button[type="submit"]');

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.className = `form-status ${tone || ''}`;
  }

  function buildMessage() {
    const parts = [];
    const message = form.message.value.trim();
    if (page === 'uninstall') {
      const reasons = [...form.querySelectorAll('input[name="reason"]:checked')].map((el) => el.value);
      parts.push(`Reasons: ${reasons.length ? reasons.join('; ') : '(none selected)'}`);
      if (message) parts.push('', message);
    } else {
      parts.push(message);
    }
    if (diagnostics.length && (!diagToggle || diagToggle.checked)) {
      parts.push('', '---', ...diagnostics.map(([k, v]) => `${k}: ${v}`));
    }
    // Header in the body itself, so the product shows even in templates
    // that don't render {{product}} / {{category}} / {{subject}}.
    return [`[${PRODUCT}] ${category()}`, `Sent from: ${location.origin}${location.pathname}`, '', ...parts].join('\n');
  }

  function category() {
    if (page === 'uninstall') return 'Uninstall survey';
    const labels = { bug: 'Bug report', feature: 'Feature request', question: 'Question', other: 'Feedback' };
    const value = form.querySelector('input[name="type"]:checked')?.value || 'other';
    return labels[value] || 'Feedback';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.website.value) return; // honeypot

    const message = form.message.value.trim();
    const hasReason = page === 'uninstall' && form.querySelector('input[name="reason"]:checked');
    if (page === 'feedback' && message.length < 10) {
      setStatus('Please write at least 10 characters.', 'is-error');
      form.message.focus();
      return;
    }
    if (page === 'uninstall' && !hasReason && !message) {
      setStatus('Pick a reason or write a short note.', 'is-error');
      return;
    }

    submitBtn.disabled = true;
    setStatus('Sending…', '');
    try {
      const res = await fetch(EMAILJS.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: EMAILJS.serviceId,
          template_id: EMAILJS.templateId,
          user_id: EMAILJS.publicKey,
          template_params: {
            product: PRODUCT,
            subject: `[${PRODUCT}] ${category()}`,
            from_name: PRODUCT,
            category: `${PRODUCT} · ${category()}`,
            message: buildMessage(),
            from_email: form.email.value.trim() || 'not provided',
            reply_to: form.email.value.trim() || '',
            version: clean(params.get('v'), 20) || 'unknown',
            timestamp: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const replyNote = form.email.value.trim() ? ' We\u2019ll reply by email if needed.' : '';
      form.reset();
      setStatus(
        page === 'uninstall'
          ? 'Thank you. Your feedback helps make RepoLens better.'
          : `Thanks! Your message has been sent.${replyNote}`,
        'is-ok'
      );
    } catch {
      setStatus('Couldn\u2019t send right now. Please try again in a moment.', 'is-error');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
