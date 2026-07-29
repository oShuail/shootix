/* ==========================================================
   SHOOTIX — Excel ledger

   Every receipt becomes one row in a running .xlsx workbook.
   The workbook is rebuilt from the database (the database is the
   source of truth, never the spreadsheet) and a master copy is
   pushed to Supabase Storage on every create/update/delete, so
   there is always an up-to-date file waiting to be downloaded.
   ========================================================== */

'use strict';

const xlsx = require('./xlsx');
const { storage } = require('./supabase');

const LEDGER_OBJECT = 'ledger/shootix-receipts.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const COLUMNS = [
    'Number / الرقم',
    'Date / التاريخ',
    'Client / العميل',
    'Phone / الجوال',
    'Email / البريد',
    'Project / المشروع',
    'Payment / الدفع',
    'Status / الحالة',
    'Items / البنود',
    'Item count / عدد البنود',
    'Subtotal / المجموع',
    'Discount / الخصم',
    'VAT / الضريبة',
    'Total / الإجمالي',
    'Notes / ملاحظات',
    'Issued by / أصدره',
    'Created / التوقيت'
];

const COL_WIDTHS = [18, 12, 24, 15, 22, 24, 14, 12, 46, 12, 13, 11, 11, 13, 30, 18, 20];

const STATUS_LABELS = {
    paid: 'مدفوع / Paid',
    partial: 'جزئي / Partial',
    unpaid: 'غير مدفوع / Unpaid'
};

/** One spreadsheet row from one receipt. Numbers stay numeric so Excel can sum them. */
function toRow(r) {
    const items = Array.isArray(r.items) ? r.items : [];
    const itemsText = items
        .map((i) => `${i.description} × ${i.qty} @ ${i.price}`)
        .join('  |  ');

    return [
        r.number,
        r.date,
        r.clientName,
        r.clientPhone || '',
        r.clientEmail || '',
        r.project || '',
        r.paymentMethod || '',
        STATUS_LABELS[r.status] || r.status || '',
        itemsText,
        items.length,
        Number(r.subtotal) || 0,
        Number(r.discount) || 0,
        Number(r.vat) || 0,
        Number(r.total) || 0,
        r.notes || '',
        r.createdBy || '',
        new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' ')
    ];
}

/**
 * Build the workbook.
 * Rows are oldest-first, so each new receipt lands as the next row down —
 * the ledger reads like an append-only log.
 */
function build(receipts) {
    const ordered = [...receipts].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );
    return xlsx.buildWorkbook(COLUMNS, ordered.map(toRow), {
        sheetName: 'Receipts',
        rightToLeft: true,
        colWidths: COL_WIDTHS
    });
}

/**
 * Refresh the master copy kept in Supabase Storage.
 * Deliberately never throws: a spreadsheet hiccup must not stop
 * someone from issuing a receipt to a client standing in front of them.
 */
async function sync(receipts) {
    try {
        await storage.upload(storage.privateBucket, LEDGER_OBJECT, build(receipts), XLSX_MIME);
        return true;
    } catch (err) {
        console.error('[ledger] could not sync to storage:', err.message);
        return false;
    }
}

module.exports = { build, sync, LEDGER_OBJECT, XLSX_MIME };
