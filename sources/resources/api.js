// ═══════════════════════════════════════════
//  RTIP v2.0 — Unified API Bridge
// ═══════════════════════════════════════════

let ocrFilePath = null;
let isProcessing = false;
let lastOcrResult = null;
let chatHistory = [];
let loadedContent = '';
let modelLoading = {ocr: false, llm: false};
let modelState = {ocr: 'unloaded', llm: 'unloaded'};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof pywebview !== 'undefined') { pollStatus(); }
  document.getElementById('ocrTab').click();
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════
//  Status — pushed from backend every 2s
// ═══════════════════════════════════════════

function updateStatus(data) {
  for (const m of ['ocr', 'llm']) {
    if (data[m]) {
      modelState[m] = data[m];
      const dot = document.getElementById(m + 'Dot');
      dot.className = 'status-dot ' + data[m];
      const startBtn = document.getElementById(m + 'StartBtn');
      const stopBtn = document.getElementById(m + 'StopBtn');
      if (data[m] === 'loaded' || data[m] === 'error') {
        stopBtn.style.display = '';
        startBtn.style.display = 'none';
        modelLoading[m] = false;
      } else if (data[m] === 'loading') {
        stopBtn.style.display = 'none';
        startBtn.style.display = 'none';
        modelLoading[m] = true;
      } else { // unloaded
        startBtn.style.display = '';
        stopBtn.style.display = 'none';
        modelLoading[m] = false;
      }
    }
  }
}

async function startModel(which) {
  if (modelLoading[which]) return;
  modelLoading[which] = true;
  document.getElementById(which + 'Dot').className = 'status-dot loading';
  try {
    if (which === 'ocr') await pywebview.api.start_ocr_model();
    else await pywebview.api.start_llm_model();
  } catch(e) { console.error(e); }
}

async function stopModel(which) {
  try {
    if (which === 'ocr') await pywebview.api.stop_ocr_model();
    else await pywebview.api.stop_llm_model();
  } catch(e) { console.error(e); }
}

async function pollStatus() {
  try {
    const s = await pywebview.api.get_status();
    updateStatus({ocr: s.ocr ? 'loaded' : 'unloaded', llm: s.llm ? 'loaded' : 'unloaded'});
  } catch(_) {}
}

// ═══════════════════════════════════════════
//  Tabs
// ═══════════════════════════════════════════

async function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
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
    img.src = 'data:image/png;base64,' + b64; img.style.display = '';
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
  document.getElementById('ocrProgress').style.display = 'flex';
  document.getElementById('ocrProgressLabel').textContent = 'OCR in progress…';
  document.getElementById('ocrResults').classList.add('visible');
  document.getElementById('ocrResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>OCR in progress…</div></div>';
  document.getElementById('ocrError').classList.remove('visible');
  document.getElementById('ocrSaveToast').classList.remove('visible');
  try { await pywebview.api.run_ocr(ocrFilePath, document.getElementById('ocrPrompt').value); }
  catch (e) { showError(String(e)); isProcessing = false; }
}

function cancelOcr() {
  document.getElementById('ocrProgressLabel').textContent = 'Cancelling…';
  pywebview.api.cancel_ocr();
  setTimeout(() => {
    isProcessing = false;
    document.getElementById('ocrProgress').style.display = 'none';
    document.getElementById('ocrBtn').textContent = '🔍 OCR';
    document.getElementById('ocrBtn').classList.remove('loading');
    showError('Cancelled');
  }, 500);
}

function showLoading() {
  document.getElementById('ocrProgress').style.display = 'flex';
  document.getElementById('ocrProgressLabel').textContent = 'OCR in progress…';
}

function showResult(data) {
  document.getElementById('ocrProgress').style.display = 'none';
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
    clean.textContent = data.pages[0].raw;
  } else { clean.textContent = data.raw; }
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
  if (np !== window.ocrCp) { window.ocrCp = np; document.getElementById('ocrPg').textContent = np + 1; document.getElementById('ocrResultBody').lastChild.textContent = lastOcrResult.pages[np].raw; }
}

function ocrCopyAll() { copyText(lastOcrResult && lastOcrResult.raw); }
function ocrOpenFolder() { if(lastOcrResult && lastOcrResult.save_path) pywebview.api.open_folder(lastOcrResult.save_path); }
function showError(m) { isProcessing = false; document.getElementById('ocrProgress').style.display = 'none'; document.getElementById('ocrBtn').textContent = '🔍 OCR'; document.getElementById('ocrBtn').classList.remove('loading'); document.getElementById('ocrError').textContent = '❌ ' + m; document.getElementById('ocrError').classList.add('visible'); }

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
        await pywebview.api.run_ocr(path, document.getElementById('ocrPrompt').value || "Extract all text from this document.");
      } else addMsg('system', `⚠️ Not an image: ${info.name}`);
    }
  } catch(_) {}
}

const _origSR = window.showResult;
window.showResult = function(d) { _origSR(d); addMsg('system', `📄 OCR done (${d.raw.length} chars)`); };
const _origSE = window.showError;
window.showError = function(m) { _origSE(m); addMsg('assistant', `❌ ${m}`); };

document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } });

async function chatSend() {
  const inp = document.getElementById('chatInput'); const msg = inp.value.trim();
  if (!msg || modelLoading.llm) return;
  inp.value = ''; addMsg('user', msg);
  const loadEl = addMsg('assistant', '<span class="loading-dots">Thinking</span>');
  try {
    chatHistory.push({role:"user",content:msg});
    if (loadedContent) await pywebview.api.llm_analyze_text(loadedContent, msg);
    else if (lastOcrResult && lastOcrResult.raw) await pywebview.api.llm_analyze_text(lastOcrResult.raw, msg);
    else await pywebview.api.llm_send(msg, JSON.stringify(chatHistory));
  } catch(e) { loadEl.remove(); addMsg('assistant', `❌ ${e}`); }
  autoResizeChat();
}

function llmResponse(t) { rmLoad(); addMsg('assistant', t); chatHistory.push({role:"assistant",content:t}); }
function llmError(m) { rmLoad(); addMsg('assistant', `❌ ${m}`); }
function rmLoad() { const m = document.getElementById('chatMessages'); const l = m.lastChild; if(l && l.innerHTML.includes('loading-dots')) l.remove(); }

function addMsg(role, text) {
  const d = document.createElement('div'); d.className = `chat-msg ${role}`; d.innerHTML = text;
  const c = document.getElementById('chatMessages'); c.appendChild(d); c.scrollTop = c.scrollHeight; return d;
}

function readClear() { loadedContent = ''; chatHistory = []; document.getElementById('readFileName').textContent = ''; document.getElementById('chatMessages').innerHTML = '<div class="chat-msg assistant">👋 Send a message or load a file to analyze.</div>'; }
function autoResizeChat() { const ta = document.getElementById('chatInput'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }

// ═══════════════════════════════════════════
//  Utils
// ═══════════════════════════════════════════

function copyText(text) {
  if (!text) return;
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(showCopy); }
  else { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showCopy(); }
}

function showCopy() { const el = document.getElementById('copyToast'); el.classList.add('visible'); clearTimeout(window._ct); window._ct = setTimeout(() => el.classList.remove('visible'), 2000); }
