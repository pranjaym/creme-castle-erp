# Deploy the daily dashboard to Google Cloud Run (8am, automatic)

You run these steps once. After that the dashboard builds and emails itself every
morning, whether or not your Mac is on. Anything in ALL-CAPS you replace with your value.
**Never paste secrets into chat** — they go into the Google Cloud console / commands only.

The easiest way to run the commands is **Google Cloud Shell** (a terminal in your browser,
gcloud already installed): open https://shell.cloud.google.com. Or install the gcloud CLI
on your Mac. Either works.

---

## Step 0 — Put the history in Supabase Storage (one time)

The cloud job reads/writes the history there (it has no disk of its own).

1. Supabase -> **cremecastle-spine** -> **Storage** -> **New bucket** -> name it
   `dashboard-history` -> **Private** -> Create.
2. Upload the two files from your Mac (drag-drop into that bucket):
   - `Sales Dashboard V5/auto/history/orders.parquet`
   - `Sales Dashboard V5/auto/history/items.parquet`

(The Petpooja login session is already in Storage from the earlier setup, so nothing to do there.)

---

## Step 1 — Point gcloud at your project

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com artifactregistry.googleapis.com
```

If you don't have a project yet: https://console.cloud.google.com -> create a project ->
enable billing. Note the **Project ID** (not the name).

---

## Step 2 — Build the container

Get the `Sales Dashboard V5/` folder into Cloud Shell (drag-drop upload) or `cd` into it
on your Mac, then:

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/cc-dashboard
```

This reads the `Dockerfile` in the folder, builds the image, and stores it. Takes a few minutes.

---

## Step 3 — Create the Cloud Run Job (with the settings)

Replace the values. The two real secrets (the Supabase key and the Gmail App Password) go
straight into this command — not into chat.

All settings go in ONE `--set-env-vars` (repeating the flag clobbers earlier ones). The
`^;^` prefix uses `;` as the separator so values may contain commas (e.g. recipients).

```bash
gcloud run jobs create cc-dashboard \
  --image gcr.io/YOUR_PROJECT_ID/cc-dashboard \
  --region asia-south1 \
  --task-timeout 1800 --max-retries 1 \
  --set-env-vars "^;^SPINE_SUPABASE_URL=https://naocaekyszvmnfgcaufw.supabase.co;SPINE_SUPABASE_SERVICE_ROLE_KEY=YOUR_SB_SECRET_KEY;DASH_HISTORY_BUCKET=dashboard-history;DASH_EMAIL_SENDER=pranjay@cremecastle.in;DASH_EMAIL_RECIPIENTS=pranjay@cremecastle.in;DASH_EMAIL_APP_PASSWORD=YOUR_16CHAR_APP_PASSWORD"
```

(`DASH_CLOUD=1`, `PETPOOJA_HEADLESS=1` and the paths are already baked into the image.)

> More secure option for later: put `SPINE_SUPABASE_SERVICE_ROLE_KEY` and
> `DASH_EMAIL_APP_PASSWORD` in Secret Manager and use `--set-secrets` instead of
> `--set-env-vars`. Fine to start with env vars.

---

## Step 4 — Test it once

```bash
gcloud run jobs execute cc-dashboard --region asia-south1
```

Watch it in the console (Cloud Run -> Jobs -> cc-dashboard -> Executions -> Logs), or:
```bash
gcloud run jobs executions list --job cc-dashboard --region asia-south1
```
Then check your inbox. If the email arrives, the whole chain works on the cloud.
If it errors, copy the log lines to me (not the secrets) and I'll fix it.

---

## Step 5 — Schedule it for 8am IST

Easiest in the console: **Cloud Run -> Jobs -> cc-dashboard -> Triggers ->
Add Scheduler trigger** -> schedule `0 8 * * *`, timezone **Asia/Kolkata** -> Create.

Or by command:
```bash
gcloud scheduler jobs create http cc-dashboard-8am \
  --location asia-south1 \
  --schedule "0 8 * * *" --time-zone "Asia/Kolkata" \
  --uri "https://asia-south1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/YOUR_PROJECT_ID/jobs/cc-dashboard:run" \
  --http-method POST \
  --oauth-service-account-email "YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com"
```
(Find `YOUR_PROJECT_NUMBER` with `gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)'`.)

Done. It now runs every morning at 8:00 IST.

---

## Keeping it running

- **New item needs a mapping:** the morning email lists any item with no glossary alias
  (it is counted under its raw name until mapped). Send me the item + its Alias + Category;
  I add it to `auto/glossary/item_glossary.csv`, then you redo **Step 2 + Step 3**
  (`gcloud builds submit ...` then `gcloud run jobs update cc-dashboard --image ...`).
- **Change recipients / email:** edit the env vars with
  `gcloud run jobs update cc-dashboard --region asia-south1 --set-env-vars "DASH_EMAIL_RECIPIENTS=a@x.com,b@y.com"`.
- **If Petpooja ever blocks Cloud Run:** the container is host-agnostic (state lives in
  Supabase Storage), so the same image runs on Oracle Cloud / a small VM with the same env
  vars and a cron calling `python /app/auto/run_daily.py --allow-unmapped`. No rebuild of logic.
- **Re-vendor the scraper before a rebuild** (keeps it in sync with the kitchen module):
  `cp "../../cremecastle-kitchen/workers/petpooja-ingest/scrape.py" deploy/vendor/scrape.py`
