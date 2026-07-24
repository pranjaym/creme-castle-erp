// ============================================================
// V2 — Tab control
// ============================================================
function switchTab(evt, group, key) {
  const buttons = evt.currentTarget.parentNode.querySelectorAll('button');
  buttons.forEach(b => b.classList.remove('active'));
  evt.currentTarget.classList.add('active');
  const contents = document.querySelectorAll(`[id^="${group}-"]`);
  contents.forEach(c => c.classList.remove('active'));
  const target = document.getElementById(`${group}-${key}`);
  if (target) target.classList.add('active');
}

// ============================================================
// V2 — Lux sparklines
// ============================================================
if (window._luxSparks) {
  Object.entries(window._luxSparks).forEach(([id, data]) => {
    const el = document.getElementById(id);
    if (!el) return;
    new Chart(el, {
      type: 'line',
      data: {
        labels: data.map((_, i) => i),
        datasets: [{
          data: data,
          borderColor: '#8B5A2B',
          backgroundColor: 'rgba(139,90,43,0.12)',
          borderWidth: 1.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, beginAtZero: true },
        },
        elements: { point: { radius: 0 } },
        maintainAspectRatio: false,
      },
    });
  });
}

// ============================================================
// V3 — Sortable tables (v2 range-tables only)
// ============================================================
function sortRangeTable(th) {
  const table = th.closest('table');
  const tbody = table.querySelector('tbody');
  const ths = Array.from(th.parentNode.children);
  const colIdx = ths.indexOf(th);
  const sortType = th.dataset.sortType || 'string';

  // Clear other headers' sort indicators
  ths.forEach(h => {
    if (h !== th) h.classList.remove('sort-asc', 'sort-desc');
  });

  // Toggle direction
  let dir;
  if (th.classList.contains('sort-asc')) {
    th.classList.remove('sort-asc'); th.classList.add('sort-desc'); dir = -1;
  } else if (th.classList.contains('sort-desc')) {
    th.classList.remove('sort-desc'); th.classList.add('sort-asc'); dir = 1;
  } else {
    th.classList.add('sort-desc'); dir = -1;
  }

  // Get rows, ignoring any section-header rows
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => !r.classList.contains('section-header'));
  rows.sort((a, b) => {
    const ca = a.children[colIdx];
    const cb = b.children[colIdx];
    let av = ca.dataset.value !== undefined ? ca.dataset.value : ca.textContent.trim();
    let bv = cb.dataset.value !== undefined ? cb.dataset.value : cb.textContent.trim();
    if (sortType === 'number') {
      av = parseFloat(av);
      bv = parseFloat(bv);
      if (isNaN(av)) av = -Infinity;
      if (isNaN(bv)) bv = -Infinity;
      return (av - bv) * dir;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  rows.forEach(r => tbody.appendChild(r));
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('table.range-table.sortable thead th').forEach(th => {
    th.addEventListener('click', () => sortRangeTable(th));
  });
});

// ============================================================
// V3 — Cake share chart (30-day Z vs S)
// ============================================================
if (window._cakeShareTrend) {
  const el = document.getElementById('cakeShareChart');
  if (el) {
    const t = window._cakeShareTrend;
    new Chart(el, {
      type: 'bar',
      data: {
        labels: t.labels,
        datasets: [
          {
            type: 'bar',
            label: 'Zomato cake qty',
            data: t.z_qty,
            backgroundColor: 'rgba(194,74,61,0.65)',
            borderColor: 'rgba(194,74,61,1)',
            borderWidth: 0,
            stack: 'cakes',
            order: 2,
            yAxisID: 'y',
          },
          {
            type: 'bar',
            label: 'Swiggy cake qty',
            data: t.s_qty,
            backgroundColor: 'rgba(184,134,11,0.65)',
            borderColor: 'rgba(184,134,11,1)',
            borderWidth: 0,
            stack: 'cakes',
            order: 2,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'Zomato share %',
            data: t.z_share,
            borderColor: '#5A3F1C',
            backgroundColor: '#5A3F1C',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#5A3F1C',
            fill: false,
            tension: 0.25,
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 }, padding: 12 },
          },
          tooltip: {
            callbacks: {
              afterLabel: function(ctx) {
                if (ctx.datasetIndex === 0) {
                  const tot = t.z_qty[ctx.dataIndex] + t.s_qty[ctx.dataIndex];
                  if (tot > 0) return `Z share: ${(t.z_qty[ctx.dataIndex]/tot*100).toFixed(1)}%`;
                }
                if (ctx.datasetIndex === 1) {
                  const tot = t.z_qty[ctx.dataIndex] + t.s_qty[ctx.dataIndex];
                  return `Total cake qty: ${tot}`;
                }
                return '';
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 },
            grid: { display: false },
          },
          y: {
            stacked: true,
            position: 'left',
            title: { display: true, text: 'Cake qty', font: { size: 11 } },
            beginAtZero: true,
            ticks: { font: { size: 10 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Zomato share %', font: { size: 11 } },
            min: 0,
            max: 100,
            ticks: {
              font: { size: 10 },
              callback: v => v + '%',
            },
            grid: { display: false },
          },
        },
      },
    });
  }
}
