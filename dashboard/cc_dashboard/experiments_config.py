"""Configuration for time-bound experiments and product launches.

Edit this file when:
- The Belgian pricing experiment ends, expands, or shifts outlets
- A new SKU joins (or leaves) the Lux Cakes range
- A different seasonal menu replaces or supplements Mango
"""
from datetime import date

# =====================================================================
# Belgian Chocolate Cake — Chivas Regal pricing experiment
# =====================================================================
BELGIAN_PRICING_TEST = {
    "sku_name": "Signature Belgian Chocolate Cake (500 Gm)",
    "start_date": date(2026, 4, 15),
    "test_price": 899,         # actual ₹899, no strikethrough
    "control_price": 699,      # ₹899 struck through to ₹699
    # The 15 outlets running real ₹899 (premium pricing, no discount):
    "test_outlets": [
        "CC-ND-Alpha 2", "CC-DL-Shahpurjat", "CC-ND-Sector141",
        "CC-DL-Vasant Kunj", "CC-ND-Sector 45", "CC-GGN-Sector 60",
        "CC-DL-Krishna Nagar", "CC-ND-Sector 68", "CC-DL-Janakpuri",
        "CC-GGN-Sector 49", "CC-ND-Gaur City", "CC-GZB-Vasundhara",
        "CC-DL-Karol Bagh", "CC-GGN-DLF Ph 4", "CC-DL-Dwarka",
    ],
}

# =====================================================================
# Lux Cakes — new gourmet range
# =====================================================================
LUX_CAKES = {
    "label": "Lux Cakes",
    "skus": [
        "Almond Rocher Cake (500 Gm)",
        "Ferrero Rocher Cake (500 Gm)",
        "Chocolate Nougat Cake (500 Gm)",
        "Signature Belgian Chocolate Cake (500 Gm)",
    ],
    # When did the range first launch? Auto-detected from data if None.
    "launch_date": None,
}

# =====================================================================
# Mango seasonal menu — substring match (list grows over time)
# =====================================================================
MANGO_SEASONAL = {
    "label": "Mango Seasonal",
    # Substring match (case-insensitive) on Alias Name.
    # New mango drops auto-appear in the report — no need to edit this list.
    "keyword": "mango",
    "launch_date": None,
}
