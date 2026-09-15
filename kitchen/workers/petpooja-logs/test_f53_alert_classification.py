import os, sys
sys.path.insert(0, os.getcwd())
import psycopg2, run_daily as R, fetch as F

ok = True
def check(label, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {label}: got {got!r}, want {want!r}")

print("is_transport:")
# the exact exception that exit-1'd the 09:30 run today
check("bare DatabaseError, server closed the connection",
      R.is_transport(psycopg2.DatabaseError("server closed the connection unexpectedly")), True)
check("OperationalError (already handled)",
      R.is_transport(psycopg2.OperationalError("could not receive data from server")), True)
# a genuine data fault must still alert, not defer into silence
check("IntegrityError duplicate key stays a real failure",
      R.is_transport(psycopg2.IntegrityError('duplicate key value violates unique constraint "x"')), False)
check("ProgrammingError undefined column stays a real failure",
      R.is_transport(psycopg2.ProgrammingError('column "foo" does not exist')), False)
check("plain ValueError stays a real failure", R.is_transport(ValueError("bad row")), False)

print("restore_all_outlets:")
class DeadPage:
    def evaluate(self, *a, **k): raise ConnectionError("net::ERR_NAME_NOT_RESOLVED")
    def goto(self, *a, **k): raise ConnectionError("net::ERR_NAME_NOT_RESOLVED")
    def wait_for_timeout(self, *a, **k): pass
check("network dead returns None (defer), not False (alarm)",
      F.restore_all_outlets(DeadPage()), None)

class StuckPage:
    """Page answers fine, but the session is genuinely still on one outlet."""
    def goto(self, *a, **k): pass
    def wait_for_timeout(self, *a, **k): pass
    def evaluate(self, js, *a):
        return "384434" if "header_changed_rest_id" in js else "CC-DL-Mayur Vihar Ph 3 AI Agent"
check("genuinely stuck on one outlet still returns False (alarm)",
      F.restore_all_outlets(StuckPage()), False)

class GoodPage:
    def goto(self, *a, **k): pass
    def wait_for_timeout(self, *a, **k): pass
    def evaluate(self, js, *a):
        return "0" if "header_changed_rest_id" in js else "All Outlets AI Agent 1 Explore"
check("restored cleanly returns True", F.restore_all_outlets(GoodPage()), True)

print("\nALL PASS" if ok else "\nFAILURES ABOVE")
sys.exit(0 if ok else 1)
