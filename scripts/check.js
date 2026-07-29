/* ==========================================================
   SHOOTIX — self check
   Exercises the parts that must never silently break, without
   needing a database:  password hashing, session tokens, the
   Excel writer, and that the app boots and serves the site.

     npm run check
   ========================================================== */

'use strict';

const assert = require('assert');
const http = require('http');

const auth = require('../api/_lib/auth');
const ledger = require('../api/_lib/ledger');

let passed = 0;
const results = [];

function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => { passed++; results.push(`  ✓ ${name}`); })
        .catch((err) => { results.push(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1; });
}

(async () => {
    /* ---------- passwords ---------- */
    await test('password hashes verify, wrong passwords do not', () => {
        const stored = auth.hashPassword('correct horse battery');
        assert.ok(auth.verifyPassword('correct horse battery', stored));
        assert.ok(!auth.verifyPassword('wrong password', stored));
        assert.ok(!auth.verifyPassword('', stored));
    });

    await test('the same password hashes differently every time (salted)', () => {
        assert.notStrictEqual(auth.hashPassword('same'), auth.hashPassword('same'));
    });

    await test('malformed stored hashes are rejected, not crashed on', () => {
        assert.ok(!auth.verifyPassword('x', 'garbage'));
        assert.ok(!auth.verifyPassword('x', null));
    });

    /* ---------- session tokens ---------- */
    await test('a signed token round-trips to the same user', () => {
        const user = { id: '11111111-2222-3333-4444-555555555555', token_version: 3 };
        const payload = auth.readToken(auth.createToken(user));
        assert.strictEqual(payload.u, user.id);
        assert.strictEqual(payload.v, 3);
    });

    await test('a tampered token is rejected', () => {
        const token = auth.createToken({ id: 'abc', token_version: 0 });
        const [body, sig] = token.split('.');
        assert.strictEqual(auth.readToken(`${body}x.${sig}`), null);
        assert.strictEqual(auth.readToken(`${body}.${sig.slice(0, -1)}a`), null);
        assert.strictEqual(auth.readToken('nonsense'), null);
        assert.strictEqual(auth.readToken(''), null);
    });

    await test('an expired token is rejected', () => {
        const expired = Buffer.from(JSON.stringify({ u: 'abc', v: 0, e: Date.now() - 1000 })).toString('base64url');
        assert.strictEqual(auth.readToken(`${expired}.whatever`), null);
    });

    /* ---------- Excel ledger ---------- */
    await test('the ledger builds a real xlsx (zip magic bytes + sheet)', () => {
        const book = ledger.build([{
            number: 'SHX-2026-0001', date: '2026-07-29', clientName: 'شركة الأفق',
            clientPhone: '0500000000', project: 'تصوير افتتاح', paymentMethod: 'تحويل بنكي',
            status: 'paid', notes: 'دفعة أولى', items: [{ description: 'تصوير', qty: 2, price: 1500 }],
            subtotal: 3000, discount: 0, vat: 450, total: 3450,
            createdBy: 'عمر', createdAt: '2026-07-29T10:00:00.000Z'
        }]);
        assert.ok(Buffer.isBuffer(book));
        assert.strictEqual(book.slice(0, 2).toString('ascii'), 'PK');   // zip
        assert.ok(book.includes(Buffer.from('xl/worksheets/sheet1.xml')));
        assert.ok(book.includes(Buffer.from('SHX-2026-0001')));
    });

    await test('the ledger orders rows oldest-first so receipts append downward', () => {
        const mk = (number, createdAt) => ({
            number, createdAt, date: createdAt.slice(0, 10), clientName: 'x',
            items: [], subtotal: 0, discount: 0, vat: 0, total: 0
        });
        const book = ledger.build([
            mk('SHX-2026-0002', '2026-02-01T00:00:00.000Z'),
            mk('SHX-2026-0001', '2026-01-01T00:00:00.000Z')
        ]).toString('latin1');
        assert.ok(book.indexOf('SHX-2026-0001') < book.indexOf('SHX-2026-0002'));
    });

    await test('the ledger survives receipts with missing optional fields', () => {
        assert.ok(ledger.build([{
            number: 'SHX-2026-0003', date: '2026-07-29', clientName: 'Someone',
            items: [], createdAt: '2026-07-29T10:00:00.000Z'
        }]).length > 0);
    });

    /* ---------- the app boots and serves ---------- */
    await test('the app serves the homepage and answers /api/health', async () => {
        const app = require('../api/_lib/app');
        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;

        const get = async (path) => {
            const res = await fetch(`http://127.0.0.1:${port}${path}`);
            return { status: res.status, body: await res.text() };
        };

        const home = await get('/index.html');
        assert.strictEqual(home.status, 200);
        assert.ok(home.body.includes('ShootiX') || home.body.includes('shootix'));

        const health = await get('/api/health');
        assert.strictEqual(health.status, 200);
        assert.ok(JSON.parse(health.body).supabase !== undefined);

        // Protected routes must refuse anonymous callers.
        assert.strictEqual((await get('/api/users')).status, 401);
        assert.strictEqual((await get('/api/receipts')).status, 401);
        assert.strictEqual((await get('/api/stats')).status, 401);

        // The public gallery must degrade to empty, never 500.
        const gallery = await get('/api/gallery');
        assert.strictEqual(gallery.status, 200);
        assert.deepStrictEqual(JSON.parse(gallery.body), { images: [] });

        assert.strictEqual((await get('/api/nope')).status, 404);

        await new Promise((resolve) => server.close(resolve));
    });

    console.log(`\nShootiX self check\n${results.join('\n')}`);
    console.log(`\n${passed}/${results.length} passed\n`);
})();
