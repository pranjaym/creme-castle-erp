// Interactivity for the daily dashboard pages: the Day / Week view toggle,
// click-to-sort on any table marked .sortable, and the small trend sparklines.
// Plain browser JS, no framework, loaded once per dashboard page.
(function () {
  var root = document.querySelector('.dashroot');
  if (!root) return;

  // Day / week toggle, on the pages that still offer one.
  document.querySelectorAll('.views button').forEach(function (b) {
    b.addEventListener('click', function () {
      root.dataset.view = b.dataset.view;
      document.querySelectorAll('.views button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
    });
  });

  // The reason, app and store-mistake filters all live in ONE engine at the
  // bottom of this file (18 Sep 2026). There used to be a second copy here
  // that also bound to .rfilter and reset the table before the real filter
  // ran; with a third dimension to honour that would have been a bug.

  // Sortable tables
  function cellKey(td) {
    var t = td.textContent.trim();
    var n = parseFloat(t.replace(/[₹,%]/g, '').replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  document.querySelectorAll('table.sortable').forEach(function (table) {
    var ths = table.querySelectorAll('thead th');
    ths.forEach(function (th, ci) {
      th.addEventListener('click', function () {
        var tbody = table.tBodies[0];
        var rows = Array.prototype.slice.call(tbody.rows);
        var dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        ths.forEach(function (h) { delete h.dataset.dir; var a = h.querySelector('.arrow'); if (a) a.remove(); });
        th.dataset.dir = dir;
        var arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = dir === 'asc' ? ' ▲' : ' ▼';
        th.appendChild(arrow);
        rows.sort(function (a, b) {
          var x = cellKey(a.cells[ci]), y = cellKey(b.cells[ci]);
          if (x === null && y === null) {
            var xs = a.cells[ci].textContent.trim().toLowerCase(), ys = b.cells[ci].textContent.trim().toLowerCase();
            return dir === 'asc' ? xs.localeCompare(ys) : ys.localeCompare(xs);
          }
          if (x === null) return 1;
          if (y === null) return -1;
          return dir === 'asc' ? x - y : y - x;
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
      });
    });
  });

  // Sparklines: <svg class="sparkline" data-points="[..]" data-labels="[..]"
  //             data-min data-max data-suffix>
  document.querySelectorAll('svg.sparkline').forEach(function (svg) {
    var data, labels;
    try { data = JSON.parse(svg.dataset.points || '[]'); } catch (e) { return; }
    try { labels = JSON.parse(svg.dataset.labels || '[]'); } catch (e) { labels = []; }
    data = data.map(function (v) { return v === null ? null : Number(v); });
    var vals = data.filter(function (v) { return v !== null; });
    if (!vals.length) return;
    var W = 252, H = 56, padL = 6, padR = 52, padT = 8, padB = 14;
    var lo = svg.dataset.min !== undefined && svg.dataset.min !== '' ? Number(svg.dataset.min) : Math.min.apply(null, vals);
    var hi = svg.dataset.max !== undefined && svg.dataset.max !== '' ? Number(svg.dataset.max) : Math.max.apply(null, vals);
    if (hi === lo) hi = lo + 1;
    var suffix = svg.dataset.suffix || '';
    var n = data.length;
    var x = function (i) { return padL + i * (W - padL - padR) / (Math.max(n - 1, 1)); };
    var y = function (v) { return padT + (hi - v) * (H - padT - padB) / (hi - lo); };
    var ns = 'http://www.w3.org/2000/svg';
    var base = document.createElementNS(ns, 'line');
    base.setAttribute('x1', padL); base.setAttribute('x2', W - padR);
    base.setAttribute('y1', H - padB); base.setAttribute('y2', H - padB);
    base.setAttribute('stroke', '#EDE3E5'); base.setAttribute('stroke-width', '1');
    svg.appendChild(base);
    var pts = [];
    data.forEach(function (v, i) { if (v !== null) pts.push(x(i) + ',' + y(v)); });
    var line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', pts.join(' '));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#DB5436');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    var lastIdx = -1;
    for (var i = n - 1; i >= 0; i--) { if (data[i] !== null) { lastIdx = i; break; } }
    if (lastIdx >= 0) {
      var last = data[lastIdx];
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', x(lastIdx)); dot.setAttribute('cy', y(last)); dot.setAttribute('r', '4');
      dot.setAttribute('fill', '#DB5436'); dot.setAttribute('stroke', '#FFFFFF'); dot.setAttribute('stroke-width', '2');
      svg.appendChild(dot);
      var lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', x(lastIdx) + 7); lbl.setAttribute('y', y(last) + 4);
      lbl.setAttribute('font-size', '11.5'); lbl.setAttribute('fill', '#2A1A1D'); lbl.setAttribute('font-weight', '600');
      lbl.textContent = (Math.round(last * 100) / 100) + suffix;
      svg.appendChild(lbl);
    }
    data.forEach(function (v, i) {
      if (v === null) return;
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', x(i)); c.setAttribute('cy', y(v)); c.setAttribute('r', '8');
      c.setAttribute('fill', 'transparent');
      var t = document.createElementNS(ns, 'title');
      t.textContent = (labels[i] ? labels[i] + ': ' : '') + v + suffix;
      c.appendChild(t);
      svg.appendChild(c);
    });
  });
})();

// ---- merged Zomato + Swiggy pages (30 Aug 2026) ----
// App-tab toggle (the approved section 1 design: one table per app).
(function () {
  document.querySelectorAll('.s1tab').forEach(function (b) {
    b.addEventListener('click', function () {
      var group = b.dataset.group || 'g1';
      document.querySelectorAll('.s1tab[data-group="' + group + '"]').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      document.querySelectorAll('.s1view[data-group="' + group + '"]').forEach(function (v) {
        v.classList.toggle('off', v.dataset.view !== b.dataset.view);
      });
    });
  });
  // Both apps / Zomato only / Swiggy only filters. They cooperate with the
  // ---------------- the one row-filter engine (18 Sep 2026) ----------------
  // Three dimensions, one source of truth for whether a row is on screen:
  //   tag      the complaint tag chips        (data-reason on the row)
  //   app      Both apps / Zomato / Swiggy    (data-app on the row)
  //   mistake  store mistakes only            (data-mistake="1" on the row)
  // plus the page-wide switch in the header, which turns the mistake dimension
  // on for EVERY list at once so one click gives a screenshot to send a team.
  // Written as one function because three separate handlers each rewriting
  // tr.style.display cannot agree.
  var root = document.querySelector('.dashroot');
  var want = {};

  function apply(target) {
    var table = document.getElementById(target);
    if (!table) return;
    var w = want[target] || {};
    var onlyBad = w.mistake || (root && root.dataset.mistake === '1');
    var shown = 0, bad = 0;
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      if (tr.classList.contains('nonerow')) return;
      var isBad = tr.dataset.mistake === '1';
      if (isBad) bad++;
      var ok = (!w.tag || tr.dataset.reason === w.tag)
            && (!w.app || tr.dataset.app === w.app)
            && (!onlyBad || isBad);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    // A list filtered down to nothing must say so, or a screenshot of an empty
    // table reads as "no data" when it means "nothing wrong here".
    var note = table.parentNode.querySelector('.mnone');
    if (!note) {
      note = document.createElement('p');
      note.className = 'mnone';
      table.parentNode.insertBefore(note, table.nextSibling);
    }
    note.textContent = shown ? '' : (onlyBad
      ? 'No store mistakes in this list.'
      : 'Nothing matches this filter.');
    note.style.display = shown ? 'none' : '';
    return bad;
  }

  function applyAll() {
    var total = 0;
    document.querySelectorAll('table.faultable[id]').forEach(function (t) {
      total += apply(t.id) || 0;
    });
    var c = document.getElementById('mistake-count');
    // "rows", not "orders": an order that both complained and rated low is
    // listed in two places, so a row count is the only honest one here.
    if (c) c.textContent = ' ' + total + ' store-mistake row' + (total === 1 ? '' : 's') + ' on this page';
  }

  document.querySelectorAll('.appfilter').forEach(function (b) {
    b.addEventListener('click', function () {
      var target = b.dataset.target;
      document.querySelectorAll('.appfilter[data-target="' + target + '"]').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      want[target] = want[target] || {};
      want[target].app = b.dataset.app;
      apply(target);
    });
  });

  document.querySelectorAll('.rfilter[data-reason]').forEach(function (b) {
    b.addEventListener('click', function () {
      var target = b.dataset.target || 'comp-wk';
      document.querySelectorAll('.rfilter[data-reason][data-target="' + target + '"]').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      want[target] = want[target] || {};
      want[target].tag = b.dataset.reason;
      // Picking a single tag drops the store-mistake narrowing, so the two
      // never silently cancel each other out and leave an empty table.
      want[target].mistake = false;
      var m = document.querySelector('.rfilter.fault[data-target="' + target + '"]');
      if (m) m.classList.remove('on');
      apply(target);
    });
  });

  // One list's own store-mistake chip.
  document.querySelectorAll('.rfilter.fault[data-target]').forEach(function (b) {
    b.addEventListener('click', function () {
      var target = b.dataset.target;
      want[target] = want[target] || {};
      var on = !b.classList.contains('on');
      b.classList.toggle('on', on);
      want[target].mistake = on;
      if (on) {
        // showing mistakes only means no single tag is selected
        want[target].tag = '';
        document.querySelectorAll('.rfilter[data-reason][data-target="' + target + '"]').forEach(function (x) {
          x.classList.toggle('on', x.dataset.reason === '');
        });
      }
      apply(target);
    });
  });

  // The page-wide switch in the header.
  var sw = document.getElementById('mistake-switch');
  if (sw && root) {
    sw.addEventListener('click', function () {
      var on = root.dataset.mistake !== '1';
      root.dataset.mistake = on ? '1' : '';
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-pressed', on ? 'true' : 'false');
      applyAll();
    });
  }

  applyAll();
})();
