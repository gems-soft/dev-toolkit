// content.js — isolated world
// 1. Inject injected.js vào MAIN world
// 2. Lắng nghe postMessage từ injected.js
// 3. Relay sang background để lưu trữ

(function () {
  // Inject injected.js vào page context
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // Relay events từ page → background
  window.addEventListener('message', e => {
    if (!e.data || !e.data.__devToolkit) return;
    chrome.runtime.sendMessage({
      type: 'STORE_EVENT',
      event: e.data.event
    }).catch(() => {}); // popup có thể đóng, ignore
  });
})();
