// Interactivity for the daily dashboard pages: the Day / Week view toggle,
// click-to-sort on any table marked .sortable, the trend sparklines, and the
// row filters (app, complaint tag, store mistakes). Plain browser JS.
//
// REWRITTEN 18 Sep 2026, after Pranjay: "the Store mistakes only button is not
// working, and when I click on it nothing is happening. In fact the Swiggy
// only button is also not working."
//
// The cause was not the buttons. This file is loaded by next/script with
// strategy="lazyOnload", which runs a script ONCE PER FULL PAGE LOAD. Every
// link in the portal rail and every "previous day" link is a Next <Link>, so
// moving between pages is a CLIENT-SIDE navigation: React swaps the DOM and
// the script is never re-run. Two things then went wrong.
//
//   1. Arriving at a daily page from any other page left the new DOM with no
//      listeners at all, so nothing on it worked. Reloading the page fixed it,
//      which is why this looked intermittent.
//   2. Moving between two daily pages reused the DOM nodes, so inline
//      display:none from the previous page's filter survived onto rows of the
//      new day, while React reset the buttons' own highlight. Rows were hidden
//      with no lit button to explain why.
//
// This was NOT introduced by the store-mistake work; the app filters, the sort
// and the view toggle had the same fault from the day they were written. It
// only surfaced now because a new button sent Pranjay looking.
//
// Two rules now keep it fixed:
//
//   A. EVERY click handler is DELEGATED from `document`, bound once. A
//      delegated listener does not care that the element under the pointer was
//      created after it, so it survives every navigation.
//   B. NO filter state is held in a variable. What is on screen is derived
//      from which buttons carry .on, and React owns those classes, so a
//      navigation resets the filters by itself and the buttons can never
//      disagree with the rows.
(function () {
  if (window.__ccDashBound) return;   // bound once per browser page load
  window.__ccDashBound = true;

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  };
  var rootEl = function () { return $('.dashroot'); };

  // ------------------------------------------------------------------
  // What should be on screen, read from the DOM every time it is asked.
  // ------------------------------------------------------------------
  function stateFor(target) {
    var q = '[data-target="' + target + '"]';
    var app = $('.appfilter' + q + '.on');
    var tag = $('.rfilter[data-reason]' + q + '.on');
    var root = rootEl();
    return {
      app: app ? (app.dataset.app || '') : '',
      tag: tag ? (tag.dataset.reason || '') : '',
      mistake: !!$('.rfilter.fault' + q + '.on')
               || !!(root && root.dataset.mistake === '1')
    };
  }

  function apply(target) {
    var table = document.getElementById(target);
    if (!table) return 0;
    var w = stateFor(target);
    var shown = 0, bad = 0;
    $$('tbody tr', table).forEach(function (tr) {
      var isBad = tr.dataset.mistake === '1';
      if (isBad) bad++;
      var ok = (!w.tag || tr.dataset.reason === w.tag)
            && (!w.app || tr.dataset.app === w.app)
            && (!w.mistake || isBad);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    // A list filtered down to nothing must say so, or a screenshot of an empty
    // table reads as "no data" when it means "nothing wrong here".
    var holder = table.parentNode;
    var note = $('.mnone', holder);
    if (!note) {
      note = document.createElement('p');
      note.className = 'mnone';
      holder.appendChild(note);
    }
    note.textContent = shown ? '' :
      (w.mistake ? 'No store mistakes in this list.' : 'Nothing matches this filter.');
    note.style.display = shown ? 'none' : '';
    return bad;
  }

  function applyAll() {
    var total = 0;
    $$('table.faultable[id]').forEach(function (t) { total += apply(t.id) || 0; });
    var c = document.getElementById('mistake-count');
    // "rows", not "orders": an order that both complained and rated low is
    // listed in two places, so a row count is the only honest one here.
    if (c) {
      c.textContent = ' ' + total + ' store-mistake row'
        + (total === 1 ? '' : 's') + ' on this page';
    }
  }

  // ------------------------------------------------------------------
  // One delegated click handler for every control on the page.
  // ------------------------------------------------------------------
  function only(sel, el) {   // give .on to el alone among sel
    $$(sel).forEach(function (x) { x.classList.toggle('on', x === el); });
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    // Day / week view toggle
    var v = t.closest('.views button');
    if (v) {
      var root = rootEl();
      if (root) root.dataset.view = v.dataset.view;
      only('.views button', v);
      return;
    }

    // Section-1 Zomato / Swiggy tab pair
    var tab = t.closest('.s1tab');
    if (tab) {
      var group = tab.dataset.group || 'g1';
      only('.s1tab[data-group="' + group + '"]', tab);
      $$('.s1view[data-group="' + group + '"]').forEach(function (view) {
        view.classList.toggle('off', view.dataset.view !== tab.dataset.view);
      });
      return;
    }

    // Both apps / Zomato only / Swiggy only
    var af = t.closest('.appfilter');
    if (af) {
      only('.appfilter[data-target="' + af.dataset.target + '"]', af);
      apply(af.dataset.target);
      return;
    }

    // Store mistakes only, for one list
    var fa = t.closest('.rfilter.fault[data-target]');
    if (fa) {
      var on = !fa.classList.contains('on');
      fa.classList.toggle('on', on);
      if (on) {
        // showing mistakes only means no single tag is selected, so the two
        // can never cancel each other out and leave an empty table
        var tagSel = '.rfilter[data-reason][data-target="' + fa.dataset.target + '"]';
        var showAll = $(tagSel + '[data-reason=""]');
        only(tagSel, showAll);
      }
      apply(fa.dataset.target);
      return;
    }

    // A single complaint tag
    var tg = t.closest('.rfilter[data-reason]');
    if (tg) {
      var target = tg.dataset.target || 'comp-wk';
      only('.rfilter[data-reason][data-target="' + target + '"]', tg);
      var chip = $('.rfilter.fault[data-target="' + target + '"]');
      if (chip) chip.classList.remove('on');   // picking a tag drops the narrowing
      apply(target);
      return;
    }

    // The page-wide store-mistake switch
    var sw = t.closest('#mistake-switch');
    if (sw) {
      var r = rootEl();
      if (!r) return;
      var want = r.dataset.mistake !== '1';
      r.dataset.mistake = want ? '1' : '';
      sw.classList.toggle('on', want);
      sw.setAttribute('aria-pressed', want ? 'true' : 'false');
      applyAll();
      return;
    }

    // Click-to-sort on any .sortable table header
    var th = t.closest('table.sortable thead th');
    if (th) { sortBy(th); return; }
  });

  function cellKey(td) {
    var s = td.textContent.trim();
    var n = parseFloat(s.replace(/[\u20B9,%]/g, '').replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function sortBy(th) {
    var table = th.closest('table');
    var ths = $$('thead th', table);
    var ci = ths.indexOf(th);
    if (ci < 0 || !table.tBodies[0]) return;
    var tbody = table.tBodies[0];
    var rows = Array.prototype.slice.call(tbody.rows);
    var dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
    ths.forEach(function (h) {
      delete h.dataset.dir;
      var a = h.querySelector('.arrow');
      if (a) a.remove();
    });
    th.dataset.dir = dir;
    var arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = dir === 'asc' ? ' \u25B2' : ' \u25BC';
    th.appendChild(arrow);
    rows.sort(function (a, b) {
      var x = cellKey(a.cells[ci]), y = cellKey(b.cells[ci]);
      if (x === null && y === null) {
        var xs = a.cells[ci].textContent.trim().toLowerCase();
        var ys = b.cells[ci].textContent.trim().toLowerCase();
        return dir === 'asc' ? xs.localeCompare(ys) : ys.localeCompare(xs);
      }
      if (x === null) return 1;
      if (y === null) return -1;
      return dir === 'asc' ? x - y : y - x;
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
  }

  // ------------------------------------------------------------------
  // Sparklines. Marked once drawn so a re-run is free and never doubles up.
  // ------------------------------------------------------------------
  function drawSparklines() {
    $$('svg.sparkline').forEach(function (svg) {
      if (svg.dataset.drawn === '1') return;
      svg.dataset.drawn = '1';
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
  }

  // ------------------------------------------------------------------
  // Run for the page that is on screen now, and again after every
  // client-side navigation. React paints a little after the URL changes, so
  // the render is retried on a short ladder; every step is idempotent.
  // ------------------------------------------------------------------
  function render() {
    if (!rootEl()) return;
    drawSparklines();
    applyAll();
  }

  function onRouteChange() {
    // React reuses DOM nodes between two daily pages, so inline display:none
    // and the page-wide switch can outlive the page that set them. Clear both
    // before re-applying, or rows stay hidden with no button lit to say why.
    var r = rootEl();
    if (r) r.dataset.mistake = '';
    $$('table[id] tbody tr').forEach(function (tr) { tr.style.display = ''; });
    [0, 120, 400, 1000].forEach(function (ms) { setTimeout(render, ms); });
  }

  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    if (typeof orig !== 'function') return;
    history[k] = function () {
      var out = orig.apply(this, arguments);
      onRouteChange();
      return out;
    };
  });
  window.addEventListener('popstate', onRouteChange);

  render();
  // The script itself is lazy-loaded, so the page may still be settling when
  // it first runs; the same short ladder covers that.
  [120, 400, 1000].forEach(function (ms) { setTimeout(render, ms); });
})();
