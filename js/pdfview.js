/* Project NOX — PDF viewer.
   Renders PDFs locally with the bundled pdf.js worker (no CDN, no network). */
(function () {
  'use strict';

  if (window.pdfjsLib) {
    // Configured at parse time: the worker then spins up in the background while
    // the rest of the app boots, instead of stalling the first document open.
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  function NoxPDF(pagesEl, wrapEl, hooks) {
    hooks = hooks || {};
    const onPage = hooks.onPage || function () {};

    let pdfDoc = null;
    let scale = 1;
    let pages = [];          // { el, canvas, ctx, rendered, task, vp }
    let observer = null;
    let current = 1;
    let baseWidth = 0;
    let loadSeq = 0;

    function teardown() {
      if (observer) { observer.disconnect(); observer = null; }
      pages.forEach((p) => { if (p.task) { try { p.task.cancel(); } catch (e) {} } });
      pages = [];
      pagesEl.innerHTML = '';
      pdfDoc = null;
    }

    function fitScale(vpWidth) {
      // A hidden view reports clientWidth 0 — fall back to a sane page width and
      // let the ResizeObserver below re-fit once the view is actually on screen.
      const cw = wrapEl.clientWidth;
      const avail = cw > 120 ? cw - 36 : 900;
      return Math.min(2.4, Math.max(0.25, avail / vpWidth));
    }

    function visibleRange() {
      const top = wrapEl.scrollTop;
      const bottom = top + (wrapEl.clientHeight || 900);
      return { top: top - 400, bottom: bottom + 400 };
    }

    function renderVisible() {
      const r = visibleRange();
      pages.forEach((rec, i) => {
        const t = rec.el.offsetTop;
        const b = t + (rec.el.offsetHeight || 0);
        if (b > r.top && t < r.bottom) renderPage(i);
      });
    }

    async function load(blob) {
      const token = ++loadSeq;
      teardown();
      if (!window.pdfjsLib) {
        pagesEl.innerHTML = '<div class="pdf-loading">pdf engine not loaded</div>';
        return;
      }
      if (!blob) { pagesEl.innerHTML = '<div class="pdf-loading">no file attached</div>'; return; }
      pagesEl.innerHTML = '<div class="pdf-loading">opening…</div>';

      let buf;
      try {
        buf = await blob.arrayBuffer();
      } catch (e) {
        pagesEl.innerHTML = '<div class="pdf-loading">could not read file</div>';
        return;
      }

      try {
        pdfDoc = await window.pdfjsLib.getDocument({ data: buf, disableAutoFetch: true }).promise;
      } catch (e) {
        if (token === loadSeq) pagesEl.innerHTML = '<div class="pdf-loading">this file could not be opened</div>';
        return;
      }
      if (token !== loadSeq) return;   // a newer load started while this one was opening

      const first = await pdfDoc.getPage(1);
      const vp1 = first.getViewport({ scale: 1 });
      baseWidth = vp1.width;
      scale = fitScale(baseWidth);
      pagesEl.innerHTML = '';

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const div = document.createElement('div');
        div.className = 'pdf-page';
        div.setAttribute('data-i', i);
        const num = document.createElement('span');
        num.className = 'pnum';
        num.textContent = i;
        const canvas = document.createElement('canvas');
        div.appendChild(num);
        div.appendChild(canvas);
        pagesEl.appendChild(div);
        const rec = { el: div, canvas, ctx: canvas.getContext('2d'), rendered: false, task: null, num };
        pages.push(rec);
      }

      // size every page first, then start observing — otherwise a page can be
      // rendered and then wiped by the sizing pass, leaving a blank sheet.
      await sizeAll();
      if (token !== loadSeq) return;

      observer = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) renderPage(Number(en.target.getAttribute('data-i')));
        });
      }, { root: wrapEl, rootMargin: '300px 0px' });
      pages.forEach((rec) => observer.observe(rec.el));

      onPage(1, pdfDoc.numPages);
      current = 1;
      wrapEl.scrollTop = 0;
      lastWrapW = wrapEl.clientWidth;
      renderVisible();
    }

    // Re-fit whenever the viewer is resized, rotated, or revealed (e.g. opening
    // the note on a phone where the view starts hidden).
    let lastWrapW = 0;
    const ro = new ResizeObserver(() => {
      const w = wrapEl.clientWidth;
      if (!pdfDoc || w === lastWrapW) return;
      lastWrapW = w;
      const next = fitScale(baseWidth);
      if (Math.abs(next - scale) > 0.02) {
        scale = next;
        sizeAll().then(() => { renderVisible(); });
      }
    });
    ro.observe(wrapEl);

    async function sizeAll() {
      const token = loadSeq;
      if (!pdfDoc) return;
      const first = await pdfDoc.getPage(1);
      if (token !== loadSeq) return;
      const vp = first.getViewport({ scale });
      for (let i = 0; i < pages.length; i++) {
        const rec = pages[i];
        const page = i === 0 ? first : await pdfDoc.getPage(i + 1);
        if (token !== loadSeq) return;
        const v = page.getViewport({ scale });
        rec.vp = v;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        rec.canvas.width = Math.round(v.width * dpr);
        rec.canvas.height = Math.round(v.height * dpr);
        rec.canvas.style.width = Math.round(v.width) + 'px';
        rec.canvas.style.height = Math.round(v.height) + 'px';
        rec.rendered = false;
        rec.ctx.setTransform(1, 0, 0, 1, 0, 0);
        rec.ctx.clearRect(0, 0, rec.canvas.width, rec.canvas.height);
      }
      void vp;
    }

    async function renderPage(index) {
      const rec = pages[index];
      if (!rec || !pdfDoc || rec.rendered || rec.task) return;
      const token = loadSeq;
      try {
        const page = await pdfDoc.getPage(index + 1);
        if (token !== loadSeq || !pdfDoc) return;
        const v = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        rec.canvas.width = Math.round(v.width * dpr);
        rec.canvas.height = Math.round(v.height * dpr);
        rec.canvas.style.width = Math.round(v.width) + 'px';
        rec.canvas.style.height = Math.round(v.height) + 'px';
        const ctx = rec.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, rec.canvas.width, rec.canvas.height);
        const params = { canvasContext: ctx, viewport: v };
        if (dpr !== 1) params.transform = [dpr, 0, 0, dpr, 0, 0];
        rec.task = page.render(params);
        await rec.task.promise;
        rec.rendered = true;
      } catch (e) {
        /* cancelled renders are expected while scrolling fast */
      } finally {
        if (rec) rec.task = null;
      }
    }

    async function setScale(next) {
      if (!pdfDoc) return;
      scale = Math.min(4, Math.max(0.2, next));
      await sizeAll();
      renderVisible();
    }

    async function fit() {
      if (!pdfDoc) return;
      await setScale(fitScale(baseWidth));
    }

    function gotoPage(n) {
      if (!pages.length) return;
      const idx = Math.min(pages.length - 1, Math.max(0, (n | 0) - 1));
      const rec = pages[idx];
      if (!rec) return;
      wrapEl.scrollTo({ top: rec.el.offsetTop - 12, behavior: 'smooth' });
      current = idx + 1;
      onPage(current, pages.length);
      renderPage(idx);
    }

    wrapEl.addEventListener('scroll', () => {
      if (!pages.length) return;
      const top = wrapEl.scrollTop + 40;
      let best = 0;
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].el.offsetTop <= top) best = i;
      }
      if (best + 1 !== current) {
        current = best + 1;
        onPage(current, pages.length);
      }
    }, { passive: true });

    window.addEventListener('resize', () => {
      if (!pdfDoc) return;
      if (wrapEl.clientWidth !== lastWrapW) {
        lastWrapW = wrapEl.clientWidth;
        setScale(fitScale(baseWidth));
      }
    });

    return {
      load,
      fit,
      gotoPage,
      zoom: (dir) => setScale(scale * (dir > 0 ? 1.2 : 1 / 1.2)),
      destroy: teardown,
      pageCount: () => (pdfDoc ? pdfDoc.numPages : 0)
    };
  }

  window.NoxPDF = NoxPDF;
})();
