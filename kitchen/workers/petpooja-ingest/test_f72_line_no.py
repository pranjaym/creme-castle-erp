"""F72: repeat item lines are numbered, kept, and never lost in silence.

No database: a fake table stands in for landing.petpooja_order_summary_item and
enforces the migration 245 rule (one live row per natural key and line_no).
Run from this folder: python3 test_f72_line_no.py
"""
import datetime as dt
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ingest
import sync
import repair_f72

ok = True
def check(label, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {label}: got {got!r}, want {want!r}")

SPEC = sync.SYNC_REPORTS["order_summary_item"]
COLS = SPEC["cols"]
KEYS = SPEC["key_cols"]
DAY = dt.date(2026, 10, 9)

def line(invoice, item="Chocolate Truffle Cake (500 Gm)", price="599.0", qty="1.0",
         total="599.0", persons=""):
    v = dict.fromkeys(COLS, "")
    v.update(restaurant_name="CC-GGN-Sector 4", invoice_no=invoice, item_name=item,
             item_price=price, item_quantity=qty, item_total=total, persons=persons,
             order_ts="09/10/26 13:05")
    vals = [v[c] for c in COLS]
    return {"business_date": DAY, "values": vals, "row_hash": ingest.row_hash([DAY] + vals)}


class FakeTable:
    """Live rows keyed by (natural key, line_no), like the 245 partial unique index."""
    def __init__(self):
        self.rows = {}          # (key, line_no) -> (id, values)
        self.next_id = 1

    def hold(self, rec_values, line_no):
        rec = dict(zip(COLS, rec_values))
        self.rows[(sync.key_of(rec, KEYS), line_no)] = (self.next_id, rec_values)
        self.next_id += 1

    def execute_values(self, cur, sql, payload, page_size=1000, fetch=False):
        assert "on conflict do nothing" in sql and "line_no" in sql, sql
        back = []
        for row in payload:
            vals, line_no = row[2:2 + len(COLS)], row[2 + len(COLS)]
            rec = dict(zip(COLS, vals))
            k = (sync.key_of(rec, KEYS), line_no)
            if k in self.rows:
                continue                      # the silent skip F72 is about
            self.rows[k] = (self.next_id, vals)
            self.next_id += 1
            back.append(tuple(rec[c] for c in KEYS) + (line_no,))
        return back if fetch else None


class FakeCur:
    def __init__(self, table):
        self.t, self.sql = table, ""
    def execute(self, sql, params=None):
        self.sql = sql
    def fetchall(self):
        assert self.sql.startswith("select id, line_no"), self.sql
        rows = sorted(((ln, i, vals) for (k, ln), (i, vals) in self.t.rows.items()))
        return [(i, ln, *vals) for ln, i, vals in rows]


def run_insert(table, source, held_spine=None):
    sync.execute_values = table.execute_values
    cur = FakeCur(table)
    src = sync.keyed_map(source, KEYS, lambda r: dict(zip(COLS, r["values"])))
    spine = sync._fetch_spine_day(cur, SPEC, DAY)
    new_keys = [k for k in src if k not in spine]
    return sync._insert_new(cur, SPEC, DAY, 1, src, spine, new_keys)


print("keyed_map carries the plain key and the ordinal:")
m = sync.keyed_map([line("19357"), line("19357")], KEYS, lambda r: dict(zip(COLS, r["values"])))
check("two identical lines give two keys", len(m), 2)
check("ordinals", sorted(r["_line"] for r in m.values()), [1, 2])
check("same plain key", len({r["_base"] for r in m.values()}), 1)

print("the second identical line is kept (the 9 Oct invoice 19357 case):")
t = FakeTable()
t.hold(line("19357")["values"], 1)
landed, short = run_insert(t, [line("19357"), line("19357")])
check("one row landed", len(landed), 1)
check("no shortfall", short, 0)
check("it is line 2", sorted(ln for (_, ln) in t.rows), [1, 2])

print("a second run of the same file adds nothing:")
landed, short = run_insert(t, [line("19357"), line("19357")])
check("nothing new", (len(landed), short), (0, 0))

print("line 1 voided earlier, only line 2 live: the new copy takes the free number 1:")
t = FakeTable()
t.hold(line("19982", item="Eggless Biscoff Brownie", price="169.0", total="169.0")["values"], 2)
landed, short = run_insert(t, [line("19982", item="Eggless Biscoff Brownie", price="169.0",
                                    total="169.0")] * 2)
check("landed", (len(landed), short), (1, 0))
check("numbers held", sorted(ln for (_, ln) in t.rows), [1, 2])

print("a row the table refuses is counted, not lost in silence:")
t = FakeTable()
t.hold(line("24792")["values"], 1)
sync.execute_values = t.execute_values
cur = FakeCur(t)
src = sync.keyed_map([line("24792"), line("24792")], KEYS, lambda r: dict(zip(COLS, r["values"])))
spine = sync._fetch_spine_day(cur, SPEC, DAY)
t.hold(line("24792")["values"], 2)          # appears behind the sync's back
landed, short = sync._insert_new(cur, SPEC, DAY, 1, src, spine, [k for k in src if k not in spine])
check("shortfall counted", (len(landed), short), (0, 1))

print("summarise turns a shortfall into an error:")
try:
    sync.summarise([{"verdict": "corrected", "material": 0, "shortfall": 1,
                     "report": "order_summary_item", "business_date": DAY}])
    check("raised", False, True)
except sync.InsertShortfall as e:
    check("raised InsertShortfall", "1 row(s) did not save" in str(e), True)
check("no shortfall, no error", sync.summarise([{"verdict": "confirmed", "material": 0,
                                                "shortfall": 0}])[0],
      "1 day(s) confirmed unchanged")

print("repair adds ONLY lost repeats of lines the spine already holds:")
t = FakeTable()
t.hold(line("19357")["values"], 1)
source = [line("19357"), line("19357"),                       # lost repeat: add
          line("30001", item="Tiramisu Tub", price="349.0", total="349.0")]   # absent: leave
sync.execute_values = t.execute_values
dry = sync.add_missing_duplicates(FakeCur(t), "order_summary_item", DAY, source, run_id=None)
check("dry run counts", (dry["lines"], dry["other"], dry["units"], dry["value"]),
      (1, 1, Decimal("1"), Decimal("599")))
check("dry run writes nothing", len(t.rows), 1)
logged = []
class LogCur(FakeCur):
    pass
def fake_ev(cur, sql, payload, page_size=1000, fetch=False):
    if "spine_row_changes" in sql:
        logged.extend(payload)
        return None
    return t.execute_values(cur, sql, payload, page_size, fetch)
sync.execute_values = fake_ev
done = sync.add_missing_duplicates(LogCur(t), "order_summary_item", DAY, source, run_id=7)
check("applied: one line landed", (len(done["landed"]), done["shortfall"]), (1, 0))
check("the absent line was left alone", len(t.rows), 2)
check("audit record written for the landed line", len(logged), 1)

print("ingest.line_numbers numbers within a day, not across days:")
a, b = line("19357"), line("19357")
c = line("19357"); c = dict(c, business_date=DAY + dt.timedelta(days=1))
check("per day", ingest.line_numbers("order_summary_item", [a, b, c]), [1, 2, 1])
check("other reports have none", ingest.line_numbers("online_orders", [a]), None)

print("repair pull windows stay within Petpooja's 7-day export cap:")
d = lambda s: dt.date.fromisoformat(s)
w = repair_f72.windows([d("2026-09-01"), d("2026-09-03"), d("2026-09-06"), d("2026-09-07"),
                        d("2026-09-16")])
check("windows", [(a.isoformat(), b.isoformat(), len(ds)) for a, b, ds in w],
      [("2026-09-01", "2026-09-07", 3), ("2026-09-07", "2026-09-08", 1),
       ("2026-09-16", "2026-09-17", 1)])
check("every window at most 7 calendar days", all((b - a).days <= 6 for a, b, _ in w), True)

print("\nALL PASS" if ok else "\nFAILURES ABOVE")
sys.exit(0 if ok else 1)
