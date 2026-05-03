// loader.js — fetches AES key from relay, decrypts calibration.enc, runs it
(async function () {
    'use strict';

    const RELAY_ORIGIN  = 'https://midimyface-relay.onrender.com';
    const BOOT_ENDPOINT = RELAY_ORIGIN + '/api/boot';
    const ENC_FILE      = '/calibration.enc';

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
            false,
            ['decrypt']
        );
    }

    async function decryptBlob(blob, cryptoKey) {
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

    try {
        const [bootRes, encRes] = await Promise.all([
            fetch(BOOT_ENDPOINT, { credentials: 'omit' }),
            fetch(ENC_FILE,      { credentials: 'omit' }),
        ]);

        if (!bootRes.ok) throw new Error(`Boot key fetch failed: ${bootRes.status}`);
        if (!encRes.ok)  throw new Error(`Enc blob fetch failed: ${encRes.status}`);

        const { key } = await bootRes.json();
        const blob    = await encRes.text();
        const cryptoKey    = await importKey(key);
        const decryptedSrc = await decryptBlob(blob, cryptoKey);

        new Function(decryptedSrc)(); // eslint-disable-line no-new-func
        console.log('[MIDImyFACE] calibration module loaded');

    } catch (err) {
        console.error('[MIDImyFACE] Failed to load calibration module:', err);
        const notice = document.createElement('div');
        notice.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;padding:12px;z-index:99999;font-family:sans-serif;text-align:center';
        notice.textContent = 'MIDImyFACE could not load. Please check your connection and reload.';
        document.body.prepend(notice);
    }
})();
