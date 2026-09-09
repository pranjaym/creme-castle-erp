"""
One-off probe, 9 Sep 2026, to be run BY PRANJAY from Terminal (Claude's sandbox blocks the
download and the outlet switch). It does three things with the saved Petpooja session:

  1. Online Store Logs   (logs/online_log_status/1): search Janakpuri 4 to 5 Sep, click Export once
  2. Online Item On/Off  (logs/online_log_status/2): search Janakpuri 5 Sep, click Export once
  3. Rider report        (reports/online_rider_report): point the session at Janakpuri, read the
     page and one search, then point the session back at All Outlets

Files land in ~/Downloads/petpooja-probe (screenshots, exports). Nothing is written to Petpooja
other than the outlet switch, which is restored at the end. Nothing touches the spine.

Run:   cd ~/creme-castle-erp/kitchen/workers/petpooja-ingest && python3 probe_logs_rider.py
"""
import json, os, re
from playwright.sync_api import sync_playwright

SESSION = os.path.join(os.environ.get("PETPOOJA_DOWNLOAD_DIR", "/var/folders/0v/t145jfcs7psb31hb_w6tf5vr0000gn/T"),
                       "petpooja_session_primary.json")
OUT = os.environ.get("OUTDIR", os.path.expanduser("~/Downloads/petpooja-probe"))
os.makedirs(OUT, exist_ok=True)


def setdate(page, name, val):
    page.evaluate(f"""() => {{ const i=document.querySelector("input[name='{name}']");
        if(i){{ i.value='{val}'; i.dispatchEvent(new Event('change',{{bubbles:true}})); }} }}""")


def hdr(page):
    return page.evaluate("() => document.body.innerText.slice(0,100).replace(/\\s+/g,' ')")


def peek(path):
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in (".xlsx", ".xls"):
            import openpyxl
            wb = openpyxl.load_workbook(path, read_only=True)
            ws = wb[wb.sheetnames[0]]
            rows = [[str(c)[:50] if c is not None else '' for c in r]
                    for i, r in zip(range(6), ws.iter_rows(values_only=True))]
            n = sum(1 for _ in ws.iter_rows())
            print("   sheets:", wb.sheetnames, "rows:", n)
            for r in rows:
                print("   ", r)
        else:
            txt = open(path, errors="replace").read(3000)
            print("   head:", txt[:1500].replace("\n", " || "))
    except Exception as e:
        print("   peek failed:", str(e)[:200])


def export_log(page, url, rest_label, d1, d2, tag):
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    page.select_option("select[name='restaurant_m']", label=rest_label)
    page.wait_for_timeout(2500)
    page.select_option("select[name='identifier[]']", label="All")
    setdate(page, "startdate", d1)
    setdate(page, "enddate", d2)
    page.get_by_role("button", name="Search").first.click()
    page.wait_for_timeout(5000)
    try:
        with page.expect_download(timeout=90000) as dl:
            page.get_by_role("button", name="Export").first.click()
        f = dl.value
        name = f.suggested_filename or f"{tag}.bin"
        path = os.path.join(OUT, f"{tag}_{name}")
        f.save_as(path)
        print(f"[{tag}] EXPORT ok: {name} {os.path.getsize(path)} bytes -> {path}")
        peek(path)
    except Exception as e:
        print(f"[{tag}] export did not produce a download: {str(e)[:200]}")
        page.screenshot(path=f"{OUT}/{tag}_export_attempt.png", full_page=True)


TABLES = """() => Array.from(document.querySelectorAll('table')).map(t=>({
  h:Array.from(t.querySelectorAll('thead th, tr:first-child th')).map(x=>x.innerText.trim()).filter(Boolean).slice(0,40),
  n:t.querySelectorAll('tbody tr').length,
  s:Array.from(t.querySelectorAll('tbody tr')).slice(0,8).map(r=>Array.from(r.querySelectorAll('td')).map(c=>c.innerText.trim().slice(0,60)))
})).filter(t=>t.h.length)"""

FORM = """() => ({
  labels:Array.from(document.querySelectorAll('label')).map(l=>l.innerText.trim()).filter(x=>x&&!/Unique Code|Password/.test(x)).slice(0,25),
  selects:Array.from(document.querySelectorAll('select')).map(s=>({name:s.name||s.id,opts:Array.from(s.options).slice(0,8).map(o=>o.text.trim())})).filter(s=>!/header/.test(s.name)).slice(0,10),
  inputs:Array.from(document.querySelectorAll('input')).filter(i=>i.type!='hidden'&&!/mapping|gallery|message|header_text|search_report/.test(i.name+i.id)).map(i=>({name:i.name||i.id,type:i.type,value:i.value})).slice(0,15),
  buttons:Array.from(document.querySelectorAll('button,input[type=submit],a.btn')).map(b=>(b.innerText||b.value||'').trim()).filter(t=>t&&t.length<30).slice(0,15)
})"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(storage_state=SESSION, accept_downloads=True, viewport={"width": 1400, "height": 1000})
    page = ctx.new_page()

    # 1 and 2: exports
    export_log(page, "https://billing.petpooja.com/logs/online_log_status/1",
               "317707 - CC-DL-Janakpuri", "4 Sep 2026", "5 Sep 2026", "storelog")
    export_log(page, "https://billing.petpooja.com/logs/online_log_status/2",
               "317707 - CC-DL-Janakpuri", "5 Sep 2026", "5 Sep 2026", "itemlog")

    # 3: rider report, scoped to Janakpuri
    page.goto("https://billing.petpooja.com/users/dashboard", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)
    print("[scope] before:", hdr(page))
    with page.expect_navigation(timeout=60000):
        page.evaluate("change_restaurant(317707)")
    page.wait_for_timeout(2500)
    print("[scope] after:", hdr(page))

    cap = {}
    page.on("request", lambda r: cap.update({"url": r.url, "post": (r.post_data or '')[:600]})
            if r.method == "POST" and "rider" in r.url.lower() else None)
    page.goto("https://billing.petpooja.com/reports/online_rider_report", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3500)
    print("[rider] url:", page.url)
    page.screenshot(path=f"{OUT}/rider_scoped.png", full_page=True)
    print("[rider] form:", json.dumps(page.evaluate(FORM))[:2000])
    print("[rider] tables:", json.dumps(page.evaluate(TABLES))[:2000])
    txt = page.evaluate("() => document.body.innerText")
    i = txt.lower().find('rider')
    print("[rider] text:", txt[max(0, i - 100):i + 1200].replace("\n", " | "))
    try:
        if page.locator("input[name='startdate']").count():
            setdate(page, "startdate", "4 Sep 2026")
            setdate(page, "enddate", "5 Sep 2026")
            page.get_by_role("button", name=re.compile("Search|Submit|Show|Get|Generate", re.I)).first.click()
            page.wait_for_timeout(8000)
            print("[rider] after search:", json.dumps(page.evaluate(TABLES))[:3500])
            page.screenshot(path=f"{OUT}/rider_search.png", full_page=True)
            print("[rider] ajax:", json.dumps(cap)[:800])
            try:
                with page.expect_download(timeout=60000) as dl:
                    page.get_by_role("button", name=re.compile("Export|Download|Excel", re.I)).first.click()
                f = dl.value
                path = os.path.join(OUT, "rider_" + (f.suggested_filename or "export.bin"))
                f.save_as(path)
                print("[rider] EXPORT ok:", path, os.path.getsize(path), "bytes")
                peek(path)
            except Exception as e:
                print("[rider] no export produced:", str(e)[:120])
    except Exception as e:
        print("[rider] search attempt:", str(e)[:200])

    # restore All Outlets
    page.goto("https://billing.petpooja.com/users/dashboard", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1500)
    try:
        with page.expect_navigation(timeout=60000):
            page.evaluate("change_restaurant(0)")
        page.wait_for_timeout(2500)
        h = hdr(page)
        print("[restore] header now:", h)
        if 'All Outlets' not in h:
            print("[restore] NOT back on All Outlets. Switcher entries:",
                  json.dumps(page.evaluate("""() => Array.from(document.querySelectorAll('[onclick*="change_restaurant"]'))
                      .map(e=>[e.getAttribute('onclick'), e.innerText.trim().slice(0,40)]).slice(0,50)"""))[:1500])
            print("[restore] If needed, open billing.petpooja.com in a browser and pick All Outlets at the top left.")
    except Exception as e:
        print("[restore] failed:", str(e)[:150])
    b.close()
    print("\nDone. Files are in", OUT)
