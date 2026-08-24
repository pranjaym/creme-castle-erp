// Interactivity for the daily dashboard pages: the Day / Week view toggle,
// click-to-sort on any table marked .sortable, and the small trend sparklines.
// Plain browser JS, no framework, loaded once per dashboard page.
(function () {
  var root = document.querySelector('.dashroot');
  if (!root) return;

  // View toggle
  document.querySelectorAll('.views button').forEach(function (b) {
    b.addEventListener('click', function () {
      root.dataset.view = b.dataset.view;
      document.querySelectorAll('.views button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
    });
  });

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
