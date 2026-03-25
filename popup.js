// popup.js

// ─── Tab switching ─────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// ─── Helpers ───────────────────────────────────────────────────────
function showEl(el) { el.style.display = ''; }
function hideEl(el) { el.style.display = 'none'; }

function syntaxHighlight(json) {
  try {
    const parsed = JSON.parse(json);
    const str = JSON.stringify(parsed, null, 2);
    return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, match => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span class="json-key">${match}</span>`;
        return `<span class="json-str">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span class="json-bool">${match}</span>`;
      if (/null/.test(match)) return `<span class="json-null">${match}</span>`;
      return `<span class="json-num">${match}</span>`;
    });
  } catch {
    return json.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

function getStatusClass(status) {
  if (status >= 200 && status < 300) return 'status-2xx';
  if (status >= 300 && status < 400) return 'status-3xx';
  if (status >= 400 && status < 500) return 'status-4xx';
  return 'status-5xx';
}

// ─── API TESTER ────────────────────────────────────────────────────
const sendBtn   = document.getElementById('send-btn');
const clearBtn  = document.getElementById('clear-btn');
const urlInput  = document.getElementById('url');
const methodSel = document.getElementById('method');
const headersTA = document.getElementById('headers');
const bodyTA    = document.getElementById('body');
const respDiv   = document.getElementById('api-response');
const errorDiv  = document.getElementById('api-error');
const loadingDiv= document.getElementById('api-loading');

let lastResponse = null; // { body, headers }
let currentRespTab = 'body';

// Persist url/method trong session storage
chrome.storage.local.get(['dt_url', 'dt_method', 'dt_headers', 'dt_body'], data => {
  if (data.dt_url)     urlInput.value   = data.dt_url;
  if (data.dt_method)  methodSel.value  = data.dt_method;
  if (data.dt_headers) headersTA.value  = data.dt_headers;
  if (data.dt_body)    bodyTA.value     = data.dt_body;
});

function saveState() {
  chrome.storage.local.set({
    dt_url: urlInput.value,
    dt_method: methodSel.value,
    dt_headers: headersTA.value,
    dt_body: bodyTA.value
  });
}
[urlInput, methodSel, headersTA, bodyTA].forEach(el => el.addEventListener('input', saveState));

sendBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) {
    showError('Nhập URL trước đã bro.');
    return;
  }

  hideEl(errorDiv);
  hideEl(respDiv);
  showEl(loadingDiv);
  sendBtn.disabled = true;

  chrome.runtime.sendMessage({
    type: 'API_REQUEST',
    url,
    method: methodSel.value,
    headers: headersTA.value.trim(),
    body: bodyTA.value.trim()
  }, resp => {
    sendBtn.disabled = false;
    hideEl(loadingDiv);

    if (chrome.runtime.lastError) {
      showError('Runtime error: ' + chrome.runtime.lastError.message);
      return;
    }

    if (!resp || !resp.ok) {
      showError(resp ? resp.error : 'Không nhận được response');
      return;
    }

    lastResponse = { body: resp.body, headers: resp.headers };
    renderResponse(resp);
  });
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  headersTA.value = '';
  bodyTA.value = '';
  hideEl(respDiv);
  hideEl(errorDiv);
  hideEl(loadingDiv);
  lastResponse = null;
  saveState();
});

function showError(msg) {
  errorDiv.textContent = '⚠ ' + msg;
  showEl(errorDiv);
  hideEl(respDiv);
}

function renderResponse(resp) {
  const statusBadge = document.getElementById('resp-status');
  statusBadge.textContent = resp.status;
  statusBadge.className = 'status-badge ' + getStatusClass(resp.status);

  document.getElementById('resp-status-text').textContent = resp.statusText;
  document.getElementById('resp-elapsed').textContent = resp.elapsed + 'ms';

  renderRespTab(currentRespTab);
  showEl(respDiv);
}

function renderRespTab(which) {
  const content = document.getElementById('resp-body-content');
  if (!lastResponse) return;

  if (which === 'body') {
    content.innerHTML = syntaxHighlight(lastResponse.body);
  } else {
    const headersStr = JSON.stringify(lastResponse.headers, null, 2);
    content.innerHTML = syntaxHighlight(headersStr);
  }
}

// Response sub-tabs
document.querySelectorAll('.resp-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.resp-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRespTab = btn.dataset.resp;
    renderRespTab(currentRespTab);
  });
});

// Copy response
document.getElementById('copy-resp-btn').addEventListener('click', () => {
  if (!lastResponse) return;
  const text = currentRespTab === 'body'
    ? lastResponse.body
    : JSON.stringify(lastResponse.headers, null, 2);
  navigator.clipboard.writeText(text).catch(() => {});
  const btn = document.getElementById('copy-resp-btn');
  btn.textContent = 'copied!';
  setTimeout(() => { btn.textContent = 'copy'; }, 1500);
});

// Enter = send
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendBtn.click();
});

// ─── SCREEN RECORDER ──────────────────────────────────────────────
document.getElementById('open-recorder-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_RECORDER' });
  window.close();
});

// ─── BUG REPORTER ─────────────────────────────────────────────────
let bugSeverity = 'medium';

// Load current tab URL
chrome.runtime.sendMessage({ type: 'GET_TAB_INFO' }, resp => {
  if (chrome.runtime.lastError || !resp || !resp.ok) {
    document.getElementById('bug-url').placeholder = 'Không lấy được URL';
    return;
  }
  document.getElementById('bug-url').value = resp.url || '';
});

// Severity buttons
document.querySelectorAll('.sev-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sev-btn').forEach(b => {
      b.className = 'sev-btn';
    });
    bugSeverity = btn.dataset.sev;
    btn.classList.add('active-' + bugSeverity);
  });
});

function buildBugReport() {
  const url      = document.getElementById('bug-url').value.trim();
  const title    = document.getElementById('bug-title').value.trim();
  const desc     = document.getElementById('bug-desc').value.trim();
  const severity = bugSeverity;
  const ts       = new Date().toISOString();

  if (!title) return null;

  return { url, title, desc, severity, timestamp: ts };
}

document.getElementById('copy-md-btn').addEventListener('click', () => {
  const r = buildBugReport();
  if (!r) { showBugStatus('Nhập tiêu đề lỗi trước.', 'error'); return; }

  const md = [
    `## 🐛 [${r.severity.toUpperCase()}] ${r.title}`,
    ``,
    `**URL:** ${r.url || '_N/A_'}`,
    `**Severity:** ${r.severity}`,
    `**Reported at:** ${r.timestamp}`,
    ``,
    `### Description`,
    r.desc || '_Chưa có mô tả._',
  ].join('\n');

  navigator.clipboard.writeText(md)
    .then(() => showBugStatus('Đã copy Markdown!', 'success'))
    .catch(() => showBugStatus('Copy thất bại.', 'error'));
});

document.getElementById('copy-json-btn').addEventListener('click', () => {
  const r = buildBugReport();
  if (!r) { showBugStatus('Nhập tiêu đề lỗi trước.', 'error'); return; }

  navigator.clipboard.writeText(JSON.stringify(r, null, 2))
    .then(() => showBugStatus('Đã copy JSON!', 'success'))
    .catch(() => showBugStatus('Copy thất bại.', 'error'));
});

function showBugStatus(msg, type) {
  const el = document.getElementById('bug-status');
  el.className = 'msg ' + type;
  el.textContent = msg;
  showEl(el);
  setTimeout(() => hideEl(el), 2500);
}

// ═══════════════════════════════════════════════════════
// REPORT PANEL
// ═══════════════════════════════════════════════════════

let allEvents   = [];
let activeFilter = 'all';

// Load khi mở tab report
document.querySelectorAll('.tab').forEach(tab => {
  if (tab.dataset.tab === 'report') {
    tab.addEventListener('click', loadEvents);
  }
});

function loadEvents() {
  chrome.runtime.sendMessage({ type: 'GET_EVENTS' }, resp => {
    if (chrome.runtime.lastError || !resp) return;
    allEvents = resp.events || [];
    renderEvents();
  });
}

// Auto-refresh mỗi 2s khi panel report đang active
setInterval(() => {
  const reportPanel = document.getElementById('report');
  if (reportPanel && reportPanel.classList.contains('active')) {
    loadEvents();
  }
}, 2000);

// ─── Filter buttons ──────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderEvents();
  });
});

// ─── Refresh & Clear ─────────────────────────────────────────────
document.getElementById('refresh-btn').addEventListener('click', loadEvents);

document.getElementById('clear-events-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, () => {
    allEvents = [];
    renderEvents();
  });
});

// ─── Render ──────────────────────────────────────────────────────
function renderEvents() {
  const list = document.getElementById('event-list');

  // Filter
  const filtered = allEvents.filter(ev => {
    if (activeFilter === 'all') return true;
    return ev.type === activeFilter;
  });

  // Summary counts
  const errors   = allEvents.filter(e => e.type === 'JS_ERROR' || e.type === 'UNHANDLED_REJECTION' || (e.type === 'CONSOLE' && e.level === 'error')).length;
  const warns    = allEvents.filter(e => e.type === 'CONSOLE' && e.level === 'warn').length;
  const netAll   = allEvents.filter(e => e.type === 'NETWORK' && e.phase === 'response').length;
  const netFail  = allEvents.filter(e => e.type === 'NETWORK' && e.phase === 'response' && (e.error || (e.status >= 400 || e.status === 0))).length;

  document.getElementById('sum-errors').textContent   = `${errors} error${errors !== 1 ? 's' : ''}`;
  document.getElementById('sum-warns').textContent    = `${warns} warn${warns !== 1 ? 's' : ''}`;
  document.getElementById('sum-net').textContent      = `${netAll} req`;
  document.getElementById('sum-net-fail').textContent = `${netFail} failed`;

  if (filtered.length === 0) {
    list.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = allEvents.length === 0
      ? 'Chưa có dữ liệu. Tương tác với trang để bắt đầu ghi nhận.'
      : 'Không có event nào khớp filter.';
    list.appendChild(empty);
    return;
  }

  list.innerHTML = '';

  // Sắp xếp mới nhất lên đầu, hiển thị response events thôi (không dupe request)
  const display = filtered.filter(e => !(e.type === 'NETWORK' && e.phase === 'request'));
  display.slice().reverse().forEach(ev => {
    const row = document.createElement('div');

    let rowClass = 'ev-row';
    let badgeClass = 'ev-badge';
    let badgeText = '';
    let msg = '';
    let meta = '';
    let stack = '';

    if (ev.type === 'JS_ERROR' || ev.type === 'UNHANDLED_REJECTION') {
      rowClass += ' type-JS_ERROR';
      badgeClass += ' badge-error';
      badgeText = ev.type === 'JS_ERROR' ? 'JS ERR' : 'REJECT';
      msg = ev.message || '(no message)';
      if (ev.source) meta = `${ev.source}${ev.line ? ':' + ev.line : ''}`;
      if (ev.stack) stack = ev.stack.split('\n').slice(0,4).join('\n');
    } else if (ev.type === 'CONSOLE') {
      rowClass += ` type-CONSOLE-${ev.level}`;
      badgeClass += ev.level === 'error' ? ' badge-error' : ' badge-warn';
      badgeText = ev.level.toUpperCase();
      msg = ev.message || '';
    } else if (ev.type === 'NETWORK') {
      const isFail = ev.error || ev.status === 0 || ev.status >= 400;
      rowClass += isFail ? ' type-NETWORK-fail' : ' type-NETWORK-ok';
      badgeClass += isFail ? ' badge-net-fail' : ' badge-net';
      badgeText = ev.status ? String(ev.status) : 'ERR';
      msg = `[${ev.method}] ${ev.url}`;
      const parts = [];
      if (ev.elapsed) parts.push(`${ev.elapsed}ms`);
      if (ev.responseSize) parts.push(`${(ev.responseSize/1024).toFixed(1)}KB`);
      if (ev.contentType) parts.push(ev.contentType.split(';')[0]);
      if (ev.error) parts.push('⚠ ' + ev.error);
      meta = parts.join(' · ');
    }

    row.className = rowClass;

    const badge = document.createElement('span');
    badge.className = badgeClass;
    badge.textContent = badgeText;

    const content = document.createElement('div');
    content.className = 'ev-content';

    const msgEl = document.createElement('div');
    msgEl.className = 'ev-msg';
    msgEl.textContent = msg;
    content.appendChild(msgEl);

    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'ev-meta';
      metaEl.textContent = meta;
      content.appendChild(metaEl);
    }

    if (stack) {
      const stackEl = document.createElement('div');
      stackEl.className = 'ev-stack';
      stackEl.textContent = stack;
      content.appendChild(stackEl);
    }

    const ts = document.createElement('div');
    ts.className = 'ev-ts';
    ts.textContent = ev.timestamp ? ev.timestamp.slice(11, 19) : '';

    row.appendChild(badge);
    row.appendChild(content);
    row.appendChild(ts);
    list.appendChild(row);
  });
}

// ─── Export Report (Markdown) ─────────────────────────────────────
document.getElementById('gen-report-btn').addEventListener('click', () => {
  const md = generateMarkdownReport();
  navigator.clipboard.writeText(md)
    .then(() => showReportStatus('Đã copy report Markdown!', 'success'))
    .catch(() => {
      // Fallback: tạo blob download
      const blob = new Blob([md], { type: 'text/markdown' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `report-${Date.now()}.md`; a.click();
      URL.revokeObjectURL(url);
    });
});

// ─── Send report lên Telegram ─────────────────────────────────────
document.getElementById('send-report-tg-btn').addEventListener('click', () => {
  chrome.storage.local.get(['tg_token', 'tg_chatid'], data => {
    if (!data.tg_token || !data.tg_chatid) {
      showReportStatus('Chưa cấu hình Telegram. Mở tab Recorder để nhập token.', 'error');
      return;
    }

    const md     = generateMarkdownReport();
    const base64 = btoa(unescape(encodeURIComponent(md)));
    const fname  = `report-${Date.now()}.md`;

    showReportStatus('Đang gửi...', 'info');

    chrome.runtime.sendMessage({
      type: 'SEND_TELEGRAM',
      token:    data.tg_token,
      chatId:   data.tg_chatid,
      base64,
      mimeType: 'text/markdown',
      filename: fname,
      caption:  `📋 Dev Report — ${new Date().toLocaleString('vi-VN')}`
    }, resp => {
      if (chrome.runtime.lastError) {
        showReportStatus('Runtime error: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      if (resp && resp.ok) {
        showReportStatus('✓ Đã gửi report lên Telegram!', 'success');
      } else {
        showReportStatus('⚠ ' + (resp ? resp.error : 'Lỗi không xác định'), 'error');
      }
    });
  });
});

function showReportStatus(msg, type) {
  const el = document.getElementById('report-status');
  el.className = 'msg ' + type;
  el.textContent = msg;
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ─── Generate Markdown report ─────────────────────────────────────
function generateMarkdownReport() {
  const now = new Date().toLocaleString('vi-VN');
  const lines = [
    `# Dev Toolkit — Error & Network Report`,
    `**Generated:** ${now}`,
    `**Total events:** ${allEvents.length}`,
    ''
  ];

  // Summary
  const jsErrors  = allEvents.filter(e => e.type === 'JS_ERROR' || e.type === 'UNHANDLED_REJECTION');
  const consErrors = allEvents.filter(e => e.type === 'CONSOLE' && e.level === 'error');
  const consWarns  = allEvents.filter(e => e.type === 'CONSOLE' && e.level === 'warn');
  const netResp    = allEvents.filter(e => e.type === 'NETWORK' && e.phase === 'response');
  const netFail    = netResp.filter(e => e.error || e.status === 0 || e.status >= 400);

  lines.push('## Summary');
  lines.push(`| Category | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| JS Errors / Rejections | ${jsErrors.length} |`);
  lines.push(`| Console Errors | ${consErrors.length} |`);
  lines.push(`| Console Warnings | ${consWarns.length} |`);
  lines.push(`| Network Requests | ${netResp.length} |`);
  lines.push(`| Failed Requests | ${netFail.length} |`);
  lines.push('');

  // JS Errors
  if (jsErrors.length > 0) {
    lines.push('## JS Errors');
    jsErrors.forEach((e, i) => {
      lines.push(`### ${i + 1}. [${e.type}] ${e.message}`);
      if (e.source) lines.push(`- **Source:** ${e.source}${e.line ? ':' + e.line : ''}`);
      lines.push(`- **Time:** ${e.timestamp}`);
      if (e.stack) lines.push(`\`\`\`\n${e.stack.slice(0, 600)}\n\`\`\``);
      lines.push('');
    });
  }

  // Console errors/warns
  const consAll = [...consErrors, ...consWarns];
  if (consAll.length > 0) {
    lines.push('## Console');
    consAll.forEach(e => {
      lines.push(`- **[${e.level.toUpperCase()}]** \`${e.message.slice(0, 200)}\` — ${e.timestamp}`);
    });
    lines.push('');
  }

  // Network
  if (netResp.length > 0) {
    lines.push('## Network Requests');
    lines.push('| Method | Status | URL | Elapsed | Size |');
    lines.push('|---|---|---|---|---|');
    netResp.forEach(e => {
      const status  = e.error ? '⚠ ERR' : e.status;
      const elapsed = e.elapsed ? `${e.elapsed}ms` : '-';
      const size    = e.responseSize ? `${(e.responseSize/1024).toFixed(1)}KB` : '-';
      const url     = e.url.length > 60 ? e.url.slice(0, 60) + '…' : e.url;
      lines.push(`| ${e.method} | ${status} | ${url} | ${elapsed} | ${size} |`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Footer: Privacy Policy link ───────────────────────────
document.getElementById('privacy-link').addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://gems.software/dev-toolkit/privacy' });
});
