// Issues to Ask (14 Oct 2026): the tick boxes, the bulk bar and the outlet
// folds. Plain browser JS, following the two rules that keep dash.js working
// across client-side navigations (F58): every handler is delegated from the
// document and bound once, and no state lives in a variable: what is selected
// is whichever boxes are checked, read fresh each time.
//
// The drawers (Ask, thread, Close) are dash.js's job; this file never touches
// them. Without this script the page still works: the row links open the
// server-rendered drawer and the per-row Seen button posts on its own; only
// the bulk bar needs the script, which is why it starts hidden.
(function () {
  if (window.__ccIssuesBound) return;
  window.__ccIssuesBound = true;

  function boxes() { return [].slice.call(document.querySelectorAll('input.isel[data-key]')); }
  function visible(b) { return !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length); }

  function sync() {
    var all = boxes();
    var sel = all.filter(function (b) { return b.checked; });
    all.forEach(function (b) { var tr = b.closest('tr'); if (tr) tr.classList.toggle('sel', b.checked); });
    // the group boxes reflect their rows: all, none, or some (indeterminate)
    [].forEach.call(document.querySelectorAll('input[data-selam], input[data-selstore]'), function (g) {
      var rows = all.filter(function (b) { return g.dataset.selam ? b.dataset.am === g.dataset.selam : b.dataset.store === g.dataset.selstore; });
      var n = rows.filter(function (b) { return b.checked; }).length;
      g.checked = rows.length > 0 && n === rows.length;
      g.indeterminate = n > 0 && n < rows.length;
    });
    var bar = document.getElementById('ibulk');
    if (!bar) return;
    bar.hidden = sel.length === 0;
    var keys = sel.map(function (b) { return b.dataset.key; }).join('\n');
    [].forEach.call(bar.querySelectorAll('input[name="keys"]'), function (i) { i.value = keys; });
    var askable = sel.filter(function (b) { return b.dataset.status === 'none'; }).length;
    var closable = sel.filter(function (b) { return b.dataset.status !== 'closed'; }).length;
    var n = document.getElementById('ibulk-n'); if (n) n.textContent = sel.length + ' selected';
    var a = document.getElementById('ibulk-askbtn'); if (a) a.disabled = !askable;
    var c = document.getElementById('ibulk-closebtn'); if (c) c.disabled = !closable;
    var h = document.getElementById('ibulk-hint');
    var answered = sel.filter(function (b) { return b.dataset.status === 'answered' || b.dataset.status === 'unasked'; }).length;
    var waiting = sel.filter(function (b) { return b.dataset.status === 'open' || b.dataset.status === 'overdue'; }).length;
    if (h) h.textContent = sel.length ? askable + ' not asked yet (Ask raises a question on each). Close: ' + answered + ' explanation' + (answered === 1 ? '' : 's') + ' accepted, ' + waiting + ' open question' + (waiting === 1 ? '' : 's') + ' closed unanswered, ' + askable + ' marked seen.' : '';
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.matches('input.isel')) { sync(); return; }
    if (t.matches('input[data-selam]')) {
      boxes().forEach(function (b) { if (b.dataset.am === t.dataset.selam && visible(b)) b.checked = t.checked; });
      sync(); return;
    }
    if (t.matches('input[data-selstore]')) {
      boxes().forEach(function (b) { if (b.dataset.store === t.dataset.selstore) b.checked = t.checked; });
      sync(); return;
    }
  });

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.id === 'ibulk-clear') { boxes().forEach(function (b) { b.checked = false; }); sync(); return; }
    if (t.closest('[data-tickmust]')) {
      boxes().forEach(function (b) { if (b.dataset.must === '1' && b.dataset.status === 'none' && visible(b)) b.checked = true; });
      sync(); return;
    }
    var fold = t.closest('[data-fold]');
    if (fold) {
      var close = fold.dataset.fold === 'close';
      [].forEach.call(document.querySelectorAll('.issues .store'), function (s) { s.classList.toggle('closed', close); });
      return;
    }
    var head = t.closest('.issues .sthead');
    if (head && !t.closest('input')) { head.parentElement.classList.toggle('closed'); return; }
  });

  // a bulk form must never post an empty selection
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!(f instanceof HTMLFormElement) || (f.id !== 'ibulk-ask' && f.id !== 'ibulk-close')) return;
    var keys = f.querySelector('input[name="keys"]');
    if (!keys || !keys.value) { ev.preventDefault(); sync(); return; }
    // one post per click: a second click while the first is in flight sent the
    // same 71 rows twice on 15 Oct 2026 (F75). The server now ignores a repeat
    // as well; this stops it leaving the browser.
    if (f.dataset.posting === '1') { ev.preventDefault(); return; }
    f.dataset.posting = '1';
    [].forEach.call(f.querySelectorAll('button[type="submit"]'), function (b) { b.disabled = true; b.textContent = 'Working...'; });
  });

  sync();
})();
