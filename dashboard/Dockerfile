# Creme Castle daily dashboard — Cloud Run Job container.
# Build context is this folder (Sales Dashboard V5/). Same Playwright base as the
# kitchen ingestion, so Petpooja scraping works headless and Petpooja accepts it
# (Rishabh's pipeline proves Cloud Run is accepted).
#
# The container carries NO secrets and NO history: secrets come from the Cloud Run
# Job's environment, the history parquet is pulled from / pushed to Supabase Storage
# each run (DASH_CLOUD=1). So the image is safe to store and the job is stateless.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app
COPY deploy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install chromium

COPY auto/           /app/auto/
COPY cc_dashboard/   /app/cc_dashboard/
COPY deploy/vendor/scrape.py /app/scraper/scrape.py

ENV CC_DASH_DIR=/app/cc_dashboard \
    PETPOOJA_SCRAPER_DIR=/app/scraper \
    PETPOOJA_DOWNLOAD_DIR=/tmp \
    PETPOOJA_HEADLESS=1 \
    DASH_CLOUD=1

# Scrape yesterday, enrich, append, build, email. --allow-unmapped keeps the daily run
# alive if a new item lacks a glossary alias (it is flagged in the email instead).
ENTRYPOINT ["python", "/app/auto/run_daily.py"]
CMD ["--allow-unmapped"]
