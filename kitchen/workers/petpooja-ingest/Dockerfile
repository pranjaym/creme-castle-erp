# Petpooja ingest worker: always-on cloud runner (Cloud Run / Railway, ~$5/mo).
# Same pattern as the Dispatch Console's Railway runner. The official Playwright
# Python image already carries Chromium and its OS deps, so scraping works headless.
#
# Secrets are NEVER baked in: every credential is a runtime env var. The OTP session
# is not built into the image either; it is pulled from Supabase Storage at startup
# (see scrape.py), so this image is safe to store in a private registry.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install chromium

COPY ingest.py scrape.py ./

# Default: scrape the Build 1a punch source and load it into the spine landing zone.
# A scheduler (Cloud Run Job / Railway cron) invokes this once per business day.
# Override the report at deploy time, e.g. CMD ... --report order_summary_item.
ENTRYPOINT ["python", "ingest.py"]
CMD ["--report", "oms_purchase", "--scrape"]
