/* ==========================================================
   SHOOTIX — local development server

   Runs the exact same app that Vercel runs in production, so
   what you see locally is what ships.

     npm install && npm start   →  http://localhost:3000

   Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
   environment (see .env.example). Without them the site still
   renders; the panels report that the backend is not configured.
   ========================================================== */

'use strict';

const app = require('./api/_lib/app');
const { isConfigured } = require('./api/_lib/supabase');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n  ShootiX      →  http://localhost:${PORT}`);
    console.log(`  Admin panel  →  http://localhost:${PORT}/admin.html`);
    console.log(`  Staff portal →  http://localhost:${PORT}/portal.html`);
    if (!isConfigured()) {
        console.log('\n  ⚠  Supabase is not configured.');
        console.log('     Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable');
        console.log('     accounts, image uploads and receipts.\n');
    } else {
        console.log('\n  ✓  Supabase connected — data is persistent.\n');
    }
});
