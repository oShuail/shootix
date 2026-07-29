/* ==========================================================
   SHOOTIX — Supabase client
   A small, predictable wrapper over the Supabase REST APIs
   (PostgREST + Storage) built on native fetch, so the whole
   backend keeps a single npm dependency.

   Requires:
     SUPABASE_URL                 https://xxxx.supabase.co
     SUPABASE_SERVICE_ROLE_KEY    service_role key (server only!)
   ========================================================== */

'use strict';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    '';

const GALLERY_BUCKET = process.env.SUPABASE_GALLERY_BUCKET || 'shootix-gallery';
const PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'shootix-private';

/** True when the server has everything it needs to talk to Supabase. */
function isConfigured() {
    return Boolean(SUPABASE_URL && SERVICE_KEY);
}

/** Thrown for any Supabase-side failure so routes can answer with a clean 5xx. */
class SupabaseError extends Error {
    constructor(message, status, details) {
        super(message);
        this.name = 'SupabaseError';
        this.status = status;
        this.details = details;
    }
}

function assertConfigured() {
    if (!isConfigured()) {
        throw new SupabaseError(
            'Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
            503
        );
    }
}

function baseHeaders(extra = {}) {
    return {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        ...extra
    };
}

/* ----------------------------------------------------------
   Postgres (PostgREST)
   ---------------------------------------------------------- */

/**
 * Build a PostgREST querystring.
 * `filters` values are passed through verbatim, e.g. { id: 'eq.123' }.
 * An array value repeats the key, which is how PostgREST expresses a range:
 * { date: ['gte.2026-01-01', 'lte.2026-12-31'] }.
 */
function buildQuery({ select, filters, order, limit, offset } = {}) {
    const params = new URLSearchParams();
    if (select) params.set('select', select);
    for (const [key, value] of Object.entries(filters || {})) {
        if (value === undefined || value === null) continue;
        for (const one of Array.isArray(value) ? value : [value]) {
            if (one !== undefined && one !== null) params.append(key, one);
        }
    }
    if (order) params.set('order', order);
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

async function restRequest(method, table, { body, query, prefer, expectJson = true } = {}) {
    assertConfigured();

    const url = `${SUPABASE_URL}/rest/v1/${table}${buildQuery(query)}`;
    const headers = baseHeaders({ 'Content-Type': 'application/json' });
    if (prefer) headers.Prefer = prefer;

    let res;
    try {
        res = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (err) {
        throw new SupabaseError(`Could not reach Supabase: ${err.message}`, 503);
    }

    const text = await res.text();
    if (!res.ok) {
        let detail = text;
        try { detail = JSON.parse(text).message || JSON.parse(text).hint || text; } catch { /* raw text */ }
        throw new SupabaseError(`Supabase ${method} ${table} failed: ${detail}`, res.status, text);
    }
    if (!expectJson || !text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

const db = {
    /** SELECT rows. Returns an array (possibly empty). */
    async select(table, query = {}) {
        return (await restRequest('GET', table, { query })) || [];
    },

    /** SELECT a single row, or null. */
    async selectOne(table, query = {}) {
        const rows = await db.select(table, { ...query, limit: 1 });
        return rows[0] || null;
    },

    /** INSERT one row and return it. */
    async insert(table, row) {
        const rows = await restRequest('POST', table, {
            body: [row],
            prefer: 'return=representation'
        });
        return (rows || [])[0] || null;
    },

    /** UPDATE rows matching `filters` and return the first updated row. */
    async update(table, patch, filters) {
        const rows = await restRequest('PATCH', table, {
            body: patch,
            query: { filters },
            prefer: 'return=representation'
        });
        return (rows || [])[0] || null;
    },

    /** DELETE rows matching `filters`. Returns the deleted rows. */
    async remove(table, filters) {
        return (await restRequest('DELETE', table, {
            query: { filters },
            prefer: 'return=representation'
        })) || [];
    },

    /** Call a Postgres function. */
    async rpc(fn, args = {}) {
        return restRequest('POST', `rpc/${fn}`, { body: args });
    },

    /** Row count for a table, using PostgREST's exact count header. */
    async count(table, filters = {}) {
        assertConfigured();
        const url = `${SUPABASE_URL}/rest/v1/${table}${buildQuery({ select: 'id', filters, limit: 1 })}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: baseHeaders({ Prefer: 'count=exact' })
        });
        if (!res.ok) throw new SupabaseError(`Supabase count ${table} failed`, res.status);
        const range = res.headers.get('content-range') || '';
        const total = Number(range.split('/')[1]);
        return Number.isFinite(total) ? total : 0;
    }
};

/* ----------------------------------------------------------
   Storage
   ---------------------------------------------------------- */

const storage = {
    galleryBucket: GALLERY_BUCKET,
    privateBucket: PRIVATE_BUCKET,

    /** Public CDN URL for an object in a public bucket. */
    publicUrl(bucket, objectPath) {
        return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
    },

    /** Upload (or replace) an object. Returns its storage path. */
    async upload(bucket, objectPath, buffer, contentType = 'application/octet-stream') {
        assertConfigured();
        const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: baseHeaders({
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    // replace instead of erroring when the path already exists
                    'x-upsert': 'true'
                }),
                body: buffer
            });
        } catch (err) {
            throw new SupabaseError(`Could not reach Supabase Storage: ${err.message}`, 503);
        }

        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new SupabaseError(`Upload failed: ${detail || res.statusText}`, res.status);
        }
        return objectPath;
    },

    /** Download an object as a Buffer, or null when it does not exist. */
    async download(bucket, objectPath) {
        assertConfigured();
        const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
        const res = await fetch(url, { headers: baseHeaders() });
        if (res.status === 404) return null;
        if (!res.ok) throw new SupabaseError(`Download failed: ${res.statusText}`, res.status);
        return Buffer.from(await res.arrayBuffer());
    },

    /** Delete objects. Never throws — a missing file is not worth a 500. */
    async remove(bucket, objectPaths) {
        if (!isConfigured() || objectPaths.length === 0) return;
        const url = `${SUPABASE_URL}/storage/v1/object/${bucket}`;
        try {
            await fetch(url, {
                method: 'DELETE',
                headers: baseHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ prefixes: objectPaths })
            });
        } catch { /* best effort */ }
    }
};

/* ----------------------------------------------------------
   Health check — used by /api/health and the admin setup banner
   ---------------------------------------------------------- */
async function health() {
    if (!isConfigured()) {
        return { ok: false, configured: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' };
    }
    try {
        await db.select('shootix_users', { select: 'id', limit: 1 });
        return { ok: true, configured: true };
    } catch (err) {
        return { ok: false, configured: true, error: err.message };
    }
}

module.exports = { db, storage, health, isConfigured, SupabaseError, SUPABASE_URL };
