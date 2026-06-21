/**
 * AES-256-GCM sealing for connector credentials.
 *
 * Envelope format on disk:
 *   base64url( version(1 byte) | iv(12 bytes) | ciphertext | authTag(16 bytes) )
 *
 * The key is read from CRED_ENCRYPTION_KEY at module load. Accepted forms:
 *   - 64 hex chars (32 bytes)
 *   - 32 raw bytes (base64 or utf-8, auto-detected by length)
 *
 * Never log the key, never return plaintext from an HTTP response.
 */
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 0x01;

function loadKey() {
    const raw = process.env.CRED_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error(
            'CRED_ENCRYPTION_KEY is required for connector credential storage. ' +
            'Generate one with: openssl rand -hex 32'
        );
    }
    let buf;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        buf = Buffer.from(raw, 'hex');
    } else if (raw.length === 32) {
        buf = Buffer.from(raw, 'utf8');
    } else {
        buf = Buffer.from(raw, 'base64');
    }
    if (buf.length !== 32) {
        throw new Error(
            `CRED_ENCRYPTION_KEY must decode to 32 bytes; got ${buf.length}. ` +
            'Use a 64-char hex string, 44-char base64, or 32-char utf8.'
        );
    }
    return buf;
}

// Lazy — don't crash the whole user-auth boot if the key is missing
// until something actually tries to encrypt.
let _key = null;
function key() {
    if (_key === null) _key = loadKey();
    return _key;
}

function encrypt(plaintext) {
    if (typeof plaintext !== 'string') {
        plaintext = JSON.stringify(plaintext);
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([Buffer.from([VERSION]), iv, ct, tag]);
    return envelope.toString('base64');
}

function decrypt(ciphertext) {
    const envelope = Buffer.from(ciphertext, 'base64');
    if (envelope[0] !== VERSION) {
        throw new Error('Unknown credential envelope version');
    }
    const iv = envelope.subarray(1, 1 + IV_LENGTH);
    const tag = envelope.subarray(envelope.length - TAG_LENGTH);
    const ct = envelope.subarray(1 + IV_LENGTH, envelope.length - TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
}

function decryptJson(ciphertext) {
    const s = decrypt(ciphertext);
    try {
        return JSON.parse(s);
    } catch {
        return s;
    }
}

module.exports = { encrypt, decrypt, decryptJson };
