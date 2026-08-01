/* ==========================================================
   SHOOTIX — shared panel runtime
   Used by both admin.html and portal.html so the two panels
   share one tested implementation of auth, toasts, dialogs,
   uploads and the printable receipt.
   ========================================================== */

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n) =>
        Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';

    const STATUS = {
        paid: { label: 'مدفوع', cls: 'ok' },
        partial: { label: 'جزئي', cls: 'warn' },
        unpaid: { label: 'غير مدفوع', cls: 'bad' }
    };

    /* ----------------------------------------------------------
       API
       ---------------------------------------------------------- */
    async function api(path, options = {}) {
        let res;
        try {
            res = await fetch(path, {
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                ...options
            });
        } catch {
            throw new Error('تعذر الاتصال بالخادم — تحقق من الإنترنت');
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
        return data;
    }

    /* ----------------------------------------------------------
       Feedback: inline messages, toasts, dialogs
       ---------------------------------------------------------- */
    function showMsg(id, text, type = 'error') {
        const el = $(id);
        if (!el) return;
        el.textContent = text;
        el.className = `msg show ${type}`;
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('show'), 6000);
    }

    function toast(text, type = 'ok') {
        let el = $('toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            el.className = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.className = `toast show ${type}`;
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('show'), 3000);
    }

    /**
     * Promise-based confirm/prompt dialog.
     * Replaces window.confirm/prompt, which are unstyled and awkward on phones.
     */
    function dialog({ title, message, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false, input = null }) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay';
            overlay.innerHTML = `
                <div class="dialog" role="dialog" aria-modal="true">
                    <h3></h3>
                    <p></p>
                    ${input ? `<div class="field"><label></label><input type="${input.type || 'text'}"
                        ${input.dir ? `dir="${input.dir}"` : ''} placeholder="${esc(input.placeholder || '')}"></div>` : ''}
                    <div class="dialog-actions">
                        <button class="btn btn-ghost cancel"></button>
                        <button class="btn ${danger ? 'btn-danger' : 'btn-gold'} ok"></button>
                    </div>
                </div>`;

            overlay.querySelector('h3').textContent = title || '';
            const p = overlay.querySelector('p');
            if (message) p.textContent = message; else p.remove();
            overlay.querySelector('.cancel').textContent = cancelText;
            overlay.querySelector('.ok').textContent = confirmText;

            const field = overlay.querySelector('input');
            if (field && input.label) overlay.querySelector('label').textContent = input.label;

            document.body.appendChild(overlay);
            requestAnimationFrame(() => overlay.classList.add('show'));

            const close = (value) => {
                overlay.classList.remove('show');
                setTimeout(() => overlay.remove(), 200);
                document.removeEventListener('keydown', onKey);
                resolve(value);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') close(null);
                if (e.key === 'Enter' && field) confirm();
            };
            const confirm = () => close(field ? (field.value.trim() || null) : true);

            overlay.querySelector('.ok').addEventListener('click', confirm);
            overlay.querySelector('.cancel').addEventListener('click', () => close(null));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
            document.addEventListener('keydown', onKey);
            setTimeout(() => (field || overlay.querySelector('.ok')).focus(), 60);
        });
    }

    const confirmAction = (title, message, opts = {}) =>
        dialog({ title, message, danger: true, confirmText: opts.confirmText || 'حذف' }).then(Boolean);

    /* ----------------------------------------------------------
       Buttons that show they are working
       ---------------------------------------------------------- */
    async function withBusy(btn, label, fn) {
        if (!btn) return fn();
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${label}`;
        try {
            return await fn();
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    /* ----------------------------------------------------------
       Tabs — with the active tab remembered per panel
       ---------------------------------------------------------- */
    function initTabs(storageKey) {
        const buttons = Array.from(document.querySelectorAll('.tab-btn'));
        if (buttons.length === 0) return;

        const activate = (name, remember = true) => {
            const btn = buttons.find((b) => b.dataset.tab === name);
            if (!btn) return;
            buttons.forEach((b) => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
            });
            document.querySelectorAll('.tab-panel').forEach((p) =>
                p.classList.toggle('active', p.id === 'tab-' + name));
            if (remember) { try { localStorage.setItem(storageKey, name); } catch { /* private mode */ } }
            document.dispatchEvent(new CustomEvent('sx:tab', { detail: name }));
            btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        };

        buttons.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));

        let saved = null;
        try { saved = localStorage.getItem(storageKey); } catch { /* ignore */ }
        activate(saved && buttons.some((b) => b.dataset.tab === saved) ? saved : buttons[0].dataset.tab, false);

        return activate;
    }

    /* ----------------------------------------------------------
       Auth flow shared by both panels
       ---------------------------------------------------------- */
    function initAuth({ adminOnly = false, onEnter }) {
        const loginScreen = $('login-screen');
        const shell = $('shell');

        const enter = (user) => {
            loginScreen.style.display = 'none';
            shell.style.display = 'flex';
            requestAnimationFrame(() => shell.classList.add('ready'));
            const nameEl = $('who-name');
            if (nameEl) nameEl.textContent = user.name;
            const roleEl = $('who-role');
            if (roleEl) roleEl.textContent = user.role === 'admin' ? 'ADMIN' : 'STAFF';
            onEnter(user);
        };

        const rejectEmployee = async () => {
            showMsg('login-msg', 'هذا الحساب موظف — استخدم بوابة الفريق');
            await api('/api/logout', { method: 'POST' }).catch(() => {});
        };

        $('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            await withBusy(btn, 'جاري الدخول...', async () => {
                try {
                    const { user } = await api('/api/login', {
                        method: 'POST',
                        body: JSON.stringify({
                            username: $('login-username').value,
                            password: $('login-password').value
                        })
                    });
                    if (adminOnly && user.role !== 'admin') return rejectEmployee();
                    enter(user);
                } catch (err) {
                    showMsg('login-msg', err.message);
                }
            });
        });

        $('logout-btn').addEventListener('click', async () => {
            await api('/api/logout', { method: 'POST' }).catch(() => {});
            location.reload();
        });

        // Already signed in? Skip the login screen.
        api('/api/me')
            .then(({ user }) => {
                if (adminOnly && user.role !== 'admin') return rejectEmployee();
                enter(user);
            })
            .catch(() => { loginScreen.classList.add('ready'); });
    }

    /* ----------------------------------------------------------
       Image upload — straight to Supabase Storage
       The file never passes through the serverless function, which
       has a ~4.5 MB body limit; this way large photos upload fine.
       ---------------------------------------------------------- */
    function putFile(url, file, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
            });
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
                ? resolve()
                : reject(new Error('فشل رفع الصورة — حاول مرة أخرى')));
            xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع'));
            xhr.send(file);
        });
    }

    async function uploadImage({ file, category, title, titleEn, featured, onProgress }) {
        const { uploadUrl, path } = await api('/api/gallery/sign-upload', {
            method: 'POST',
            body: JSON.stringify({ category, filename: file.name })
        });
        await putFile(uploadUrl, file, onProgress);
        const { image } = await api('/api/gallery', {
            method: 'POST',
            body: JSON.stringify({ path, category, title, titleEn, featured, bytes: file.size })
        });
        return image;
    }

    /* ----------------------------------------------------------
       Printable receipt  (browser print → "Save as PDF")
       ---------------------------------------------------------- */
    function receiptHtml(r) {
        const rows = (r.items || []).map((i) => `
            <tr>
                <td>${esc(i.description)}</td>
                <td dir="ltr">${i.qty}</td>
                <td dir="ltr">${money(i.price)}</td>
                <td dir="ltr">${money(i.qty * i.price)}</td>
            </tr>`).join('');

        const cell = (label, value, dir) => value
            ? `<div><div class="lbl">${label}</div><div class="val"${dir ? ` dir="${dir}"` : ''}>${esc(value)}</div></div>`
            : '';

        return `
            <div class="receipt-doc" dir="rtl">
                <div class="rc-head">
                    <div>
                        <div class="rc-brand-name">SHOTIX</div>
                        <div class="rc-brand-sub">شوتيكس للإنتاج البصري — Visual Production Studio</div>
                        <div class="rc-brand-sub" dir="ltr">shootix.sa@gmail.com · +966 53 761 4446 · shotix.space</div>
                    </div>
                    <div class="rc-doc-type">
                        <div class="big">إيصال / RECEIPT</div>
                        <div class="num" dir="ltr">${esc(r.number)}</div>
                    </div>
                </div>
                <div class="rc-meta">
                    ${cell('العميل / Client', r.clientName)}
                    ${cell('الجوال / Phone', r.clientPhone, 'ltr')}
                    ${cell('البريد / Email', r.clientEmail, 'ltr')}
                    ${cell('المشروع / Project', r.project)}
                    ${cell('التاريخ / Date', r.date, 'ltr')}
                    ${cell('طريقة الدفع / Payment', r.paymentMethod)}
                </div>
                <table class="rc-table">
                    <thead><tr><th>الوصف / Description</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="rc-totals">
                    <div class="row"><span>المجموع / Subtotal</span><span dir="ltr">${money(r.subtotal)}</span></div>
                    ${r.discount > 0 ? `<div class="row"><span>الخصم / Discount</span><span dir="ltr">- ${money(r.discount)}</span></div>` : ''}
                    ${r.vatEnabled ? `<div class="row"><span>الضريبة / VAT 15%</span><span dir="ltr">${money(r.vat)}</span></div>` : ''}
                    <div class="row grand"><span>الإجمالي / Total</span><span dir="ltr">${money(r.total)}</span></div>
                </div>
                ${r.notes ? `<div class="rc-notes"><div class="lbl">ملاحظات / Notes</div>${esc(r.notes)}</div>` : ''}
                <div class="rc-foot">
                    <span>أصدره / Issued by: ${esc(r.createdBy)}</span>
                    <span dir="ltr">${new Date(r.createdAt).toLocaleString('en-GB')}</span>
                    <span>شكراً لتعاملكم معنا — Thank you for your business</span>
                </div>
            </div>`;
    }

    function printReceipt(r) {
        let area = $('receipt-print-area');
        if (!area) {
            area = document.createElement('div');
            area.id = 'receipt-print-area';
            document.body.appendChild(area);
        }
        area.innerHTML = receiptHtml(r);

        const previousTitle = document.title;
        document.title = r.number;          // becomes the suggested PDF filename
        window.print();
        setTimeout(() => { document.title = previousTitle; }, 500);
    }

    /* ----------------------------------------------------------
       Backend health banner
       Tells the operator plainly when the database is not wired up,
       instead of leaving them to guess why nothing saves.
       ---------------------------------------------------------- */
    async function checkBackend() {
        try {
            const health = await api('/api/health');
            if (health.ok) return true;
            banner(health.supabase && health.supabase.configured
                ? 'قاعدة البيانات غير متاحة حالياً — تحقق من إعدادات Supabase.'
                : 'الخادم غير مهيأ: أضف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في إعدادات المشروع.');
            return false;
        } catch {
            banner('تعذر الوصول للخادم.');
            return false;
        }
    }

    function banner(text) {
        const el = document.createElement('div');
        el.className = 'setup-banner';
        el.innerHTML = '<i class="fas fa-triangle-exclamation"></i><span></span>';
        el.querySelector('span').textContent = text;
        document.body.prepend(el);
    }

    window.SX = {
        $, esc, money, STATUS,
        api, showMsg, toast, dialog, confirmAction, withBusy,
        initTabs, initAuth,
        uploadImage, printReceipt, receiptHtml,
        checkBackend
    };
})();
