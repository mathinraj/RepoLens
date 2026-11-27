ScrollCraft.mount(document.body);

// Firefox visitors get the Firefox Add-ons listing on every "Get RepoLens" link.
if (/Firefox\//.test(navigator.userAgent)) {
  document.querySelectorAll('a[href^="https://chromewebstore.google.com/"]').forEach((a) => {
    if (a.closest('.close__stores')) return;
    a.href = 'https://addons.mozilla.org/firefox/addon/repolens-ai-answers-for-github/';
  });
}
