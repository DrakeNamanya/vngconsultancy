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
Overview · Field coverage (vs per LG: 4 official KIIs [A1+A2], 2 trader KIIs [A3], 2 FGDs [B1]; A4 national counted separately) · Themes (+ official-vs-trader divergence, emergent terms) · LG comparison heat-map · Evidence & quotes (filterable, CSV export) · Closed questions (by group) · Triangulation (Section D ratings vs Section E figures) · Interviews & audio (player + clickable transcript) · Data quality (flags, per-enumerator) · Pipeline (sync, exports).

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
Config: `wrangler.jsonc` → `KOBO_FORMS` = `"<asset uid>:kii,<asset uid>:fgd"`. Six instruments are connected:

| Code | Group (`respondent_group`) | Kobo asset uid |
|---|---|---|
| A1 | `lg_official` | a5aXBd4dw3GdBiCcKUqA8r |
| A2 | `lg_political_enforcement` | awyYY28KeHFw38t63gpN4i |
| A3 | `trader_association` | aDxyhLChCpyAaF4bWkBxGr |
| A4 | `national` | aCAksSTdaXM67vhVNUFu9A (aUiymP3TwGr4H7fPyZyhfb is a duplicate copy) |
| B1 | `fgd_informal_traders` | aoJ4xmsMP2TVpjZz7NbRwa (FGD) |

Each form's question labels/choices are stored in D1 (`forms.schema`) at sync, so the interview drawer, closed-question charts (per-form selector) and CSV export follow the form. Sync also removes local records that no longer exist on Kobo. `GET /api/forms` shows per-form Kobo vs dashboard counts.

Audio worker env: `WHISPER_BEAM` (default 2). The `small` model needs about 1.5 GB RAM; on a 1 GB machine use `--model base` (or add swap).

## Security
* Read endpoints are open (add Hosted access rules before sharing the URL: this is interview data).
* Write endpoints and **audio playback** need the admin key (`x-admin-key` / `?key=`).
* The Kobo token is never sent to the browser; audio is proxied.

## Status
Done: Kobo sync, schema-aware normalisation, audio worker, transcript gate, coding, all dashboard views, exports.
Not done: no production deploy, coding is keyword-based (no LLM; the workspace LLM proxy is blocked on the free plan), Whisper accuracy on Ugandan-accented English and local languages is unvalidated.
