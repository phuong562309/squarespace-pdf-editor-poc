# PDF Studio

A static browser proof of concept for adding annotations and downloading a real PDF without an email form. Local scripts and fonts are served from this site. The application does not send uploaded PDF bytes or form text to a server. The host still receives ordinary asset requests; browser extensions and the surrounding website are outside this application's control.

## Run locally

From this folder, run `python -m http.server 8080`, then open `http://localhost:8080/`. Use HTTP on localhost or HTTPS when hosted. Opening `index.html` directly with `file://` is unsupported because fonts are fetched from the same origin. No package install or build step is needed.

Keep `index.html`, `app.js`, `pdf-core.js`, `style.css`, `embed.html`, `vendor/`, and `fonts/` together. Deploy the entire folder as a static site. Scripts use pdf-lib 1.17.1 and @pdf-lib/fontkit 1.1.1; PDF text uses DejaVu Sans regular and bold. The pdf-lib and DejaVu licenses are distributed alongside their assets. The published fontkit package declares MIT but omits a license file; `vendor/NOTICE-fontkit.md` records this limitation and the upstream metadata sources.

## Supported behavior

- Start a new document or import an unencrypted PDF of 1–200 pages, up to 20 MiB. The PDF is parsed before becoming the active source. A failed replacement leaves the previous source active and displays the error.
- Set a header, multiline note, status, color, typed sign-off and up to 30 line items. Limits: header 300, note 8000, sign-off 200 and each item 1000 JavaScript string units. Unsupported glyphs and control characters are rejected before export. Vietnamese and many Latin, Greek and Cyrillic characters are supported by the bundled font; this is not universal Unicode or emoji support.
- Default placement appends US Letter annotation pages and retains imported page content. Text wraps using embedded-font measurements and paginates (up to 50 annotation pages). Appended pages do not edit or replace existing text.
- Optional first-page overlay draws a white panel on the first page, covering original content beneath it. This mode requires an unrotated, uncropped first page with a zero-origin MediaBox and dimensions of 300–2000 pt. Content that cannot fit is explicitly rejected. Other source pages are not annotated.
- The preview is the generated PDF in the browser's native viewer. Download and preview use the exact same cached PDF bytes and Blob URL. Changes immediately clear the preview, download link and old hash; stale asynchronous work cannot replace newer work.
- SHA-256 is computed over those exact bytes with Web Crypto. If unavailable or denied, the interface explicitly reports it as unavailable. A hash is an integrity fingerprint, not identity verification, a cryptographic signature, or certification.
- Typed sign-off is ordinary text only. Re-saving a previously signed PDF can invalidate existing digital signatures. Use an unsigned copy. This is not a redaction tool or full PDF text/form editor.

## Known limits

Native PDF preview and download behavior depend on the browser, mobile platform and iframe policy. Use **Open PDF** or download if the inline viewer is blank. No PDF.js renderer is included. Parsing is not a malware scan or comprehensive PDF conformance validation. Complex documents, interactive forms, embedded media and accessibility features may not survive re-saving identically; retain the original. Imported pages are retained visually, not byte-for-byte. Large or complex files may be slow even within the limits. Do not expect identical output hashes across separate generation runs, since document metadata can vary. The hash always describes the current cached artifact.

## Squarespace embedding

Open `embed.html` for a real iframe snippet and a hosted iframe preview. Its intended target is `https://phuong562309.github.io/squarespace-pdf-editor-poc/`; the target must be deployed before the embed works. This project does not claim a tested Squarespace tenant installation. Check your plan, Code Block restrictions, nested scrolling, upload, viewer and download behavior on the published page. No email capture or backend service is included.

## Programmatic verification

Test status: PDF generation core smoke checks passed, including Unicode, pagination, digest calculation and input rejection. **UI_NOT_VERIFIED:** the browser automation bridge timed out, so this build has no completed live browser UI verification. Hosted embedding and a Squarespace tenant installation also remain unverified. Programmatic checks do not establish browser interaction or deployment readiness.

`pdf-core.js` exports `buildPdf`, `validateSource`, `wrapText`, `normalizeSnapshot` and `sha256` through CommonJS (Node) or `window.PdfEditorCore` (browser). `buildPdf({snapshot, sourceBytes, PDFLib, fontkit, regularFontBytes, boldFontBytes})` returns `{bytes, pageCount, annotationPages, sourcePages, sizes}`. Pass a snapshot with `headline`, `bodyNote`, `signature`, `items` (strings), `stamp`, `color` and `mode` (`append` or `overlay`). All dependencies and font byte arrays are explicitly supplied, so PDF generation can be tested without DOM access.
