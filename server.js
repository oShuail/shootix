/* ==========================================================
   SHOTIX — Backend server
   - Serves the static website
   - Auth (admin / employee accounts, session cookies)
   - Admin-only image management for the portfolio
   - Staff receipts (created in the portal, printed as PDF)
   - Every receipt is also appended to an Excel ledger (.xlsx)
   Run:  npm install && npm start   →  http://localhost:3000
   ========================================================== */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const xlsx = require('./lib/xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'assets', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ---------- tiny JSON file store ---------- */
function loadJSON(name, fallback) {
    const file = path.join(DATA_DIR, name);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
}
function saveJSON(name, value) {
    const file = path.join(DATA_DIR, name);
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

let users = loadJSON('users.json', []);
let gallery = loadJSON('gallery.json', []);
let receipts = loadJSON('receipts.json', []);
let meta = loadJSON('meta.json', { receiptCounter: 0 });

/* ---------- passwords (scrypt, no external deps) ---------- */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(password, salt, 64);
    const known = Buffer.from(hash, 'hex');
    return known.length === test.length && crypto.timingSafeEqual(test, known);
}

/* ---------- first-run admin account ---------- */
if (!users.some(u => u.role === 'admin')) {
    const initialPassword = process.env.SHOTIX_ADMIN_PASSWORD || 'shotix-admin';
    users.push({
        id: crypto.randomUUID(),
        username: 'admin',
        name: 'Shotix Admin',
        role: 'admin',
        password: hashPassword(initialPassword),
        createdAt: new Date().toISOString()
    });
    saveJSON('users.json', users);
    console.log('──────────────────────────────────────────────');
    console.log('  First run: admin account created');
    console.log(`  username: admin   password: ${initialPassword}`);
    console.log('  ⚠ Change this password right after logging in.');
    console.log('──────────────────────────────────────────────');
}

/* ---------- sessions (in-memory, 7 days) ---------- */
const sessions = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId, expires: Date.now() + SESSION_TTL });
    return token;
}
function getSessionUser(req) {
    const cookies = Object.fromEntries(
        (req.headers.cookie || '').split(';').map(c => {
            const i = c.indexOf('=');
            return i === -1 ? [c.trim(), ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
        })
    );
    const token = cookies.sx_session;
    if (!token) return null;
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) { sessions.delete(token); return null; }
    return users.find(u => u.id === session.userId) || null;
}
function requireAuth(req, res, next) {
    const user = getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
}
function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        next();
    });
}
function publicUser(u) {
    return { id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt };
}

/* ---------- middleware ---------- */
app.use(express.json({ limit: '12mb' }));
app.use('/data', (req, res) => res.status(403).json({ error: 'Forbidden' }));

/* ==========================================================
   AUTH
   ========================================================== */
app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = users.find(u => u.username === String(username || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(password || ''), user.password)) {
        return res.status(401).json({ error: 'Wrong username or password' });
    }
    const token = createSession(user.id);
    res.setHeader('Set-Cookie',
        `sx_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax`);
    res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
    const match = (req.headers.cookie || '').match(/sx_session=([^;]+)/);
    if (match) sessions.delete(match[1]);
    res.setHeader('Set-Cookie', 'sx_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!verifyPassword(String(currentPassword || ''), req.user.password)) {
        return res.status(400).json({ error: 'Current password is wrong' });
    }
    if (String(newPassword || '').length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    req.user.password = hashPassword(String(newPassword));
    saveJSON('users.json', users);
    res.json({ ok: true });
});

/* ==========================================================
   USERS (admin only)
   ========================================================== */
app.get('/api/users', requireAdmin, (req, res) => res.json({ users: users.map(publicUser) }));

app.post('/api/users', requireAdmin, (req, res) => {
    const { username, name, password, role } = req.body || {};
    const uname = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(uname)) {
        return res.status(400).json({ error: 'Username: 3–30 chars, letters/numbers/._- only' });
    }
    if (users.some(u => u.username === uname)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    if (String(password || '').length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = {
        id: crypto.randomUUID(),
        username: uname,
        name: String(name || uname).trim(),
        role: role === 'admin' ? 'admin' : 'employee',
        password: hashPassword(String(password)),
        createdAt: new Date().toISOString()
    };
    users.push(user);
    saveJSON('users.json', users);
    res.json({ user: publicUser(user) });
});

app.post('/api/users/:id/reset-password', requireAdmin, (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { newPassword } = req.body || {};
    if (String(newPassword || '').length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    user.password = hashPassword(String(newPassword));
    saveJSON('users.json', users);
    res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    users = users.filter(u => u.id !== user.id);
    saveJSON('users.json', users);
    res.json({ ok: true });
});

/* ==========================================================
   GALLERY (public read, admin write)
   Categories match the homepage portfolio sections.
   ========================================================== */
const CATEGORIES = ['cars', 'food', 'realestate', 'events', 'products', 'fashion'];

app.get('/api/gallery', (req, res) => res.json({ images: gallery }));

app.post('/api/gallery', requireAdmin, (req, res) => {
    const { title, titleEn, category, image } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(String(image || ''));
    if (!match) return res.status(400).json({ error: 'Image must be a PNG, JPG, WEBP or GIF' });

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Image is larger than 8 MB' });

    const id = crypto.randomUUID();
    const filename = `${Date.now()}-${id.slice(0, 8)}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

    const item = {
        id,
        category,
        title: String(title || '').trim(),
        titleEn: String(titleEn || '').trim(),
        src: `assets/uploads/${filename}`,
        uploadedBy: req.user.username,
        createdAt: new Date().toISOString()
    };
    gallery.push(item);
    saveJSON('gallery.json', gallery);
    res.json({ image: item });
});

app.delete('/api/gallery/:id', requireAdmin, (req, res) => {
    const item = gallery.find(g => g.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Image not found' });
    gallery = gallery.filter(g => g.id !== item.id);
    saveJSON('gallery.json', gallery);
    const file = path.join(ROOT, item.src);
    if (file.startsWith(UPLOADS_DIR)) fs.unlink(file, () => {});
    res.json({ ok: true });
});

/* ==========================================================
   RECEIPTS (employees create their own, admins see all)
   ========================================================== */
/* ---------- Excel ledger (one row per receipt) ---------- */
const RECEIPT_COLUMNS = [
    'Number / الرقم', 'Date / التاريخ', 'Client / العميل', 'Phone / الجوال',
    'Project / المشروع', 'Payment / الدفع', 'Items / البنود', 'Subtotal / المجموع',
    'Discount / الخصم', 'VAT / الضريبة', 'Total / الإجمالي', 'Issued by / أصدره', 'Created / التوقيت'
];
const RECEIPT_COL_WIDTHS = [18, 12, 24, 15, 24, 14, 46, 13, 11, 11, 13, 18, 20];

function receiptRow(r) {
    const itemsText = (r.items || [])
        .map(i => `${i.description} × ${i.qty} @ ${i.price}`)
        .join('  |  ');
    return [
        r.number, r.date, r.clientName, r.clientPhone || '', r.project || '',
        r.paymentMethod || '', itemsText,
        r.subtotal, r.discount, r.vat, r.total,
        r.createdBy, new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' ')
    ];
}

// chronological (oldest first) so each new receipt appends as the next row
function buildReceiptsWorkbook(list) {
    return xlsx.buildWorkbook(RECEIPT_COLUMNS, list.map(receiptRow), {
        sheetName: 'Receipts', rightToLeft: true, colWidths: RECEIPT_COL_WIDTHS
    });
}

// keep a master ledger file on disk, refreshed on every change
function writeReceiptsLedger() {
    try {
        fs.writeFileSync(path.join(DATA_DIR, 'receipts.xlsx'), buildReceiptsWorkbook(receipts));
    } catch (err) {
        console.error('Could not write Excel ledger:', err.message);
    }
}
writeReceiptsLedger();

// Download the Excel ledger. Admins get every receipt; employees get their own.
app.get('/api/receipts.xlsx', requireAuth, (req, res) => {
    const list = req.user.role === 'admin'
        ? receipts
        : receipts.filter(r => r.createdById === req.user.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="shotix-receipts.xlsx"');
    res.send(buildReceiptsWorkbook(list));
});

app.get('/api/receipts', requireAuth, (req, res) => {
    const list = req.user.role === 'admin'
        ? receipts
        : receipts.filter(r => r.createdById === req.user.id);
    res.json({ receipts: [...list].reverse() });
});

app.get('/api/receipts/:id', requireAuth, (req, res) => {
    const receipt = receipts.find(r => r.id === req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    if (req.user.role !== 'admin' && receipt.createdById !== req.user.id) {
        return res.status(403).json({ error: 'Not your receipt' });
    }
    res.json({ receipt });
});

app.post('/api/receipts', requireAuth, (req, res) => {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items
        .map(i => ({
            description: String(i.description || '').trim(),
            qty: Math.max(1, Number(i.qty) || 1),
            price: Math.max(0, Number(i.price) || 0)
        }))
        .filter(i => i.description) : [];
    if (!String(b.clientName || '').trim()) return res.status(400).json({ error: 'Client name is required' });
    if (items.length === 0) return res.status(400).json({ error: 'Add at least one line item' });

    const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
    const discount = Math.min(subtotal, Math.max(0, Number(b.discount) || 0));
    const vatEnabled = Boolean(b.vatEnabled);
    const vat = vatEnabled ? (subtotal - discount) * 0.15 : 0;

    meta.receiptCounter += 1;
    const number = `SHX-${new Date().getFullYear()}-${String(meta.receiptCounter).padStart(4, '0')}`;

    const receipt = {
        id: crypto.randomUUID(),
        number,
        date: b.date || new Date().toISOString().slice(0, 10),
        clientName: String(b.clientName).trim(),
        clientPhone: String(b.clientPhone || '').trim(),
        project: String(b.project || '').trim(),
        paymentMethod: String(b.paymentMethod || '').trim(),
        notes: String(b.notes || '').trim(),
        items,
        discount,
        vatEnabled,
        subtotal: Number(subtotal.toFixed(2)),
        vat: Number(vat.toFixed(2)),
        total: Number((subtotal - discount + vat).toFixed(2)),
        createdBy: req.user.name,
        createdById: req.user.id,
        createdAt: new Date().toISOString()
    };
    receipts.push(receipt);
    saveJSON('receipts.json', receipts);
    saveJSON('meta.json', meta);
    writeReceiptsLedger();   // append this receipt as a new row in the Excel ledger
    res.json({ receipt });
});

app.delete('/api/receipts/:id', requireAdmin, (req, res) => {
    if (!receipts.some(r => r.id === req.params.id)) {
        return res.status(404).json({ error: 'Receipt not found' });
    }
    receipts = receipts.filter(r => r.id !== req.params.id);
    saveJSON('receipts.json', receipts);
    writeReceiptsLedger();   // keep the Excel ledger in sync
    res.json({ ok: true });
});

/* ---------- static site ---------- */
app.use(express.static(ROOT, { extensions: ['html'] }));

app.listen(PORT, () => {
    console.log(`Shotix running →  http://localhost:${PORT}`);
    console.log(`Admin panel     →  http://localhost:${PORT}/admin.html`);
    console.log(`Staff portal    →  http://localhost:${PORT}/portal.html`);
});
