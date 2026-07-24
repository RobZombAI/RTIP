// ═══════════════════════════════════════════
//  RTIP — Session Manager + AI Post-Processing + Video Temporal Grounding
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
let activeTab = 'doc';

// Video globals
let videoPath = null;
let videoProcessing = false;

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
  el.textContent = '🧠 ' + systemInfo.ram_gb + 'GB · ' + systemInfo.msg_ocr + ' · ' + systemInfo.msg_llm + ' · ' + systemInfo.msg_timelens;
  bar.appendChild(el);
  if (systemInfo.llm && !systemInfo.llm_file) addDownloadUI();

  // Color RAM chips based on actual hardware
  updateRamChips();
}

function updateRamChips() {
  if (!systemInfo) return;
  // Map: chip text pattern → min_ram value
  const chips = {
    '≥4GB RAM': { ok: 4, pass: systemInfo.ocr },
    '≥48GB RAM': { ok: 48, pass: systemInfo.llm && systemInfo.llm_file },
    '≥20GB RAM': { ok: 20, pass: systemInfo.timelens },
  };
  document.querySelectorAll('.chip .ram').forEach(el => {
    const text = el.textContent.trim();
    const info = chips[text];
    if (info) {
      el.className = 'ram ' + (info.pass ? 'ok' : 'nok');
    } else if (text === '0 GPU') {
      el.className = 'ram ok';
    }
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ Tab switching ═══
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
  // Hide global error banner when switching
  hideError();
}

// ═══ Status ──
async function pollStatus() {
  try {
    const s = await pywebview.api.get_status();
    setDot('ocr', s.ocr ? 'on' : (s.ocr === 'loading' ? 'loading' : 'off'));
    setDot('llm', s.llm ? 'on' : 'off');
    setDot('timelens', s.timelens ? 'on' : (s.timelens === 'loading' ? 'loading' : 'off'));
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
    chatHistory = data.chat || [];
    // Switch to doc tab
    switchTab('doc');
    showPage(0);
    document.getElementById('docResultArea').classList.add('visible');
    document.getElementById('docResultTitle').textContent = data.type === 'pdf' ? '📄 ' + data.file : '🖼️ ' + data.file;
    document.getElementById('docSaveToast').classList.remove('visible');
    document.getElementById('docActionBtns').style.display = '';
    // Restore chat history
    const m = document.getElementById('chatMessages');
    m.innerHTML = '<div class="chat-msg system">💬 Chat — fai domande sul testo estratto</div>';
    chatHistory.forEach(c => {
      if (c.role === 'user') addChat('user', c.content);
      if (c.role === 'assistant') addChat('assistant', c.content);
    });
    if (currentPages.length > 1) {
      document.getElementById('docPageNav').style.display = '';
      document.getElementById('docPageTotal').textContent = currentPages.length;
    } else {
      document.getElementById('docPageNav').style.display = 'none';
    }
    renderSessions();
  } catch(e) { showError(e); }
}

async function deleteSession(sid) {
  try {
    sessions = JSON.parse(await pywebview.api.delete_session(sid));
    if (sid === currentSid) { currentSid = null; clearDocResult(); }
    renderSessions();
  } catch(e) {}
}

// ═══ Document: File selection ──
document.getElementById('docDropZone').addEventListener('click', async () => {
  if (activeTab !== 'doc') return;
  try {
    const p = await pywebview.api.pick_file();
    if (p) selectDocFile(p);
  } catch(_) {}
});

async function selectDocFile(path) {
  selectedPath = path; currentPage = 0; currentPages = [];
  currentType = null; currentFullText = ''; currentSid = null; chatHistory = [];
  document.getElementById('docPageNav').style.display = 'none';
  document.getElementById('docActionBtns').style.display = 'none';
  document.getElementById('docSaveToast').classList.remove('visible');
  document.getElementById('chatMessages').innerHTML = '<div class="chat-msg system">💬 Chat — fai domande sul testo estratto</div>';
  hideError();

  const info = await pywebview.api.file_info(path);
  currentType = info.type;

  document.getElementById('docDropContent').style.display = 'none';
  document.getElementById('docFilePreview').style.display = 'flex';
  document.getElementById('docFileName').textContent = info.name;
  document.getElementById('docFileSize').textContent = info.size_str;

  const badge = document.getElementById('docFileBadge');
  badge.textContent = info.type.toUpperCase();
  badge.style.background = info.type === 'pdf' ? 'var(--error)' : 'var(--accent2)';
  badge.style.color = '#fff';

  const img = document.getElementById('docPreviewImg');
  if (info.type === 'image') {
    const b64 = await pywebview.api.read_file_b64(path);
    img.src = 'data:image/png;base64,' + b64; img.style.display = '';
  } else { img.style.display = 'none'; }
  document.getElementById('docDropZone').classList.add('has-file');

  const btn = document.getElementById('docActionBtn');
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
  document.getElementById('docResultArea').classList.add('visible');
  document.getElementById('docResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>Extracting…</div></div>';
  try { await pywebview.api.extract_pdf(selectedPath); }
  catch (e) { showError(e); isProcessing = false; }
}

// ═══ Image OCR ──
async function runOcr() {
  if (!selectedPath || isProcessing) return;
  isProcessing = true;
  showProgress('OCR in progress…');
  document.getElementById('docResultArea').classList.add('visible');
  document.getElementById('docResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>OCR…</div></div>';
  try { await pywebview.api.run_ocr(selectedPath, ''); }
  catch (e) { showError(e); isProcessing = false; }
}

function showLoading() { showProgress('Processing…'); }

// ═══ Results ──
function streamPage(data) {
  currentPages[data.page - 1] = data.text;
  document.getElementById('progressLabel').textContent = 'Page ' + data.page + '/' + data.total;
  document.getElementById('progressDetail').textContent = data.text.length + ' chars';
  const body = document.getElementById('docResultBody');
  if (body.children.length === 1 && body.children[0].className === 'loading-indicator') body.innerHTML = '';
  const d = document.createElement('div');
  d.style.cssText = 'padding:3px 6px;margin:1px 0;background:var(--surface2);border-radius:3px;font-size:11px;color:var(--success);';
  d.textContent = '📄 Page ' + data.page + '/' + data.total + ' ✓';
  body.appendChild(d); body.scrollTop = body.scrollHeight;
}

function showResult(data) {
  hideProgress(); isProcessing = false;
  currentFullText = data.raw; currentSavePath = data.save_path;
  currentSid = data.sid; currentPage = 0; chatHistory = [];
  currentPages = data.pages.map(p => p.text);
  showPage(0);
  document.getElementById('docSavePath').textContent = data.save_path;
  document.getElementById('docSaveToast').classList.add('visible');
  document.getElementById('docActionBtns').style.display = '';
  document.getElementById('docResultTitle').textContent = data.type === 'pdf' ? '📄 PDF OCR' : '🖼️ Image OCR';
  if (currentPages.length > 1) {
    document.getElementById('docPageNav').style.display = '';
    document.getElementById('docPageTotal').textContent = currentPages.length;
  } else { document.getElementById('docPageNav').style.display = 'none'; }
  document.getElementById('docActionBtn').disabled = true;
}

function showPage(idx) {
  currentPage = Math.max(0, Math.min(idx, currentPages.length - 1));
  document.getElementById('docResultBody').innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = currentPages[currentPage] || '[empty]';
  document.getElementById('docResultBody').appendChild(pre);
  document.getElementById('docPageNum').textContent = currentPage + 1;
  if (document.getElementById('docPrevPg')) document.getElementById('docPrevPg').disabled = currentPage === 0;
  if (document.getElementById('docNextPg')) document.getElementById('docNextPg').disabled = currentPage === currentPages.length - 1;
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
  addChat('system', '🤖 Agents A1 processing…');
  pywebview.api.llm_process(currentFullText, action, lang).then(() => {
    btn.textContent = action.charAt(0).toUpperCase() + action.slice(1);
    btn.disabled = false;
  });
}

function llmResponse(text) {
  hideProgress();
  document.getElementById('chatMessages').innerHTML = '';
  chatHistory.push({role: 'assistant', content: text});
  if (currentSid) pywebview.api.save_chat(currentSid, JSON.stringify(chatHistory));
  addChat('assistant', text);
  // Replace main result with processed text
  currentFullText = text;
  currentPages = splitIntoPages(text);
  currentPage = 0;
  showPage(0);
  document.getElementById('docActionBtns').style.display = '';
  if (currentPages.length > 1) {
    document.getElementById('docPageNav').style.display = '';
    document.getElementById('docPageTotal').textContent = currentPages.length;
  } else { document.getElementById('docPageNav').style.display = 'none'; }
  document.getElementById('docResultTitle').textContent = '🤖 Processed';
  document.getElementById('docSaveToast').classList.remove('visible');
  // Re-enable action buttons
  document.querySelectorAll('.action-btns .btn').forEach(b => b.disabled = false);
}

function splitIntoPages(text) {
  // Try to split by page markers, fallback to chunks
  const parts = text.split(/=== PAGE \d+\/\d+ ===/);
  if (parts.length > 1) return parts.filter(p => p.trim()).map(p => p.trim());
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
  addChat('user', msg);
  addChat('assistant', '<span class="loading-dots">Thinking</span>');
  // Always include full document context + current page in every message
  const context = currentFullText
    ? 'Document text (' + currentFullText.length + ' chars):\n' + currentFullText + '\n\n---\n'
    : '';
  const pageContext = currentPages[currentPage]
    ? 'Currently viewing page ' + (currentPage + 1) + ':\n' + currentPages[currentPage]
    : '';
  const fullMsg = (context || '') + (pageContext ? pageContext + '\n\n---\n' : '') + 'User question: ' + msg;
  pywebview.api.llm_chat(fullMsg, JSON.stringify(chatHistory));
  chatHistory.push({role: 'user', content: msg});
  // Auto-save chat to session
  if (currentSid) pywebview.api.save_chat(currentSid, JSON.stringify(chatHistory));
}

function addChat(role, text) {
  const d = document.createElement('div');
  d.className = 'chat-msg ' + role; d.innerHTML = text;
  const m = document.getElementById('chatMessages');
  m.appendChild(d); m.scrollTop = m.scrollHeight;
}

// ═══════════════════════════════════════════
//  🎬 Video — TimeLens2-8B Temporal Grounding
// ═══════════════════════════════════════════

// Video file selection
document.getElementById('videoDropZone').addEventListener('click', async () => {
  if (activeTab !== 'video') return;
  try {
    const p = await pywebview.api.pick_video();
    if (p) selectVideoFile(p);
  } catch(_) {}
});

async function selectVideoFile(path) {
  videoPath = path;
  hideError();

  const info = await pywebview.api.file_info(path);

  document.getElementById('videoDropContent').style.display = 'none';
  document.getElementById('videoFilePreview').style.display = 'flex';
  document.getElementById('videoFileName').textContent = info.name;
  document.getElementById('videoFileSize').textContent = info.size_str;
  document.getElementById('videoDropZone').classList.add('has-file', 'video-active');

  // Enable query input and analyze button
  document.getElementById('videoQuery').disabled = false;
  document.getElementById('videoQuery').focus();
  document.getElementById('videoAnalyzeBtn').disabled = false;

  // Show result area
  document.getElementById('videoResultArea').classList.add('visible');
  document.getElementById('videoResultBody').innerHTML = '<div class="loading-indicator"><div style="font-size:28px;margin-bottom:8px">🎬</div><div>Enter a query and click Analyze</div></div>';
}

// Video analysis
async function runTimelens() {
  const query = document.getElementById('videoQuery').value.trim();
  if (!videoPath || !query || videoProcessing) return;

  videoProcessing = true;
  document.getElementById('videoAnalyzeBtn').disabled = true;
  document.getElementById('videoAnalyzeBtn').textContent = '⏳ Loading TimeLens2…';

  // Ensure model is loaded
  try {
    await pywebview.api.start_timelens();
  } catch(e) {}

  // Wait a moment for status update, then show progress
  await sleep(500);
  showVideoProgress();

  document.getElementById('videoResultArea').classList.add('visible');
  document.getElementById('videoResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>🧠 TimeLens2 analyzing video…</div></div>';

  try {
    await pywebview.api.timelens_process(videoPath, query);
  } catch(e) {
    showError(e);
    videoProcessing = false;
    document.getElementById('videoAnalyzeBtn').disabled = false;
    document.getElementById('videoAnalyzeBtn').textContent = '🎯 Analyze';
  }
}

function showVideoProgress() {
  document.getElementById('videoResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner" style="border-top-color:var(--video)"></div><div>🎬 TimeLens2 analyzing…</div><div style="font-size:10px;color:var(--text2);margin-top:4px">Processing video frames…</div></div>';
}

// Video results handler
function timelensResult(resultStr) {
  videoProcessing = false;
  document.getElementById('videoAnalyzeBtn').disabled = false;
  document.getElementById('videoAnalyzeBtn').textContent = '🎯 Analyze';
  hideProgress();

  const body = document.getElementById('videoResultBody');
  body.innerHTML = '';

  // Try to parse result as JSON time intervals
  let intervals = [];
  let rawText = resultStr;

  try {
    const parsed = JSON.parse(resultStr);
    if (Array.isArray(parsed)) {
      intervals = parsed;
    } else if (parsed.error) {
      body.innerHTML = '<div class="timeline-empty">❌ ' + escHtml(parsed.error) + '</div>';
      return;
    }
  } catch(e) {
    // Not JSON — try to extract intervals from text
    body.innerHTML = '';
    const pre = document.createElement('pre');
    pre.textContent = resultStr || '[no output]';
    body.appendChild(pre);
    return;
  }

  const query = document.getElementById('videoQuery').value.trim();

  if (intervals.length === 0) {
    body.innerHTML = '<div class="timeline-empty">🔍 No matching time spans found for this query</div>';
    return;
  }

  // Find max end time for timeline scale
  const maxTime = Math.max(...intervals.map(i => i[1]), 10);

  // Build timeline HTML
  let html = '<div class="timeline-wrap">';
  html += '<div class="timeline-query">🔍 <strong>' + escHtml(query) + '</strong></div>';
  html += '<div class="timeline-bar">';

  for (const [start, end] of intervals) {
    const leftPct = (start / maxTime) * 100;
    const widthPct = ((end - start) / maxTime) * 100;
    html += `<div class="timeline-segment" style="left:${leftPct}%;width:${Math.max(widthPct, 2)}%;" title="${start}s - ${end}s">${widthPct > 8 ? start + 's' : ''}</div>`;
  }

  html += '</div>';
  html += '<div class="timeline-labels"><span>0s</span><span>' + Math.round(maxTime) + 's</span></div>';
  html += '</div>';

  // List intervals
  html += '<div style="margin-top:8px">';
  html += '<div style="font-size:10px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">⏱ Time Spans</div>';
  intervals.forEach(([start, end], i) => {
    const dur = (end - start).toFixed(1);
    html += `<div class="timeline-interval">${i + 1}. <strong>${start.toFixed(1)}s → ${end.toFixed(1)}s</strong> (${dur}s duration)</div>`;
  });
  html += '</div>';

  // Raw JSON toggle
  html += '<details style="margin-top:12px">';
  html += '<summary style="font-size:10px;color:var(--text2);cursor:pointer">📋 Raw output</summary>';
  html += '<pre style="font-size:10px;margin-top:4px;color:var(--text2)">' + escHtml(resultStr) + '</pre>';
  html += '</details>';

  body.innerHTML = html;
}

// Video cancel
function cancelVideo() {
  videoProcessing = false;
  document.getElementById('videoAnalyzeBtn').disabled = false;
  document.getElementById('videoAnalyzeBtn').textContent = '🎯 Analyze';
  pywebview.api.cancel_timelens();
}

// ═══ Cancel ──
function cancelCurrent() {
  if (activeTab === 'video') {
    cancelVideo();
  } else {
    if (currentType === 'image') pywebview.api.cancel_ocr();
  }
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
function clearDocResult() { document.getElementById('docResultBody').innerHTML = '<div class="loading-indicator"><div class="spinner"></div><div>Select a file</div></div>';
  document.getElementById('docResultTitle').textContent = 'Ready';
  document.getElementById('docActionBtns').style.display = 'none'; }

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
