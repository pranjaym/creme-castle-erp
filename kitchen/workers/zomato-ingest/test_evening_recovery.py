"""Does the evening Zomato pull survive a flaky network? (F22 and F23)

Run this whenever ingest.store_receipt or run_evening's failure handling is touched:

    python3 test_evening_recovery.py

Safe to run at any time: it uses NO internet, does NOT touch the real spine, and
does NOT send mail. requests.post, the clock, the scrape and the alert are all
replaced with stand-ins, so the real code runs against fakes.

It recreates two real evenings:

  17 Aug 2026 (F22): the customer_details receipt upload died with OSError 49
  one second after the identical order_history upload had succeeded. store_receipt
  had a single attempt and no timeout, so a one-second flap lost a whole export.

  18 Aug 2026 (F23): a two hour outage killed the 18:00 and 18:20 slots; the 20:00
  slot then landed the full sweep. The first slot had already sent a hard-failure
  alert that was false by the time it was read.

Part A: the receipt upload retries a flap, refuses to retry a 4xx, always sets a
timeout, and honours the CC_FORCE_IPV4 off switch.
Part B: a network failure defers quietly while a slot remains and only alarms on
the last one, while a fault no extra slot can fix alarms immediately.
"""
import datetime as dt
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.chdir(HERE)
os.environ.setdefault("SPINE_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SPINE_SUPABASE_SERVICE_ROLE_KEY", "test-key")

import requests
import urllib3.util.connection as urllib3_conn
import ingest
import run_evening
import scrape

THIS_FILE = os.path.abspath(__file__)      # any real file will do as the payload
failures = []


def check(name, got, want=True):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"  (got {got!r}, want {want!r})"))
    if not ok:
        failures.append(name)


def http_error(status):
    e = requests.exceptions.HTTPError(f"{status}")
    e.response = types.SimpleNamespace(status_code=status)
    return e


calls = []


def fake_post_factory(outcomes):
    seq = list(outcomes)

    def fake_post(url, **kw):
        calls.append(kw)
        out = seq.pop(0)
        if isinstance(out, Exception):
            raise out
        resp = types.SimpleNamespace(status_code=200)
        resp.raise_for_status = lambda: None
        return resp
    return fake_post


flap = requests.exceptions.ConnectionError(
    "('Connection aborted.', OSError(49, \"Can't assign requested address\"))")
ssl_outage = requests.exceptions.SSLError(
    "HTTPSConnectionPool(host='...supabase.co', port=443): Max retries exceeded "
    "(Caused by SSLError(SSL")

print("=" * 60)
print("PART A: the receipt upload (F22)")
print("=" * 60)

real_post = requests.post
try:
    calls.clear()
    requests.post = fake_post_factory([flap, flap, None])
    sha, path = ingest.store_receipt(THIS_FILE, max_retries=3, retry_wait_s=0)
    check("two flaps then success: recovers", len(calls) == 3 and bool(sha))

    calls.clear()
    requests.post = fake_post_factory([flap, flap, flap])
    try:
        ingest.store_receipt(THIS_FILE, max_retries=3, retry_wait_s=0)
        check("all attempts flap: raises rather than hanging", False)
    except requests.exceptions.ConnectionError:
        check("all attempts flap: raises rather than hanging", len(calls) == 3)

    calls.clear()
    requests.post = fake_post_factory([http_error(403), None, None])
    try:
        ingest.store_receipt(THIS_FILE, max_retries=3, retry_wait_s=0)
        check("a 403 is not retried", False)
    except requests.exceptions.HTTPError:
        check("a 403 is not retried", len(calls) == 1)

    calls.clear()
    requests.post = fake_post_factory([http_error(503), None])
    ingest.store_receipt(THIS_FILE, max_retries=3, retry_wait_s=0)
    check("a 503 is retried", len(calls) == 2)
    check("every request carries a timeout", all(c.get("timeout") for c in calls))
finally:
    requests.post = real_post

was = urllib3_conn.HAS_IPV6
try:
    urllib3_conn.HAS_IPV6 = True
    os.environ.pop("CC_FORCE_IPV4", None)
    ingest._pin_to_ipv4()
    check("pins to IPv4 by default", urllib3_conn.HAS_IPV6 is False)
    urllib3_conn.HAS_IPV6 = True
    os.environ["CC_FORCE_IPV4"] = "0"
    ingest._pin_to_ipv4()
    check("CC_FORCE_IPV4=0 leaves dual-stack alone", urllib3_conn.HAS_IPV6 is True)
finally:
    os.environ.pop("CC_FORCE_IPV4", None)
    urllib3_conn.HAS_IPV6 = was

print()
print("=" * 60)
print("PART B: which failures wake the owner (F23)")
print("=" * 60)

print("\nclassifying failures (True = network, safe to defer):")
for name, exc, want in [
    ("18 Aug SSLError", ssl_outage, True),
    ("17 Aug OSError 49", flap, True),
    ("connect timeout", requests.exceptions.ConnectTimeout("timed out"), True),
    ("Playwright DNS failure", Exception("Error: Page.goto: NS_ERROR_UNKNOWN_HOST"), True),
    ("Storage 503", http_error(503), True),
    ("Storage 403, wrong key", http_error(403), False),
    ("Storage 404, no bucket", http_error(404), False),
    ("parse failure", ValueError("no CSV inside export.zip"), False),
    ("missing file", FileNotFoundError(2, "No such file or directory"), False),
    ("code bug", KeyError("zomato_order_id"), False),
]:
    check(name, run_evening._is_transport_error(exc), want)

sys.argv = ["run_evening.py"]
scrape.have_session = lambda: True
alerts = []
run_evening._alert_once = lambda subject, body: alerts.append(subject)
real_datetime = dt.datetime


def run_slot(exc, hour):
    """Run main() as if the slot had started at `hour`, with pull_window failing."""
    def boom(*a, **k):
        raise exc

    class FrozenClock(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2026, 8, 18, hour, 5)

    run_evening.pull_window = boom
    run_evening.dt.datetime = FrozenClock
    alerts.clear()
    try:
        run_evening.main()
        return 0, list(alerts)
    except SystemExit as e:
        return e.code, list(alerts)
    finally:
        run_evening.dt.datetime = real_datetime


print("\nslot policy (75 = defer quietly, 1 = alarm):")
for hour, label in [(18, "18:00"), (20, "20:00"), (22, "22:00, the last slot")]:
    code, sent = run_slot(ssl_outage, hour)
    want_code = 1 if hour >= run_evening.LAST_SLOT_HOUR else 75
    check(f"network outage at {label}: exit {want_code}", code, want_code)
    check(f"network outage at {label}: {'alerts' if want_code == 1 else 'stays silent'}",
          bool(sent), want_code == 1)

code, sent = run_slot(http_error(403), 18)
check("wrong key at 18:00 alarms at once, no waiting", code == 1 and bool(sent))

print()
if failures:
    print(f"FAILURES: {failures}")
    sys.exit(1)
print("ALL PASS: the evening defers on a flaky network and only wakes the owner "
      "when it has run out of chances.")
