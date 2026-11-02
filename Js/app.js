/* Project NOX — application shell.
   Local-first: every keystroke lands in IndexedDB. No server, no account, no sync. */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const KIND_ICON = { rich: '¶', ink: '✎', mind: '❖', pdf: '▤', link: '∞' };
  const KIND_LABEL = { rich: 'note', ink: 'sketch', mind: 'mindmap', pdf: 'pdf', link: 'link' };
  const INK_COLORS = ['#e8e2d9', '#ff2d4b', '#c9a227', '#8fa9c4', '#9b9490'];
  const INK_SIZES = [2, 3.5, 6, 10, 16];

  const state = {
    docs: [],
    activeId: null,
    filter: 'all',
    tag: null,
    query: ''
  };

  let inkCtl = null;
  let mindCtl = null;
  let pdfCtl = null;
  const saveTimers = new Map();

  /* ══════════════════════ helpers ══════════════════════ */

  function activeDoc() {
    return state.docs.find((d) => d.id === state.activeId) || null;
  }

  function titleOf(doc) {
    const t = (doc.title || '').trim();
    if (t) return t;
    return 'Untitled ' + KIND_LABEL[doc.kind];
  }

  function findByTitle(title) {
    const t = String(title || '').trim().toLowerCase();
    return state.docs.find((d) => !d.trashed && (d.title || '').trim().toLowerCase() === t) || null;
  }

  function previewOf(doc) {
    if (doc.kind === 'rich') return NoxUI.stripTags(doc.html).slice(0, 90) || 'empty note';
    if (doc.kind === 'ink') return (doc.ink && doc.ink.strokes ? doc.ink.strokes.length : 0) + ' strokes';
    if (doc.kind === 'mind') return (doc.mind && doc.mind.nodes ? doc.mind.nodes.length : 0) + ' nodes';
    if (doc.kind === 'pdf') return doc.pdfName || 'pdf';
    if (doc.kind === 'link') return doc.url || 'no url';
    return '';
  }

  function queueSave(doc) {
    doc.updatedAt = Date.now();
    clearTimeout(saveTimers.get(doc.id));
    saveTimers.set(doc.id, setTimeout(() => saveNow(doc), 350));
    scheduleListRefresh();
  }

  async function saveNow(doc) {
    clearTimeout(saveTimers.get(doc.id));
    saveTimers.delete(doc.id);
    doc.updatedAt = doc.updatedAt || Date.now();
    try {
      await NoxDB.put(doc);
    } catch (e) {
      NoxUI.toast('Could not save — storage may be full');
    }
  }

  async function flushAll() {
    const pending = state.docs.filter((d) => saveTimers.has(d.id));
    for (const d of pending) await saveNow(d);
  }

  let listTimer = null;
  function scheduleListRefresh() {
    clearTimeout(listTimer);
    listTimer = setTimeout(() => { renderList(); updateCounts(); }, 700);
  }

  /* ══════════════════════ list ══════════════════════ */

  function visibleDocs() {
    const q = state.query.trim().toLowerCase();
    return state.docs
      .filter((d) => {
        if (state.filter === 'trash') { if (!d.trashed) return false; }
        else if (d.trashed) return false;
        if (state.filter === 'pinned' && !d.pinned) return false;
        if (state.tag && (d.tags || []).indexOf(state.tag) === -1) return false;
        if (q) {
          const hay = [
            d.title, NoxUI.stripTags(d.html), d.url, d.notes, d.caption, d.pdfName,
            (d.tags || []).join(' ')
          ].join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  }

  function renderList() {
    const host = $('#docList');
    const docs = visibleDocs();
    if (!docs.length) {
      host.innerHTML = '<div class="list-empty">' + (state.query ? 'no matches' : 'nothing here yet') + '</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    docs.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'doc-item' + (d.id === state.activeId ? ' active' : '');
      row.dataset.id = d.id;
      row.innerHTML =
        '<div class="doc-ico">' + KIND_ICON[d.kind] + '</div>' +
        '<div class="doc-main">' +
          '<div class="doc-name">' + NoxUI.escape(titleOf(d)) + '</div>' +
          '<div class="doc-sub">' + NoxUI.escape(previewOf(d)) + ' · ' + NoxUI.relTime(d.updatedAt) + '</div>' +
        '</div>' +
        '<div class="doc-pin">' + (d.pinned ? '★' : '') + '</div>';
      frag.appendChild(row);
    });
    host.innerHTML = '';
    host.appendChild(frag);
  }

  function updateCounts() {
    const live = state.docs.filter((d) => !d.trashed);
    $('#countAll').textContent = live.length;
    $('#countPinned').textContent = live.filter((d) => d.pinned).length;
    $('#countTrash').textContent = state.docs.filter((d) => d.trashed).length;
    renderTags();
  }

  function renderTags() {
    const counts = new Map();
    state.docs.filter((d) => !d.trashed).forEach((d) => {
      (d.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
    });
    const host = $('#tagList');
    if (!counts.size) { host.innerHTML = ''; return; }
    const frag = document.createDocumentFragment();
    Array.from(counts.keys()).sort().forEach((t) => {
      const b = document.createElement('button');
      b.className = 'tag-chip' + (state.tag === t ? ' on' : '');
      b.textContent = '#' + t;
      b.onclick = () => {
        state.tag = state.tag === t ? null : t;
        renderTags();
        renderList();
      };
      frag.appendChild(b);
    });
    host.innerHTML = '';
    host.appendChild(frag);
  }

  /* ══════════════════════ views ══════════════════════ */

  function showView(kind) {
    $$('.view').forEach((v) => v.classList.remove('is-active'));
    const v = kind ? $('#view-' + kind) : $('#view-empty');
    if (v) v.classList.add('is-active');
  }

  function setNav(open) {
    document.body.classList.toggle('nav-open', !!open);
  }

  async function openDoc(id) {
    const doc = state.docs.find((d) => d.id === id);
    if (!doc) return;

    if (state.activeId && state.activeId !== id) finalizeRich();

    state.activeId = id;
    showView(doc.kind);
    renderList();
    syncAppbar(doc);
    setNav(false);

    if (doc.kind === 'rich') mountRich(doc);
    else if (doc.kind === 'ink') mountInk(doc);
    else if (doc.kind === 'mind') mountMind(doc);
    else if (doc.kind === 'pdf') mountPDF(doc);
    else if (doc.kind === 'link') mountLink(doc);
  }

  function syncAppbar(doc) {
    const pin = $('#btnPin');
    if (!doc) { pin.classList.remove('on'); pin.textContent = '☆'; return; }
    pin.classList.toggle('on', !!doc.pinned);
    pin.textContent = doc.pinned ? '★' : '☆';
    $('#btnTrash').title = doc.trashed ? 'Delete permanently' : 'Move to trash';
  }

  /* ══════════════════════ rich text ══════════════════════ */

  function mountRich(doc) {
    const body = $('#richBody');
    const title = $('#richTitle');
    title.value = doc.title || '';
    body.innerHTML = doc.html || '';
    linkifyWikilinks(body);
    updateRichMeta(doc);
    renderBacklinks(doc);
  }

  function updateRichMeta(doc) {
    const words = NoxUI.stripTags(doc.html).split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(words / 220));
    $('#richMeta').textContent = 'rich note · ' + words + ' words · ' + mins + ' min · edited ' + NoxUI.relTime(doc.updatedAt);
    $('#wordCount').textContent = words + ' words';
  }

  function finalizeRich() {
    const doc = activeDoc();
    if (!doc || doc.kind !== 'rich') return;
    const body = $('#richBody');
    if (!body) return;
    linkifyWikilinks(body);
    doc.html = body.innerHTML;
    if (saveTimers.has(doc.id)) saveNow(doc);
    renderBacklinks(doc);
  }

  function linkifyWikilinks(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || n.nodeValue.indexOf('[[') === -1) continue;
      const p = n.parentElement;
      if (p && p.closest('a,pre,code')) continue;
      targets.push(n);
    }
    targets.forEach((node) => {
      const parts = node.nodeValue.split(/(\[\[[^\]]+\]\])/);
      const frag = document.createDocumentFragment();
      parts.forEach((part) => {
        const m = part.match(/^\[\[([^\]]+)\]\]$/);
        if (m) {
          const t = m[1].trim();
          const a = document.createElement('a');
          a.className = 'wikilink' + (findByTitle(t) ? '' : ' missing');
          a.href = '#';
          a.dataset.title = t;
          a.textContent = t;
          frag.appendChild(a);
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      });
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
  }

  function renderBacklinks(doc) {
    const host = $('#backlinks');
    if (!doc || doc.kind !== 'rich') { host.innerHTML = ''; return; }
    const title = (doc.title || '').trim().toLowerCase();
    if (!title) { host.innerHTML = ''; return; }
    const hits = state.docs.filter((d) => {
      if (d.id === doc.id || d.trashed) return false;
      const html = d.html || '';
      if (!html) return false;
      return html.indexOf('[[' + doc.title + ']]') !== -1 ||
             html.toLowerCase().indexOf('data-title="' + title + '"') !== -1 ||
             new RegExp('data-title="' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'i').test(html);
    });
    host.innerHTML = '';
    if (!hits.length) return;
    const lbl = document.createElement('span');
    lbl.textContent = 'linked from';
    host.appendChild(lbl);
    hits.slice(0, 6).forEach((h) => {
      const b = document.createElement('button');
      b.className = 'backlink';
      b.textContent = titleOf(h);
      b.onclick = () => openDoc(h.id);
      host.appendChild(b);
    });
  }

  function bindRich() {
    const body = $('#richBody');
    const title = $('#richTitle');

    try { document.execCommand('styleWithCSS', false, true); } catch (e) {}

    title.addEventListener('input', () => {
      const doc = activeDoc();
      if (!doc) return;
      doc.title = title.value;
      queueSave(doc);
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); body.focus(); }
    });

    body.addEventListener('input', () => {
      const doc = activeDoc();
      if (!doc || doc.kind !== 'rich') return;
      doc.html = body.innerHTML;
      queueSave(doc);
      updateRichMeta(doc);
    });

    body.addEventListener('blur', () => {
      setTimeout(() => { if (document.activeElement !== body) finalizeRich(); }, 120);
    });

    body.addEventListener('click', (e) => {
      const link = e.target.closest('.wikilink');
      if (link) {
        e.preventDefault();
        const t = link.dataset.title;
        const found = findByTitle(t);
        if (found) openDoc(found.id);
        else createDoc('rich', { title: t });
        return;
      }
      const ext = e.target.closest('a[href]');
      if (ext && ext.getAttribute('href') !== '#') {
        e.preventDefault();
        window.open(ext.getAttribute('href'), '_blank', 'noopener');
      }
    });

    body.addEventListener('paste', (e) => {
      // paste as plain text unless it is our own HTML
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (text) {
        e.preventDefault();
        document.execCommand('insertText', false, text);
      }
    });

    const tb = $('#richToolbar');
    tb.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });
    tb.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val;
      body.focus();

      if (cmd === 'highlight') {
        document.execCommand('hiliteColor', false, 'rgba(200,16,46,0.32)');
      } else if (cmd === 'link') {
        askLink();
      } else if (cmd === 'wikilink') {
        askWikilink();
      } else if (cmd === 'formatBlock') {
        const cur = document.queryCommandValue('formatBlock');
        document.execCommand('formatBlock', false, cur && cur.toLowerCase() === val ? 'p' : val);
      } else if (cmd) {
        document.execCommand(cmd, false, null);
      }
      const doc = activeDoc();
      if (doc) { doc.html = body.innerHTML; queueSave(doc); updateRichMeta(doc); }
    });
  }

  function askLink() {
    const sel = window.getSelection();
    const hasSel = sel && String(sel);
    NoxUI.modal({
      title: 'Insert link',
      body: '<div class="field"><label>URL</label><input type="url" id="mUrl" placeholder="https://example.com" /></div>' +
            '<div class="field"><label>Text</label><input type="text" id="mText" value="' + NoxUI.escape(hasSel) + '" placeholder="optional" /></div>',
      actions: [
        { label: 'Cancel' },
        { label: 'Insert', primary: true, onClick: (b) => {
            const url = b.querySelector('#mUrl').value.trim();
            const text = b.querySelector('#mText').value.trim();
            if (!url) return false;
            const body = $('#richBody');
            body.focus();
            if (text && !hasSel) document.execCommand('insertText', false, text);
            document.execCommand('createLink', false, /^[a-z]+:/i.test(url) ? url : 'https://' + url);
            const doc = activeDoc();
            if (doc) { doc.html = body.innerHTML; queueSave(doc); }
          } }
      ],
      onMount: (b) => { const i = b.querySelector('#mUrl'); if (i) i.focus(); }
    });
  }

  function askWikilink() {
    const titles = state.docs.filter((d) => !d.trashed).map((d) => d.title).filter(Boolean);
    NoxUI.modal({
      title: 'Link a note',
      body: '<div class="field"><label>Note title</label><input type="text" id="mWiki" placeholder="Type a title — new notes are created on click" list="wikiList" />' +
            '<datalist id="wikiList">' + titles.map((t) => '<option value="' + NoxUI.escape(t) + '"></option>').join('') + '</datalist></div>' +
            '<p style="margin:0;font-size:11.5px;color:#6a645f">Typing <code>[[Note title]]</code> anywhere in a note does the same thing.</p>',
      actions: [
        { label: 'Cancel' },
        { label: 'Insert', primary: true, onClick: (b) => {
            const v = b.querySelector('#mWiki').value.trim();
            if (!v) return false;
            const body = $('#richBody');
            body.focus();
            document.execCommand('insertText', false, '[[' + v + ']]');
            finalizeRich();
          } }
      ],
      onMount: (b) => { const i = b.querySelector('#mWiki'); if (i) i.focus(); }
    });
  }

  /* ══════════════════════ ink ══════════════════════ */

  function mountInk(doc) {
    $('#inkTitle').value = doc.title || '';
    if (!doc.ink) doc.ink = { strokes: [], paper: 'ruled' };

    if (!inkCtl) {
      inkCtl = NoxInk($('#inkCanvas'), $('#inkWrap'), {
        onChange: () => {
          const d = activeDoc();
          if (!d || d.kind !== 'ink') return;
          d.ink = inkCtl.state();
          queueSave(d);
          updateInkMeta(d);
        }
      });
      buildInkToolbar();
    }
    inkCtl.load(doc);
    $('#inkPaper').value = (doc.ink && doc.ink.paper) || 'plain';
    updateInkMeta(doc);
    requestAnimationFrame(() => inkCtl.resize());
  }

  function updateInkMeta(doc) {
    const n = doc.ink && doc.ink.strokes ? doc.ink.strokes.length : 0;
    $('#inkMeta').textContent = 'handwriting · ' + n + ' strokes · edited ' + NoxUI.relTime(doc.updatedAt);
  }

  let inkColorIdx = 0, inkSizeIdx = 1;

  function buildInkToolbar() {
    const colors = $('#inkColors');
    INK_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' on' : '');
      b.style.background = c;
      b.title = c;
      b.onclick = () => {
        inkColorIdx = i;
        inkCtl.setColor(c);
        inkCtl.setEraser(false);
        $('#inkEraser').classList.remove('on');
        $$('#inkColors .swatch').forEach((s, j) => s.classList.toggle('on', j === i));
      };
      colors.appendChild(b);
    });

    const sizes = $('#inkSizes');
    INK_SIZES.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'size-btn' + (i === 1 ? ' on' : '');
      const pip = document.createElement('span');
      pip.className = 'pip';
      const d = Math.min(16, 3 + s);
      pip.style.width = d + 'px';
      pip.style.height = d + 'px';
      b.appendChild(pip);
      b.title = s + 'px';
      b.onclick = () => {
        inkSizeIdx = i;
        inkCtl.setSize(s);
        $$('#inkSizes .size-btn').forEach((x, j) => x.classList.toggle('on', j === i));
      };
      sizes.appendChild(b);
    });

    inkCtl.setColor(INK_COLORS[inkColorIdx]);
    inkCtl.setSize(INK_SIZES[inkSizeIdx]);

    $('#inkEraser').onclick = (e) => {
      const on = !inkCtl.isEraser();
      inkCtl.setEraser(on);
      e.currentTarget.classList.toggle('on', on);
    };
    $('#inkUndo').onclick = () => { if (!inkCtl.undo()) NoxUI.toast('Nothing to undo'); };
    $('#inkClear').onclick = () => {
      NoxUI.confirm('Clear sketch', 'Erase every stroke on this page?', 'Clear', () => inkCtl.clear());
    };
    $('#inkPaper').onchange = (e) => {
      inkCtl.setPaper(e.target.value);
      const d = activeDoc();
      if (d) { d.ink = inkCtl.state(); queueSave(d); }
    };
    $('#inkExport').onclick = () => {
      const d = activeDoc();
      const canvas = inkCtl.exportPNG(2);
      canvas.toBlob((blob) => {
        if (blob) NoxUI.download(blob, NoxUI.slug(d ? titleOf(d) : 'sketch') + '.png');
      }, 'image/png');
    };
  }

  function bindInk() {
    $('#inkTitle').addEventListener('input', (e) => {
      const d = activeDoc();
      if (!d) return;
      d.title = e.target.value;
      queueSave(d);
    });
    window.addEventListener('resize', () => { if (inkCtl && activeDoc() && activeDoc().kind === 'ink') inkCtl.resize(); });
  }

  /* ══════════════════════ mindmap ══════════════════════ */

  function mountMind(doc) {
    $('#mindTitle').value = doc.title || '';
    if (!mindCtl) {
      mindCtl = NoxMind($('#mindSvg'), $('#mindWrap'), $('#mindInput'), {
        onChange: () => {
          const d = activeDoc();
          if (!d || d.kind !== 'mind') return;
          d.mind = mindCtl.state();
          queueSave(d);
          updateMindMeta(d);
        }
      });
      bindMindToolbar();
    }
    requestAnimationFrame(() => {
      mindCtl.load(doc);
      updateMindMeta(doc);
    });
  }

  function updateMindMeta(doc) {
    const n = doc.mind && doc.mind.nodes ? doc.mind.nodes.length : 0;
    $('#mindMeta').textContent = 'mindmap · ' + n + ' nodes · edited ' + NoxUI.relTime(doc.updatedAt);
  }

  function bindMindToolbar() {
    $('#mindAddChild').onclick = () => mindCtl.addChild();
    $('#mindAddSibling').onclick = () => mindCtl.addSibling();
    $('#mindRename').onclick = () => mindCtl.rename();
    $('#mindDelete').onclick = () => mindCtl.remove();
    $('#mindZoomIn').onclick = () => mindCtl.zoom(1);
    $('#mindZoomOut').onclick = () => mindCtl.zoom(-1);
    $('#mindFit').onclick = () => mindCtl.fit();
    $('#mindExport').onclick = () => {
      const d = activeDoc();
      const svg = mindCtl.exportSVG();
      if (!svg) { NoxUI.toast('Nothing to export'); return; }
      NoxUI.downloadText(svg, NoxUI.slug(d ? titleOf(d) : 'mindmap') + '.svg', 'image/svg+xml');
    };
    $('#mindTitle').addEventListener('input', (e) => {
      const d = activeDoc();
      if (!d) return;
      d.title = e.target.value;
      queueSave(d);
    });
  }

  /* ══════════════════════ pdf ══════════════════════ */

  function mountPDF(doc) {
    $('#pdfTitle').value = doc.title || '';
    $('#pdfCaption').value = doc.caption || '';
    $('#pdfMeta').textContent = 'pdf · ' + (doc.pdfName || 'document') + (doc.pdfBlob ? ' · ' + NoxUI.bytes(doc.pdfBlob.size) : '');

    if (!pdfCtl) {
      pdfCtl = NoxPDF($('#pdfPages'), $('#pdfWrap'), {
        onPage: (cur, total) => {
          $('#pdfPageNum').value = cur;
          $('#pdfPageCount').textContent = '/ ' + total;
        }
      });
      bindPDFToolbar();
    }
    requestAnimationFrame(() => requestAnimationFrame(() => pdfCtl.load(doc.pdfBlob)));
  }

  function bindPDFToolbar() {
    $('#pdfPrev').onclick = () => pdfCtl.gotoPage((Number($('#pdfPageNum').value) || 1) - 1);
    $('#pdfNext').onclick = () => pdfCtl.gotoPage((Number($('#pdfPageNum').value) || 1) + 1);
    $('#pdfPageNum').addEventListener('change', (e) => pdfCtl.gotoPage(Number(e.target.value) || 1));
    $('#pdfZoomIn').onclick = () => pdfCtl.zoom(1);
    $('#pdfZoomOut').onclick = () => pdfCtl.zoom(-1);
    $('#pdfFit').onclick = () => pdfCtl.fit();
    $('#pdfReplace').onclick = async () => {
      const d = activeDoc();
      if (!d) return;
      const f = await NoxUI.pickFile('application/pdf');
      if (!f) return;
      d.pdfBlob = f;
      d.pdfName = f.name;
      if (!d.title) d.title = f.name.replace(/\.pdf$/i, '');
      $('#pdfTitle').value = d.title;
      queueSave(d);
      pdfCtl.load(f);
      NoxUI.toast('PDF replaced');
    };
    $('#pdfSaveFile').onclick = () => {
      const d = activeDoc();
      if (!d || !d.pdfBlob) return;
      NoxUI.download(d.pdfBlob, d.pdfName || 'document.pdf');
    };
    $('#pdfTitle').addEventListener('input', (e) => {
      const d = activeDoc();
      if (!d) return;
      d.title = e.target.value;
      queueSave(d);
    });
    $('#pdfCaption').addEventListener('input', (e) => {
      const d = activeDoc();
      if (!d) return;
      d.caption = e.target.value;
      queueSave(d);
    });
  }

  /* ══════════════════════ link ══════════════════════ */

  function mountLink(doc) {
    $('#linkTitle').value = doc.title || '';
    $('#linkUrl').value = doc.url || '';
    $('#linkNotes').value = doc.notes || '';
    updateLinkDomain(doc.url);
    $('#linkMeta').textContent = 'link · edited ' + NoxUI.relTime(doc.updatedAt);
  }

  function updateLinkDomain(url) {
    const host = $('#linkDomain');
    const open = $('#linkOpen');
    if (!url) { host.textContent = 'no destination set'; open.setAttribute('href', '#'); open.style.opacity = '.4'; return; }
    open.style.opacity = '1';
    const full = /^[a-z]+:\/\//i.test(url) ? url : 'https://' + url;
    open.setAttribute('href', full);
    try { host.textContent = new URL(full).hostname; } catch (e) { host.textContent = full; }
  }

  function bindLink() {
    $('#linkTitle').addEventListener('input', (e) => {
      const d = activeDoc();
      if (!d) return;
      d.title = e.target.value;
      queueSave(d);
    });
    $('#linkUrl').addEventListener('input', (e) => {
      const d = activeDoc();
      if (!d) return;
      d.url = e.target.value;
      updateLinkDomain(d.url);
      queueSave(d);
    });
    $('#linkNotes').addEventListener('input', (e) => {
      const d = activeDoc();
      if (!d) return;
      d.notes = e.target.value;
      queueSave(d);
    });
    $('#linkCopy').onclick = async () => {
      const v = $('#linkUrl').value.trim();
      if (!v) return;
      try {
        await navigator.clipboard.writeText(v);
        NoxUI.toast('Copied');
      } catch (e) {
        NoxUI.toast('Copy blocked by the browser');
      }
    };
  }

  /* ══════════════════════ create / delete ══════════════════════ */

  async function createDoc(kind, opts) {
    opts = opts || {};
    const now = Date.now();
    const doc = {
      id: NoxUI.uid(),
      kind: kind,
      title: opts.title || '',
      html: '',
      tags: opts.tags || [],
      pinned: false,
      trashed: false,
      createdAt: now,
      updatedAt: now
    };

    if (kind === 'ink') doc.ink = { strokes: [], paper: 'ruled' };
    if (kind === 'mind') doc.mind = { nodes: [], view: null };
    if (kind === 'link') { doc.url = ''; doc.notes = ''; }
    if (kind === 'pdf') {
      const file = await NoxUI.pickFile('application/pdf');
      if (!file) return null;
      doc.pdfBlob = file;
      doc.pdfName = file.name;
      doc.title = opts.title || file.name.replace(/\.pdf$/i, '');
    }

    state.docs.push(doc);
    await NoxDB.put(doc);
    renderList();
    updateCounts();
    openDoc(doc.id);

    if (kind === 'rich') setTimeout(() => $('#richTitle').focus(), 80);
    if (kind === 'link') setTimeout(() => $('#linkUrl').focus(), 80);
    return doc;
  }

  async function trashActive() {
    const doc = activeDoc();
    if (!doc) return;
    if (!doc.trashed) {
      doc.trashed = true;
      queueSave(doc);
      await saveNow(doc);
      NoxUI.toast('Moved to trash');
      state.activeId = null;
      showView(null);
      syncAppbar(null);
      renderList();
      updateCounts();
    } else {
      NoxUI.confirm('Delete forever', 'This removes "' + titleOf(doc) + '" from this device permanently.', 'Delete', async () => {
        await NoxDB.remove(doc.id);
        state.docs = state.docs.filter((d) => d.id !== doc.id);
        state.activeId = null;
        showView(null);
        syncAppbar(null);
        renderList();
        updateCounts();
        NoxUI.toast('Deleted');
      });
    }
  }

  async function duplicateActive() {
    const doc = activeDoc();
    if (!doc) return;
    const copy = JSON.parse(JSON.stringify(doc));
    // blobs do not survive JSON — carry them across explicitly
    copy.pdfBlob = doc.pdfBlob || null;
    copy.id = NoxUI.uid();
    copy.title = titleOf(doc) + ' (copy)';
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.pinned = false;
    state.docs.push(copy);
    await NoxDB.put(copy);
    renderList();
    updateCounts();
    openDoc(copy.id);
    NoxUI.toast('Duplicated');
  }

  function openDocMenu() {
    const doc = activeDoc();
    if (!doc) { NoxUI.toast('Open a note first'); return; }
    const tags = (doc.tags || []).join(', ');
    NoxUI.modal({
      title: titleOf(doc),
      body:
        '<div class="field"><label>Tags (comma separated)</label><input type="text" id="mTags" value="' + NoxUI.escape(tags) + '" placeholder="idea, research" /></div>' +
        '<div class="btn-row" style="margin-top:4px">' +
          '<button class="ghost-btn" id="mDup">Duplicate</button>' +
          '<button class="ghost-btn" id="mExp">Export</button>' +
          '<button class="ghost-btn" id="mPin">' + (doc.trashed ? 'Restore' : (doc.pinned ? 'Unpin' : 'Pin to top')) + '</button>' +
        '</div>' +
        '<p style="margin:14px 0 0;font-size:11.5px;color:#6a645f">Created ' + NoxUI.fullTime(doc.createdAt) + ' · edited ' + NoxUI.fullTime(doc.updatedAt) + '</p>',
      actions: [
        { label: 'Cancel' },
        { label: 'Save', primary: true, onClick: (b) => {
            const raw = b.querySelector('#mTags').value;
            doc.tags = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
            queueSave(doc);
            saveNow(doc);
            renderList();
            updateCounts();
            NoxUI.toast('Tags updated');
          } }
      ],
      onMount: (b) => {
        b.querySelector('#mDup').onclick = () => { NoxUI.closeModal(); duplicateActive(); };
        b.querySelector('#mExp').onclick = () => { NoxUI.closeModal(); exportActive(); };
        b.querySelector('#mPin').onclick = () => {
          if (doc.trashed) {
            doc.trashed = false;
            queueSave(doc);
            saveNow(doc);
            syncAppbar(doc);
            renderList();
            updateCounts();
            NoxUI.closeModal();
            NoxUI.toast('Restored');
            return;
          }
          doc.pinned = !doc.pinned;
          queueSave(doc);
          saveNow(doc);
          syncAppbar(doc);
          renderList();
          NoxUI.closeModal();
        };
      }
    });
  }

  function exportActive() {
    const doc = activeDoc();
    if (!doc) return;
    const base = NoxUI.slug(titleOf(doc));
    if (doc.kind === 'rich') {
      NoxUI.downloadText(
        '<!doctype html><meta charset="utf-8"><title>' + NoxUI.escape(titleOf(doc)) + '</title>' +
        '<style>body{background:#0b0b0d;color:#cfc7bb;font:16px/1.75 Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px}a{color:#ff2d4b}</style>' +
        '<h1>' + NoxUI.escape(titleOf(doc)) + '</h1>' + (doc.html || ''),
        base + '.html', 'text/html;charset=utf-8');
    } else if (doc.kind === 'ink' && inkCtl) {
      inkCtl.exportPNG(2).toBlob((blob) => { if (blob) NoxUI.download(blob, base + '.png'); }, 'image/png');
    } else if (doc.kind === 'mind' && mindCtl) {
      NoxUI.downloadText(mindCtl.exportSVG(), base + '.svg', 'image/svg+xml');
    } else if (doc.kind === 'pdf' && doc.pdfBlob) {
      NoxUI.download(doc.pdfBlob, doc.pdfName || base + '.pdf');
    } else if (doc.kind === 'link') {
      NoxUI.downloadText(doc.url + '\n\n' + (doc.notes || ''), base + '.txt');
    }
  }

  /* ══════════════════════ backup / settings ══════════════════════ */

  function blobToDataURL(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  }

  async function exportBackup() {
    const out = { app: 'project-nox', version: 1, exportedAt: new Date().toISOString(), docs: [] };
    for (const d of state.docs) {
      const copy = Object.assign({}, d);
      if (d.pdfBlob) {
        copy.pdfBlob = null;
        copy.pdfData = await blobToDataURL(d.pdfBlob);
      }
      out.docs.push(copy);
    }
    NoxUI.downloadText(JSON.stringify(out, null, 2), 'nox-backup-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
    NoxUI.toast('Backup downloaded');
  }

  async function importBackup() {
    const file = await NoxUI.pickFile('application/json,.json');
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      NoxUI.toast('That file is not valid NOX JSON');
      return;
    }
    const docs = Array.isArray(parsed.docs) ? parsed.docs : (Array.isArray(parsed) ? parsed : null);
    if (!docs) { NoxUI.toast('No notes found in that file'); return; }

    let added = 0;
    for (const raw of docs) {
      if (!raw || !raw.id) continue;
      if (state.docs.some((d) => d.id === raw.id)) continue;
      const d = Object.assign({}, raw);
      if (raw.pdfData) {
        const res = await fetch(raw.pdfData);
        d.pdfBlob = await res.blob();
        delete d.pdfData;
      }
      state.docs.push(d);
      added++;
    }
    await NoxDB.bulkPut(state.docs);
    renderList();
    updateCounts();
    NoxUI.toast(added + ' notes imported');
  }

  async function openSettings() {
    const est = await NoxDB.estimate();
    const used = est ? NoxUI.bytes(est.usage) : '—';
    const quota = est ? NoxUI.bytes(est.quota) : '—';
    const counts = { rich: 0, ink: 0, mind: 0, pdf: 0, link: 0 };
    state.docs.forEach((d) => { if (!d.trashed) counts[d.kind] = (counts[d.kind] || 0) + 1; });

    NoxUI.modal({
      title: 'Settings & backup',
      body:
        '<div class="stat-grid">' +
          '<div class="stat"><b>' + state.docs.filter((d) => !d.trashed).length + '</b><span>notes</span></div>' +
          '<div class="stat"><b>' + used + '</b><span>used</span></div>' +
          '<div class="stat"><b>' + quota + '</b><span>device quota</span></div>' +
        '</div>' +
        '<p style="margin:0 0 14px;font-size:12px;color:#6a645f">' + counts.rich + ' notes · ' + counts.ink + ' sketches · ' +
          counts.mind + ' mindmaps · ' + counts.pdf + ' pdfs · ' + counts.link + ' links</p>' +
        '<div class="btn-row">' +
          '<button class="ghost-btn" id="sExport">Export backup (.json)</button>' +
          '<button class="ghost-btn" id="sImport">Import backup</button>' +
          '<button class="ghost-btn" id="sPersist">Protect from cleanup</button>' +
          '<button class="ghost-btn" id="sWipe">Erase everything</button>' +
        '</div>' +
        '<p style="margin:16px 0 0;font-size:11.5px;line-height:1.7;color:#5a544f">' +
          'Project NOX keeps every note in this browser\'s IndexedDB. Nothing is uploaded. ' +
          'Clearing site data, using private mode, or a browser storage sweep can remove notes — ' +
          'export a backup now and then, and install the app so the browser keeps its storage.' +
        '</p>',
      actions: [{ label: 'Close', primary: true }],
      onMount: (b) => {
        b.querySelector('#sExport').onclick = () => { NoxUI.closeModal(); exportBackup(); };
        b.querySelector('#sImport').onclick = () => { NoxUI.closeModal(); importBackup(); };
        b.querySelector('#sPersist').onclick = async () => {
          const ok = await NoxDB.persist();
          NoxUI.toast(ok ? 'Storage is now persistent' : 'Browser declined — install the app first');
        };
        b.querySelector('#sWipe').onclick = () => {
          NoxUI.closeModal();
          NoxUI.confirm('Erase everything', 'Every note, sketch, mindmap and PDF on this device will be deleted. Export a backup first if you are unsure.', 'Erase all', async () => {
            await NoxDB.clear();
            state.docs = [];
            state.activeId = null;
            showView(null);
            syncAppbar(null);
            renderList();
            updateCounts();
            NoxUI.toast('Everything erased');
          });
        };
      }
    });
  }

  /* ══════════════════════ wiring ══════════════════════ */

  function bindShell() {
    // new note buttons (sidebar, empty state, fab)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-new]');
      if (!b) return;
      e.preventDefault();
      createDoc(b.dataset.new);
      setNav(false);
    });

    // doc list
    $('#docList').addEventListener('click', (e) => {
      const row = e.target.closest('.doc-item');
      if (row) openDoc(row.dataset.id);
    });
    $('#docList').addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.doc-item');
      if (!row) return;
      e.preventDefault();
      openDoc(row.dataset.id).then(() => openDocMenu());
    });

    // filters
    $('#filters').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.filter = b.dataset.filter;
      state.tag = null;
      $$('#filters button').forEach((x) => x.classList.toggle('active', x === b));
      renderTags();
      renderList();
      setNav(false);
    });

    // search
    const search = $('#search');
    search.addEventListener('input', () => {
      state.query = search.value;
      renderList();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { search.value = ''; state.query = ''; renderList(); search.blur(); }
      if (e.key === 'Enter') {
        const first = visibleDocs()[0];
        if (first) { openDoc(first.id); search.blur(); }
      }
    });

    // appbar
    $('#btnPin').onclick = () => {
      const d = activeDoc();
      if (!d) return;
      d.pinned = !d.pinned;
      queueSave(d);
      saveNow(d);
      syncAppbar(d);
      renderList();
      NoxUI.toast(d.pinned ? 'Pinned' : 'Unpinned');
    };
    $('#btnTrash').onclick = trashActive;
    $('#btnMore').onclick = openDocMenu;
    $('#btnSettings').onclick = openSettings;

    // mobile nav
    $('#openSidebar').onclick = () => setNav(true);
    $('#closeSidebar').onclick = () => setNav(false);
    $('#scrim').onclick = () => setNav(false);

    // fab = quick new note
    $('#fab').onclick = () => createDoc('rich');

    // modal close
    $('#modalRoot').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) NoxUI.closeModal();
    });

    // keyboard
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); search.select(); }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); createDoc('rich'); }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flushAll().then(() => NoxUI.toast('Saved')); }
      if (e.key === 'Escape') {
        if (!$('#modalRoot').hidden) NoxUI.closeModal();
        else setNav(false);
      }
    });

    // save when the tab hides or closes
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
    window.addEventListener('pagehide', flushAll);

    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
  }

  function updateNet() {
    const b = $('#netBadge');
    if (!b) return;
    const online = navigator.onLine;
    b.classList.toggle('online', online);
    b.innerHTML = '<span class="dot"></span> ' + (online ? 'synced locally · online' : 'offline ready');
  }

  /* ══════════════════════ seed ══════════════════════ */

  async function seed() {
    const now = Date.now();
    const welcome = {
      id: NoxUI.uid(),
      kind: 'rich',
      title: 'Welcome to NOX',
      pinned: true,
      trashed: false,
      tags: ['start-here'],
      createdAt: now,
      updatedAt: now,
      html:
        '<p>This notebook lives entirely on your device. Nothing leaves it.</p>' +
        '<h2>What you can make</h2>' +
        '<ul>' +
          '<li><b>Notes</b> — rich text with headings, lists, quotes, code and highlights.</li>' +
          '<li><b>Sketches</b> — pressure-aware handwriting, ruled or gridded paper.</li>' +
          '<li><b>Mindmaps</b> — drag nodes, pan, zoom, export as SVG.</li>' +
          '<li><b>PDFs</b> — imported and rendered locally, even offline.</li>' +
          '<li><b>Links</b> — a bookmark plus the reason you kept it.</li>' +
        '</ul>' +
        '<h2>Link your thoughts</h2>' +
        '<p>Type <code>[[Note title]]</code> to point at another note. Here is a real one: [[Scratchpad]]. ' +
        'Click the amber link to jump there — if no note has that title yet, NOX creates it. ' +
        'Backlinks appear along the bottom of the page.</p>' +
        '<blockquote>Notes are only useful when you can find them again. Pin the ones that matter, tag the rest.</blockquote>' +
        '<h2>Keep it safe</h2>' +
        '<p>Open <b>Settings &amp; backup</b> and export a backup now and then. Browser storage is durable, but it is not eternal.</p>'
    };
    const scratch = {
      id: NoxUI.uid(),
      kind: 'rich',
      title: 'Scratchpad',
      pinned: false,
      trashed: false,
      tags: [],
      createdAt: now,
      updatedAt: now - 1000,
      html: '<p>A page for the things that do not deserve their own note yet.</p>' +
            '<ul><li>Ideas to test</li><li>Half-lines worth keeping</li></ul>' +
            '<p>Back to [[Welcome to NOX]].</p>'
    };

    state.docs.push(welcome, scratch);
    await NoxDB.put(welcome);
    await NoxDB.put(scratch);
  }

  /* ══════════════════════ boot ══════════════════════ */

  async function boot() {
    try {
      state.docs = await NoxDB.all();
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;font-family:Georgia,serif;color:#ece6dc;background:#0a0a0b;height:100vh">' +
        '<h2 style="color:#c8102e">Storage unavailable</h2>' +
        '<p>NOX needs IndexedDB. If you opened the file directly from disk, serve it over http:// or install it as an app instead.</p></div>';
      return;
    }

    if (!state.docs.length) await seed();

    bindShell();
    bindRich();
    bindInk();
    bindLink();

    renderList();
    updateCounts();
    updateNet();
    syncAppbar(null);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    const params = new URLSearchParams(location.search);
    const wanted = params.get('new');
    if (wanted && KIND_ICON[wanted]) {
      createDoc(wanted);
      history.replaceState({}, '', location.pathname);
    } else {
      const recent = state.docs.filter((d) => !d.trashed).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      if (recent) openDoc(recent.id);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
