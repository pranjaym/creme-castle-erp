"""Checks for the pure parts of the SupplyNote worker: no network, no database.
Run: python3 test_shapes.py
"""
from decimal import Decimal

import load as L
import shapes as S

LEDGER = {"log_id": "6ae01694b1c69494a7f8eecd", "outlet_id": "5dd9015b742a4b9b20c45677",
          "product_id": "63259272f806bcf6cf6418c0", "transaction_at": "2026-10-27 03:12:19.657",
          "transaction_type": "StockOut", "reference_no": "GD-TRN-CC-03833", "quantity_adjusted": -2,
          "stock_before": 616, "stock_after": 614, "unit_price": 68.1, "is_accounting_update": False,
          "_updated_at": "2026-10-27 03:12:19.657"}


def test_timestamps_get_the_utc_zone():
    assert S.ts("2026-10-27 03:12:19.657") == "2026-10-27 03:12:19.657+00"
    assert S.ts("2026-09-03T06:15:30.000Z") == "2026-09-03T06:15:30.000+00"
    assert S.ts("2026-10-27 03:12:19+00") == "2026-10-27 03:12:19+00"
    assert S.ts(None) is None and S.ts("") is None


def test_numbers_are_lossless():
    # a long identifier-like number must not collapse (the %g incident)
    assert S.num(243712451100181) == Decimal("243712451100181")
    assert S.num(9.280000000000001) == Decimal("9.280000000000001")
    assert S.num(None) is None


def test_ledger_row_shape_and_stable_hash():
    a, b = S.ledger(dict(LEDGER)), S.ledger(dict(reversed(list(LEDGER.items()))))
    assert a["row_hash"] == b["row_hash"], "hash must not depend on key order"
    assert a["quantity_adjusted"] == Decimal("-2") and a["transaction_at"].endswith("+00")
    changed = S.ledger(dict(LEDGER, stock_after=613))
    assert changed["row_hash"] != a["row_hash"]


def test_null_timestamp_row_is_kept():
    r = S.ledger(dict(LEDGER, transaction_at=None))
    assert r["transaction_at"] is None and r["log_id"]


def test_duplicate_or_empty_keys_are_refused():
    r = S.ledger(dict(LEDGER))
    for bad in ([r, dict(r)], [dict(r, log_id=None)]):
        try:
            S.check_keys("inventory_log", bad)
        except ValueError:
            continue
        raise AssertionError("a bad key batch was accepted")


def test_split_new_changed_unchanged():
    r1, r2, r3 = (S.ledger(dict(LEDGER, log_id=x)) for x in ("a", "b", "c"))
    current = {"a": (11, r1["row_hash"]), "b": (12, "an old hash")}
    fresh, changed, same = L.split([r1, r2, r3], ["log_id"], current)
    assert same == 1 and [r["log_id"] for r in fresh] == ["c"] and changed == [(12, r2)]


def test_stock_key_is_date_outlet_product():
    s = S.stock({"outlet_id": "o", "product_id": "p", "current_stock": -3}, "2026-11-10", "2026-11-10T22:30:00+05:30")
    assert L.key_of(s, S.TABLES["stock_daily"][1]) == "2026-11-10|o|p" and s["current_stock"] == Decimal("-3")


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            n += 1
    print(f"{n} checks passed")
