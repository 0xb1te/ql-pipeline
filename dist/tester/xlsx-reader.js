// @neuron tester.preview.xlsxReader
import { inflateRawSync } from 'node:zlib';
/**
 * Enough of the xlsx format to read a sheet of strings, and no more.
 *
 * An .xlsx is a ZIP of XML parts. Reading one needs a central directory walk, raw DEFLATE, and
 * three of the parts inside - the workbook (sheet name to relationship id), its relationships
 * (id to part path), and the shared string table every text cell points into.
 *
 * Written rather than depended on, deliberately. ql-pipeline ships with four runtime dependencies
 * and adding a spreadsheet library to read seven columns would be the largest of them. The scope
 * that makes this safe is narrow and stated: strings and numbers out of a sheet's used range.
 * Formulas are read as their cached value, and everything else in the format - styles, charts,
 * merged cells, pivot tables - is ignored rather than mishandled.
 *
 * It fails loudly on anything it does not understand. A reader that returns an empty sheet for a
 * file it could not parse turns "the test plan is unreadable" into "the test plan has no cases",
 * and a test run reporting success it did not earn is the failure this whole feature exists to
 * prevent.
 */
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
export class XlsxError extends Error {
    constructor(message) {
        super(message);
        this.name = 'XlsxError';
    }
}
/** Walks the central directory backwards from the end-of-central-directory record. */
function readCentralDirectory(buf) {
    // The EOCD is at the end, after a comment of up to 64 KiB. Scan back for its signature.
    let eocd = -1;
    const lowest = Math.max(0, buf.length - 0x10000 - 22);
    for (let i = buf.length - 22; i >= lowest; i -= 1) {
        if (buf.readUInt32LE(i) === SIG_EOCD) {
            eocd = i;
            break;
        }
    }
    if (eocd === -1)
        throw new XlsxError('not a zip archive: no end-of-central-directory record');
    let count = buf.readUInt16LE(eocd + 10);
    let start = buf.readUInt32LE(eocd + 16);
    // ZIP64: openpyxl emits it for large workbooks, and the 32-bit fields are then sentinels.
    if (count === 0xffff || start === 0xffffffff) {
        const locator = eocd - 20;
        if (locator < 0 || buf.readUInt32LE(locator) !== SIG_EOCD64_LOCATOR) {
            throw new XlsxError('zip64 archive with no zip64 locator');
        }
        const eocd64 = Number(buf.readBigUInt64LE(locator + 8));
        count = Number(buf.readBigUInt64LE(eocd64 + 32));
        start = Number(buf.readBigUInt64LE(eocd64 + 48));
    }
    const entries = new Map();
    let offset = start;
    for (let i = 0; i < count; i += 1) {
        if (buf.readUInt32LE(offset) !== SIG_CENTRAL) {
            throw new XlsxError(`corrupt zip: expected a central directory entry at byte ${String(offset)}`);
        }
        const method = buf.readUInt16LE(offset + 10);
        const compressedSize = buf.readUInt32LE(offset + 20);
        const nameLength = buf.readUInt16LE(offset + 28);
        const extraLength = buf.readUInt16LE(offset + 30);
        const commentLength = buf.readUInt16LE(offset + 32);
        const localHeaderOffset = buf.readUInt32LE(offset + 42);
        const name = buf.toString('utf-8', offset + 46, offset + 46 + nameLength);
        entries.set(name, { name, method, compressedSize, localHeaderOffset });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}
function readEntry(buf, entry) {
    const local = entry.localHeaderOffset;
    // The local header repeats the name and extra-field lengths, and they can differ from the
    // central directory's, so the data offset is computed from the local header only.
    const nameLength = buf.readUInt16LE(local + 26);
    const extraLength = buf.readUInt16LE(local + 28);
    const dataStart = local + 30 + nameLength + extraLength;
    const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0)
        return raw.toString('utf-8');
    if (entry.method === 8)
        return inflateRawSync(raw).toString('utf-8');
    throw new XlsxError(`unsupported zip compression method ${String(entry.method)} for ${entry.name}`);
}
const XML_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
};
function decodeXml(text) {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
        if (body.startsWith('#x') || body.startsWith('#X'))
            return String.fromCodePoint(parseInt(body.slice(2), 16));
        if (body.startsWith('#'))
            return String.fromCodePoint(parseInt(body.slice(1), 10));
        return XML_ENTITIES[body] ?? whole;
    });
}
/** Shared strings, in index order. A `<si>` can be split across several `<t>` runs. */
function readSharedStrings(xml) {
    const out = [];
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        let text = '';
        for (const t of (si[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
            text += decodeXml(t[1] ?? '');
        }
        out.push(text);
    }
    return out;
}
/** `B12` -> 1 (zero-based column index). */
function columnIndexOf(ref) {
    const letters = /^([A-Z]+)/.exec(ref)?.[1];
    if (letters === undefined)
        throw new XlsxError(`unreadable cell reference "${ref}"`);
    let index = 0;
    for (const ch of letters)
        index = index * 26 + (ch.charCodeAt(0) - 64);
    return index - 1;
}
function readSheet(xml, shared) {
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attrs = cellMatch[1] ?? '';
            const body = cellMatch[2] ?? '';
            const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
            const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
            let value = '';
            if (type === 'inlineStr') {
                for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
                    value += decodeXml(t[1] ?? '');
            }
            else {
                // <v> is the value for shared strings (an index), numbers, booleans, and the cached
                // result of a formula. A formula cell with no cached <v> reads as empty, which is
                // correct: nothing has computed it.
                const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
                if (raw !== undefined) {
                    const decoded = decodeXml(raw);
                    if (type === 's') {
                        const index = Number(decoded);
                        const resolved = shared[index];
                        if (resolved === undefined)
                            throw new XlsxError(`shared string ${decoded} is out of range`);
                        value = resolved;
                    }
                    else if (type === 'b') {
                        value = decoded === '1' ? 'TRUE' : 'FALSE';
                    }
                    else {
                        value = decoded;
                    }
                }
            }
            // Empty cells are omitted from the XML entirely, so a row's cells are placed by their
            // reference rather than appended. Reading them positionally would shift every column after
            // the first blank - the silent-skew failure this reader exists to avoid.
            const at = ref === undefined ? cells.length : columnIndexOf(ref);
            while (cells.length < at)
                cells.push('');
            cells[at] = value;
        }
        rows.push(cells);
    }
    return rows;
}
/** Every sheet in the workbook, by name, each as an array of rows of trimmed strings. */
// @signal readWorkbook
export function readWorkbook(bytes) {
    const entries = readCentralDirectory(bytes);
    const workbookXml = entries.get('xl/workbook.xml');
    if (workbookXml === undefined)
        throw new XlsxError('not an xlsx workbook: xl/workbook.xml is missing');
    const relsEntry = entries.get('xl/_rels/workbook.xml.rels');
    if (relsEntry === undefined)
        throw new XlsxError('not an xlsx workbook: xl/_rels/workbook.xml.rels is missing');
    const relTargets = new Map();
    for (const rel of readEntry(bytes, relsEntry).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        const attrs = rel[1] ?? '';
        const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
        const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
        if (id !== undefined && target !== undefined) {
            relTargets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
        }
    }
    const sharedEntry = entries.get('xl/sharedStrings.xml');
    const shared = sharedEntry === undefined ? [] : readSharedStrings(readEntry(bytes, sharedEntry));
    const sheets = new Map();
    for (const sheet of readEntry(bytes, workbookXml).matchAll(/<sheet\b([^>]*)\/?>/g)) {
        const attrs = sheet[1] ?? '';
        const name = /\bname="([^"]+)"/.exec(attrs)?.[1];
        const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1];
        if (name === undefined || rid === undefined)
            continue;
        const path = relTargets.get(rid);
        const entry = path === undefined ? undefined : entries.get(path);
        if (entry === undefined) {
            throw new XlsxError(`workbook names sheet "${decodeXml(name)}" but its part ${path ?? rid} is not in the file`);
        }
        sheets.set(decodeXml(name), readSheet(readEntry(bytes, entry), shared));
    }
    return sheets;
}
//# sourceMappingURL=xlsx-reader.js.map