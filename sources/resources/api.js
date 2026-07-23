// ═══════════════════════════════════════════
//  RTIP — Session Manager + AI Post-Processing
// ═══════════════════════════════════════════

let selectedPath = null;
let isProcessing = false;
let currentType = null;
let currentPages = [];
let currentPage = 0;
let currentFullText = '';
let currentSid = null;
let currentSavePath = '';
let chatHistory = [];
let sessions = [];
let systemInfo = null;

document.addEventListener('DOMContentLoaded', () => {
  if (typeof pywebview !== 'undefined') { initSystem(); pollStatus(); refreshSessions(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isProcessing) cancelCurrent(); });
});

async function initSystem() {
  try {
    systemInfo = JSON.parse(await pywebview.api.get_system_info());
    showSystemInfo();
  } catch(e) { console.error(e); }
}

function showSystemInfo() {
  if (!systemInfo) return;
  const bar = document.getElementById('statusBar');
  const existing = document.getElementById('sysInfo');
  if (existing) existing.remove();
  const el = document.createElement('span');
  el.id = 'sysInfo';
  el.style.cssText = 'font-size:10px;color:var(--text2);margin-left:auto;';
  el.textContent = '🧠 ' + systemInfo.ram_gb + 'GB · ' + systemInfo.msg_ocr + ' · ' + systemInfo.msg_llm;
  bar.appendChild(el);
  if (systemInfo.llm && !systemInfo.llm_file) addDownloadUI();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ Status ──
async function pollStatus() {
  try {
    const s = await pywebview.api.get_status();
    setDot('ocr', s.ocr ? 'on' : (s.ocr === 'loading' ? 'loading' : 'off'));
    setDot('llm', s.llm ? 'on' : 'off');
  } catch(_) {}
  setTimeout(pollStatus, 3000);
}

function setDot(id, state) {
  document.getElementById(id + 'Dot').className = 'status-dot ' + state;
}

// ═══ Sessions ──
async function refreshSessions() {
  if (typeof pywebview === 'undefined') return;
  try {
    sessions = JSON.parse(await pywebview.api.get_sessions());
  } catch(e) { sessions = []; }
  renderSessions();
}

function renderSessions() {
  const list = document.getElementById('sessionList');
  document.getElementById('sessionCount').textContent = sessions.length + ' sessions';
  if (sessions.length === 0) {
    list.innerHTML = '<div style="padding:12px;font-size:10px;color:var(--text2);text-align:center">No sessions yet</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item${s.id === currentSid ? ' active' : ''}" onclick="openSession('${s.id}')">
      <div class="name">${escHtml(s.file)}</div>
      <div class="meta">
        <span class="badge-type badge-${s.type}">${s.type}</span>
        <span>${s.chars}c</span>
        <span>${s.pages}p</span>
        <span class="del" onclick="event.stopPropagation();deleteSession('${s.id}')">✕</span>
      </div>
    </div>`).join('');
}

async function openSession(sid) {
  try {
    const data = JSON.parse(await pywebview.api.load_session(sid));
    currentSid = sid;
    currentFullText = data.raw || '';
    currentPages = (data.pages || []).map(p => p.text);
    currentPage = 0;
    currentSavePath = '';
    currentType = data.type;
    showPage(0);
    document.getElementById('resultArea').classList.add('visible');
    document.getElementById('resultTitle').textContent = data.type === 'pdf' ? '📄 ' + data.file : '🖼️ ' + data.file;
    document.getElementById('saveToast').classList.remove('visible');
    document.getElementById('actionBtns').style.display = '';
    document.getElementById('chatSection').classList.remove('visible');
    document.getElementById('chatMessages').innerHTML = '';
    if (currentPages.length > 1) {
      document.getElementById('pageNav').style.display = '';
      document.getElementById('pageTotal').textContent = currentPages.length;
    } else {
      document.getElementById('pageNav').style.display = 'none';
    }
    renderSessions();
  } catch(e) { showError(e); }
}

async function deleteSession(sid) {
  try {
    sessions = JSON.parse(await pywebview.api.delete_session(sid));
    if (sid === currentSid) { currentSid = null; clearResult(); }
    renderSessions();
  } catch(e) {}
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
  currentType = null; currentFullText = ''; currentSid = null;
  document.getElementById('pageNav').style.display = 'none';
  document.getElementById('actionBtns').style.display = 'none';
  document.getElementById('chatSection').classList.remove('visible');
  document.getElementById('saveToast').classList.remove('visible');
  hideError();

  const info = await pywebview.api.file_info(path);
  currentType = info.type;

  document.getElementById('dropContent').style.display = 'none';
  document.getElementById('filePreview').style.display = 'flex';
  document.getElementById('fileName').textContent = info.name;
  document.getElementById('fileSize').textContent = info.size_str;

  const badge = document.getElementById('fileBadge');
  badge.textContent = info.type.toUpperCase();
  badge.style.background = info.type === 'pdf' ? 'var(--error)' : 'var(--accent2)';
  badge.style.color = '#fff';

  const img = document.getElementById('previewImg');
  if (info.type === 'image') {
    const b64 = await pywebview.api.read_file_b64(path);
    img.src = 'data:image/png;base64,' + b64; img.style.display = '';
  } else { img.style.display = 'none'; }
  document.getElementById('dropZone').classList.add('has-file');

  const btn = document.getElementById('actionBtn');
  if (info.type === 'pdf') {
    btn.textContent = '📝 Extract text'; btn.onclick = extractPdf;
  } else {
    btn.textContent = '🔍 OCR'; btn.onclick = runOcr;
  }
  btn.disabled = false;
}

// ═══ PDF extraction ──
async function extractPdf() {
  if (!selectedPath || isProcessing) return;
  isProcessing = true;
  showProgress('Extracting PDF text…');
  document.getElementById('resultArea').classList.add('visible');
  document.getElementById('resultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>Extracting…</div></div>';
  try { await pywebview.api.extract_pdf(selectedPath); }
  catch (e) { showError(e); isProcessing = false; }
}

// ═══ Image OCR ──
async function runOcr() {
  if (!selectedPath || isProcessing) return;
  isProcessing = true;
  showProgress('OCR in progress…');
  document.getElementById('resultArea').classList.add('visible');
  document.getElementById('resultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>OCR…</div></div>';
  try { await pywebview.api.run_ocr(selectedPath, ''); }
  catch (e) { showError(e); isProcessing = false; }
}

function showLoading() { showProgress('Processing…'); }

// ═══ Results ──
function streamPage(data) {
  currentPages[data.page - 1] = data.text;
  document.getElementById('progressLabel').textContent = 'Page ' + data.page + '/' + data.total;
  document.getElementById('progressDetail').textContent = data.text.length + ' chars';
  const body = document.getElementById('resultBody');
  if (body.children.length === 1 && body.children[0].className === 'loading-indicator') body.innerHTML = '';
  const d = document.createElement('div');
  d.style.cssText = 'padding:3px 6px;margin:1px 0;background:var(--surface2);border-radius:3px;font-size:11px;color:var(--success);';
  d.textContent = '📄 Page ' + data.page + '/' + data.total + ' ✓';
  body.appendChild(d); body.scrollTop = body.scrollHeight;
}

function showResult(data) {
  hideProgress(); isProcessing = false;
  currentFullText = data.raw; currentSavePath = data.save_path;
  currentSid = data.sid; currentPage = 0;
  currentPages = data.pages.map(p => p.text);
  showPage(0);
  document.getElementById('savePath').textContent = data.save_path;
  document.getElementById('saveToast').classList.add('visible');
  document.getElementById('actionBtns').style.display = '';
  document.getElementById('resultTitle').textContent = data.type === 'pdf' ? '📄 PDF OCR' : '🖼️ Image OCR';
  if (currentPages.length > 1) {
    document.getElementById('pageNav').style.display = '';
    document.getElementById('pageTotal').textContent = currentPages.length;
  } else { document.getElementById('pageNav').style.display = 'none'; }
  document.getElementById('actionBtn').disabled = true;
}

function showPage(idx) {
  currentPage = Math.max(0, Math.min(idx, currentPages.length - 1));
  document.getElementById('resultBody').innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = currentPages[currentPage] || '[empty]';
  document.getElementById('resultBody').appendChild(pre);
  document.getElementById('pageNum').textContent = currentPage + 1;
  if (document.getElementById('prevPg')) document.getElementById('prevPg').disabled = currentPage === 0;
  if (document.getElementById('nextPg')) document.getElementById('nextPg').disabled = currentPage === currentPages.length - 1;
}

function nextPage() { if (currentPage < currentPages.length - 1) showPage(currentPage + 1); }
function prevPage() { if (currentPage > 0) showPage(currentPage - 1); }

// ═══ LLM Post-Processing ──
function llmAction(action) {
  if (!currentFullText) return;
  const lang = document.getElementById('langSelect')?.value || 'Italian';
  const btn = event.target;
  const labels = {translate: '🌐 Translating to ' + lang + '…', summarize: '📝 Summarizing…', rewrite: '✏️ Rewriting…'};
  btn.textContent = labels[action] || '⏳ Processing…';
  btn.disabled = true;
  showProgress(labels[action] || 'Processing…');
  document.getElementById('chatSection').classList.add('visible');
  document.getElementById('chatMessages').innerHTML = '';
  addChat('system', '🤖 Agents A1 processing…');
  pywebview.api.llm_process(currentFullText, action, lang).then(() => {
    btn.textContent = action.charAt(0).toUpperCase() + action.slice(1);
    btn.disabled = false;
  });
}

function llmResponse(text) {
  hideProgress();
  document.getElementById('chatMessages').innerHTML = '';
  addChat('assistant', text);
  // Replace main result with processed text
  currentFullText = text;
  currentPages = splitIntoPages(text);
  currentPage = 0;
  showPage(0);
  document.getElementById('actionBtns').style.display = '';
  if (currentPages.length > 1) {
    document.getElementById('pageNav').style.display = '';
    document.getElementById('pageTotal').textContent = currentPages.length;
  } else { document.getElementById('pageNav').style.display = 'none'; }
  document.getElementById('resultTitle').textContent = '🤖 Processed';
  document.getElementById('saveToast').classList.remove('visible');
  // Re-enable action buttons
  document.querySelectorAll('.action-btns .btn').forEach(b => b.disabled = false);
}

function splitIntoPages(text) {
  // Try to split by page markers, fallback to chunks
  const parts = text.split(/=== PAGE \d+\/\d+ ===/);
  if (parts.length > 1) return parts.filter(p => p.trim()).map(p => p.trim());
  // If text is long, split into ~3000 char chunks
  if (text.length > 4000) {
    const chunks = [];
    for (let i = 0; i < text.length; i += 3000) {
      chunks.push(text.slice(i, i + 3000));
    }
    return chunks;
  }
  return [text];
}

function llmError(msg) {
  hideProgress();
  document.getElementById('chatMessages').innerHTML = '';
  addChat('assistant', '❌ ' + msg);
}

function chatSend() {
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  document.getElementById('chatSection').classList.add('visible');
  addChat('user', msg);
  addChat('assistant', '<span class="loading-dots">Thinking</span>');
  const pageText = currentPages[currentPage] || '';
  const context = currentFullText ? 'Context from document:\n' + currentFullText.slice(0, 5000) + '\n\n' : '';
  pywebview.api.llm_chat((context || '') + msg, JSON.stringify(chatHistory));
  chatHistory.push({role: 'user', content: msg});
}

function addChat(role, text) {
  const d = document.createElement('div');
  d.className = 'chat-msg ' + role; d.innerHTML = text;
  const m = document.getElementById('chatMessages');
  m.appendChild(d); m.scrollTop = m.scrollHeight;
}

// ═══ Cancel ──
function cancelCurrent() {
  if (currentType === 'image') pywebview.api.cancel_ocr();
  hideProgress(); isProcessing = false;
  showError('Cancelled');
}

// ═══ Progress ──
function showProgress(label) {
  document.getElementById('progressOverlay').classList.add('visible');
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('progressDetail').textContent = '';
  document.getElementById('globalCancelBtn').style.display = '';
}
function hideProgress() {
  document.getElementById('progressOverlay').classList.remove('visible');
  document.getElementById('globalCancelBtn').style.display = 'none';
}

// ═══ Utils ──
function showError(m) { hideProgress(); isProcessing = false;
  document.getElementById('errorBanner').textContent = '❌ ' + m;
  document.getElementById('errorBanner').classList.add('visible'); }
function hideError() { document.getElementById('errorBanner').classList.remove('visible'); }
function clearResult() { document.getElementById('resultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>Select a file</div></div>';
  document.getElementById('resultTitle').textContent = 'Ready';
  document.getElementById('actionBtns').style.display = 'none'; }

function copyAll() {
  const text = currentFullText || (currentPages[currentPage] || '');
  if (!text) return;
  if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(showCopy); }
  else { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showCopy(); }
}
function openFolder() { if (currentSavePath) pywebview.api.open_folder(currentSavePath); }
function showCopy() { const el = document.getElementById('copyToast'); el.classList.add('visible'); clearTimeout(window._ct); window._ct = setTimeout(() => el.classList.remove('visible'), 2000); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ═══ Download UI ──
function addDownloadUI() {
  const bar = document.getElementById('statusBar');
  if (!bar || document.getElementById('downloadBtn')) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-sm';
  btn.id = 'downloadBtn';
  btn.textContent = '⬇️ Download Agents A1 (34GB)';
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = '⏳ Downloading…';
    pywebview.api.download_llm();
  };
  bar.appendChild(btn);
}

function downloadProgress(data) {
  const btn = document.getElementById('downloadBtn');
  if (!btn) return;
  if (data.pct === -1) {
    btn.textContent = '❌ ' + data.msg;
    btn.disabled = false;
  } else if (data.pct === 100) {
    btn.textContent = '✅ Downloaded!';
    setTimeout(() => btn.remove(), 3000);
  } else {
    btn.textContent = '⏳ ' + data.pct + '% · ' + data.msg;
  }
}

function llmDownloaded() {
  const btn = document.getElementById('downloadBtn');
  if (btn) { btn.textContent = '✅ Restart app to load Agents A1'; btn.disabled = true; }
}
