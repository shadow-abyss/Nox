/* Project NOX — handwriting engine.
   Pressure-aware pointer ink on a canvas, stored as resolution-independent strokes
   so a sketch reopens and rescales exactly on any screen. */
(function () {
  'use strict';

  const BG = '#0b0b0d';
  const RULE = 'rgba(200,16,46,0.13)';

  function NoxInk(canvas, wrap, hooks) {
    hooks = hooks || {};
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');

    let W = 0, H = 0, dpr = 1;
    let strokes = [];
    let current = null;
    let color = '#e8e2d9';
    let size = 3;
    let eraser = false;
    let paper = 'plain';
    let drawing = false;
    let activeId = null;

    const onChange = hooks.onChange || function () {};
    const notify = () => onChange();

    function applyPaper(p) {
      paper = p || 'plain';
      wrap.className = 'canvas-wrap ' + paper;
    }

    /* ── geometry ── */
    function resize() {
      const rect = wrap.getBoundingClientRect();
      const nw = Math.max(1, Math.round(rect.width));
      const nh = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      if (nw === W && nh === H) return;
      W = nw; H = nh;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      off.width = canvas.width;
      off.height = canvas.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawAll();
    }

    function styleCtx(c, st, pr) {
      c.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
      c.strokeStyle = st.c;
      c.fillStyle = st.c;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = Math.max(0.6, st.w * pr);
    }

    function paintStroke(c, st) {
      const p = st.p;
      if (!p.length) return;
      if (p.length === 1) {
        styleCtx(c, st, p[0][2] || 1);
        c.beginPath();
        c.arc(p[0][0] * W, p[0][1] * H, Math.max(0.6, st.w * (p[0][2] || 1)) / 2, 0, Math.PI * 2);
        c.fill();
        return;
      }
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i];
        styleCtx(c, st, (b[2] || 1));
        c.beginPath();
        c.moveTo(a[0] * W, a[1] * H);
        c.lineTo(b[0] * W, b[1] * H);
        c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
    }

    function commitToOffscreen(st) {
      paintStroke(octx, st);
      octx.globalCompositeOperation = 'source-over';
    }

    function redrawAll() {
      octx.clearRect(0, 0, W, H);
      strokes.forEach((st) => commitToOffscreen(st));
      render();
    }

    function render() {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0, W, H);
      if (current) paintStroke(ctx, current);
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ── pointer input ── */
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      let pr = 0.55;
      if (e.pointerType === 'pen' && e.pressure > 0) pr = Math.max(0.12, e.pressure * 1.5);
      else if (e.pointerType === 'touch') pr = 0.75;
      return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), pr];
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      current = { p: [pos(e)], c: eraser ? '#000' : color, w: eraser ? size * 5 : size, e: eraser ? 1 : 0 };
      render();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !current) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const p = pos(ev);
        const last = current.p[current.p.length - 1];
        if (Math.abs(p[0] - last[0]) * W < 0.6 && Math.abs(p[1] - last[1]) * H < 0.6) continue;
        current.p.push(p);
      }
      render();
    });

    function endStroke(e) {
      if (!drawing) return;
      drawing = false;
      if (current) {
        if (current.p.length > 0) {
          strokes.push(current);
          commitToOffscreen(current);
        }
        current = null;
        render();
        notify();
      }
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', (e) => { if (drawing && e.buttons === 0) endStroke(e); });

    window.addEventListener('resize', () => { resize(); });

    /* ── public api ── */
    const api = {
      load(doc) {
        const s = (doc && doc.ink) || {};
        strokes = Array.isArray(s.strokes) ? s.strokes : [];
        applyPaper(s.paper || 'plain');
        resize();
        redrawAll();
      },
      state() {
        return { strokes: strokes.slice(), paper: paper };
      },
      setColor(c) { color = c; eraser = false; },
      setSize(s) { size = s; },
      setEraser(on) { eraser = !!on; },
      isEraser() { return eraser; },
      setPaper: applyPaper,
      getPaper() { return paper; },
      undo() {
        if (!strokes.length) return false;
        strokes.pop();
        redrawAll();
        notify();
        return true;
      },
      clear() {
        strokes = [];
        redrawAll();
        notify();
      },
      isEmpty() { return strokes.length === 0; },
      strokeCount() { return strokes.length; },
      resize,
      exportPNG(scale) {
        scale = scale || 2;
        const c = document.createElement('canvas');
        c.width = Math.round(W * scale);
        c.height = Math.round(H * scale);
        const g = c.getContext('2d');
        g.fillStyle = BG;
        g.fillRect(0, 0, c.width, c.height);
        g.save();
        g.scale(scale, scale);
        if (paper === 'ruled' || paper === 'grid' || paper === 'dots') {
          g.strokeStyle = RULE;
          g.lineWidth = 1;
          if (paper === 'ruled' || paper === 'grid') {
            for (let y = 32; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
          }
          if (paper === 'grid') {
            for (let x = 32; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
          }
          if (paper === 'dots') {
            g.fillStyle = 'rgba(200,16,46,0.35)';
            for (let x = 26; x < W; x += 26) for (let y = 26; y < H; y += 26) {
              g.beginPath(); g.arc(x, y, 1, 0, Math.PI * 2); g.fill();
            }
          }
        }
        g.drawImage(off, 0, 0, W, H);
        g.restore();
        return c;
      }
    };

    resize();
    return api;
  }

  window.NoxInk = NoxInk;
})();
