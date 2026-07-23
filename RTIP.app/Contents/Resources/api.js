// ═══════════════════════════════════════════
//  RTIP — Image OCR + PDF Reader
// ═══════════════════════════════════════════

let selectedPath = null;
let isProcessing = false;
let currentType = null; // 'image' or 'pdf'
let currentPages = [];
let currentPage = 0;
let currentFullText = '';
let currentSavePath = '';
let chatHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  if (typeof pywebview !== 'undefined') pollStatus();
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ Status ──
async function pollStatus() {
  try {
    const s = await pywebview.api.get_status();
    updateStatus(s);
  } catch(_) {}
  setTimeout(pollStatus, 3000);
}

function updateStatus(s) {
  if (s.ocr) { setModel('ocr', 'on'); }
  else if (s.ocr === 'loading') { setModel('ocr', 'loading'); }
  else { setModel('ocr', 'off'); }
  setModel('llm', s.llm ? 'on' : 'off');
}

function setModel(m, state) {
  const dot = document.getElementById(m + 'Dot');
  dot.className = 'status-dot ' + state;
  if (state === 'on') {
    document.getElementById(m + 'Start').style.display = 'none';
    document.getElementById(m + 'Stop').style.display = '';
  } else {
    document.getElementById(m + 'Start').style.display = '';
    document.getElementById(m + 'Stop').style.display = 'none';
  }
}

async function startModel(m) {
  document.getElementById(m + 'Dot').className = 'status-dot loading';
  if (m === 'ocr') await pywebview.api.start_ocr();
  else await pywebview.api.start_llm();
}

async function stopModel(m) {
  if (m === 'ocr') await pywebview.api.stop_ocr();
  else await pywebview.api.stop_llm();
}

// ═══ File selection ──

document.getElementById('dropZone').addEventListener('click', async () => {
  try {
    const p = await pywebview.api.pick_file();
    if (p) selectFile(p);
  } catch(_) {}
});

async function selectFile(path) {
  selectedPath = path; currentPage = 0; currentPages = [];
  currentType = null; currentFullText = '';
  document.getElementById('pageNav').style.display = 'none';
  document.getElementById('analyzeBtn').style.display = 'none';
  document.getElementById('chatSection').classList.remove('visible');
  document.getElementById('saveToast').classList.remove('visible');
  document.getElementById('actionBar').style.display = '';
  document.getElementById('infoBox').classList.remove('visible');

  const info = await pywebview.api.file_info(path);
  currentType = info.type;

  document.getElementById('dropContent').style.display = 'none';
  document.getElementById('filePreview').style.display = 'flex';
  document.getElementById('fileName').textContent = info.name;
  document.getElementById('fileSize').textContent = info.size_str;

  const badge = document.getElementById('fileBadge');
  badge.textContent = info.type.toUpperCase();
  badge.className = 'file-badge badge-' + info.type;

  const img = document.getElementById('previewImg');
  if (info.type === 'image') {
    const b64 = await pywebview.api.read_file_b64(path);
    img.src = 'data:image/png;base64,' + b64;
    img.style.display = '';
  } else { img.style.display = 'none'; }

  document.getElementById('dropZone').classList.add('has-file');

  // Configure action bar
  const box = document.getElementById('infoBox');
  if (info.type === 'pdf') {
    box.className = 'info-box visible info-pdf';
    box.innerHTML = '📄 PDF: text extraction + optional AI analysis';
    const btn = document.getElementById('actionBtn');
    btn.textContent = '📝 Extract text';
    btn.disabled = false;
    btn.onclick = extractPdf;
  } else {
    box.className = 'info-box visible info-image';
    box.innerHTML = '🖼️ Image: OCR text extraction';
    const btn = document.getElementById('actionBtn');
    btn.textContent = '🔍 OCR';
    btn.disabled = false;
    btn.onclick = runOcr;
  }
}

// ═══ PDF text extraction ──

async function extractPdf() {
  if (!selectedPath || isProcessing) return;
  isProcessing = true;
  showProgress('Extracting text from PDF…');
  document.getElementById('resultArea').classList.add('visible');
  document.getElementById('resultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>Extracting…</div></div>';
  hideError();
  try { await pywebview.api.extract_pdf_text(selectedPath); }
  catch (e) { showError(e); isProcessing = false; }
}

// ═══ Image OCR ──

async function runOcr() {
  if (!selectedPath || isProcessing) return;
  isProcessing = true;
  showProgress('OCR in progress…');
  document.getElementById('resultArea').classList.add('visible');
  document.getElementById('resultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>OCR in progress…</div></div>';
  hideError();
  try { await pywebview.api.run_ocr(selectedPath, document.getElementById('promptInput').value || 'Extract all text from this document.'); }
  catch (e) { showError(e); isProcessing = false; }
}

function showLoading() { showProgress('Processing…'); }

function streamPage(data) {
  currentPages[data.page - 1] = data.text;
  document.getElementById('progressLabel').textContent = 'Page ' + data.page + '/' + data.total + '…';
  document.getElementById('progressDetail').textContent = data.text.length + ' chars';
  const body = document.getElementById('resultBody');
  if (body.children.length === 1 && body.children[0].className === 'loading-indicator') body.innerHTML = '';
  const d = document.createElement('div');
  d.style.cssText = 'padding:4px 8px;margin:2px 0;background:var(--surface2);border-radius:4px;font-size:12px;color:var(--success);';
  d.textContent = '📄 Page ' + data.page + '/' + data.total + ' ✓ (' + data.text.length + ' chars)';
  body.appendChild(d);
  body.scrollTop = body.scrollHeight;
}

function showResult(data) {
  hideProgress(); isProcessing = false;
  currentFullText = data.raw;
  currentSavePath = data.save_path;
  currentPage = 0;

  // Parse pages
  if (data.type === 'pdf' && data.pages) {
    currentPages = data.pages.map(p => p.text);
  } else {
    currentPages = [data.raw];
  }

  showPage(0);
  document.getElementById('savePath').textContent = data.save_path;
  document.getElementById('saveToast').classList.add('visible');

  if (currentPages.length > 1) {
    document.getElementById('pageNav').style.display = '';
    document.getElementById('pageTotal').textContent = currentPages.length;
    document.getElementById('analyzeBtn').style.display = '';
  } else {
    document.getElementById('pageNav').style.display = 'none';
    document.getElementById('analyzeBtn').style.display = currentType === 'pdf' ? '' : 'none';
  }
  document.getElementById('resultTitle').textContent = data.type === 'pdf' ? '📄 PDF Text' : '🖼️ OCR Result';
  document.getElementById('actionBar').style.display = 'none';
}

function showPage(idx) {
  currentPage = Math.max(0, Math.min(idx, currentPages.length - 1));
  const body = document.getElementById('resultBody');
  body.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = currentPages[currentPage] || '[empty]';
  body.appendChild(pre);
  document.getElementById('pageNum').textContent = currentPage + 1;
  if (document.getElementById('prevPg')) document.getElementById('prevPg').disabled = currentPage === 0;
  if (document.getElementById('nextPg')) document.getElementById('nextPg').disabled = currentPage === currentPages.length - 1;
}

function nextPage() { if (currentPage < currentPages.length - 1) showPage(currentPage + 1); }
function prevPage() { if (currentPage > 0) showPage(currentPage - 1); }

// ═══ Analyze with LLM ──

function openAnalyze() {
  document.getElementById('chatSection').classList.add('visible');
  document.getElementById('chatMessages').innerHTML = '<div class="chat-msg system">🤖 Agents A1 ready. Ask about this document.</div>';
  document.getElementById('analyzeBtn').style.display = 'none';
}

async function chatSend() {
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  addChat('user', msg);
  addChat('assistant', '<span class="loading-dots">Thinking</span>');

  const pageText = currentPages[currentPage] || '';
  try {
    await pywebview.api.llm_analyze(pageText, msg);
  } catch(e) {
    removeLastChat();
    addChat('assistant', '❌ Error: ' + e);
  }
}

function llmResponse(t) { removeLastChat(); addChat('assistant', t); }
function llmError(m) { removeLastChat(); addChat('assistant', '❌ ' + m); }

function addChat(role, text) {
  const d = document.createElement('div');
  d.className = 'chat-msg ' + role;
  d.innerHTML = text;
  document.getElementById('chatMessages').appendChild(d);
  document.getElementById('chatMessages').scrollTop = document.getElementById('chatMessages').scrollHeight;
}

function removeLastChat() {
  const m = document.getElementById('chatMessages');
  if (m.lastChild && m.lastChild.innerHTML.includes('loading-dots')) m.removeChild(m.lastChild);
}

// ═══ Cancel ──

function cancelCurrent() {
  if (currentType === 'image') {
    pywebview.api.cancel_ocr();
  }
  hideProgress(); isProcessing = false;
  showError('Cancelled');
}

// ═══ Progress ──

function showProgress(label) {
  document.getElementById('progressOverlay').classList.add('visible');
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('progressDetail').textContent = '';
}

function hideProgress() {
  document.getElementById('progressOverlay').classList.remove('visible');
}

// ═══ Utils ──

function showError(m) {
  hideProgress(); isProcessing = false;
  document.getElementById('errorBanner').textContent = '❌ ' + m;
  document.getElementById('errorBanner').classList.add('visible');
}
function hideError() { document.getElementById('errorBanner').classList.remove('visible'); }

function copyText(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(showCopy); }
  else {
    const ta = document.createElement('textarea'); ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showCopy();
  }
}

function openFolder() { if (currentSavePath) pywebview.api.open_folder(currentSavePath); }

function showCopy() {
  const el = document.getElementById('copyToast');
  el.classList.add('visible');
  clearTimeout(window._ct);
  window._ct = setTimeout(() => el.classList.remove('visible'), 2000);
}
