// SORTABLE TABLES (v1 data tables — outlet, SKU, launches)
document.querySelectorAll('table.data.sortable').forEach(table => {
  table.querySelectorAll('thead th').forEach((th, idx) => {
    th.addEventListener('click', () => sortTable(table, idx, th.dataset.sort));
  });
});
function sortTable(table, idx, type) {
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const ths = Array.from(table.querySelectorAll('thead th'));
  const dir = ths[idx].dataset.dir === 'asc' ? 'desc' : 'asc';
  ths.forEach(t => { t.dataset.dir = ''; t.classList.remove('active'); });
  ths[idx].dataset.dir = dir;
  ths[idx].classList.add('active');
  rows.sort((a, b) => {
    let av = a.children[idx].innerText.trim();
    let bv = b.children[idx].innerText.trim();
    if (type === 'num') {
      const parseN = s => {
        const m = s.match(/-?\d[\d,]*\.?\d*/);
        return m ? parseFloat(m[0].replace(/,/g, '')) : -Infinity;
      };
      av = parseN(av); bv = parseN(bv);
      return dir === 'asc' ? av - bv : bv - av;
    }
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// OUTLET FILTERS
function applyOutletFilters() {
  const search = (document.getElementById('o-search').value || '').toLowerCase();
  const city   = document.getElementById('o-city').value;
  const bias   = document.getElementById('o-bias').value;
  const status = document.getElementById('o-status').value;
  const rows = document.querySelectorAll('#outlet-table tbody tr');
  let shown = 0;
  rows.forEach(r => {
    const o = r.dataset.outlet || '';
    const c = r.dataset.city || '';
    const b = r.dataset.bias || '';
    const dRev = parseFloat(r.dataset.dRev);
    const cancel = parseFloat(r.dataset.cancel);
    let show = true;
    if (search && !o.includes(search)) show = false;
    if (city && c !== city) show = false;
    if (bias && b !== bias) show = false;
    if (status === 'down' && !(dRev < 0)) show = false;
    if (status === 'up'   && !(dRev > 0)) show = false;
    if (status === 'cancel' && !(cancel >= 5)) show = false;
    r.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  document.getElementById('o-count').innerText = shown + ' outlets';
}
['o-search', 'o-city', 'o-bias', 'o-status'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', applyOutletFilters);
});

// SKU FILTERS
function applySkuFilters() {
  const search = (document.getElementById('s-search').value || '').toLowerCase();
  const cat    = document.getElementById('s-cat').value;
  const mover  = document.getElementById('s-mover').value;
  const rows = document.querySelectorAll('#sku-table tbody tr');
  let shown = 0;
  rows.forEach(r => {
    const sku = r.dataset.sku || '';
    const c   = r.dataset.cat || '';
    const lastTd = r.children[r.children.length - 1].innerText;
    const dN = parseFloat(lastTd);
    let show = true;
    if (search && !sku.includes(search)) show = false;
    if (cat && c !== cat) show = false;
    if (mover === 'up'   && !(dN > 10))  show = false;
    if (mover === 'down' && !(dN < -10)) show = false;
    r.style.display = show ? '' : 'none';
    if (show) shown++;
  });
  document.getElementById('s-count').innerText = shown + ' SKUs';
}
['s-search', 's-cat', 's-mover'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', applySkuFilters);
});

// CHART.JS DEFAULTS
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
Chart.defaults.color = '#7A6F5F';
Chart.defaults.borderColor = '#E8E0D2';
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.animation = { duration: 250 };

const PALETTE = { z: '#C24A3D', s: '#4A6FA5', accent: '#8B5A2B',
                  pos: '#4A8C5C', warn: '#D89A2C', muted: '#9E9286' };

function makeLine(id, datasets, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  new Chart(el, {
    type: 'line',
    data: { labels: window._trend.labels, datasets },
    options: {
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: opts.beginAtZero !== false, grid: { color: '#F0E9DD' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// 14-DAY TREND
if (window._trend) {
  const t = window._trend;
  new Chart(document.getElementById('trend-orders'), {
    type: 'bar',
    data: { labels: t.labels, datasets: [
      { label: 'Zomato', data: t.z, backgroundColor: PALETTE.z },
      { label: 'Swiggy', data: t.s, backgroundColor: PALETTE.s }
    ]},
    options: {
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#F0E9DD' } }
      }
    }
  });
  makeLine('trend-aov', [{
    label: 'AOV', data: t.aov, borderColor: PALETTE.accent,
    backgroundColor: 'rgba(139,90,43,0.08)', tension: 0.3, fill: true, borderWidth: 2
  }]);
  makeLine('trend-cake', [{
    label: 'Cake share %', data: t.cake, borderColor: PALETTE.pos,
    backgroundColor: 'rgba(74,140,92,0.08)', tension: 0.3, fill: true, borderWidth: 2
  }]);
  makeLine('trend-disc', [{
    label: 'Outlet disc%', data: t.od, borderColor: PALETTE.warn,
    backgroundColor: 'rgba(216,154,44,0.08)', tension: 0.3, fill: true, borderWidth: 2
  }]);
}

// DISCOUNT BANDS
if (window._bands) {
  const b = window._bands;
  const cfg = (focal, comp) => ({
    type: 'bar',
    data: { labels: b.labels, datasets: [
      { label: 'Yesterday',   data: focal, backgroundColor: PALETTE.z },
      { label: 'Same day LW', data: comp,  backgroundColor: 'rgba(122,111,95,0.4)' }
    ]},
    options: {
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, grid: { color: '#F0E9DD' } }, x: { grid: { display: false } } }
    }
  });
  new Chart(document.getElementById('bandsZ'), cfg(b.z_focal, b.z_comp));
  new Chart(document.getElementById('bandsS'), cfg(b.s_focal, b.s_comp));
}

// HOUR BRAND
if (window._hourBrand) {
  const h = window._hourBrand;
  new Chart(document.getElementById('hourBrand'), {
    type: 'line',
    data: { labels: h.labels, datasets: [
      { label: 'Yesterday', data: h.focal, borderColor: PALETTE.z,
        backgroundColor: 'rgba(194,74,61,0.08)', tension: 0.3, fill: true, borderWidth: 2 },
      { label: 'Same day LW', data: h.comp, borderColor: PALETTE.muted,
        backgroundColor: 'transparent', tension: 0.3, borderWidth: 1.5, borderDash: [4,3] }
    ]},
    options: {
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, grid: { color: '#F0E9DD' } }, x: { grid: { display: false } } }
    }
  });
}

// BELGIAN PRICING EXPERIMENT TREND
if (window._belgianTrend) {
  const b = window._belgianTrend;
  const startIdx = b.labels.indexOf(b.startDate);
  new Chart(document.getElementById('belgian-trend'), {
    type: 'line',
    data: { labels: b.labels, datasets: [
      { label: 'Test (Rs.899)', data: b.test, borderColor: PALETTE.accent,
        backgroundColor: 'rgba(139,90,43,0.08)', tension: 0.3, fill: true, borderWidth: 2 },
      { label: 'Control (Rs.699 strikethrough)', data: b.control, borderColor: PALETTE.s,
        backgroundColor: 'rgba(74,111,165,0.06)', tension: 0.3, fill: true, borderWidth: 2 }
    ]},
    options: {
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#F0E9DD' }, title: { display: true, text: 'Qty / outlet / day', font: { size: 10 } } },
        x: { grid: { display: false } }
      }
    }
  });
}

// LAUNCH TRENDS (Lux + Mango)
function _renderLaunchTrend(canvasId, data, color) {
  const el = document.getElementById(canvasId);
  if (!el || !data) return;
  new Chart(el, {
    type: 'bar',
    data: { labels: data.labels, datasets: [
      { label: 'Qty', data: data.qty, backgroundColor: color },
    ]},
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#F0E9DD' }, title: { display: true, text: 'Qty sold', font: { size: 10 } } },
        x: { grid: { display: false } }
      }
    }
  });
}
if (window._luxTrend)   _renderLaunchTrend('lux-trend',   window._luxTrend,   PALETTE.accent);
if (window._mangoTrend) _renderLaunchTrend('mango-trend', window._mangoTrend, PALETTE.warn);
