/**
 * Optional Touch ID / Windows Hello lock for the keys on the Preferences page.
 * Uses a WebAuthn platform credential; Chromium accepts the extension ID as the
 * RP ID, so changing it would orphan every registered credential.
 * This gates the UI only — keys in chrome.storage.local are not encrypted.
 */
(function (root) {
  const { STORAGE } = root.REPOLENS;
  const RP_ID = location.hostname;

  function toBase64(buffer) {
    let binary = '';
    new Uint8Array(buffer).forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  /** "Touch ID", "Windows Hello", or a generic name for other platforms. */
  function authName() {
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    if (/mac/i.test(platform)) return 'Touch ID';
    if (/win/i.test(platform)) return 'Windows Hello';
    return 'your device sign-in';
  }

  async function isAvailable() {
    try {
      return Boolean(root.PublicKeyCredential)
        && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /** @returns {Promise<string|null>} the registered credential id, if the lock is on */
  async function credentialId() {
    const { [STORAGE.KEY_LOCK]: lock } = await chrome.storage.local.get(STORAGE.KEY_LOCK);
    return lock?.credentialId || null;
  }

  function friendlyError(err) {
    if (err?.name === 'NotAllowedError') return 'Verification was cancelled or timed out.';
    if (err?.name === 'InvalidStateError') return 'This device already has a RepoLens credential. Try again.';
    return `Verification failed: ${err?.message || err}`;
  }

  /** Register a platform credential (prompts for fingerprint / face / PIN). */
  async function enable() {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'RepoLens', id: RP_ID },
        user: { id: randomBytes(16), name: 'repolens-keys', displayName: 'RepoLens API keys' },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60000,
        attestation: 'none',
      },
    });
    const id = toBase64(credential.rawId);
    await chrome.storage.local.set({ [STORAGE.KEY_LOCK]: { credentialId: id, enabledAt: Date.now() } });
    return id;
  }

  /** Prompt the OS for verification against the registered credential. */
  async function verify(id) {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: RP_ID,
        allowCredentials: [{ id: fromBase64(id), type: 'public-key', transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return Boolean(assertion);
  }

  async function disable() {
    await chrome.storage.local.remove(STORAGE.KEY_LOCK);
  }

  root.RepoLensKeyLock = { authName, isAvailable, credentialId, enable, verify, disable, friendlyError };
})(globalThis);
