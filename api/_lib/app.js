/* ==========================================================
   SHOOTIX — API

   Serves the site and everything behind it:
     • team accounts (admins + employees)
     • the portfolio images shown on the public site
     • client receipts, and the Excel ledger they feed

   All state lives in Supabase (Postgres + Storage), so nothing
   is lost on restart, redeploy or scale-out.
   ========================================================== */

'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { db, storage, health, isConfigured, SupabaseError, SUPABASE_URL } = require('./supabase');
const auth = require('./auth');
const ledger = require('./ledger');

const ROOT = path.join(__dirname, '..', '..');

const CATEGORIES = ['cars', 'food', 'realestate', 'events', 'products', 'fashion'];
const RECEIPT_STATUSES = ['paid', 'partial', 'unpaid'];
const VAT_RATE = 0.15;
// Vercel caps a serverless request body at ~4.5 MB, so anything larger must go
// straight to Supabase Storage from the browser via a signed upload URL.
const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));

/* ==========================================================
   Helpers
   ========================================================== */

/** Wrap an async route so a rejected promise becomes a clean error response. */
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const isHttps = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Strip characters that carry meaning inside a PostgREST filter. */
const safeSearch = (v) => str(v, 80).replace(/[,()*\\"':.]/g, ' ').trim();

/* ---------- row  →  API shape ---------- */
function publicUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        name: row.name,
        role: row.role,
        active: row.active !== false,
        email: row.email || '',
        phone: row.phone || '',
        jobTitle: row.job_title || '',
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at || null
    };
}

function publicImage(row) {
    return {
        id: row.id,
        category: row.category,
        title: row.title || '',
        titleEn: row.title_en || '',
        src: row.url,
        path: row.storage_path,
        bytes: row.bytes || 0,
        featured: Boolean(row.featured),
        sortOrder: row.sort_order || 0,
        uploadedBy: row.uploaded_by || '',
        createdAt: row.created_at
    };
}

function publicReceipt(row) {
    return {
        id: row.id,
        number: row.number,
        date: row.date,
        clientName: row.client_name,
        clientPhone: row.client_phone || '',
        clientEmail: row.client_email || '',
        project: row.project || '',
        paymentMethod: row.payment_method || '',
        status: row.status || 'paid',
        notes: row.notes || '',
        items: Array.isArray(row.items) ? row.items : [],
        subtotal: Number(row.subtotal) || 0,
        discount: Number(row.discount) || 0,
        vatEnabled: row.vat_enabled !== false,
        vat: Number(row.vat) || 0,
        total: Number(row.total) || 0,
        createdBy: row.created_by || '',
        createdById: row.created_by_id || null,
        createdAt: row.created_at
    };
}

/* ==========================================================
   First-run admin account
   Created lazily, once per instance, guarded by the unique
   index on username so two cold starts cannot both create it.
   ========================================================== */
let bootstrapPromise = null;

async function ensureBootstrapAdmin() {
    if (!isConfigured()) return;
    if (!bootstrapPromise) {
        bootstrapPromise = (async () => {
            const existing = await db.selectOne('shootix_users', {
                select: 'id',
                filters: { role: 'eq.admin' }
            });
            if (existing) return;

            const password = process.env.SHOOTIX_ADMIN_PASSWORD || 'shootix-admin';
            try {
                await db.insert('shootix_users', {
                    username: 'admin',
                    name: 'ShotiX Admin',
                    role: 'admin',
                    password_hash: auth.hashPassword(password)
                });
                console.log('[shootix] first-run admin created — username "admin". Change the password now.');
            } catch (err) {
                // 409 = another instance won the race, which is fine.
                if (err.status !== 409) throw err;
            }
        })().catch((err) => {
            bootstrapPromise = null; // let the next request retry
            throw err;
        });
    }
    return bootstrapPromise;
}

/* ==========================================================
   Auth middleware
   ========================================================== */
async function loadUser(req) {
    const token = auth.parseCookies(req)[auth.COOKIE_NAME];
    if (!token) return null;
    const payload = auth.readToken(token);
    if (!payload) return null;

    const user = await db.selectOne('shootix_users', { filters: { id: `eq.${payload.u}` } });
    if (!user || user.active === false) return null;
    // A password change bumps token_version, retiring every cookie issued before it.
    if ((user.token_version || 0) !== (payload.v || 0)) return null;
    return user;
}

const requireAuth = route(async (req, res, next) => {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
});

const requireAdmin = route(async (req, res, next) => {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    req.user = user;
    next();
});

/* ==========================================================
   HEALTH
   ========================================================== */
app.get('/api/health', route(async (req, res) => {
    const supabase = await health();
    if (supabase.ok) await ensureBootstrapAdmin().catch(() => {});
    res.json({
        ok: supabase.ok,
        supabase,
        storageBuckets: { gallery: storage.galleryBucket, private: storage.privateBucket },
        time: new Date().toISOString()
    });
}));

/* ==========================================================
   AUTH
   ========================================================== */
app.post('/api/login', route(async (req, res) => {
    if (!isConfigured()) {
        return res.status(503).json({ error: 'الخادم غير مهيأ بعد — Supabase غير مضبوط.' });
    }
    await ensureBootstrapAdmin();

    const username = str(req.body?.username, 40).toLowerCase();
    const password = String(req.body?.password ?? '');

    const user = await db.selectOne('shootix_users', { filters: { username: `eq.${username}` } });
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    if (user.active === false) {
        return res.status(403).json({ error: 'تم إيقاف هذا الحساب — راجع المسؤول.' });
    }

    db.update('shootix_users', { last_login_at: new Date().toISOString() }, { id: `eq.${user.id}` })
        .catch(() => { /* a failed timestamp must not block the login */ });

    res.setHeader('Set-Cookie', auth.sessionCookie(auth.createToken(user), { secure: isHttps(req) }));
    res.json({ user: publicUser(user) });
}));

app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearCookie({ secure: isHttps(req) }));
    res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/change-password', requireAuth, route(async (req, res) => {
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '');

    if (!auth.verifyPassword(current, req.user.password_hash)) {
        return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }
    if (next.length < 8) {
        return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل' });
    }

    // Bump token_version so sessions on other devices are signed out.
    const updated = await db.update('shootix_users', {
        password_hash: auth.hashPassword(next),
        token_version: (req.user.token_version || 0) + 1
    }, { id: `eq.${req.user.id}` });

    // Keep *this* device logged in with a freshly signed cookie.
    res.setHeader('Set-Cookie', auth.sessionCookie(auth.createToken(updated), { secure: isHttps(req) }));
    res.json({ ok: true });
}));

/* ==========================================================
   TEAM MEMBERS  (admin only)
   ========================================================== */
app.get('/api/users', requireAdmin, route(async (req, res) => {
    const rows = await db.select('shootix_users', { order: 'created_at.asc' });
    res.json({ users: rows.map(publicUser) });
}));

app.post('/api/users', requireAdmin, route(async (req, res) => {
    const username = str(req.body?.username, 30).toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
        return res.status(400).json({ error: 'اسم المستخدم: ٣–٣٠ حرفاً إنجليزياً أو أرقاماً أو . _ - فقط' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل' });
    }

    const clash = await db.selectOne('shootix_users', {
        select: 'id',
        filters: { username: `eq.${username}` }
    });
    if (clash) return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });

    const row = await db.insert('shootix_users', {
        username,
        name: str(req.body?.name, 80) || username,
        role: req.body?.role === 'admin' ? 'admin' : 'employee',
        password_hash: auth.hashPassword(password),
        email: str(req.body?.email, 120),
        phone: str(req.body?.phone, 30),
        job_title: str(req.body?.jobTitle, 60)
    });
    res.json({ user: publicUser(row) });
}));

app.patch('/api/users/:id', requireAdmin, route(async (req, res) => {
    const target = await db.selectOne('shootix_users', { filters: { id: `eq.${req.params.id}` } });
    if (!target) return res.status(404).json({ error: 'الحساب غير موجود' });

    const patch = {};
    if (req.body?.name !== undefined) patch.name = str(req.body.name, 80);
    if (req.body?.email !== undefined) patch.email = str(req.body.email, 120);
    if (req.body?.phone !== undefined) patch.phone = str(req.body.phone, 30);
    if (req.body?.jobTitle !== undefined) patch.job_title = str(req.body.jobTitle, 60);
    if (req.body?.role !== undefined) patch.role = req.body.role === 'admin' ? 'admin' : 'employee';
    if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);

    // Guard rails: never let an admin lock every admin out of the panel.
    const losingAdmin =
        (patch.role === 'employee' && target.role === 'admin') ||
        (patch.active === false && target.role === 'admin');
    if (losingAdmin) {
        if (target.id === req.user.id) {
            return res.status(400).json({ error: 'لا يمكنك سحب صلاحيتك من نفسك' });
        }
        const admins = await db.select('shootix_users', {
            select: 'id',
            filters: { role: 'eq.admin', active: 'eq.true' }
        });
        if (admins.length <= 1) {
            return res.status(400).json({ error: 'يجب أن يبقى مسؤول واحد فعّال على الأقل' });
        }
    }

    const row = await db.update('shootix_users', patch, { id: `eq.${target.id}` });
    res.json({ user: publicUser(row) });
}));

app.post('/api/users/:id/reset-password', requireAdmin, route(async (req, res) => {
    const password = String(req.body?.newPassword ?? '');
    if (password.length < 8) {
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل' });
    }
    const target = await db.selectOne('shootix_users', { filters: { id: `eq.${req.params.id}` } });
    if (!target) return res.status(404).json({ error: 'الحساب غير موجود' });

    await db.update('shootix_users', {
        password_hash: auth.hashPassword(password),
        token_version: (target.token_version || 0) + 1
    }, { id: `eq.${target.id}` });

    res.json({ ok: true });
}));

app.delete('/api/users/:id', requireAdmin, route(async (req, res) => {
    const target = await db.selectOne('shootix_users', { filters: { id: `eq.${req.params.id}` } });
    if (!target) return res.status(404).json({ error: 'الحساب غير موجود' });
    if (target.id === req.user.id) {
        return res.status(400).json({ error: 'لا يمكنك حذف حسابك الخاص' });
    }
    if (target.role === 'admin') {
        const admins = await db.select('shootix_users', { select: 'id', filters: { role: 'eq.admin' } });
        if (admins.length <= 1) {
            return res.status(400).json({ error: 'يجب أن يبقى مسؤول واحد على الأقل' });
        }
    }
    await db.remove('shootix_users', { id: `eq.${target.id}` });
    res.json({ ok: true });
}));

/* ==========================================================
   PORTFOLIO IMAGES
   Public read; admins upload. Files live in Supabase Storage,
   metadata in Postgres.
   ========================================================== */

/** Sniff the real type from magic bytes — never trust the declared MIME. */
function sniffImage(buffer) {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
    if (buffer.toString('ascii', 0, 8) === '\x89PNG\r\n\x1a\n') return { ext: 'png', mime: 'image/png' };
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
    if (buffer.toString('ascii', 0, 6) === 'GIF89a' || buffer.toString('ascii', 0, 6) === 'GIF87a') return { ext: 'gif', mime: 'image/gif' };
    return null;
}

const newObjectPath = (category, ext) =>
    `${category}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

app.get('/api/gallery', route(async (req, res) => {
    if (!isConfigured()) return res.json({ images: [] });
    try {
        const rows = await db.select('shootix_gallery', { order: 'sort_order.asc,created_at.asc' });
        // Cached briefly at the edge — the public site hits this on every page load.
        res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
        res.json({ images: rows.map(publicImage) });
    } catch {
        // The public site must render even if the database is briefly unreachable.
        res.json({ images: [] });
    }
}));

/**
 * Hand the browser a one-shot signed URL so large images upload straight to
 * Supabase, bypassing the serverless request-body limit entirely.
 */
app.post('/api/gallery/sign-upload', requireAdmin, route(async (req, res) => {
    const category = str(req.body?.category, 20);
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'قسم غير معروف' });

    const ext = (str(req.body?.filename, 200).split('.').pop() || 'jpg').toLowerCase();
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
    const objectPath = newObjectPath(category, safeExt);

    const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/upload/sign/${storage.galleryBucket}/${objectPath}`,
        {
            method: 'POST',
            headers: {
                apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        }
    );
    if (!signRes.ok) {
        const detail = await signRes.text().catch(() => '');
        return res.status(502).json({ error: `تعذر تجهيز الرفع: ${detail || signRes.statusText}` });
    }
    const { token } = await signRes.json();

    res.json({
        uploadUrl: `${SUPABASE_URL}/storage/v1/object/upload/sign/${storage.galleryBucket}/${objectPath}?token=${token}`,
        path: objectPath,
        publicUrl: storage.publicUrl(storage.galleryBucket, objectPath)
    });
}));

app.post('/api/gallery', requireAdmin, route(async (req, res) => {
    const category = str(req.body?.category, 20);
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'قسم غير معروف' });

    const meta = {
        category,
        title: str(req.body?.title, 120),
        title_en: str(req.body?.titleEn, 120),
        featured: Boolean(req.body?.featured),
        uploaded_by: req.user.username
    };

    let objectPath;
    let bytes = Number(req.body?.bytes) || 0;

    if (req.body?.path) {
        // Path A — the browser already uploaded via a signed URL. Confirm the
        // object really exists so a client can't register a phantom image.
        objectPath = str(req.body.path, 300);
        if (!objectPath.startsWith(`${category}/`)) {
            return res.status(400).json({ error: 'مسار الملف غير صالح' });
        }
        const stored = await storage.download(storage.galleryBucket, objectPath);
        if (!stored) return res.status(400).json({ error: 'لم يكتمل رفع الصورة — حاول مرة أخرى' });
        if (!sniffImage(stored)) {
            await storage.remove(storage.galleryBucket, [objectPath]);
            return res.status(400).json({ error: 'الملف ليس صورة صالحة' });
        }
        bytes = stored.length;
    } else {
        // Path B — small image sent inline as a data URL.
        const match = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(req.body?.image || ''));
        if (!match) return res.status(400).json({ error: 'الصورة يجب أن تكون PNG أو JPG أو WEBP أو GIF' });

        const buffer = Buffer.from(match[1], 'base64');
        if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
            return res.status(413).json({ error: 'الصورة كبيرة — استخدم الرفع المباشر' });
        }
        const kind = sniffImage(buffer);
        if (!kind) return res.status(400).json({ error: 'الملف ليس صورة صالحة' });

        objectPath = newObjectPath(category, kind.ext);
        await storage.upload(storage.galleryBucket, objectPath, buffer, kind.mime);
        bytes = buffer.length;
    }

    const row = await db.insert('shootix_gallery', {
        ...meta,
        storage_path: objectPath,
        url: storage.publicUrl(storage.galleryBucket, objectPath),
        bytes
    });
    res.json({ image: publicImage(row) });
}));

app.patch('/api/gallery/:id', requireAdmin, route(async (req, res) => {
    const patch = {};
    if (req.body?.title !== undefined) patch.title = str(req.body.title, 120);
    if (req.body?.titleEn !== undefined) patch.title_en = str(req.body.titleEn, 120);
    if (req.body?.featured !== undefined) patch.featured = Boolean(req.body.featured);
    if (req.body?.sortOrder !== undefined) patch.sort_order = Number(req.body.sortOrder) || 0;
    if (req.body?.category !== undefined) {
        const category = str(req.body.category, 20);
        if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'قسم غير معروف' });
        patch.category = category;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'لا يوجد تغيير' });

    const row = await db.update('shootix_gallery', patch, { id: `eq.${req.params.id}` });
    if (!row) return res.status(404).json({ error: 'الصورة غير موجودة' });
    res.json({ image: publicImage(row) });
}));

app.delete('/api/gallery/:id', requireAdmin, route(async (req, res) => {
    const removed = await db.remove('shootix_gallery', { id: `eq.${req.params.id}` });
    if (removed.length === 0) return res.status(404).json({ error: 'الصورة غير موجودة' });
    await storage.remove(storage.galleryBucket, removed.map((r) => r.storage_path));
    res.json({ ok: true });
}));

/* ==========================================================
   RECEIPTS
   ========================================================== */

/** Employees only ever see their own receipts; admins see everything. */
const scopeFilter = (user) => (user.role === 'admin' ? {} : { created_by_id: `eq.${user.id}` });

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function receiptFilters(req) {
    const filters = { ...scopeFilter(req.user) };

    const status = str(req.query.status, 12);
    if (RECEIPT_STATUSES.includes(status)) filters.status = `eq.${status}`;

    // Both ends of the range live under the same key — PostgREST ANDs repeats.
    const range = [];
    const from = str(req.query.from, 10);
    const to = str(req.query.to, 10);
    if (isDate(from)) range.push(`gte.${from}`);
    if (isDate(to)) range.push(`lte.${to}`);
    if (range.length) filters.date = range;

    const q = safeSearch(req.query.q);
    if (q) {
        filters.or = `(client_name.ilike.*${q}*,number.ilike.*${q}*,project.ilike.*${q}*,client_phone.ilike.*${q}*)`;
    }
    return filters;
}

app.get('/api/receipts', requireAuth, route(async (req, res) => {
    const rows = await db.select('shootix_receipts', {
        filters: receiptFilters(req),
        order: 'created_at.desc',
        limit: Math.min(Number(req.query.limit) || 200, 500),
        offset: Math.max(Number(req.query.offset) || 0, 0)
    });
    res.json({ receipts: rows.map(publicReceipt) });
}));

app.get('/api/receipts/:id', requireAuth, route(async (req, res) => {
    const row = await db.selectOne('shootix_receipts', { filters: { id: `eq.${req.params.id}` } });
    if (!row) return res.status(404).json({ error: 'الإيصال غير موجود' });
    if (req.user.role !== 'admin' && row.created_by_id !== req.user.id) {
        return res.status(403).json({ error: 'هذا الإيصال ليس من إصدارك' });
    }
    res.json({ receipt: publicReceipt(row) });
}));

app.post('/api/receipts', requireAuth, route(async (req, res) => {
    const b = req.body || {};

    const items = (Array.isArray(b.items) ? b.items : [])
        .map((i) => ({
            description: str(i.description, 200),
            qty: Math.max(1, Math.min(Number(i.qty) || 1, 100000)),
            price: Math.max(0, money(i.price))
        }))
        .filter((i) => i.description);

    if (!str(b.clientName, 120)) return res.status(400).json({ error: 'اسم العميل مطلوب' });
    if (items.length === 0) return res.status(400).json({ error: 'أضف بنداً واحداً على الأقل' });

    const subtotal = money(items.reduce((sum, i) => sum + i.qty * i.price, 0));
    const discount = money(Math.min(subtotal, Math.max(0, Number(b.discount) || 0)));
    const vatEnabled = b.vatEnabled !== false;
    const vat = money(vatEnabled ? (subtotal - discount) * VAT_RATE : 0);

    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(b.date, 10))
        ? str(b.date, 10)
        : new Date().toISOString().slice(0, 10);

    // Reserved in Postgres, so two people saving at once can never share a number.
    const numbering = await db.rpc('shootix_next_receipt_number', {
        p_year: Number(date.slice(0, 4))
    });
    const { next_seq: seq, next_number: number } = Array.isArray(numbering) ? numbering[0] : numbering;

    const row = await db.insert('shootix_receipts', {
        number,
        seq,
        date,
        client_name: str(b.clientName, 120),
        client_phone: str(b.clientPhone, 30),
        client_email: str(b.clientEmail, 120),
        project: str(b.project, 160),
        payment_method: str(b.paymentMethod, 40),
        status: RECEIPT_STATUSES.includes(b.status) ? b.status : 'paid',
        notes: str(b.notes, 1000),
        items,
        subtotal,
        discount,
        vat_enabled: vatEnabled,
        vat,
        total: money(subtotal - discount + vat),
        created_by: req.user.name,
        created_by_id: req.user.id
    });

    await syncLedger();
    res.json({ receipt: publicReceipt(row) });
}));

app.patch('/api/receipts/:id', requireAuth, route(async (req, res) => {
    const row = await db.selectOne('shootix_receipts', { filters: { id: `eq.${req.params.id}` } });
    if (!row) return res.status(404).json({ error: 'الإيصال غير موجود' });
    if (req.user.role !== 'admin' && row.created_by_id !== req.user.id) {
        return res.status(403).json({ error: 'هذا الإيصال ليس من إصدارك' });
    }

    const patch = {};
    if (req.body?.status !== undefined) {
        if (!RECEIPT_STATUSES.includes(req.body.status)) {
            return res.status(400).json({ error: 'حالة غير معروفة' });
        }
        patch.status = req.body.status;
    }
    if (req.body?.notes !== undefined) patch.notes = str(req.body.notes, 1000);
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'لا يوجد تغيير' });

    const updated = await db.update('shootix_receipts', patch, { id: `eq.${row.id}` });
    await syncLedger();
    res.json({ receipt: publicReceipt(updated) });
}));

app.delete('/api/receipts/:id', requireAdmin, route(async (req, res) => {
    const removed = await db.remove('shootix_receipts', { id: `eq.${req.params.id}` });
    if (removed.length === 0) return res.status(404).json({ error: 'الإيصال غير موجود' });
    await syncLedger();
    res.json({ ok: true });
}));

/* ---------- the Excel ledger ---------- */
async function allReceipts() {
    const rows = await db.select('shootix_receipts', { order: 'created_at.asc', limit: 5000 });
    return rows.map(publicReceipt);
}

/** Refresh the master workbook in Storage. Never allowed to fail a request. */
async function syncLedger() {
    try {
        await ledger.sync(await allReceipts());
    } catch (err) {
        console.error('[ledger] refresh failed:', err.message);
    }
}

app.get('/api/receipts.xlsx', requireAuth, route(async (req, res) => {
    const rows = await db.select('shootix_receipts', {
        filters: scopeFilter(req.user),
        order: 'created_at.asc',
        limit: 5000
    });
    const book = ledger.build(rows.map(publicReceipt));
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', ledger.XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="shootix-receipts-${stamp}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(book);
}));

/* ==========================================================
   DASHBOARD STATS  (admin)
   ========================================================== */
app.get('/api/stats', requireAdmin, route(async (req, res) => {
    const [receipts, images, users] = await Promise.all([
        db.select('shootix_receipts', { select: 'total,date,status,created_at', limit: 5000 }),
        db.count('shootix_gallery'),
        db.select('shootix_users', { select: 'id,role,active' })
    ]);

    const month = new Date().toISOString().slice(0, 7);
    const monthReceipts = receipts.filter((r) => String(r.date || '').startsWith(month));
    const sum = (list) => money(list.reduce((t, r) => t + (Number(r.total) || 0), 0));

    res.json({
        receipts: {
            count: receipts.length,
            total: sum(receipts),
            monthCount: monthReceipts.length,
            monthTotal: sum(monthReceipts),
            unpaid: receipts.filter((r) => r.status === 'unpaid').length
        },
        images,
        team: {
            total: users.length,
            admins: users.filter((u) => u.role === 'admin').length,
            active: users.filter((u) => u.active !== false).length
        }
    });
}));

/* ==========================================================
   STATIC SITE
   ========================================================== */
app.use('/data', (req, res) => res.status(403).json({ error: 'Forbidden' }));
app.use(express.static(ROOT, { extensions: ['html'], maxAge: '1h' }));

/* ==========================================================
   ERRORS
   ========================================================== */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err instanceof SupabaseError) {
        console.error('[supabase]', err.message);
        return res.status(err.status >= 400 && err.status < 600 ? err.status : 500)
            .json({ error: 'تعذر الوصول لقاعدة البيانات — حاول مرة أخرى.' });
    }
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'الملف كبير جداً' });
    }
    console.error('[error]', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

module.exports = app;
