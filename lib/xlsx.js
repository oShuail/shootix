/* ==========================================================
   Minimal, dependency-free .xlsx (Excel) writer.
   Builds a valid Office Open XML workbook as a Buffer using
   a hand-rolled ZIP container (STORE method) + inline strings.
   Good enough for ledger-style exports; no styling engine,
   just a bold header row and optional column widths / RTL.
   ========================================================== */

'use strict';

/* ---------- CRC32 (for the ZIP container) ---------- */
let CRC_TABLE = null;
function crc32(buf) {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let c = ~0;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
    return (~c) >>> 0;
}

/* ---------- ZIP writer (no compression) ---------- */
function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
        const name = Buffer.from(f.name, 'utf8');
        const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // local file header signature
        local.writeUInt16LE(20, 4);         // version needed
        local.writeUInt16LE(0, 6);          // flags
        local.writeUInt16LE(0, 8);          // method = store
        local.writeUInt16LE(0, 10);         // mod time
        local.writeUInt16LE(0x21, 12);      // mod date (1980-01-01)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        chunks.push(local, name, data);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);    // central dir signature
        cd.writeUInt16LE(20, 4);            // version made by
        cd.writeUInt16LE(20, 6);           // version needed
        cd.writeUInt16LE(0, 8);            // flags
        cd.writeUInt16LE(0, 10);           // method
        cd.writeUInt16LE(0, 12);           // mod time
        cd.writeUInt16LE(0x21, 14);        // mod date
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt16LE(0, 30);           // extra len
        cd.writeUInt16LE(0, 32);           // comment len
        cd.writeUInt16LE(0, 34);           // disk number
        cd.writeUInt16LE(0, 36);           // internal attrs
        cd.writeUInt32LE(0, 38);           // external attrs
        cd.writeUInt32LE(offset, 42);      // local header offset
        central.push(Buffer.concat([cd, name]));

        offset += local.length + name.length + data.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...chunks, centralBuf, end]);
}

/* ---------- helpers ---------- */
function colLetter(n) {
    let s = '';
    n += 1;
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        // strip XML-illegal control chars
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/* ---------- build a one-sheet workbook ---------- */
function buildWorkbook(headers, rows, opts = {}) {
    const sheetName = (opts.sheetName || 'Sheet1').slice(0, 31);
    const rtl = opts.rightToLeft ? ' rightToLeft="1"' : '';
    const grid = [headers, ...rows];

    let sheetData = '';
    grid.forEach((row, ri) => {
        const r = ri + 1;
        let cells = '';
        row.forEach((val, ci) => {
            const ref = colLetter(ci) + r;
            const style = ri === 0 ? ' s="1"' : '';
            if (ri > 0 && typeof val === 'number' && isFinite(val)) {
                cells += `<c r="${ref}"${style}><v>${val}</v></c>`;
            } else {
                cells += `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(val == null ? '' : val)}</t></is></c>`;
            }
        });
        sheetData += `<row r="${r}">${cells}</row>`;
    });

    let cols = '';
    if (Array.isArray(opts.colWidths) && opts.colWidths.length) {
        cols = '<cols>' + opts.colWidths
            .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
            .join('') + '</cols>';
    }

    const sheetXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<sheetViews><sheetView${rtl} workbookViewId="0"/></sheetViews>` +
        cols +
        `<sheetData>${sheetData}</sheetData></worksheet>`;

    const contentTypes =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`;

    const rels =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`;

    const workbook =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

    const workbookRels =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`;

    const styles =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
        `<fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border/></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `</styleSheet>`;

    return zip([
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rels },
        { name: 'xl/workbook.xml', data: workbook },
        { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
        { name: 'xl/styles.xml', data: styles },
        { name: 'xl/worksheets/sheet1.xml', data: sheetXml }
    ]);
}

module.exports = { buildWorkbook };
