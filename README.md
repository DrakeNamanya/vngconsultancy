# Trade Order Study: Qualitative Evidence Pipeline & Dashboard

Pipeline and dashboard for the SDLG / VNG International *Comparative Analysis of Trade Order Implementation* study (20 local governments, KIIs + FGDs + audio, collected in KoboToolbox).

## Architecture
```
KoboToolbox ──sync──▶ Hono API (Cloudflare Worker) ──▶ D1 (submissions, transcripts, codes)
     │                      ▲   │  coding engine (codebook from report Table 2 + ToR objectives)
     └─ audio ──proxy──▶ pipeline/run.py (faster-whisper, local) ──POST transcript──┘
                                │
                         Dashboard (/)  : 10 tabs
```
* **Sync** (`POST /api/sync`): pulls submissions via Kobo API v2, normalises them (skip-logic aware), splits closed vs open-ended answers, codes the text. Idempotent.
* **Audio worker** (`pipeline/run.py`): runs outside the Worker (audio is too heavy for the edge). Downloads through `/api/audio/:id`, transcribes with faster-whisper on your own machine, applies quality gates, posts the result. Raw audio is deleted from the worker machine after processing.
* **Coding engine** (`src/codebook.ts`): 26 themes in 7 dimensions (the report's Table 2), mapped to ToR Objectives 1-4; every passage gets an evidence label (documented / observed / reported / inferred) and a rule-based tone. Respondent name and enumerator ID are never coded; phone numbers/emails are masked in excerpts.
* **Transcript gate**: loops/hallucinations, very low confidence or almost no speech put a transcript in **Needs review**. It is excluded from themes until a person accepts it. The server re-checks every upload independently of the worker.

## Dashboard tabs
Overview · Field coverage (vs 4 official + 2 trader KIIs per LG) · Themes (+ official-vs-trader divergence, emergent terms) · LG comparison heat-map · Evidence & quotes (filterable, CSV export) · Closed questions (by group) · Triangulation (Section D ratings vs Section E figures) · Interviews & audio (player + clickable transcript) · Data quality (flags, per-enumerator) · Pipeline (sync, exports).

## Run locally
```bash
npm install && npm run build
npx wrangler d1 migrations apply webapp-production --local
pm2 start ecosystem.config.cjs            # http://localhost:3000
# secrets live in .dev.vars (git-ignored): KOBO_TOKEN, INGEST_TOKEN
# audio worker
pip install -r pipeline/requirements.txt
DASH_URL=http://localhost:3000 ADMIN_KEY=<INGEST_TOKEN> python pipeline/run.py --model small
```
Config: `wrangler.jsonc` → `KOBO_FORMS` = `"<asset uid>:kii,<asset uid>:fgd"`.

## Security
* Read endpoints are open (add Hosted access rules before sharing the URL: this is interview data).
* Write endpoints and **audio playback** need the admin key (`x-admin-key` / `?key=`).
* The Kobo token is never sent to the browser; audio is proxied.

## Status
Done: Kobo sync, schema-aware normalisation, audio worker, transcript gate, coding, all dashboard views, exports.
Not done: FGD form (Form B) is not connected yet (add its uid to `KOBO_FORMS`), no production deploy, coding is keyword-based (no LLM; the workspace LLM proxy is blocked on the free plan), Whisper accuracy on Ugandan-accented English and local languages is unvalidated.
