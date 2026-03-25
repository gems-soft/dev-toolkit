// injected.js — chạy trong MAIN world (page context)
// Hook console, XHR, fetch, window errors → postMessage → content.js
(function () {
  if (window.__devToolkitInjected) return;
  window.__devToolkitInjected = true;

  const TS = () => new Date().toISOString();

  function emit(event) {
    window.postMessage({ __devToolkit: true, event }, '*');
  }

  // ─── console.error / console.warn ───────────────────────────────
  ['error', 'warn'].forEach(level => {
    const orig = console[level].bind(console);
    console[level] = function (...args) {
      orig(...args);
      try {
        emit({
          type: 'CONSOLE',
          level,
          message: args.map(a => {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch { return String(a); }
          }).join(' '),
          timestamp: TS(),
          url: location.href
        });
      } catch (_) {}
    };
  });

  // ─── window.onerror ─────────────────────────────────────────────
  const origOnError = window.onerror;
  window.onerror = function (msg, src, line, col, err) {
    emit({
      type: 'JS_ERROR',
      message: msg,
      source: src || location.href,
      line,
      col,
      stack: err && err.stack ? err.stack : null,
      timestamp: TS(),
      url: location.href
    });
    if (origOnError) return origOnError.apply(this, arguments);
    return false;
  };

  // ─── unhandledrejection ─────────────────────────────────────────
  window.addEventListener('unhandledrejection', e => {
    const reason = e.reason;
    emit({
      type: 'UNHANDLED_REJECTION',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : null,
      timestamp: TS(),
      url: location.href
    });
  });

  // ─── XMLHttpRequest ──────────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OrigXHR();
    let _method = '', _url = '';
    const startTime = { value: 0 };

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      _method = method;
      _url = url;
      return origOpen(method, url, ...rest);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function (body) {
      startTime.value = Date.now();
      emit({
        type: 'NETWORK',
        phase: 'request',
        method: _method,
        url: _url,
        body: body ? (typeof body === 'string' ? body.slice(0, 500) : '[binary]') : null,
        timestamp: TS()
      });
      xhr.addEventListener('loadend', () => {
        emit({
          type: 'NETWORK',
          phase: 'response',
          method: _method,
          url: _url,
          status: xhr.status,
          statusText: xhr.statusText,
          elapsed: Date.now() - startTime.value,
          responseSize: xhr.responseText ? xhr.responseText.length : 0,
          contentType: xhr.getResponseHeader('content-type') || '',
          error: xhr.status === 0 ? 'Network error / blocked' : null,
          timestamp: TS()
        });
      });
      return origSend(body);
    };

    return xhr;
  };
  // Copy static props
  Object.defineProperties(window.XMLHttpRequest, Object.getOwnPropertyDescriptors(OrigXHR));

  // ─── fetch ───────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url    = typeof input === 'string' ? input : (input.url || String(input));
    const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const start  = Date.now();

    emit({
      type: 'NETWORK',
      phase: 'request',
      method,
      url,
      body: init.body ? (typeof init.body === 'string' ? init.body.slice(0, 500) : '[binary]') : null,
      timestamp: TS()
    });

    try {
      const res = await origFetch(input, init);
      const clone = res.clone();
      let size = 0;
      try {
        const buf = await clone.arrayBuffer();
        size = buf.byteLength;
      } catch (_) {}

      emit({
        type: 'NETWORK',
        phase: 'response',
        method,
        url,
        status: res.status,
        statusText: res.statusText,
        elapsed: Date.now() - start,
        responseSize: size,
        contentType: res.headers.get('content-type') || '',
        error: null,
        timestamp: TS()
      });
      return res;
    } catch (err) {
      emit({
        type: 'NETWORK',
        phase: 'response',
        method,
        url,
        status: 0,
        elapsed: Date.now() - start,
        error: err.message,
        timestamp: TS()
      });
      throw err;
    }
  };

})();
