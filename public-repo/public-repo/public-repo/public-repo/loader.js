/**
 * loader.js  —  MIDImyFACE encrypted module bootstrap
 *
 * Included in index.html INSTEAD of calibration.js:
 *   <script src="loader.js"></script>
 *
 * What it does:
 *   1. Fetches the AES key from /api/boot on the relay server
 *   2. Fetches calibration.enc (encrypted blob, public)
 *   3. Decrypts using WebCrypto (native browser API — zero libs, zero perf cost)
 *   4. eval()s the decrypted source — runs exactly as if loaded normally
 *
 * Everything after step 4 is identical to the unencrypted path.
 * Typical added latency: ~50–100ms on first load (two parallel fetches).
 */
(async function () {
    'use strict';

    // ── Config ─────────────────────────────────────────────────────────────
    // Change RELAY_ORIGIN to wherever midimyface-relay is hosted
    const RELAY_ORIGIN  = 'https://midimyface-relay.onrender.com';
    const BOOT_ENDPOINT = RELAY_ORIGIN + '/api/boot';
    const ENC_FILE      = '/calibration.enc';

    // ── Helpers ────────────────────────────────────────────────────────────
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf;
    }

    function hexToBytes(hex) {
        const buf = new Uint8Array(hex.length / 2);
        for (let i = 0; i < buf.length; i++) buf[i] = parseInt(hex.slice(i*2, i*2+2), 16);
        return buf;
    }

    async function importKey(hexKey) {
        return crypto.subtle.importKey(
            'raw', hexToBytes(hexKey),
            { name: 'AES-CBC' },
            false,          // not extractable — key cannot be read back out
            ['decrypt']
        );
    }

    async function decryptBlob(blob, cryptoKey) {
        // blob format: base64(iv) + ':' + base64(ciphertext)
        const [ivB64, ctB64] = blob.split(':');
        const iv         = b64ToBytes(ivB64);
        const ciphertext = b64ToBytes(ctB64);
        const plainBuf   = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv },
            cryptoKey,
            ciphertext
        );
        return new TextDecoder().decode(plainBuf);
    }

    // ── Main ───────────────────────────────────────────────────────────────
    try {
        // Parallel fetch: key + encrypted blob at the same time
        const [bootRes, encRes] = await Promise.all([
            fetch(BOOT_ENDPOINT, { credentials: 'omit' }),
            fetch(ENC_FILE,      { credentials: 'omit' }),
        ]);

        if (!bootRes.ok) throw new Error(`Boot key fetch failed: ${bootRes.status}`);
        if (!encRes.ok)  throw new Error(`Enc blob fetch failed:  ${encRes.status}`);

        const { key } = await bootRes.json();
        const blob    = await encRes.text();

        const cryptoKey    = await importKey(key);
        const decryptedSrc = await decryptBlob(blob, cryptoKey);

        // Execute — identical to browser parsing the JS file normally
        // Wrapped in a named function so stack traces are readable during dev
        const fn = new Function(decryptedSrc); // eslint-disable-line no-new-func
        fn();

        console.log('[MIDImyFACE] calibration module loaded');

    } catch (err) {
        // Graceful degradation: show a user-facing error rather than a silent break
        console.error('[MIDImyFACE] Failed to load calibration module:', err);
        const notice = document.createElement('div');
        notice.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;padding:12px;z-index:99999;font-family:sans-serif;text-align:center';
        notice.textContent = 'MIDImyFACE could not load. Please check your connection and reload.';
        document.body.prepend(notice);
    }
})();
