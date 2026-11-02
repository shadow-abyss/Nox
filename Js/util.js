/* Project NOX — small shared helpers (ids, dates, modal, toast, downloads). */
(function () {
  'use strict';

  const NoxUI = {};

  NoxUI.uid = function () {
    return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  };

  NoxUI.debounce = function (fn, ms) {
    let t = null;
    const wrapped = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
    wrapped.flush = function (...args) { clearTimeout(t); fn.apply(this, args); };
    wrapped.cancel = function () { clearTimeout(t); };
    return wrapped;
  };

  NoxUI.escape = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  NoxUI.stripTags = function (html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  };

  NoxUI.relTime = function (ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  };

  NoxUI.fullTime = function (ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  NoxUI.bytes = function (n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  };

  /* ── toast ── */
  let toastTimer = null;
  NoxUI.toast = function (msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  };

  /* ── modal ── */
  const root = () => document.getElementById('modalRoot');

  NoxUI.closeModal = function () {
    const r = root();
    if (!r) return;
    r.hidden = true;
    document.getElementById('modalBody').innerHTML = '';
    document.getElementById('modalFoot').innerHTML = '';
    NoxUI._modalCleanup && NoxUI._modalCleanup();
    NoxUI._modalCleanup = null;
  };

  NoxUI.modal = function (opts) {
    const r = root();
    if (!r) return;
    document.getElementById('modalTitle').textContent = opts.title || '';
    const body = document.getElementById('modalBody');
    body.innerHTML = opts.body || '';
    const foot = document.getElementById('modalFoot');
    foot.innerHTML = '';

    (opts.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = a.primary ? 'primary-btn' : 'ghost-btn';
      b.textContent = a.label;
      b.onclick = () => {
        const keep = a.onClick ? a.onClick(body) : false;
        if (keep !== true) NoxUI.closeModal();
      };
      foot.appendChild(b);
    });

    r.hidden = false;
    if (opts.onMount) opts.onMount(body);
  };

  NoxUI.confirm = function (title, message, confirmLabel, onYes) {
    NoxUI.modal({
      title: title,
      body: '<p style="margin:0">' + NoxUI.escape(message) + '</p>',
      actions: [
        { label: 'Cancel' },
        { label: confirmLabel || 'Confirm', primary: true, onClick: () => { onYes && onYes(); } }
      ]
    });
  };

  /* ── file helpers ── */
  NoxUI.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  NoxUI.downloadText = function (text, filename, type) {
    NoxUI.download(new Blob([text], { type: type || 'text/plain;charset=utf-8' }), filename);
  };

  NoxUI.pickFile = function (accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      let done = false;
      input.onchange = () => {
        done = true;
        const f = input.files && input.files[0];
        input.remove();
        resolve(f || null);
      };
      // If the picker is cancelled there is no reliable event; clean up on next focus.
      window.addEventListener('focus', function once() {
        window.removeEventListener('focus', once);
        setTimeout(() => { if (!done) { input.remove(); resolve(null); } }, 600);
      });
      input.click();
    });
  };

  NoxUI.slug = function (s) {
    return String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
  };

  window.NoxUI = NoxUI;
})();
