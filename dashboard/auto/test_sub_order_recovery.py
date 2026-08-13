"""Does the morning job survive the internet dropping mid-run? (F20)

Run this whenever run_daily.load_sub_order_wise is touched:

    python3 test_sub_order_recovery.py

Safe to run at any time: it uses NO internet and does NOT touch the real spine.
Stand-in psycopg2 / scrape / ingest modules are injected, so the real function runs
against fakes. It reads .env only so SPINE_DATABASE_URL exists as a string; nothing
ever connects with it.

It recreates the 13 August 2026 failure exactly: the day's scrape fails AND the
connection is already dead, so conn.rollback() raises instead of returning.

Scenario A: reconnecting works. Every day must still be attempted, and the reported
error must name the days (not the old, false "before any day could load").
Scenario B: reconnecting fails too. Must stop cleanly and say which days were never
tried, rather than leaving them unmentioned.
"""
import os, sys, types

AUTO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AUTO)
os.chdir(AUTO)
import run_daily
run_daily._load_env_file()
assert os.environ.get("SPINE_DATABASE_URL"), "SPINE_DATABASE_URL not loaded"


class DatabaseError(Exception):
    pass


def build_fakes(reconnect_ok):
    state = {"connects": 0, "rollbacks": 0}

    class FakeCur:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def execute(self, *a, **k): pass
        def fetchall(self): return []          # nothing present -> all 7 days missing

    class FakeConn:
        def cursor(self): return FakeCur()
        def rollback(self):
            state["rollbacks"] += 1
            raise DatabaseError("could not receive data from server: "
                                "Can't assign requested address")
        def close(self): pass

    def connect(dsn):
        state["connects"] += 1
        if state["connects"] > 1 and not reconnect_ok:
            raise DatabaseError("could not connect to server")
        return FakeConn()

    pg = types.ModuleType("psycopg2")
    pg.connect = connect
    pg.DatabaseError = DatabaseError

    scrape = types.ModuleType("scrape")
    def scrape_and_download(*a, **k):
        raise SystemExit("net::ERR_INTERNET_DISCONNECTED")
    scrape.scrape_and_download = scrape_and_download

    ingest = types.ModuleType("ingest")
    ingest.REPORTS = {"sub_order_wise": {"table": "landing.fake", "parse": lambda p: ([], 0)}}
    ingest.store_receipt = lambda p: "receipt"
    ingest.load_records = lambda *a, **k: None
    return pg, scrape, ingest, state


def run(reconnect_ok):
    pg, scrape, ingest, state = build_fakes(reconnect_ok)
    sys.modules["psycopg2"], sys.modules["scrape"], sys.modules["ingest"] = pg, scrape, ingest
    try:
        return run_daily.load_sub_order_wise(), state
    finally:
        for m in ("psycopg2", "scrape", "ingest"):
            sys.modules.pop(m, None)


print("=" * 60, "\nSCENARIO A: connection dies, reconnect works\n", "=" * 60)
(summary, error), state = run(reconnect_ok=True)
print("summary:", summary)
print("error  :", error)
print("connects:", state["connects"], " rollback attempts:", state["rollbacks"])
assert error and "before any day could load" not in error, error
assert state["rollbacks"] == run_daily.SUB_ORDER_LOOKBACK_DAYS, "not every day was attempted"
assert "not attempted" not in error
print("PASS: all 7 days attempted, error names the days\n")

print("=" * 60, "\nSCENARIO B: connection dies, reconnect fails too\n", "=" * 60)
(summary, error), state = run(reconnect_ok=False)
print("summary:", summary)
print("error  :", error)
print("connects:", state["connects"], " rollback attempts:", state["rollbacks"])
assert error and "not attempted, spine unreachable" in error, error
assert state["rollbacks"] == 1, "should have stopped after the first dead day"
print("PASS: stopped cleanly, named the days never tried")
