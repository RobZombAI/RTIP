// ═══════════════════════════════════════════
//  RTIP OCR — LightOnOCR-2-1B
// ═══════════════════════════════════════════

let selectedPath = null;
let isProcessing = false;
let lastResult = null;

document.addEventListener('DOMContentLoaded', () => {
  if (typeof pywebview !== 'undefined') pollModel();
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ Model status ── pushed from backend ──

function updateStatus(s) {
  const dot = document.getElementById('modelDot');
  const label = document.getElementById('modelLabel');
  if (s.loaded) {
    dot.className = 'status-dot loaded';
    label.textContent = 'loaded';
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = '';
  } else if (s.loading) {
    dot.className = 'status-dot loading';
    label.textContent = 'loading…';
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'none';
  } else {
    dot.className = 'status-dot unloaded';
    label.textContent = 'unloaded';
    document.getElementById('startBtn').style.display = '';
    document.getElementById('stopBtn').style.display = 'none';
  }
}

async function startModel() {
  document.getElementById('modelDot').className = 'status-dot loading';
  document.getElementById('modelLabel').textContent = 'loading…';
  try { await pywebview.api.start_model(); }
  catch(e) { console.error(e); }
}

async function stopModel() {
  try { await pywebview.api.stop_model(); }
  catch(e) { console.error(e); }
}

async function pollModel() {
  try {
    const s = await pywebview.api.get_status();
    updateStatus({loaded: s.loaded});
  } catch(_) {}
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
  const btn = document.getElementById('ocrBtn');
  btn.textContent = '⏳ OCR…'; btn.classList.add('loading');
  document.getElementById('ocrProgress').classList.add('visible');
  document.getElementById('ocrProgressLabel').textContent = 'OCR in progress…';
  document.getElementById('resultArea').classList.add('visible');
  document.getElementById('resultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>OCR in progress…</div></div>';
  document.getElementById('errorBanner').classList.remove('visible');
  document.getElementById('saveToast').classList.remove('visible');
  try { await pywebview.api.run_ocr(selectedPath, document.getElementById('promptInput').value); }
  catch (e) { showError(String(e)); isProcessing = false; }
}

function showLoading() {
  document.getElementById('ocrProgress').classList.add('visible');
  document.getElementById('ocrProgressLabel').textContent = 'OCR in progress…';
}

function streamPage(data) {
  // Append live page result
  const body = document.getElementById('resultBody');
  // Remove loading indicator if present
  if (body.children.length === 1 && body.children[0].classList.contains('loading-indicator')) {
    body.innerHTML = '';
  }
  // Add or update page result
  const existing = document.getElementById('page-' + data.page);
  if (existing) {
    existing.textContent = '📄 Page ' + data.page + '/' + data.total + ' ✓';
  } else {
    const div = document.createElement('div');
    div.id = 'page-' + data.page;
    div.style.cssText = 'padding:4px 8px;margin:2px 0;background:var(--surface2);border-radius:4px;font-size:12px;color:var(--success);';
    div.textContent = '📄 Page ' + data.page + '/' + data.total + ' ✓';
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }
  document.getElementById('ocrProgressLabel').textContent = 'Page ' + data.page + '/' + data.total + '…';
}

function cancelOcr() {
  document.getElementById('ocrProgressLabel').textContent = 'Cancelling…';
  pywebview.api.cancel_ocr();
  setTimeout(() => {
    isProcessing = false;
    document.getElementById('ocrProgress').classList.remove('visible');
    document.getElementById('ocrBtn').textContent = '🔍 OCR';
    document.getElementById('ocrBtn').classList.remove('loading');
    showError('Cancelled');
    // Re-load model for next use
    startModel();
  }, 800);
}

function showResult(data) {
  document.getElementById('ocrProgress').classList.remove('visible');
  lastResult = data; isProcessing = false;
  document.getElementById('ocrBtn').textContent = '🔍 OCR';
  document.getElementById('ocrBtn').classList.remove('loading');
  const body = document.getElementById('resultBody');
  body.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--text);';
  pre.textContent = data.raw;
  body.appendChild(pre);
  const lines = data.raw.split('\n').filter(l => l.trim()).length;
  document.getElementById('resultTitle').textContent = data.type === 'pdf' ? '📄 PDF OCR' : '🖼️ Image OCR';
  document.getElementById('savePath').textContent = data.save_path;
  document.getElementById('saveToast').classList.add('visible');
}

function showError(m) {
  isProcessing = false;
  document.getElementById('ocrProgress').classList.remove('visible');
  document.getElementById('ocrBtn').textContent = '🔍 OCR';
  document.getElementById('ocrBtn').classList.remove('loading');
  document.getElementById('errorBanner').textContent = '❌ ' + m;
  document.getElementById('errorBanner').classList.add('visible');
}

function copyAll() { copyText(lastResult && lastResult.raw); }
function openFolder() { if(lastResult && lastResult.save_path) pywebview.api.open_folder(lastResult.save_path); }

function copyText(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(showCopy); }
  else {
    const ta = document.createElement('textarea'); ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showCopy();
  }
}

function showCopy() {
  const el = document.getElementById('copyToast');
  el.classList.add('visible');
  clearTimeout(window._ct);
  window._ct = setTimeout(() => el.classList.remove('visible'), 2000);
}
