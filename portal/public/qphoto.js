// Photos on an explanation or answer (migration 249, 20 Oct 2026). A phone
// photo is 3 to 5 MB and one post may carry about 4 MB in all, so each picked
// photo is redrawn here at most 1600 px on its long side as a JPEG, about
// 200 to 400 KB, before the form is sent. Only the first four are kept, and
// the send button waits while they are prepared. Without this script the
// photos go as they are and the server refuses any over 5 MB.
//
// Bound once and delegated from document, for the reason in the header of
// dash.js: portal pages change without a page load, so a listener bound to
// an element would be lost.
(function () {
  if (window.__ccPhotoBound) return;
  window.__ccPhotoBound = true;

  var MAX = 4, EDGE = 1600, QUALITY = 0.8, SMALL = 400 * 1024;

  function shrink(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type)) return resolve(file);
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var k = Math.min(1, EDGE / Math.max(w, h));
        URL.revokeObjectURL(url);
        if (k === 1 && file.size <= SMALL) return resolve(file);   // already small
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) {
          if (!b || b.size >= file.size) return resolve(file);
          var name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([b], name, { type: 'image/jpeg', lastModified: file.lastModified }));
        }, 'image/jpeg', QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };   // cannot read it: send as is
      img.src = url;
    });
  }

  function show(form, files, note) {
    var box = form && form.querySelector('[data-qphoto-picked]');
    if (!box) return;
    box.textContent = '';
    files.forEach(function (f) {
      var im = document.createElement('img');
      im.alt = f.name || 'Photo';
      im.src = URL.createObjectURL(f);
      box.appendChild(im);
    });
    if (note) {
      var p = document.createElement('div');
      p.className = 'note';
      p.textContent = note;
      box.appendChild(p);
    }
  }

  document.addEventListener('change', function (ev) {
    var input = ev.target;
    if (!input || !input.matches || !input.matches('input[type="file"][data-qphoto]')) return;
    var form = input.form;
    var picked = Array.prototype.slice.call(input.files || []);
    var dropped = picked.length > MAX ? picked.length - MAX : 0;
    picked = picked.slice(0, MAX);
    if (!picked.length) { show(form, [], ''); return; }
    var btn = form && form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    show(form, [], 'Preparing ' + picked.length + ' photo' + (picked.length === 1 ? '' : 's') + '...');
    Promise.all(picked.map(shrink)).then(function (out) {
      try {
        var dt = new DataTransfer();
        out.forEach(function (f) { dt.items.add(f); });
        input.files = dt.files;   // setting files does not fire change again
      } catch (e) { /* an old browser keeps the originals */ }
      var note = out.length + ' photo' + (out.length === 1 ? '' : 's') + ' ready to send.';
      if (dropped) note += ' Only the first ' + MAX + ' are kept.';
      show(form, out, note);
      if (btn) btn.disabled = false;
    });
  });
})();
