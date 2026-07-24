// ═══════════════════════════════════════════
//  RTIP v2 — Frontend Logic
// ═══════════════════════════════════════════

const API = 'http://127.0.0.1:8080';
let systemInfo = null;
let activeTab = 'doc';
let sessions = [];
let docPath = null;
let docType = null;
let docFullText = '';
let currentSid = null;
let chatHistory = [];

// Video
let videoPath = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  init();
  pollStatus();
  loadSessions();
  setupDropZones();
});

async function init() {
  try {
    const r = await fetch(`${API}/api/system`);
    systemInfo = await r.json();
    document.getElementById('sysInfo').textContent = `🧠 ${systemInfo.ram_gb}GB · ${systemInfo.msg_ocr} · ${systemInfo.msg_llm} · ${systemInfo.msg_timelens}`;
  } catch(e) {
    document.getElementById('sysInfo').textContent = '⚠️ Server offline';
  }
}

// ── Status polling ──
async function pollStatus() {
  try {
    const r = await fetch(`${API}/api/status`);
    const s = await r.json();
    setDot('statOcr', s.ocr ? 'on' : 'off');
    setDot('statLlm', s.llm ? 'on' : 'off');

    // TimeLens status: handle loading/ready/error states
    const tlStatus = s.timelens_status || (s.timelens ? 'ready' : 'off');
    const tlState = s.timelens ? (tlStatus === 'ready' ? 'on' : tlStatus === 'loading' ? 'loading' : 'off') : 'off';
    setDot('statTs', tlState);

    // If TimeLens errored, show message
    if (s.timelens_message && s.timelens_status === 'error') {
      document.querySelector('#statTs .dot').title = '❌ ' + s.timelens_message;
    }

    document.getElementById('statRam').textContent = `🧠 ${systemInfo?.ram_gb || '?'}GB RAM`;
  } catch(_) {}
  setTimeout(pollStatus, 2000);
}

function setDot(id, state) {
  const el = document.querySelector(`#${id} .dot`);
  if (el) el.className = 'dot ' + state;
}

// ── Tab switching ──
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
}

// ── File dialog (doc) ──
function setupDropZones() {
  const docInput = document.getElementById('docFileInput');
  document.getElementById('docDrop').addEventListener('click', () => docInput.click());
  docInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch(`${API}/api/upload`, {method: 'POST', body: form});
      const data = await r.json();
      if (data.error) { showToast('❌ ' + data.error); return; }
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      selectDocFile(data.path, file.name, data.size, isPdf ? 'pdf' : 'image');
    } catch(e) { showToast('❌ ' + e.message); }
    docInput.value = '';
  });

  const videoInput = document.getElementById('videoFileInput');
  document.getElementById('videoDrop').addEventListener('click', () => videoInput.click());
  videoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show video preview immediately (before upload)
    const videoUrl = URL.createObjectURL(file);
    const player = document.getElementById('videoPlayer');
    player.src = videoUrl;
    player.load();

    document.getElementById('videoDropContent').style.display = 'none';
    document.getElementById('videoPreview').style.display = 'flex';
    document.getElementById('videoFileName').textContent = file.name;
    document.getElementById('videoSize').textContent = (file.size / 1048576).toFixed(1) + ' MB';
    document.getElementById('videoDrop').classList.add('has-file', 'video-active');
    document.getElementById('videoQuery').disabled = false;
    document.getElementById('videoQuery').focus();
    document.getElementById('videoBtn').disabled = false;
    document.getElementById('videoResult').style.display = 'flex';
    document.getElementById('videoResultBody').innerHTML = '<div class="empty-state">Enter a query and click Analyze</div>';

    // Upload to server for processing (background)
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch(`${API}/api/upload`, {method: 'POST', body: form});
      const data = await r.json();
      if (data.error) { showToast('❌ ' + data.error); return; }
      videoPath = data.path;  // server path for processing
    } catch(e) { showToast('❌ Upload: ' + e.message); }
    videoInput.value = '';
  });
}

async function selectDocFile(path, name, size, type) {
  docPath = path; docType = type;
  document.getElementById('docDropContent').style.display = 'none';
  document.getElementById('docPreview').style.display = 'flex';
  document.getElementById('docFileName').textContent = name;
  const badge = document.getElementById('docBadge');
  badge.textContent = type.toUpperCase();
  badge.className = 'badge badge-' + type;
  document.getElementById('docSize').textContent = size;
  document.getElementById('docDrop').classList.add('has-file');

  const btn = document.getElementById('docActionBtn');
  btn.textContent = type === 'pdf' ? '📝 Extract text' : '🔍 OCR';
  btn.disabled = false;
  btn.onclick = docProcess;
}

async function selectVideoFile(path, name, size) {
  videoPath = path;
  document.getElementById('videoDropContent').style.display = 'none';
  document.getElementById('videoPreview').style.display = 'flex';
  document.getElementById('videoFileName').textContent = name;
  document.getElementById('videoSize').textContent = size;
  document.getElementById('videoDrop').classList.add('has-file', 'video-active');
  document.getElementById('videoQuery').disabled = false;
  document.getElementById('videoQuery').focus();
  document.getElementById('videoBtn').disabled = false;
  document.getElementById('videoResult').style.display = 'flex';
  document.getElementById('videoResultBody').innerHTML = '<div class="empty-state">Enter a query and click Analyze</div>';
}

// ── Document OCR/PDF ──
async function docProcess() {
  if (!docPath) return;
  showOverlay(docType === 'pdf' ? 'Extracting PDF…' : 'OCR in progress…');

  try {
    let r;
    if (docType === 'pdf') {
      r = await fetch(`${API}/api/extract-pdf`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path: docPath}),
      });
    } else {
      r = await fetch(`${API}/api/ocr`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({image_path: docPath, prompt: ''}),
      });
    }
    const data = await r.json();
    hideOverlay();

    docFullText = data.text || data.raw || '';
    docFullText = data.error || docFullText;

    if (data.error) {
      showToast('❌ ' + data.error);
      return;
    }

    // Create session
    const sid = 'sess_' + Date.now();
    currentSid = sid;
    const sessData = {
      id: sid, file: docPath.split('/').pop(), type: docType,
      chars: docFullText.length, pages: 1, date: new Date().toISOString(),
    };
    await fetch(`${API}/api/sessions`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(sessData),
    });
    loadSessions();

    document.getElementById('docResult').style.display = 'flex';
    document.getElementById('docResultBody').innerHTML = `<pre>${escHtml(docFullText)}</pre>`;
    document.getElementById('docResultTitle').textContent = docType === 'pdf' ? '📄 ' + docPath.split('/').pop() : '🖼️ ' + docPath.split('/').pop();
    document.getElementById('docActions').style.display = '';
    document.getElementById('docActionBtn').disabled = true;
  } catch(e) {
    hideOverlay();
    showToast('❌ ' + e.message);
  }
}

// ── LLM Post-Processing ──
async function llmAction(action) {
  if (!docFullText) return;
  showOverlay('Processing…');

  try {
    const lang = document.getElementById('langSelect')?.value || 'Italian';
    const prompts = {
      translate: `Translate the following text to ${lang}. Preserve formatting:\n\n`,
      summarize: 'Summarize in 3-5 key points:\n\n',
      rewrite: 'Rewrite in clear professional style:\n\n',
    };
    const prefix = prompts[action] || action + '\n\n';

    const r = await fetch(`${API}/api/llm/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        messages: [
          {role: 'system', content: 'You are RTIP Assistant. Output only the result.'},
          {role: 'user', content: prefix + docFullText.slice(0, 40000)},
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });
    const data = await r.json();
    hideOverlay();
    const text = data.choices?.[0]?.message?.content || 'No response';
    docFullText = text;
    document.getElementById('docResultBody').innerHTML = `<pre>${escHtml(text)}</pre>`;
    document.getElementById('docResultTitle').textContent = '🤖 Processed';
    showToast('✅ Done');
  } catch(e) {
    hideOverlay();
    showToast('❌ ' + e.message);
  }
}

// ── Chat ──
async function chatSend() {
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  addChat('user', msg);

  try {
    const context = docFullText ? `Document (${docFullText.length} chars):\n${docFullText}\n\n---\nUser: ${msg}` : msg;
    const r = await fetch(`${API}/api/llm/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        messages: [
          {role: 'system', content: 'You are RTIP Assistant.'},
          {role: 'user', content: context},
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || 'No response';
    addChat('assistant', text);
  } catch(e) {
    addChat('assistant', '❌ ' + e.message);
  }
}

function addChat(role, text) {
  const m = document.getElementById('chatMessages');
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  if (role === 'system') d.textContent = text;
  else d.textContent = text;
  m.appendChild(d);
  m.scrollTop = m.scrollHeight;
}

// ── Video ──
async function runTimelens() {
  const query = document.getElementById('videoQuery').value.trim();
  if (!videoPath || !query) return;

  document.getElementById('videoBtn').disabled = true;
  document.getElementById('videoBtn').textContent = '⏳ Loading TimeLens…';
  document.getElementById('videoOverlay').style.display = 'flex';

  try {
    const r = await fetch(`${API}/api/timelens`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({video_path: videoPath, query}),
    });
    const data = await r.json();
    document.getElementById('videoOverlay').style.display = 'none';
    document.getElementById('videoBtn').disabled = false;
    document.getElementById('videoBtn').textContent = '🎯 Analyze';

    const body = document.getElementById('videoResultBody');
    body.innerHTML = '';

    if (data.error) {
      body.innerHTML = `<div class="timeline-empty">❌ ${escHtml(data.error)}</div>`;
      return;
    }

    const intervals = data.intervals || [];

    if (intervals.length === 0) {
      body.innerHTML = '<div class="timeline-empty">🔍 No matching time spans found</div>';
      return;
    }

    const maxTime = Math.max(...intervals.map(i => i[1]), 10);
    const totalDur = intervals.reduce((s, [a, b]) => s + (b - a), 0);
    const colors = ['#a371f7','#f472b6','#fb923c','#34d399','#60a5fa','#e879f9','#fbbf24','#67e8f9'];

    // Header
    let html = `<div class="timeline-wrap">
      <div class="timeline-query">🔍 <strong>${escHtml(query)}</strong> — found <strong>${intervals.length}</strong> segment${intervals.length > 1 ? 's' : ''} (${totalDur.toFixed(1)}s total)</div>
      <div class="timeline-controls">
        <button class="btn btn-ghost btn-sm" id="playAllBtn" onclick="playAllSegments()">▶ Play All</button>
        <button class="btn btn-ghost btn-sm" id="playPrevBtn" onclick="playPrevSegment()" disabled>◀</button>
        <span id="segmentCounter" style="font-size:10px;color:var(--text2);margin:0 4px">—</span>
        <button class="btn btn-ghost btn-sm" id="playNextBtn" onclick="playNextSegment()" disabled>▶</button>
      </div>
      <div class="timeline-bar-wrap">
        <div class="timeline-bar" id="timelineBar">
          <div class="timeline-playhead" id="playhead"></div>`;

    for (let i = 0; i < intervals.length; i++) {
      const [start, end] = intervals[i];
      const left = (start / maxTime) * 100;
      const w = Math.max(((end - start) / maxTime) * 100, 1.5);
      const color = colors[i % colors.length];
      html += `<div class="timeline-segment" data-idx="${i}" data-start="${start}" data-end="${end}"
        style="left:${left}%;width:${w}%;background:linear-gradient(135deg,${color},${color}cc);cursor:pointer"
        title="Segment ${i+1}: ${start.toFixed(1)}s → ${end.toFixed(1)}s"></div>`;
    }

    html += `</div>
      <div class="timeline-labels"><span>0s</span><span id="currentTimeLabel" style="font-weight:600;color:var(--video)">0.0s</span><span>${maxTime.toFixed(0)}s</span></div>
    </div>`;

    // Segment list
    html += `<div class="segment-list">`;
    for (let i = 0; i < intervals.length; i++) {
      const [start, end] = intervals[i];
      const dur = (end - start).toFixed(1);
      const color = colors[i % colors.length];
      html += `<div class="segment-item" data-idx="${i}" data-start="${start}" data-end="${end}"
        onclick="playSegment(${start},${end},${i})"
        onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''"
        style="border-left:3px solid ${color}">
        <span class="segment-num" style="background:${color}22;color:${color}">${i+1}</span>
        <span class="segment-time"><strong>${start.toFixed(1)}s</strong> → <strong>${end.toFixed(1)}s</strong></span>
        <span class="segment-dur">${dur}s</span>
        <button class="btn btn-icon btn-sm" onclick="event.stopPropagation();playSegment(${start},${end},${i})" title="Play">▶</button>
      </div>`;
    }
    html += `</div>`;

    // Current segment info
    html += `<div class="segment-player-info" id="segmentInfo" style="display:none">
      <div class="segment-progress"><div class="segment-progress-bar" id="segProgress"></div></div>
    </div>`;

    html += `<details style="margin-top:6px"><summary style="font-size:10px;color:var(--text3);cursor:pointer">📋 Raw output</summary>
      <pre style="font-size:10px;margin-top:4px;color:var(--text2)">${escHtml(data.raw || '')}</pre></details>`;

    body.innerHTML = html;

    // Click handlers for timeline segments
    document.querySelectorAll('.timeline-segment').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.idx);
        playSegment(parseFloat(el.dataset.start), parseFloat(el.dataset.end), i);
      });
    });
  } catch(e) {
    document.getElementById('videoOverlay').style.display = 'none';
    document.getElementById('videoBtn').disabled = false;
    document.getElementById('videoBtn').textContent = '🎯 Analyze';
    showToast('❌ ' + e.message);
  }
}

// ── Sessions ──
async function loadSessions() {
  try {
    const r = await fetch(`${API}/api/sessions`);
    sessions = await r.json();
    renderSessions();
  } catch(_) {}
}

function renderSessions() {
  const list = document.getElementById('sessionList');
  if (!sessions.length) {
    list.innerHTML = '<div class="session-empty">No sessions yet</div>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item${s.id === currentSid ? ' active' : ''}" onclick="openSession('${s.id}')">
      <div class="session-name">${escHtml(s.file)}</div>
      <div class="session-meta">
        <span class="badge badge-${s.type}">${s.type}</span>
        <span>${s.chars}c</span>
        <span>${s.pages}p</span>
        <span class="session-del" onclick="event.stopPropagation();delSession('${s.id}')">✕</span>
      </div>
    </div>`).join('');
}

async function openSession(sid) {
  try {
    const r = await fetch(`${API}/api/sessions/${sid}`);
    const data = await r.json();
    currentSid = sid;
    docFullText = data.raw || '';
    chatHistory = data.chat || [];
    switchTab('doc');
    document.getElementById('docResult').style.display = 'flex';
    document.getElementById('docResultBody').innerHTML = `<pre>${escHtml(docFullText)}</pre>`;
    document.getElementById('docResultTitle').textContent = data.type === 'pdf' ? '📄 ' + data.file : '🖼️ ' + data.file;
    document.getElementById('docActions').style.display = '';
    document.getElementById('docActionBtn').disabled = true;
    // Restore chat
    const m = document.getElementById('chatMessages');
    m.innerHTML = '<div class="msg system">💬 Chat — fai domande sul testo</div>';
    chatHistory.forEach(c => {
      if (c.role === 'user' || c.role === 'assistant') addChat(c.role, c.content);
    });
    renderSessions();
  } catch(e) { showToast('❌ ' + e.message); }
}

async function delSession(sid) {
  try {
    await fetch(`${API}/api/sessions/${sid}`, {method: 'DELETE'});
    if (sid === currentSid) {
      currentSid = null;
      document.getElementById('docResult').style.display = 'none';
      document.getElementById('docActions').style.display = 'none';
    }
    loadSessions();
  } catch(_) {}
}

// ── Utils ──

// Segment playback state
let _segments = [];
let _currentSegIdx = -1;
let _playingAll = false;
let _segTimeUpdate = null;

// Play video segment
function playSegment(start, end, idx) {
  const player = document.getElementById('videoPlayer');
  if (!player || !player.src) return;

  // Store segments reference
  const items = document.querySelectorAll('.segment-item');
  _currentSegIdx = (idx !== undefined && idx >= 0) ? idx : 0;
  _playingAll = false;
  document.getElementById('playAllBtn').textContent = '▶ Play All';

  // Update UI
  player.currentTime = start;
  player.play();

  // Highlight active segment
  document.querySelectorAll('.timeline-segment').forEach(el => {
    el.style.opacity = '0.35';
    el.style.boxShadow = 'none';
  });
  document.querySelectorAll(`.timeline-segment[data-idx="${_currentSegIdx}"]`).forEach(el => {
    el.style.opacity = '1';
    el.style.boxShadow = '0 0 12px rgba(163, 113, 247, 0.6)';
  });

  document.querySelectorAll('.segment-item').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`.segment-item[data-idx="${_currentSegIdx}"]`);
  if (active) {
    active.classList.add('active');
    active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  updateSegmentCounter();
  enableNavButtons();

  // Show progress
  const segInfo = document.getElementById('segmentInfo');
  if (segInfo) segInfo.style.display = 'flex';

  // Remove old listener
  if (_segTimeUpdate) {
    player.removeEventListener('timeupdate', _segTimeUpdate);
  }

  const thisStart = start, thisEnd = end, thisIdx = idx;
  _segTimeUpdate = () => {
    const t = player.currentTime;
    // Update playhead position
    const maxTime = parseFloat(document.querySelector('.timeline-labels span:last-child')?.textContent || '10');
    const pct = (t / maxTime) * 100;
    const ph = document.getElementById('playhead');
    if (ph) ph.style.left = Math.min(pct, 100) + '%';
    // Update time label
    const tl = document.getElementById('currentTimeLabel');
    if (tl) tl.textContent = t.toFixed(1) + 's';
    // Update progress bar
    const segDur = thisEnd - thisStart;
    const segPct = segDur > 0 ? ((t - thisStart) / segDur) * 100 : 0;
    const pb = document.getElementById('segProgress');
    if (pb) pb.style.width = Math.min(Math.max(segPct, 0), 100) + '%';

    // Auto-stop at end
    if (t >= thisEnd) {
      player.pause();
      if (_playingAll && _currentSegIdx < _segments.length - 1) {
        playNextSegment();
      }
    }
  };
  player.addEventListener('timeupdate', _segTimeUpdate);
}

function playAllSegments() {
  const items = document.querySelectorAll('.segment-item');
  if (items.length === 0) return;

  // Store intervals
  _segments = [];
  items.forEach(el => {
    _segments.push({
      start: parseFloat(el.dataset.start),
      end: parseFloat(el.dataset.end),
      idx: parseInt(el.dataset.idx),
    });
  });

  _playingAll = !_playingAll;
  const btn = document.getElementById('playAllBtn');

  if (!_playingAll) {
    btn.textContent = '▶ Play All';
    return;
  }

  btn.textContent = '⏸ Pause All';
  playSegment(_segments[0].start, _segments[0].end, 0);
}

function playNextSegment() {
  const items = document.querySelectorAll('.segment-item');
  if (_currentSegIdx < items.length - 1) {
    const el = items[_currentSegIdx + 1];
    playSegment(parseFloat(el.dataset.start), parseFloat(el.dataset.end), _currentSegIdx + 1);
  }
}

function playPrevSegment() {
  if (_currentSegIdx > 0) {
    const items = document.querySelectorAll('.segment-item');
    const el = items[_currentSegIdx - 1];
    playSegment(parseFloat(el.dataset.start), parseFloat(el.dataset.end), _currentSegIdx - 1);
  }
}

function updateSegmentCounter() {
  const total = document.querySelectorAll('.segment-item').length;
  const el = document.getElementById('segmentCounter');
  if (el) el.textContent = _currentSegIdx >= 0 ? `${_currentSegIdx + 1} / ${total}` : '—';
}

function enableNavButtons() {
  const total = document.querySelectorAll('.segment-item').length;
  document.getElementById('playPrevBtn').disabled = _currentSegIdx <= 0;
  document.getElementById('playNextBtn').disabled = _currentSegIdx >= total - 1;
}

function showOverlay(label) {
  const ov = document.getElementById('overlay');
  document.getElementById('overlayLabel').textContent = label;
  ov.style.display = 'flex';
}
function hideOverlay() { document.getElementById('overlay').style.display = 'none'; }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show';
  clearTimeout(window._tt); window._tt = setTimeout(() => t.className = 'toast', 2000);
}

function copyText() {
  const text = docFullText;
  if (!text) return;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast('✅ Copied'));
  else showToast('❌ Copy failed');
}

function escHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
