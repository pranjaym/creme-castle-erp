import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { REPORTS, MAX_RANGE_DAYS, isValidDate, fetchReportRows } from '@/lib/reports';
import { getLatestDate } from '@/lib/daily';

const PREVIEW_ROWS = 30;

// One report: date range, preview of the first rows, download. The download
// itself streams from the existing /reports/download route.
export default async function ReportPage({ params, searchParams }:
  { params: Promise<{ key: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  if (!['admin', 'central', 'viewer'].includes(user.role)) redirect('/');

  const { key } = await params;
  const def = REPORTS[key];
  if (!def) notFound();

  const latest = await getLatestDate();
  const sp = await searchParams;
  const to = isValidDate(sp.to ?? '') ? sp.to! : latest;
  const defFromDate = new Date(to + 'T00:00:00');
  defFromDate.setDate(defFromDate.getDate() - 6);
  const from = isValidDate(sp.from ?? '') ? sp.from! : defFromDate.toISOString().slice(0, 10);

  let preview: unknown[][] = [];
  let previewError: string | null = null;
  try {
    const rows = await fetchReportRows(
      { ...def, },
      from, to,
    );
    preview = rows.slice(0, PREVIEW_ROWS);
    // For dateless reports the fetch reads the whole table; cap the wait by
    // previewing only (the download route streams the full set).
    if (def.dateless) preview = rows.slice(0, PREVIEW_ROWS);
  } catch (e) {
    previewError = e instanceof Error ? e.message : 'unknown error';
  }

  const dl = def.dateless
    ? `/reports/download?report=${def.key}&from=${from}&to=${to}`
    : `/reports/download?report=${def.key}&from=${from}&to=${to}`;

  return (
    <main>
      <p style={{ marginTop: 8 }}><Link href="/reports">&#8592; All reports</Link></p>
      <h1 className="page">{def.label}</h1>
      <p className="hint">{def.desc}</p>

      {!def.dateless ? (
        <form method="get" className="row" style={{ marginBottom: 16 }}>
          <div>
            <label className="fld" htmlFor="from">From</label>
            <input className="txt" type="date" id="from" name="from" defaultValue={from} max={latest} />
          </div>
          <div>
            <label className="fld" htmlFor="to">To</label>
            <input className="txt" type="date" id="to" name="to" defaultValue={to} max={latest} />
          </div>
          <button className="ghostbtn" type="submit">Preview</button>
          <a className="primary" style={{ textDecoration: 'none' }} href={dl}>Download CSV</a>
        </form>
      ) : (
        <p style={{ marginBottom: 16 }}>
          <a className="primary" style={{ textDecoration: 'none' }} href={dl}>Download the whole table (CSV)</a>
        </p>
      )}
      {!def.dateless ? (
        <p className="note">One download covers at most {MAX_RANGE_DAYS} days; for longer history, download in pieces.</p>
      ) : null}

      <h2 className="section">Preview {def.dateless ? '' : `(${from} to ${to}, first ${PREVIEW_ROWS} rows)`}</h2>
      {previewError ? <p className="err">Could not read the report: {previewError}</p> : null}
      {!previewError && preview.length === 0 ? <p className="note">No rows in this range.</p> : null}
      {preview.length > 0 ? (
        <div className="scroll-x">
          <table className="sheet">
            <thead><tr>{def.headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i}>{row.map((v, j) => <td key={j}>{v === null || v === undefined ? '' : String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
