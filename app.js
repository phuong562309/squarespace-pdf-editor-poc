(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const core = window.PdfEditorCore;
  const state = { sourceBytes: null, sourceName: 'New document', revision: 0, uploadToken: 0, uploading: false, building: false, artifact: null, timer: null, fonts: null };
  const items = ['Review the project scope and delivery details.', 'Keep a copy of this PDF for your records.'];

  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  function sourceStatus(message, error = false) { $('sourceStatus').textContent = message; $('sourceStatus').classList.toggle('error', error); }
  function snapshot() {
    return { headline: $('inputHeadline').value, bodyNote: $('inputBodyNote').value, signature: $('inputSignature').value, stamp: $('selectStamp').value, color: $('selectColor').value, mode: $('annotationMode').value, items: [...items] };
  }
  function clearArtifact() {
    const old = state.artifact;
    state.artifact = null;
    $('pdfPreview').hidden = true;
    $('pdfPreview').removeAttribute('src');
    $('previewEmpty').hidden = false;
    for (const id of ['btnDownloadPdf', 'openPdf']) {
      $(id).removeAttribute('href'); $(id).classList.add('disabled'); $(id).setAttribute('aria-disabled', 'true');
    }
    $('hashReceiptBox').textContent = 'SHA-256: waiting for a current PDF.';
    $('pageMetaLabel').textContent = 'Preview out of date';
    if (old) URL.revokeObjectURL(old.url);
  }
  function invalidate() {
    state.revision++;
    clearArtifact();
    clearTimeout(state.timer);
    status(state.uploading ? 'Validating selected PDF…' : 'Updating the actual PDF…');
    state.timer = setTimeout(buildCurrent, 350);
  }
  async function loadFonts() {
    if (!state.fonts) {
      state.fonts = Promise.all(['fonts/DejaVuSans.ttf', 'fonts/DejaVuSans-Bold.ttf'].map(async url => {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Cannot load local fonts. Serve this folder over HTTP or HTTPS.');
        return new Uint8Array(await response.arrayBuffer());
      })).catch(error => { state.fonts = null; throw error; });
    }
    return state.fonts;
  }
  async function buildCurrent() {
    if (state.building || state.uploading) return;
    const revision = state.revision;
    const captured = snapshot();
    const source = state.sourceBytes;
    state.building = true;
    status('Generating PDF and SHA-256…');
    try {
      if (!core || !window.PDFLib || !window.fontkit) throw new Error('Local PDF libraries did not load. Reload or check the site files.');
      const [regularFontBytes, boldFontBytes] = await loadFonts();
      if (revision !== state.revision) return;
      const result = await core.buildPdf({ snapshot: captured, sourceBytes: source, PDFLib: window.PDFLib, fontkit: window.fontkit, regularFontBytes, boldFontBytes });
      const hash = await core.sha256(result.bytes, window.crypto);
      if (revision !== state.revision || state.uploading) return;
      const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/pdf' }));
      state.artifact = { ...result, revision, url, hash };
      $('pdfPreview').src = url;
      $('pdfPreview').hidden = false;
      $('previewEmpty').hidden = true;
      for (const id of ['btnDownloadPdf', 'openPdf']) {
        $(id).href = url; $(id).classList.remove('disabled'); $(id).setAttribute('aria-disabled', 'false');
      }
      $('btnDownloadPdf').download = source ? 'annotated-' + state.sourceName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/\.pdf$/i, '').slice(0, 100) + '.pdf' : 'annotated-document.pdf';
      $('hashReceiptBox').textContent = hash ? 'SHA-256 of current PDF: ' + hash : 'SHA-256 unavailable: Web Crypto is not available in this context. The PDF is still downloadable.';
      $('pageMetaLabel').textContent = result.pageCount + (result.pageCount === 1 ? ' page' : ' pages') + ' · ' + (result.bytes.length / 1024).toFixed(1) + ' KiB';
      status('Ready. Preview and download share the same PDF bytes. ' + (source && captured.mode === 'overlay' ? 'First-page overlay covers content beneath its white panel.' : 'All annotation text is included.'));
    } catch (error) {
      if (revision === state.revision) { clearArtifact(); status(error.message || 'PDF generation failed.', true); }
    } finally {
      state.building = false;
      if (revision !== state.revision && !state.uploading) { clearTimeout(state.timer); state.timer = setTimeout(buildCurrent, 100); }
    }
  }
  function renderItems() {
    const list = $('customItemsList');
    list.replaceChildren();
    items.forEach((text, index) => {
      const row = document.createElement('div'); row.className = 'item-row';
      const input = document.createElement('textarea'); input.rows = 2; input.maxLength = 1000; input.value = text; input.setAttribute('aria-label', 'Line item ' + (index + 1));
      input.addEventListener('input', () => { items[index] = input.value; invalidate(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove line item ' + (index + 1));
      remove.addEventListener('click', () => { items.splice(index, 1); renderItems(); invalidate(); });
      row.append(input, remove); list.append(row);
    });
    $('itemCountLabel').textContent = items.length + ' / 30';
    $('btnAddItem').disabled = items.length >= 30;
  }
  for (const id of ['inputHeadline', 'inputBodyNote', 'inputSignature']) $(id).addEventListener('input', invalidate);
  for (const id of ['selectStamp', 'selectColor', 'annotationMode']) $(id).addEventListener('change', () => {
    $('modeHelp').textContent = $('annotationMode').value === 'overlay' ? 'Overlay adds a white annotation panel to the first page and covers the original content beneath it. It does not edit original text. Overflow is rejected; other pages are untouched.' : 'Appended pages keep imported page content visually unchanged. Existing text is not edited.';
    invalidate();
  });
  $('btnAddItem').addEventListener('click', () => { if (items.length < 30) { items.push(''); renderItems(); invalidate(); const inputs = $('customItemsList').querySelectorAll('textarea'); inputs[inputs.length - 1].focus(); } });
  $('pdfUploadInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const token = ++state.uploadToken;
    state.uploading = true;
    sourceStatus('Validating ' + file.name + '…');
    invalidate();
    try {
      if (!core || !window.PDFLib) throw new Error('PDF libraries are unavailable. Reload the page.');
      if (file.size > core.MAX_BYTES) throw new Error('PDF exceeds the 20 MiB upload limit.');
      if (!file.size) throw new Error('The selected PDF is empty.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await core.validateSource(bytes, window.PDFLib);
      if (token !== state.uploadToken) return;
      state.sourceBytes = bytes; state.sourceName = file.name;
      $('docBadge').textContent = file.name;
      sourceStatus('Loaded and parsed: ' + result.pageCount + ' page(s). First page: ' + result.sizes[0].width.toFixed(0) + ' × ' + result.sizes[0].height.toFixed(0) + ' pt.');
    } catch (error) {
      if (token !== state.uploadToken) return;
      sourceStatus((error.message || 'Could not load PDF.') + ' Previous document remains active: ' + state.sourceName + '.', true);
    } finally {
      if (token === state.uploadToken) { state.uploading = false; event.target.value = ''; invalidate(); }
    }
  });
  $('btnResetSample').addEventListener('click', () => {
    state.uploadToken++; state.uploading = false; state.sourceBytes = null; state.sourceName = 'New document';
    $('pdfUploadInput').value = ''; $('docBadge').textContent = 'New document'; sourceStatus('New document selected. Your annotations are retained.'); invalidate();
  });
  for (const id of ['btnDownloadPdf', 'openPdf']) $(id).addEventListener('click', event => {
    if (!state.artifact || state.artifact.revision !== state.revision || state.uploading) event.preventDefault();
  });
  window.addEventListener('pagehide', () => { if (state.artifact) URL.revokeObjectURL(state.artifact.url); });
  window.addEventListener('pageshow', event => { if (event.persisted) invalidate(); });
  renderItems(); invalidate();
})();
