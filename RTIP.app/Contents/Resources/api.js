// ═══════════════════════════════════════════
//  RTIP OCR — LightOnOCR-2-1B
// ═══════════════════════════════════════════

let selectedPath = null;
let isProcessing = false;
let lastResult = null;
let pages = [];
let currentPage = 0;
let viewAllMode = false;

document.addEventListener('DOMContentLoaded', () => {
  if (typeof pywebview !== 'undefined') pollModel();
});

// ═══ Model ──

function updateStatus(s) {
  const dot = document.getElementById('modelDot');
  const label = document.getElementById('modelLabel');
  if (s.loaded) {
    dot.className = 'status-dot loaded'; label.textContent = 'loaded';
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = '';
  } else if (s.loading) {
    dot.className = 'status-dot loading'; label.textContent = 'loading…';
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'none';
  } else {
    dot.className = 'status-dot unloaded'; label.textContent = 'unloaded';
    document.getElementById('startBtn').style.display = '';
    document.getElementById('stopBtn').style.display = 'none';
  }
}

async function startModel() {
  document.getElementById('modelDot').className = 'status-dot loading';
  document.getElementById('modelLabel').textContent = 'loading…';
  try { await pywebview.api.start_model(); } catch(e) { console.error(e); }
}

async function stopModel() {
  try { await pywebview.api.stop_model(); } catch(e) { console.error(e); }
}

async function pollModel() {
  try { const s = await pywebview.api.get_status(); updateStatus({loaded: s.loaded}); } catch(_) {}
}

// ═══ File picker ──

document.getElementById('dropZone').addEventListener('click', async () => {
  try {
    const p = await pywebview.api.pick_file();
    if (p) selectFile(p);
  } catch(_) {}
});

async function selectFile(path) {
  selectedPath = path;
  pages = []; currentPage = 0; viewAllMode = false;
  document.getElementById('pageNav').style.display = 'none';
  document.getElementById('ocrBtn').disabled = false;
  document.getElementById('saveToast').classList.remove('visible');
  const info = await pywebview.api.file_info(path);
  document.getElementById('dropContent').style.display = 'none';
  document.getElementById('thumbWrap').style.display = '';
  document.getElementById('fileMeta').style.display = '';
  document.getElementById('fileName').textContent = info.name;
  document.getElementById('fileSize').textContent = info.size_str;
  const badge = document.getElementById('fileBadge');
  badge.textContent = info.type.toUpperCase();
  badge.className = 'file-badge ' + (info.type === 'pdf' ? 'badge-pdf' : 'badge-image');
  const img = document.getElementById('previewImg');
  if (info.type === 'image') {
    const b64 = await pywebview.api.read_file_b64(path);
    img.src = 'data:image/png;base64,' + b64; img.style.display = '';
    document.getElementById('modalPreviewImg').src = img.src;
    img.onclick = (ev) => { ev.stopPropagation(); document.getElementById('imagePreview').classList.add('visible'); };
  } else { img.style.display = 'none'; }
  document.getElementById('dropZone').classList.add('has-file');
}

// ═══ OCR ──

document.getElementById('ocrBtn').addEventListener('click', runOcr);
document.getElementById('promptInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && selectedPath) runOcr(); });

async function runOcr() {
  if (!selectedPath || isProcessing) return;
  isProcessing = true;
  pages = []; currentPage = 0; viewAllMode = false;
  document.getElementById('pageNav').style.display = 'none';
  const btn = document.getElementById('ocrBtn');
  btn.textContent = '⏳ OCR…'; btn.classList.add('loading');
  document.getElementById('ocrProgress').classList.add('visible');
  document.getElementById('ocrProgressLabel').textContent = 'Starting…';
  document.getElementById('ocrProgressDetail').textContent = '';
  document.getElementById('resultArea').classList.add('visible');
  document.getElementById('resultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>OCR in progress…</div></div>';
  document.getElementById('errorBanner').classList.remove('visible');
  document.getElementById('saveToast').classList.remove('visible');
  try { await pywebview.api.run_ocr(selectedPath, document.getElementById('promptInput').value); }
  catch (e) { showError(String(e)); isProcessing = false; }
}

function showLoading() {
  document.getElementById('ocrProgress').classList.add('visible');
  document.getElementById('ocrProgressLabel').textContent = 'Processing…';
}

function streamPage(data) {
  // Store page
  pages[data.page - 1] = data.text;
  currentPage = 0;
  viewAllMode = false;
  document.getElementById('ocrProgressLabel').textContent = 'Page ' + data.page + '/' + data.total + '…';
  document.getElementById('ocrProgressDetail').textContent = (data.text.length || '0') + ' chars extracted';

  const body = document.getElementById('resultBody');
  if (body.children.length === 1 && body.children[0].className === 'loading-indicator') {
    body.innerHTML = '';
  }

  // Show live preview of latest page
  const pre = document.createElement('pre');
  pre.textContent = '📄 Page ' + data.page + '/' + data.total + '\n' + data.text.slice(0, 500);
  if (data.text.length > 500) pre.textContent += '\n…';
  body.appendChild(pre);
  body.scrollTop = body.scrollHeight;

  updateRamMeter();
}

function updateRamMeter() {
  const el = document.getElementById('ramMeter');
  const usedPages = pages.filter(p => p !== undefined).length;
  if (usedPages > 0) {
    el.textContent = '📄 ' + usedPages + ' pages · ' + (lastResult ? (lastResult.match(/\n/g) || []).length + ' lines' : '');
  }
}

function showResult(data) {
  document.getElementById('ocrProgress').classList.remove('visible');
  lastResult = data.raw; isProcessing = false;

  // Parse pages from raw text
  if (data.raw.includes('=== PAGE')) {
    const parts = data.raw.split(/=== PAGE \d+\/\d+ ===/);
    pages = parts.filter(p => p.trim()).map(p => p.trim());
    currentPage = 0;
    showPage(0);
    document.getElementById('pageNav').style.display = '';
    document.getElementById('pageTotal').textContent = pages.length;
    document.getElementById('pageInput').value = 1;
    document.getElementById('resultTitle').textContent = '📄 PDF OCR (' + pages.length + ' pages)';
  } else {
    pages = [data.raw];
    currentPage = 0;
    showPage(0);
    document.getElementById('pageNav').style.display = 'none';
    document.getElementById('resultTitle').textContent = '🖼️ Image OCR';
  }

  document.getElementById('ocrBtn').textContent = '🔍 OCR';
  document.getElementById('ocrBtn').classList.remove('loading');
  document.getElementById('savePath').textContent = data.save_path;
  document.getElementById('saveToast').classList.add('visible');
  updateRamMeter();
}

// ═══ Page navigation ──

function showPage(idx) {
  viewAllMode = false;
  currentPage = Math.max(0, Math.min(idx, pages.length - 1));
  const body = document.getElementById('resultBody');
  body.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = pages[currentPage] || '[empty]';
  body.appendChild(pre);
  document.getElementById('pageInput').value = currentPage + 1;
  document.getElementById('prevPageBtn').disabled = currentPage === 0;
  document.getElementById('nextPageBtn').disabled = currentPage === pages.length - 1;
}

function nextPage() { if (currentPage < pages.length - 1) showPage(currentPage + 1); }
function prevPage() { if (currentPage > 0) showPage(currentPage - 1); }
function goToPage(n) { if (n >= 1 && n <= pages.length) showPage(n - 1); }

function viewAll() {
  viewAllMode = true;
  const body = document.getElementById('resultBody');
  body.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = lastResult;
  body.appendChild(pre);
}

// ═══ Cancel ──

function cancelOcr() {
  document.getElementById('ocrProgressLabel').textContent = 'Cancelling…';
  pywebview.api.cancel_ocr();
  setTimeout(() => {
    isProcessing = false;
    document.getElementById('ocrProgress').classList.remove('visible');
    document.getElementById('ocrBtn').textContent = '🔍 OCR';
    document.getElementById('ocrBtn').classList.remove('loading');
    showError('Cancelled');
    startModel();
  }, 800);
}

// ═══ Utils ──

function showError(m) {
  isProcessing = false; document.getElementById('ocrProgress').classList.remove('visible');
  document.getElementById('ocrBtn').textContent = '🔍 OCR'; document.getElementById('ocrBtn').classList.remove('loading');
  document.getElementById('errorBanner').textContent = '❌ ' + m;
  document.getElementById('errorBanner').classList.add('visible');
}

function copyAll() {
  const text = viewAllMode || pages.length <= 1 ? lastResult : pages[currentPage];
  if (!text) return;
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(showCopy); }
  else {
    const ta = document.createElement('textarea'); ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showCopy();
  }
}

function openFolder() { if (document.getElementById('savePath').textContent) pywebview.api.open_folder(document.getElementById('savePath').textContent); }

function showCopy() {
  const el = document.getElementById('copyToast');
  el.classList.add('visible');
  clearTimeout(window._ct);
  window._ct = setTimeout(() => el.classList.remove('visible'), 2000);
}
