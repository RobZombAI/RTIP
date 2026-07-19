// ═══════════════════════════════════════════
//  RTIP — Unified API Bridge
//  Intelligent model lifecycle + clean UX
// ═══════════════════════════════════════════

let ocrFilePath = null;
let pdfFilePath = null;
let isProcessing = false;
let lastOcrResult = null;
let chatHistory = [];
let loadedContent = '';
let modelLoading = false;

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof pywebview === 'undefined') return devMode();
  pollModels();
  document.getElementById('ocrTab').click();
});

function devMode() {
  ['ocrBadge','llmBadge'].forEach(id => {
    document.getElementById(id).textContent = '⚠️ Dev';
    document.getElementById(id).className = 'badge error';
  });
}

async function pollModels() {
  let ocrOk = false, llmOk = false;
  for (let i = 0; i < 120; i++) {
    try {
      const s = await pywebview.api.get_status();
      if (s.ocr && !ocrOk) { ocrOk = true; setModelStatus('ocr', 'ok'); }
      if (s.llm && !llmOk) { llmOk = true; setModelStatus('llm', 'ok'); }
      if (ocrOk && llmOk) return;
    } catch(_) {}
    await sleep(1500);
    const d = '.'.repeat((i % 3) + 1);
    if (!ocrOk) document.getElementById('ocrBadge').textContent = `⏳ OCR${d}`;
    if (!llmOk) document.getElementById('llmBadge').textContent = `⏳ LLM${d}`;
  }
  if (!ocrOk) setModelStatus('ocr', 'err');
  if (!llmOk) setModelStatus('llm', 'err');
}

function setModelStatus(which, state) {
  const label = which === 'ocr' ? 'OCR' : 'LLM';
  const dot = document.getElementById(`${which}Dot`);
  const badge = document.getElementById(`${which}Badge`);
  if (state === 'ok') {
    badge.textContent = `✅ ${label}`; badge.className = 'badge ready';
    dot.className = 'status-dot ok';
  } else if (state === 'loading') {
    badge.textContent = `⏳ ${label}`; badge.className = 'badge starting';
    dot.className = 'status-dot wait';
  } else {
    badge.textContent = `❌ ${label}`; badge.className = 'badge error';
    dot.className = 'status-dot err';
  }
}

async function switchTab(name) {
  if (modelLoading) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');

  if (typeof pywebview === 'undefined') return;
  modelLoading = true;
  document.getElementById(`${name}Loading`).style.display = 'block';
  if (name === 'read') document.getElementById('chatMessages').style.opacity = '0.5';
  if (name === 'ocr') document.getElementById('ocrBtn').disabled = true;

  try {
    await pywebview.api.tab_switched(name);
  } catch(e) { console.error(e); }
}

function tabReady(tab, ok) {
  modelLoading = false;
  document.getElementById(`${tab}Loading`).style.display = 'none';
  if (tab === 'read') document.getElementById('chatMessages').style.opacity = '1';
  if (tab === 'ocr') document.getElementById('ocrBtn').disabled = !ocrFilePath;
  if (ok) setModelStatus(tab === 'ocr' ? 'ocr' : 'llm', 'ok');
  else setModelStatus(tab === 'ocr' ? 'ocr' : 'llm', 'err');
}

// ═══════════════════════════════════════════
//  OCR Tab
// ═══════════════════════════════════════════

document.getElementById('ocrDropZone').addEventListener('click', async () => {
  try {
    const p = await pywebview.api.pick_file();
    if (p) ocrSelectFile(p);
  } catch(_) {}
});

async function ocrSelectFile(path) {
  ocrFilePath = path;
  document.getElementById('ocrBtn').disabled = false;
  document.getElementById('ocrSaveToast').classList.remove('visible');
  const info = await pywebview.api.file_info(path);
  document.getElementById('ocrDropContent').style.display = 'none';
  document.getElementById('ocrThumbWrap').style.display = '';
  document.getElementById('ocrFileMeta').style.display = '';
  document.getElementById('ocrFileName').textContent = info.name;
  document.getElementById('ocrFileSize').textContent = info.size_str;
  const badge = document.getElementById('ocrFileBadge');
  badge.textContent = info.type.toUpperCase();
  badge.className = `file-badge badge-${info.type}`;
  const img = document.getElementById('ocrPreviewImg');
  if (info.type === 'image') {
    const b64 = await pywebview.api.read_file_b64(path);
    img.src = 'data:image/png;base64,' + b64;
    img.style.display = '';
    document.getElementById('modalPreviewImg').src = img.src;
    img.onclick = (ev) => { ev.stopPropagation(); document.getElementById('imagePreview').classList.add('visible'); };
  } else { img.style.display = 'none'; }
  document.getElementById('ocrDropZone').classList.add('has-file');
}

document.getElementById('ocrBtn').addEventListener('click', ocrRun);
document.getElementById('ocrPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && ocrFilePath) ocrRun(); });

async function ocrRun() {
  if (!ocrFilePath || isProcessing) return;
  isProcessing = true;
  const btn = document.getElementById('ocrBtn');
  btn.textContent = '⏳ OCR…'; btn.classList.add('loading');
  document.getElementById('ocrResults').classList.add('visible');
  document.getElementById('ocrResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>OCR in progress…</div></div>';
  document.getElementById('ocrError').classList.remove('visible');
  document.getElementById('ocrSaveToast').classList.remove('visible');
  try { await pywebview.api.run_ocr(ocrFilePath, document.getElementById('ocrPrompt').value); }
  catch (e) { showError(String(e)); isProcessing = false; }
}

function showLoading() {}

function showResult(data) {
  lastOcrResult = data; isProcessing = false;
  document.getElementById('ocrBtn').textContent = '🔍 OCR'; document.getElementById('ocrBtn').classList.remove('loading');
  const body = document.getElementById('ocrResultBody'); body.innerHTML = '';
  const clean = document.createElement('div');
  clean.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;padding:4px;color:var(--text);';
  window.ocrCp = 0;
  const tp = data.pages.length;
  if (tp > 1) {
    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:4px 8px;background:var(--bg);border-radius:4px;font-size:11px;';
    nav.innerHTML = `<button onclick="ocrNav(-1)" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:1px 8px;border-radius:3px;cursor:pointer;">◀</button><span>Page <span id="ocrPg">1</span>/${tp}</span><button onclick="ocrNav(1)" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:1px 8px;border-radius:3px;cursor:pointer;">▶</button>`;
    body.appendChild(nav);
    clean.textContent = ocrClean(data.pages[0].raw);
  } else { clean.textContent = ocrClean(data.raw); }
  body.appendChild(clean);
  let tl = 0; for (const p of data.pages) tl += p.lines ? p.lines.length : 0;
  document.getElementById('ocrLineCount').textContent = `${tl} lines · ${tp} page${tp>1?'s':''}`;
  document.getElementById('ocrResultTitle').textContent = data.type === 'pdf' ? '📄 PDF OCR' : '🖼️ Image OCR';
  document.getElementById('ocrSavePath').textContent = data.save_path;
  document.getElementById('ocrSaveToast').classList.add('visible');
}

function ocrNav(d) {
  const tp = lastOcrResult.pages.length;
  const np = Math.max(0, Math.min(tp-1, window.ocrCp + d));
  if (np !== window.ocrCp) {
    window.ocrCp = np;
    document.getElementById('ocrPg').textContent = np + 1;
    const body = document.getElementById('ocrResultBody');
    body.lastChild.textContent = ocrClean(lastOcrResult.pages[np].raw);
  }
}

function ocrClean(raw) { return raw.split('\n').map(l => l.replace(/^(title|text)\s*\[[^\]]*\]\s*/i,'').trim()).filter(l=>l.length).join('\n'); }
function ocrCopyAll() { copyText(lastOcrResult && lastOcrResult.raw); }
function ocrOpenFolder() { if(lastOcrResult && lastOcrResult.save_path) pywebview.api.open_folder(lastOcrResult.save_path); }
function showError(m) {
  isProcessing = false;
  document.getElementById('ocrBtn').textContent = '🔍 OCR'; document.getElementById('ocrBtn').classList.remove('loading');
  document.getElementById('ocrError').textContent = '❌ ' + m; document.getElementById('ocrError').classList.add('visible');
}

// ═══════════════════════════════════════════
//  Read Tab (LLM Chat)
// ═══════════════════════════════════════════

async function readPickFile() {
  try {
    const path = await pywebview.api.pick_file();
    if (path) {
      const text = await pywebview.api.read_file_text(path);
      const info = await pywebview.api.file_info(path);
      loadedContent = text;
      document.getElementById('readFileName').textContent = `📄 ${info.name} (${info.size_str})`;
      addMsg('system', `📄 Loaded: ${info.name} (${text.length} chars)`);
    }
  } catch(_) {}
}

async function readPickImage() {
  try {
    const path = await pywebview.api.pick_file();
    if (path) {
      const info = await pywebview.api.file_info(path);
      if (info.type === 'image') {
        addMsg('system', `📷 OCR image: ${info.name}`);
        ocrFilePath = path;
        await pywebview.api.run_ocr(path, document.getElementById('ocrPrompt').value || "document parsing.");
      } else addMsg('system', `⚠️ Not an image: ${info.name}`);
    }
  } catch(_) {}
}

// Forward OCR results to chat
const _origSR = window.showResult;
window.showResult = function(d) {
  _origSR(d);
  addMsg('system', `📄 OCR done (${d.raw.length} chars)`);
};
const _origSE = window.showError;
window.showError = function(m) {
  _origSE(m);
  addMsg('assistant', `❌ ${m}`);
};

document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } });

async function chatSend() {
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (!msg || modelLoading) return;
  inp.value = '';
  addMsg('user', msg);
  const loadEl = addMsg('assistant', '<span class="loading-dots">Thinking</span>');
  try {
    if (loadedContent) {
      chatHistory.push({role:"user",content:msg});
      await pywebview.api.llm_analyze_text(loadedContent, msg);
    } else if (lastOcrResult && lastOcrResult.raw) {
      chatHistory.push({role:"user",content:msg});
      await pywebview.api.llm_analyze_text(lastOcrResult.raw, msg);
    } else {
      chatHistory.push({role:"user",content:msg});
      await pywebview.api.llm_send(msg, JSON.stringify(chatHistory));
    }
  } catch(e) { loadEl.remove(); addMsg('assistant', `❌ ${e}`); }
  autoResizeChat();
}

function llmResponse(t) { rmLoad(); addMsg('assistant', t); chatHistory.push({role:"assistant",content:t}); }
function llmError(m) { rmLoad(); addMsg('assistant', `❌ ${m}`); }
function rmLoad() { const m = document.getElementById('chatMessages'); const l = m.lastChild; if(l && l.innerHTML.includes('loading-dots')) l.remove(); }

function addMsg(role, text) {
  const d = document.createElement('div'); d.className = `chat-msg ${role}`; d.innerHTML = text;
  const c = document.getElementById('chatMessages'); c.appendChild(d); c.scrollTop = c.scrollHeight;
  return d;
}

function readClear() {
  loadedContent = ''; chatHistory = [];
  document.getElementById('readFileName').textContent = '';
  document.getElementById('chatMessages').innerHTML = '<div class="chat-msg assistant">👋 Send a message or load a file to analyze.</div>';
}

function autoResizeChat() { const ta = document.getElementById('chatInput'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }

// ═══════════════════════════════════════════
//  PDF Tab
// ═══════════════════════════════════════════

document.getElementById('pdfDropZone').addEventListener('click', async () => {
  try { const p = await pywebview.api.pick_file(); if(p) pdfSelectFile(p); } catch(_) {}
});

async function pdfSelectFile(path) {
  pdfFilePath = path;
  const info = await pywebview.api.file_info(path);
  document.getElementById('pdfDropContent').style.display = 'none';
  document.getElementById('pdfFileMeta').style.display = '';
  document.getElementById('pdfFileName').textContent = info.name;
  document.getElementById('pdfFileSize').textContent = info.size_str;
  ['pdfExtractBtn','pdfOcrBtn','pdfAnalyzeBtn'].forEach(id => document.getElementById(id).disabled = false);
  document.getElementById('pdfSaveToast').classList.remove('visible');
  document.getElementById('pdfDropZone').classList.add('has-file');
}

let lastPdfResult = null;

document.getElementById('pdfExtractBtn').addEventListener('click', () => {
  if (!pdfFilePath) return;
  document.getElementById('pdfResults').classList.add('visible');
  document.getElementById('pdfResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>Extracting text…</div></div>';
  pywebview.api.extract_pdf_text(pdfFilePath);
});

document.getElementById('pdfOcrBtn').addEventListener('click', () => {
  if (!pdfFilePath) return;
  ocrFilePath = pdfFilePath;
  document.getElementById('ocrPrompt').value = 'document parsing.';
  switchTab('ocr');
  ocrRun();
});

function pdfExtracted(data) {
  lastPdfResult = data;
  document.getElementById('pdfResultBody').innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText = 'font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--text);';
  pre.textContent = data.full_text;
  document.getElementById('pdfResultBody').appendChild(pre);
  document.getElementById('pdfPageCount').textContent = `${data.pages.length} pages`;
  document.getElementById('pdfResultTitle').textContent = '📄 Text Extraction';
  document.getElementById('pdfSavePath').textContent = data.save_path;
  document.getElementById('pdfSaveToast').classList.add('visible');
  loadedContent = data.full_text;
}

document.getElementById('pdfAnalyzeBtn').addEventListener('click', () => {
  if (!pdfFilePath) return;
  switchTab('read');
  addMsg('system', '📄 Processing PDF for analysis…');
  pdfExtractAndAnalyze();
});

async function pdfExtractAndAnalyze() {
  if (lastPdfResult && lastPdfResult.full_text) {
    loadedContent = lastPdfResult.full_text;
    addMsg('system', `📄 PDF ready (${loadedContent.length} chars)`);
    return;
  }
  document.getElementById('pdfResults').classList.add('visible');
  document.getElementById('pdfResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>Extracting text…</div></div>';
  try {
    const info = await pywebview.api.file_info(pdfFilePath);
    addMsg('system', `📄 Loading ${info.name}…`);
  } catch(_) {}
  // extract_pdf_text callback will set loadedContent
}

function pdfOpenFolder() {
  const sp = document.getElementById('pdfSavePath').textContent;
  if (sp) pywebview.api.open_folder(sp);
}

// ═══════════════════════════════════════════
//  Utils
// ═══════════════════════════════════════════

function copyText(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(showCopy); }
  else {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showCopy();
  }
}

function showCopy() {
  const el = document.getElementById('copyToast');
  el.classList.add('visible');
  clearTimeout(window._ct);
  window._ct = setTimeout(() => el.classList.remove('visible'), 2000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
