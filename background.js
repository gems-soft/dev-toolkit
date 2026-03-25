// background.js — Service Worker

// ─── Event store (per tab, in-memory + storage) ────────────────────
// Tối đa 200 events/tab để tránh bloat
const MAX_EVENTS = 200;

async function getEvents(tabId) {
  const key = `events_${tabId}`;
  return new Promise(resolve => {
    chrome.storage.local.get([key], data => {
      resolve(data[key] || []);
    });
  });
}

async function storeEvent(tabId, event) {
  const key = `events_${tabId}`;
  const events = await getEvents(tabId);
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: events }, resolve);
  });
}

async function clearEvents(tabId) {
  const key = `events_${tabId}`;
  return new Promise(resolve => {
    chrome.storage.local.remove([key], resolve);
  });
}

// Xoá events khi tab đóng
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.local.remove([`events_${tabId}`]);
});

// ─── Message handler ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ─── Lưu event từ content script ──────────────────────────────
  if (msg.type === 'STORE_EVENT') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      storeEvent(tabId, msg.event);
    }
    return false; // no async response needed
  }

  // ─── Lấy events cho tab hiện tại ──────────────────────────────
  if (msg.type === 'GET_EVENTS') {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (chrome.runtime.lastError || !tabs[0]) {
        sendResponse({ ok: false, events: [] });
        return;
      }
      const events = await getEvents(tabs[0].id);
      sendResponse({ ok: true, tabId: tabs[0].id, events });
    });
    return true;
  }

  // ─── Xoá events cho tab hiện tại ─────────────────────────────
  if (msg.type === 'CLEAR_EVENTS') {
    chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
      if (tabs[0]) await clearEvents(tabs[0].id);
      sendResponse({ ok: true });
    });
    return true;
  }

  // ─── API Request ───────────────────────────────────────────────
  if (msg.type === 'API_REQUEST') {
    const { url, method, headers, body } = msg;

    if (!url || !url.startsWith('http')) {
      sendResponse({ ok: false, error: 'URL không hợp lệ. Phải bắt đầu bằng http:// hoặc https://' });
      return true;
    }

    const opts = { method: method || 'GET', headers: {} };

    try {
      if (headers && headers.trim()) Object.assign(opts.headers, JSON.parse(headers));
    } catch (_) {
      sendResponse({ ok: false, error: 'Headers không phải JSON hợp lệ' });
      return true;
    }

    if (body && body.trim() && method !== 'GET' && method !== 'HEAD') {
      opts.body = body;
      if (!opts.headers['Content-Type'] && !opts.headers['content-type'])
        opts.headers['Content-Type'] = 'application/json';
    }

    const startTime = Date.now();
    fetch(url, opts)
      .then(async res => {
        const elapsed = Date.now() - startTime;
        const text = await res.text();
        const respHeaders = {};
        res.headers.forEach((v, k) => { respHeaders[k] = v; });
        sendResponse({ ok: true, status: res.status, statusText: res.statusText, headers: respHeaders, body: text, elapsed });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ─── Lấy URL tab hiện tại ─────────────────────────────────────
  if (msg.type === 'GET_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (chrome.runtime.lastError || !tabs[0]) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Không tìm thấy tab' });
        return;
      }
      const tab = tabs[0];
      sendResponse({ ok: true, url: tab.url || '', title: tab.title || '', id: tab.id });
    });
    return true;
  }

  // ─── Mở recorder tab ──────────────────────────────────────────
  if (msg.type === 'OPEN_RECORDER') {
    chrome.tabs.create({ url: chrome.runtime.getURL('recorder.html') });
    sendResponse({ ok: true });
    return true;
  }
});

// ─── Gửi clip lên Telegram Bot API ────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'SEND_TELEGRAM') return false;

  const { token, chatId, base64, mimeType, filename, caption } = msg;

  if (!token || !chatId || !base64) {
    sendResponse({ ok: false, error: 'Thiếu token, chatId hoặc dữ liệu file' });
    return true;
  }

  const byteLen = Math.ceil(base64.length * 0.75);
  if (byteLen > 50 * 1024 * 1024) {
    sendResponse({ ok: false, error: 'File quá lớn (giới hạn 50MB của Telegram Bot API)' });
    return true;
  }

  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption || filename);
  form.append('document', blob, filename);

  fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form })
    .then(async res => {
      const json = await res.json();
      if (json.ok) {
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: `Telegram ${json.error_code}: ${json.description}` });
      }
    })
    .catch(err => sendResponse({ ok: false, error: 'Fetch error: ' + err.message }));

  return true;
});
