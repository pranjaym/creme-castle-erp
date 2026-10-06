// Shown the instant a daily page is asked for, while its reads run (6 Oct
// 2026). The reads take about a second; without this the old page just sat
// there and a click looked ignored.
export default function Loading() {
  return (
    <main className="dashroot">
      <p className="note" style={{ marginTop: 24, fontSize: 14 }}>Loading the day&hellip;</p>
    </main>
  );
}
