/* Project NOX — mindmap engine.
   A small SVG graph: draggable nodes, bezier edges, pan/zoom, editable labels.
   State is plain JSON ({nodes, view}) so it saves straight into IndexedDB. */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function NoxMind(svg, wrap, input, hooks) {
    hooks = hooks || {};
    const world = svg.querySelector('#mindWorld');
    const onChange = hooks.onChange || function () {};

    let nodes = [];
    let view = { x: 0, y: 0, k: 1 };
    let selectedId = null;
    let drag = null;      // {type:'node'|'pan', ...}
    let raf = 0;
    let editingId = null;

    function uid() { return 'm_' + Math.random().toString(36).slice(2, 9); }

    function nodeById(id) { return nodes.find((n) => n.id === id) || null; }
    function children(id) { return nodes.filter((n) => n.parent === id); }
    function root() { return nodes.find((n) => !n.parent) || nodes[0] || null; }

    function widthOf(n) {
      const t = String(n.text || '');
      return Math.min(260, Math.max(96, t.length * 7.6 + 30));
    }
    const H = 34;

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; render(); });
    }

    function render() {
      const frag = document.createDocumentFragment();
      const map = {};
      nodes.forEach((n) => { map[n.id] = n; });

      // edges first so nodes sit above them
      nodes.forEach((n) => {
        if (!n.parent || !map[n.parent]) return;
        const p = map[n.parent];
        const pw = widthOf(p) / 2, cw = widthOf(n) / 2;
        const right = n.x >= p.x;
        const x1 = p.x + (right ? pw : -pw), y1 = p.y;
        const x2 = n.x + (right ? -cw : cw), y2 = n.y;
        const mx = (x1 + x2) / 2;
        const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
        const sel = selectedId && (n.id === selectedId || p.id === selectedId);
        frag.appendChild(el('path', { d, class: 'mind-edge' + (sel ? ' sel' : '') }));
      });

      nodes.forEach((n) => {
        const w = widthOf(n);
        const isRoot = !n.parent;
        const g = el('g', {
          class: 'mind-node' + (isRoot ? ' root' : '') + (n.id === selectedId ? ' sel' : ''),
          'data-id': n.id,
          transform: `translate(${n.x},${n.y})`
        });
        g.appendChild(el('rect', { x: -w / 2, y: -H / 2, width: w, height: H, rx: 5 }));
        const t = el('text', { 'text-anchor': 'middle', dy: '0.35em' });
        const label = String(n.text || '');
        t.textContent = label.length > 30 ? label.slice(0, 29) + '…' : label;
        g.appendChild(t);
        frag.appendChild(g);
      });

      world.innerHTML = '';
      world.appendChild(frag);
      world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    }

    function screenToWorld(clientX, clientY) {
      const r = svg.getBoundingClientRect();
      return {
        x: (clientX - r.left - view.x) / view.k,
        y: (clientY - r.top - view.y) / view.k
      };
    }

    /* ── pan / zoom ── */
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k2 = Math.min(2.6, Math.max(0.22, view.k * factor));
      view.x = mx - (mx - view.x) * (k2 / view.k);
      view.y = my - (my - view.y) * (k2 / view.k);
      view.k = k2;
      schedule();
      saveView();
    }, { passive: false });

    const saveView = () => onChange();

    /* ── pointer ── */
    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mind-input')) return;
      const nodeEl = e.target.closest('.mind-node');
      svg.setPointerCapture(e.pointerId);

      if (nodeEl) {
        const id = nodeEl.getAttribute('data-id');
        select(id);
        const n = nodeById(id);
        drag = { type: 'node', id, ox: n.x, oy: n.y, sx: e.clientX, sy: e.clientY, moved: false };
      } else {
        drag = { type: 'pan', vx: view.x, vy: view.y, sx: e.clientX, sy: e.clientY, moved: false };
        svg.classList.add('dragging');
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      if (drag.type === 'node') {
        const n = nodeById(drag.id);
        if (!n) return;
        n.x = Math.round(drag.ox + dx / view.k);
        n.y = Math.round(drag.oy + dy / view.k);
      } else {
        view.x = drag.vx + dx;
        view.y = drag.vy + dy;
      }
      schedule();
    });

    function endDrag() {
      if (!drag) return;
      if (drag.type === 'node' && drag.moved) onChange();
      if (drag.type === 'pan' && drag.moved) onChange();
      drag = null;
      svg.classList.remove('dragging');
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    svg.addEventListener('dblclick', (e) => {
      const nodeEl = e.target.closest('.mind-node');
      if (nodeEl) {
        beginRename(nodeEl.getAttribute('data-id'));
      } else {
        const p = screenToWorld(e.clientX, e.clientY);
        addNode(p.x, p.y, selectedId || (root() && root().id));
      }
    });

    /* ── inline rename ── */
    function beginRename(id) {
      const n = nodeById(id);
      if (!n) return;
      editingId = id;
      const r = svg.getBoundingClientRect();
      const sx = n.x * view.k + view.x + r.left;
      const sy = n.y * view.k + view.y + r.top;
      input.value = n.text || '';
      input.style.display = 'block';
      input.style.left = Math.max(8, sx - 90) + 'px';
      input.style.top = Math.max(8, sy - 18) + 'px';
      input.focus();
      input.select();
    }

    function commitRename() {
      if (!editingId) return;
      const n = nodeById(editingId);
      const v = input.value.trim();
      if (n) { n.text = v || 'Untitled'; onChange(); }
      editingId = null;
      input.style.display = 'none';
      schedule();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      if (e.key === 'Escape') { editingId = null; input.style.display = 'none'; }
      e.stopPropagation();
    });
    input.addEventListener('blur', commitRename);

    /* ── model ops ── */
    function select(id) {
      selectedId = id;
      schedule();
    }

    function addNode(x, y, parentId) {
      const n = { id: uid(), x: Math.round(x), y: Math.round(y), text: 'New idea', parent: parentId || null };
      nodes.push(n);
      selectedId = n.id;
      onChange();
      schedule();
      beginRename(n.id);
      return n;
    }

    function addChild(parentId) {
      const p = nodeById(parentId) || root();
      if (!p) return addNode(0, 0, null);
      const kids = children(p.id);
      const x = p.x + 210;
      const y = p.y + (kids.length ? kids.length * 62 - ((kids.length - 1) * 62) / 2 : 0);
      return addNode(x, y, p.id);
    }

    function addSibling(id) {
      const n = nodeById(id) || root();
      if (!n) return addNode(0, 0, null);
      if (!n.parent) return addNode(n.x + 210, n.y + 62, null);
      return addNode(n.x, n.y + 62, n.parent);
    }

    function removeSelected() {
      const n = nodeById(selectedId);
      if (!n) return;
      // remove descendants too
      const doomed = new Set([n.id]);
      let grew = true;
      while (grew) {
        grew = false;
        nodes.forEach((m) => {
          if (m.parent && doomed.has(m.parent) && !doomed.has(m.id)) { doomed.add(m.id); grew = true; }
        });
      }
      nodes = nodes.filter((m) => !doomed.has(m.id));
      selectedId = null;
      if (!nodes.length) {
        nodes = [{ id: uid(), x: 0, y: 0, text: 'Central idea', parent: null }];
      }
      onChange();
      schedule();
    }

    function fit() {
      if (!nodes.length) return;
      const r = svg.getBoundingClientRect();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach((n) => {
        const w = widthOf(n);
        minX = Math.min(minX, n.x - w / 2);
        maxX = Math.max(maxX, n.x + w / 2);
        minY = Math.min(minY, n.y - H / 2);
        maxY = Math.max(maxY, n.y + H / 2);
      });
      const pad = 60;
      const k = Math.min(1.4, Math.max(0.25, Math.min(
        (r.width - pad * 2) / Math.max(1, maxX - minX),
        (r.height - pad * 2) / Math.max(1, maxY - minY)
      )));
      view.k = k;
      view.x = r.width / 2 - ((minX + maxX) / 2) * k;
      view.y = r.height / 2 - ((minY + maxY) / 2) * k;
      schedule();
      onChange();
    }

    function exportSVG() {
      if (!nodes.length) return '';
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach((n) => {
        const w = widthOf(n);
        minX = Math.min(minX, n.x - w / 2); maxX = Math.max(maxX, n.x + w / 2);
        minY = Math.min(minY, n.y - H / 2); maxY = Math.max(maxY, n.y + H / 2);
      });
      const pad = 40;
      const W = maxX - minX + pad * 2, Hh = maxY - minY + pad * 2;
      const ox = -minX + pad, oy = -minY + pad;
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(Hh)}" viewBox="0 0 ${Math.round(W)} ${Math.round(Hh)}">`;
      out += `<rect width="100%" height="100%" fill="#0b0b0d"/>`;
      out += `<g transform="translate(${ox},${oy})">`;

      nodes.forEach((n) => {
        if (!n.parent) return;
        const p = nodeById(n.parent);
        if (!p) return;
        const pw = widthOf(p) / 2, cw = widthOf(n) / 2;
        const right = n.x >= p.x;
        const x1 = p.x + (right ? pw : -pw), x2 = n.x + (right ? -cw : cw);
        const mx = (x1 + x2) / 2;
        out += `<path d="M ${x1} ${p.y} C ${mx} ${p.y}, ${mx} ${n.y}, ${x2} ${n.y}" fill="none" stroke="#4a2230" stroke-width="1.6"/>`;
      });

      nodes.forEach((n) => {
        const w = widthOf(n);
        const isRoot = !n.parent;
        out += `<g transform="translate(${n.x},${n.y})">`;
        out += `<rect x="${-w / 2}" y="${-H / 2}" width="${w}" height="${H}" rx="5" fill="${isRoot ? '#1c0b11' : '#141014'}" stroke="${isRoot ? '#c8102e' : '#3a2028'}" stroke-width="1.4"/>`;
        out += `<text text-anchor="middle" dy="0.35em" font-family="Georgia,serif" font-size="14" fill="${isRoot ? '#ffffff' : '#cfc7bb'}">${esc(n.text)}</text>`;
        out += `</g>`;
      });

      out += `</g></svg>`;
      return out;
    }

    /* ── public api ── */
    const api = {
      load(doc) {
        const m = (doc && doc.mind) || {};
        nodes = Array.isArray(m.nodes) && m.nodes.length
          ? JSON.parse(JSON.stringify(m.nodes))
          : [{ id: uid(), x: 0, y: 0, text: doc && doc.title ? doc.title : 'Central idea', parent: null }];
        view = m.view && typeof m.view.k === 'number' ? { ...m.view } : { x: 0, y: 0, k: 1 };
        selectedId = nodes[0] ? nodes[0].id : null;
        render();
        if (!m.view) fit();
      },
      state() { return { nodes: JSON.parse(JSON.stringify(nodes)), view: { ...view } }; },
      addChild: () => addChild(selectedId),
      addSibling: () => addSibling(selectedId),
      rename: () => { if (selectedId) beginRename(selectedId); },
      remove: removeSelected,
      zoom(dir) {
        const r = svg.getBoundingClientRect();
        const cx = r.width / 2, cy = r.height / 2;
        const k2 = Math.min(2.6, Math.max(0.22, view.k * (dir > 0 ? 1.2 : 1 / 1.2)));
        view.x = cx - (cx - view.x) * (k2 / view.k);
        view.y = cy - (cy - view.y) * (k2 / view.k);
        view.k = k2;
        schedule();
        onChange();
      },
      fit,
      exportSVG,
      resize: schedule,
      count: () => nodes.length
    };

    window.addEventListener('resize', schedule);
    return api;
  }

  window.NoxMind = NoxMind;
})();
