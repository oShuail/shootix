/* ==========================================================
   SHOOTIX — passwords & sessions

   Sessions are *stateless signed cookies*, not an in-memory map.
   That matters: the app runs on serverless, where every request
   can hit a fresh instance and any in-memory session table would
   be empty. A signed cookie is verified from the secret alone, so
   logins survive restarts, redeploys and scale-out.

   Revocation still works — each user carries a `token_version`
   that is bumped on password change, which invalidates old cookies.
   ========================================================== */

'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'sx_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/* ----------------------------------------------------------
   Signing secret
   ---------------------------------------------------------- */
function resolveSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

    // No explicit secret: derive a stable one from the service-role key so
    // sessions survive restarts. Random-per-boot would sign everyone out on
    // every cold start.
    const seed = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (seed) return crypto.createHash('sha256').update(`shootix:${seed}`).digest('hex');

    // Local dev with nothing configured.
    return 'shootix-insecure-dev-secret';
}

/* ----------------------------------------------------------
   Passwords (scrypt)
   ---------------------------------------------------------- */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    try {
        const test = crypto.scryptSync(String(password), salt, 64);
        const known = Buffer.from(hash, 'hex');
        return known.length === test.length && crypto.timingSafeEqual(test, known);
    } catch {
        return false;
    }
}

/* ----------------------------------------------------------
   Token signing
   ---------------------------------------------------------- */
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadJson) {
    return crypto.createHmac('sha256', resolveSecret()).update(payloadJson).digest('base64url');
}

/** Create a signed session token for a user. */
function createToken(user) {
    const payload = JSON.stringify({
        u: user.id,
        v: user.token_version || 0,
        e: Date.now() + SESSION_TTL_MS
    });
    return `${b64url(payload)}.${sign(payload)}`;
}

/**
 * Verify a token's signature and expiry.
 * Returns the decoded payload, or null when the token is invalid.
 */
function readToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;

    let payloadJson;
    try {
        payloadJson = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
        return null;
    }

    // Constant-time compare so a wrong signature leaks no timing information.
    const expected = Buffer.from(sign(payloadJson));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

    let payload;
    try { payload = JSON.parse(payloadJson); } catch { return null; }
    if (!payload || typeof payload.u !== 'string') return null;
    if (!payload.e || payload.e < Date.now()) return null;
    return payload;
}

/* ----------------------------------------------------------
   Cookies
   ---------------------------------------------------------- */
function parseCookies(req) {
    const raw = req.headers.cookie || '';
    const out = {};
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

function sessionCookie(token, { secure }) {
    const bits = [
        `${COOKIE_NAME}=${token}`,
        'HttpOnly',
        'Path=/',
        `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
        'SameSite=Lax'
    ];
    if (secure) bits.push('Secure');
    return bits.join('; ');
}

function clearCookie({ secure }) {
    const bits = [`${COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
    if (secure) bits.push('Secure');
    return bits.join('; ');
}

module.exports = {
    COOKIE_NAME,
    SESSION_TTL_MS,
    hashPassword,
    verifyPassword,
    createToken,
    readToken,
    parseCookies,
    sessionCookie,
    clearCookie
};
