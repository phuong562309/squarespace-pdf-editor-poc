(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PdfEditorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_SOURCE_PAGES = 200;
  const COLORS = { emerald: [0.02, 0.59, 0.41], blue: [0.15, 0.39, 0.92], rose: [0.88, 0.11, 0.28], slate: [0.12, 0.16, 0.23] };
  const STAMPS = ['APPROVED', 'DRAFT COPY', 'CONFIDENTIAL', 'NONE'];

  async function validateSource(bytes, PDFLib) {
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('The selected PDF is empty.');
    if (bytes.length > MAX_BYTES) throw new Error('PDF exceeds the 20 MiB upload limit.');
    const header = String.fromCharCode(...bytes.subarray(0, 8));
    const tail = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 2048)));
    if (!header.startsWith('%PDF-') || !tail.includes('%%EOF')) throw new Error('Invalid or incomplete PDF file.');
    let doc;
    try { doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); }
    catch (_) { throw new Error('Cannot read this PDF. It may be corrupt, encrypted or password protected. Use an unencrypted PDF.'); }
    if (doc.isEncrypted) throw new Error('Encrypted PDFs are not supported.');
    const count = doc.getPageCount();
    if (!count || count > MAX_SOURCE_PAGES) throw new Error('PDF must contain 1–200 pages.');
    const sizes = doc.getPages().map(page => {
      const { width, height } = page.getSize();
      if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw new Error('PDF has an unsupported page size.');
      return { width, height };
    });
    return { doc, pageCount: count, sizes };
  }

  function normalizeSnapshot(input) {
    function field(value, max, label) {
      if (typeof value !== 'string') throw new Error(label + ' must be text.');
      if (value.length > max) throw new Error(label + ' exceeds ' + max + ' characters.');
      const text = value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').normalize('NFC');
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)) throw new Error(label + ' contains unsupported control characters.');
      return text;
    }
    if (!input || !Array.isArray(input.items) || input.items.length > 30) throw new Error('Use at most 30 line items.');
    if (!STAMPS.includes(input.stamp) || !COLORS[input.color] || !['append', 'overlay'].includes(input.mode)) throw new Error('Choose valid annotation settings.');
    return {
      headline: field(input.headline, 300, 'Header'), bodyNote: field(input.bodyNote, 8000, 'Note'),
      signature: field(input.signature, 200, 'Typed sign-off'), items: input.items.map(t => field(t, 1000, 'Line item')),
      stamp: input.stamp, color: input.color, mode: input.mode
    };
  }

  // Width-based wrapping preserves every character, including long unbroken words.
  function wrapText(text, font, size, maxWidth) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      let line = '';
      for (const token of paragraph.match(/\s+|\S+/gu) || []) {
        if (font.widthOfTextAtSize(line + token, size) <= maxWidth) { line += token; continue; }
        if (line) { lines.push(line); line = ''; }
        for (const char of token) {
          if (font.widthOfTextAtSize(char, size) > maxWidth) throw new Error('A character is wider than the annotation area.');
          if (font.widthOfTextAtSize(line + char, size) > maxWidth) { lines.push(line); line = ''; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  async function buildPdf({ snapshot, sourceBytes = null, PDFLib, fontkit, regularFontBytes, boldFontBytes }) {
    if (!PDFLib || !fontkit) throw new Error('PDF libraries are unavailable. Reload the page.');
    const data = normalizeSnapshot(snapshot);
    // Validate every user code point against the actual embedded font before drawing.
    const regularFace = fontkit.create(regularFontBytes);
    const boldFace = fontkit.create(boldFontBytes);
    const fields = [[data.headline, boldFace], [data.bodyNote, regularFace], [data.signature, boldFace], ...data.items.map(t => [t, regularFace])];
    for (const [value, face] of fields) {
      for (const ch of value) {
        if (ch !== '\n' && !face.hasGlyphForCodePoint(ch.codePointAt(0))) {
          throw new Error('Unsupported character ' + JSON.stringify(ch) + ' (U+' + ch.codePointAt(0).toString(16).toUpperCase() + '). Replace it before exporting.');
        }
      }
    }
    const loaded = sourceBytes ? await validateSource(sourceBytes, PDFLib) : null;
    const doc = loaded ? loaded.doc : await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(regularFontBytes, { subset: true });
    const bold = await doc.embedFont(boldFontBytes, { subset: true });
    const overlay = !!loaded && data.mode === 'overlay';
    let width = 612, height = 792;
    if (overlay) {
      const page = doc.getPage(0), crop = page.getCropBox(), media = page.getMediaBox();
      ({ width, height } = page.getSize());
      if (page.getRotation().angle !== 0 || media.x !== 0 || media.y !== 0 || crop.x !== 0 || crop.y !== 0 || crop.width !== width || crop.height !== height || width < 300 || height < 300 || width > 2000 || height > 2000) {
        throw new Error('First-page overlay needs an unrotated, uncropped page between 300 and 2000 pt. Choose appended annotation pages.');
      }
    }
    const margin = 40, contentWidth = width - 2 * margin;
    const rows = [];
    function section(text, font, size, after = 12) {
      if (text === '') return;
      for (const line of wrapText(text, font, size, contentWidth)) rows.push({ text: line, font, size, height: size * 1.65 });
      rows.push({ height: after });
    }
    section('DOCUMENT ANNOTATIONS', regular, 9, 12);
    section(data.headline || 'Untitled document', bold, 19, 16);
    if (data.stamp !== 'NONE') section('STATUS: ' + data.stamp, bold, 11, 14);
    if (data.bodyNote) { section('NOTE', bold, 9, 4); section(data.bodyNote, regular, 11, 16); }
    if (data.items.length) {
      section('LINE ITEMS', bold, 9, 4);
      data.items.forEach((item, i) => section((i + 1) + '. ' + item, regular, 11, 7));
    }
    if (data.signature) { section('TYPED SIGN-OFF (TEXT ONLY)', regular, 9, 4); section(data.signature, bold, 11, 10); }
    const available = height - 140;
    const chunks = [[]]; let used = 0;
    for (const row of rows) {
      if (used + row.height > available) {
        if (overlay) throw new Error('Annotations do not fit on the first page. Shorten the text or choose appended annotation pages.');
        chunks.push([]); used = 0;
      }
      chunks[chunks.length - 1].push(row); used += row.height;
    }
    if (chunks.length > 50) throw new Error('Annotations exceed the 50-page output limit. Shorten the content.');
    const accent = PDFLib.rgb(...COLORS[data.color]);
    chunks.forEach((chunk, index) => {
      const page = overlay ? doc.getPage(0) : doc.addPage([width, height]);
      if (overlay) page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, color: PDFLib.rgb(1, 1, 1) });
      page.drawRectangle({ x: margin, y: height - 46, width: contentWidth, height: 5, color: accent });
      let y = height - 70;
      for (const row of chunk) {
        if (row.text) page.drawText(row.text, { x: margin, y: y - row.size, size: row.size, font: row.font, color: row.font === bold ? accent : PDFLib.rgb(0.16, 0.2, 0.26) });
        y -= row.height;
      }
      page.drawLine({ start: { x: margin, y: 49 }, end: { x: width - margin, y: 49 }, thickness: 0.5, color: accent });
      const footer = 'Annotations ' + (index + 1) + ' / ' + chunks.length + '  |  Typed text; no certificate-based signature';
      wrapText(footer, regular, 7, contentWidth).forEach((line, lineIndex) => {
        page.drawText(line, { x: margin, y: 34 - lineIndex * 10, size: 7, font: regular, color: PDFLib.rgb(0.35, 0.4, 0.46) });
      });
    });
    const bytes = await doc.save();
    return { bytes, pageCount: doc.getPageCount(), annotationPages: chunks.length, sourcePages: loaded ? loaded.pageCount : 0, sizes: doc.getPages().map(p => p.getSize()) };
  }

  async function sha256(bytes, cryptoProvider) {
    if (!cryptoProvider || !cryptoProvider.subtle) return null;
    try {
      const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) { return null; }
  }
  return { MAX_BYTES, MAX_SOURCE_PAGES, validateSource, normalizeSnapshot, wrapText, buildPdf, sha256 };
});
