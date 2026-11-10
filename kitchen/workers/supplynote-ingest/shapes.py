"""Source row to spine row, for each SupplyNote dataset. Deterministic: no
clock, no network. The whole source row is kept in raw; the typed columns are
the ones the inventory module reads.
"""
from __future__ import annotations
import hashlib
import json
from decimal import Decimal


def ts(v):
    """SupplyNote sends UTC with no zone suffix. Add it. None stays None."""
    if v is None or v == "":
        return None
    s = str(v).strip()
    if s.endswith("Z"):
        return s[:-1] + "+00"
    return s if "+" in s[10:] else s + "+00"


def num(v):
    """Lossless number: through str, never through float formatting (the %g bug)."""
    if v is None or v == "":
        return None
    return Decimal(str(v))


def txt(v):
    return None if v is None else str(v)


def row_hash(raw: dict) -> str:
    return hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _base(raw):
    return {"raw": json.dumps(raw, sort_keys=True, default=str), "row_hash": row_hash(raw)}


def product(r):
    return dict(product_id=txt(r["product_id"]), sku_code=txt(r.get("sku_code")), product_title=txt(r.get("product_title")),
                category=txt(r.get("category")), sub_category=txt(r.get("sub_category")), base_unit=txt(r.get("base_unit")),
                brand=txt(r.get("brand")), hsn_code=txt(r.get("hsn_code")), tax_pct=num(r.get("tax_pct")),
                is_active=r.get("is_active"), **_base(r))


def stock(r, snapshot_date, pulled_at):
    return dict(snapshot_date=snapshot_date, pulled_at=pulled_at, outlet_id=txt(r["outlet_id"]), product_id=txt(r["product_id"]),
                outlet_product_id=txt(r.get("outlet_product_id")), current_stock=num(r.get("current_stock")),
                last_purchased_price=num(r.get("last_purchased_price")),
                last_weighted_average_price=num(r.get("last_weighted_average_price")),
                is_active=r.get("is_active"), **_base(r))


def ledger(r):
    return dict(log_id=txt(r["log_id"]), outlet_id=txt(r["outlet_id"]), product_id=txt(r["product_id"]),
                transaction_at=ts(r.get("transaction_at")), transaction_type=txt(r.get("transaction_type")),
                reason=txt(r.get("reason")), wastage_reason=txt(r.get("wastage_reason")), reference_no=txt(r.get("reference_no")),
                invoice_id=txt(r.get("invoice_id")), quantity_adjusted=num(r.get("quantity_adjusted")),
                stock_before=num(r.get("stock_before")), stock_after=num(r.get("stock_after")), unit_price=num(r.get("unit_price")),
                weighted_avg_price=num(r.get("weighted_avg_price")), is_accounting_update=r.get("is_accounting_update"),
                source_updated_at=ts(r.get("_updated_at")), **_base(r))


def po(r):
    return dict(purchase_order_id=txt(r["purchase_order_id"]), purchase_order_no=txt(r.get("purchase_order_no")),
                direction=txt(r.get("direction")), outlet_id=txt(r.get("outlet_id")), outlet_name=txt(r.get("outlet_name")),
                seller_id=txt(r.get("seller_id")), seller_name=txt(r.get("seller_name")), po_saved_at=ts(r.get("po_saved_at")),
                po_dated_at=ts(r.get("po_dated_at")), confirmed_at=ts(r.get("confirmed_at")),
                delivery_due_at=ts(r.get("delivery_due_at")), status=txt(r.get("status")), total_amount=num(r.get("total_amount")),
                is_open_po=r.get("is_open_po"), is_closed=r.get("is_closed"), is_finished=r.get("is_finished"),
                is_void=r.get("is_void"), source_created_at=ts(r.get("created_at")), source_updated_at=ts(r.get("_updated_at")),
                **_base(r))


def po_line(r):
    return dict(purchase_order_line_id=txt(r["purchase_order_line_id"]), purchase_order_id=txt(r["purchase_order_id"]),
                direction=txt(r.get("direction")), outlet_id=txt(r.get("outlet_id")), product_id=txt(r.get("product_id")),
                seller_id=txt(r.get("seller_id")), quantity_ordered=num(r.get("quantity_ordered")),
                quantity_confirmed=num(r.get("quantity_confirmed")), quantity_invoiced=num(r.get("quantity_invoiced")),
                quantity_delivered=num(r.get("quantity_delivered")), quantity_received=num(r.get("quantity_received")),
                quantity_cancelled=num(r.get("quantity_cancelled")), quantity_returned=num(r.get("quantity_returned")),
                unit=txt(r.get("unit")), base_unit=txt(r.get("base_unit")), unit_conversion=num(r.get("unit_conversion")),
                unit_price=num(r.get("unit_price")), tax_pct=num(r.get("tax_pct")), **_base(r))


# report_key -> (table, natural key columns)
TABLES = {
    "products": ("landing.supplynote_products", ["product_id"]),
    "stock_daily": ("landing.supplynote_stock_daily", ["snapshot_date", "outlet_id", "product_id"]),
    "inventory_log": ("landing.supplynote_inventory_log", ["log_id"]),
    "purchase_orders": ("landing.supplynote_purchase_orders", ["purchase_order_id"]),
    "purchase_order_lines": ("landing.supplynote_purchase_order_lines", ["purchase_order_line_id"]),
}


def check_keys(report_key, rows):
    """Refuse a batch whose natural key is missing or repeats (the lesson of the
    lossy-key incident: a colliding key overwrites the wrong rows)."""
    _, keys = TABLES[report_key]
    seen = set()
    for r in rows:
        k = tuple(str(r[c]) for c in keys)
        if any(r[c] in (None, "") for c in keys):
            raise ValueError(f"{report_key}: a row has an empty key {k}")
        if k in seen:
            raise ValueError(f"{report_key}: key {k} appears twice in one pull")
        seen.add(k)
