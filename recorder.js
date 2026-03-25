// recorder.js
'use strict';

// ─── State ──────────────────────────────────────────────────────────
let mediaRecorder = null;
let chunks        = [];
let timerInterval = null;
let seconds       = 0;
let recCount      = 0;
const clipBlobs   = {}; // id → Blob

// ─── DOM refs ────────────────────────────────────────────────────────
const startBtn  = document.getElementById('start-btn');
const stopBtn   = document.getElementById('stop-btn');
const timerEl   = document.getElementById('timer');
const statusEl  = document.getElementById('rec-status');
const dotEl     = document.getElementById('rec-dot');
const preview   = document.getElementById('preview');
const clipList  = document.getElementById('clip-list');
const clipsCard = document.getElementById('clips-card');
const errMsg    = document.getElementById('err-msg');

// ─── Helpers ─────────────────────────────────────────────────────────
function formatTime(s) {
  const h   = String(Math.floor(s / 3600)).padStart(2, '0');
  const m   = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function showErr(msg) {
  errMsg.textContent = '⚠ ' + msg;
  errMsg.className = 'msg error';
  errMsg.style.display = '';
  setTimeout(() => { errMsg.style.display = 'none'; }, 6000);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Capture thumbnail from video blob ───────────────────────────────
function makeThumbnail(url, cb) {
  const vid = document.createElement('video');
  vid.src = url;
  vid.muted = true;
  vid.currentTime = 0.5;
  vid.addEventListener('seeked', () => {
    const canvas = document.createElement('canvas');
    canvas.width  = 112;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(vid, 0, 0, 112, 72);
    cb(canvas.toDataURL('image/jpeg', 0.7));
  }, { once: true });
  vid.load();
}

// ─── Add clip to list ────────────────────────────────────────────────
function addClipItem(id, blob, url, name, durationSec) {
  clipBlobs[id] = blob;
  const size = (blob.size / 1024 / 1024).toFixed(2) + ' MB';
  const dur  = formatTime(durationSec);

  clipsCard.style.display = '';

  const item = document.createElement('div');
  item.className = 'clip-item';
  item.id = 'clip-' + id;

  // Header
  const header = document.createElement('div');
  header.className = 'clip-header';

  // Thumbnail
  const thumb = document.createElement('img');
  thumb.className = 'clip-thumb';
  thumb.alt = 'thumbnail';
  thumb.title = 'Click để xem preview';
  thumb.addEventListener('click', () => {
    preview.src = url;
    preview.style.display = '';
    preview.scrollIntoView({ behavior: 'smooth' });
    preview.play();
  });
  makeThumbnail(url, src => { thumb.src = src; });

  // Info
  const info = document.createElement('div');
  info.className = 'clip-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'clip-name';
  nameEl.textContent = name;

  const metaEl = document.createElement('div');
  metaEl.className = 'clip-meta';
  metaEl.textContent = `${dur} · ${size}`;

  info.appendChild(nameEl);
  info.appendChild(metaEl);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'clip-actions';

  // Download
  const dlBtn = document.createElement('button');
  dlBtn.className = 'btn-sm btn-dl';
  dlBtn.textContent = '⬇ Tải';
  dlBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  });

  // Telegram
  const tgBtn = document.createElement('button');
  tgBtn.className = 'btn-sm btn-tg';
  tgBtn.textContent = '✈ TG';
  tgBtn.addEventListener('click', () => sendToTelegram(id, name, item));

  // Delete
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-sm btn-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Xoá khỏi danh sách';
  delBtn.addEventListener('click', () => {
    URL.revokeObjectURL(url);
    delete clipBlobs[id];
    item.remove();
    if (!clipList.hasChildNodes()) clipsCard.style.display = 'none';
  });

  actions.appendChild(dlBtn);
  actions.appendChild(tgBtn);
  actions.appendChild(delBtn);

  header.appendChild(thumb);
  header.appendChild(info);
  header.appendChild(actions);

  // TG status bar
  const tgStatus = document.createElement('div');
  tgStatus.className = 'tg-status';
  tgStatus.id = 'tg-status-' + id;

  item.appendChild(header);
  item.appendChild(tgStatus);
  clipList.prepend(item);
}

// ─── Send to Telegram ────────────────────────────────────────────────
async function sendToTelegram(id, name, itemEl) {
  const tgStatus = document.getElementById('tg-status-' + id);

  chrome.storage.local.get(['tg_token', 'tg_chatid'], async data => {
    if (!data.tg_token || !data.tg_chatid) {
      // Auto-open config
      openTgConfig();
      tgStatus.className = 'tg-status fail';
      tgStatus.textContent = '⚠ Chưa cấu hình Telegram. Nhập token + chat ID bên dưới.';
      return;
    }

    const blob = clipBlobs[id];
    if (!blob) {
      tgStatus.className = 'tg-status fail';
      tgStatus.textContent = '⚠ Không tìm thấy dữ liệu clip.';
      return;
    }

    tgStatus.className = 'tg-status sending';
    tgStatus.textContent = '⟳ Đang chuyển đổi...';

    let base64;
    try {
      base64 = await blobToBase64(blob);
    } catch (e) {
      tgStatus.className = 'tg-status fail';
      tgStatus.textContent = '⚠ Lỗi đọc file: ' + e.message;
      return;
    }

    tgStatus.textContent = '⟳ Đang gửi lên Telegram...';

    chrome.runtime.sendMessage({
      type: 'SEND_TELEGRAM',
      token:  data.tg_token,
      chatId: data.tg_chatid,
      base64,
      mimeType: blob.type || 'video/webm',
      filename: name,
      caption: `🎥 ${name}\nGhi từ Dev Toolkit`
    }, resp => {
      if (chrome.runtime.lastError) {
        tgStatus.className = 'tg-status fail';
        tgStatus.textContent = '⚠ Runtime error: ' + chrome.runtime.lastError.message;
        return;
      }
      if (resp && resp.ok) {
        tgStatus.className = 'tg-status done';
        tgStatus.textContent = '✓ Đã gửi thành công lên Telegram!';
      } else {
        tgStatus.className = 'tg-status fail';
        tgStatus.textContent = '⚠ ' + (resp ? resp.error : 'Không có phản hồi');
      }
    });
  });
}

// ─── Recording ───────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  errMsg.style.display = 'none';

  try {
    const optAudio = document.getElementById('opt-audio').checked;
    const optTab   = document.getElementById('opt-tab').checked;

    let stream;
    if (optTab) {
      if (!chrome?.tabCapture) {
        showErr('Tab-only capture cần permission "tabCapture". Dùng chế độ toàn màn hình.');
        return;
      }
      stream = await new Promise((resolve, reject) => {
        chrome.tabCapture.capture({ audio: optAudio, video: true }, s => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(s);
        });
      });
    } else {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: optAudio
      });
    }

    chunks = [];

    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ].find(m => MediaRecorder.isTypeSupported(m)) || '';

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    const startedAt = Date.now();

    mediaRecorder.onstop = () => {
      const finalMime = mediaRecorder.mimeType || 'video/webm';
      const blob = new Blob(chunks, { type: finalMime });
      const url  = URL.createObjectURL(blob);
      const ext  = finalMime.includes('mp4') ? 'mp4' : 'webm';
      const id   = ++recCount;
      const name = `clip-${id}-${Date.now()}.${ext}`;
      const durationSec = Math.round((Date.now() - startedAt) / 1000);

      // Update preview
      preview.src = url;
      preview.style.display = '';

      addClipItem(id, blob, url, name, durationSec);
    };

    stream.getVideoTracks()[0].onended = () => stopRecording();

    mediaRecorder.start(500);
    seconds = 0;
    timerInterval = setInterval(() => {
      seconds++;
      timerEl.textContent = formatTime(seconds);
    }, 1000);

    timerEl.classList.add('recording');
    dotEl.classList.add('recording');
    statusEl.textContent = 'Đang ghi...';
    startBtn.disabled = true;
    stopBtn.disabled  = false;

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showErr('Bạn đã từ chối chia sẻ màn hình.');
    } else {
      showErr('Lỗi: ' + err.message);
    }
  }
});

stopBtn.addEventListener('click', stopRecording);

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  clearInterval(timerInterval);
  timerEl.classList.remove('recording');
  dotEl.classList.remove('recording');
  statusEl.textContent = 'Đã lưu — xem clip bên dưới';
  startBtn.disabled = false;
  stopBtn.disabled  = true;
}

// ─── Telegram config panel ───────────────────────────────────────────
const tgToggle = document.getElementById('tg-toggle');
const tgBody   = document.getElementById('tg-body');
const tgIcon   = document.getElementById('tg-toggle-icon');

function openTgConfig() {
  tgBody.classList.add('open');
  tgToggle.classList.add('open');
  tgIcon.textContent = '▲ đóng';
  tgBody.scrollIntoView({ behavior: 'smooth' });
}

tgToggle.addEventListener('click', () => {
  const isOpen = tgBody.classList.toggle('open');
  tgToggle.classList.toggle('open', isOpen);
  tgIcon.textContent = isOpen ? '▲ đóng' : '▼ mở';
});

// Load saved config
chrome.storage.local.get(['tg_token', 'tg_chatid'], data => {
  if (data.tg_token)  document.getElementById('tg-token').value  = data.tg_token;
  if (data.tg_chatid) document.getElementById('tg-chatid').value = data.tg_chatid;
});

document.getElementById('tg-save-btn').addEventListener('click', () => {
  const token  = document.getElementById('tg-token').value.trim();
  const chatid = document.getElementById('tg-chatid').value.trim();
  if (!token || !chatid) return;

  chrome.storage.local.set({ tg_token: token, tg_chatid: chatid }, () => {
    const s = document.getElementById('tg-save-status');
    s.style.display = '';
    setTimeout(() => { s.style.display = 'none'; }, 2000);
  });
});
