# Trade Order Study: Field Tracking, Transcription & Evidence Dashboard

Dashboard for the SDLG / VNG International *Comparative Analysis of Trade Order Implementation* study (Uganda, 20 local governments).

It does five jobs:
1. **Tracks field collection** against the study targets, by form, local government (LG), region and day.
2. **Tracks each enumerator ID**: what they submit, where, when, how long, how clean.
3. **Processes submissions into text**: typed answers are coded; audio is transcribed (faster-whisper) and coded.
4. **Detects errors** in data, audio, enumerator IDs and GPS, with a review queue (valid / re-check / test).
5. **Reports**: themes, evidence & quotes, LG comparison, triangulation, map, and a generated findings report.

```
KoboCollect -> KoboToolbox -> POST /api/sync -> Hono API on Cloudflare (D1) -> Dashboard
                                   ^                       |
                    pipeline/run.py (faster-whisper) <-----+  audio proxy / transcript upload
                    (runs on a separate machine, NOT on Cloudflare)
```

## Collection targets (385 forms)

| Code | Form | Target |
|---|---|---|
| A1 | Local Authorities KII | 11 per LG x 20 = 220 |
| A2 | KII: Town Clerk, Mayor, Police Commandant | 3 per LG x 20 = 60 |
| A3 | KII: Street vendors not relocated | 2 per LG x 20 = 40 |
| A5 | KII: Market administrators | 1 per LG x 20 = 20 |
| B1 | FGD 1: informal vendors & relocated traders | 1 per LG x 20 = 20 |
| B2 | FGD 2: formal & licensed traders | 1 per LG x 20 = 20 |
| A4 | KII: National-level stakeholders | at least 5 in total |

Targets, minimum plausible session lengths and all error thresholds are in **`src/field.ts`**. Declined interviews and records marked *test* do not count. Counts are capped at the per-LG target so a surplus in one LG cannot hide a gap in another.

## Dashboard tabs
| Tab | Purpose |
|---|---|
| Field overview | Progress vs 385, per-form progress, submissions per day, processing table (received, audio, transcribed, review, coded, errors), open problems, progress by region |
| Coverage vs target | Matrix LG x form (n/target), colour-coded, last data date, declined count |
| Enumerators | One row per normalised ID: forms, LGs, active days, median session, words, audio, GPS, errors; click for their submissions |
| Errors & review | Queue of flagged records with plain-language hints; filter by type (data / audio / enumerator / location); mark Valid / Re-check / Test (admin key); CSV export |
| Submissions & audio | All records with filters; drawer with audio player, clickable transcript, answers, checks, field status |
| Map | GPS of every interview (Leaflet + OpenStreetMap), coloured by form group |
| Themes, LG comparison, Evidence & quotes, Closed questions, Triangulation | Qualitative analysis views |
| Report | Findings report (print/PDF, Word, Markdown) |
| Pipeline | Sync, re-code, form connection status, audio worker instructions, exports |

## Error checks (`src/api.ts` `qualityFlags`, `src/field.ts` `crossFlags`)
- **Data:** session shorter than the form minimum, form open > 4 h, very little typed text, test-like input, same text pasted across answers, long answer identical to another interview, duplicate A2 role in the same LG, LG missing, category/region mismatch, future date, interview date differs from form start date, identical before/after figures.
- **Audio:** consent given but no recording, recording much shorter than the session, transcript failed quality gate (silence, loops, low confidence) and awaits review.
- **Enumerator ID:** not a usable code (name, long number, keyboard mash), same ID in LGs > 100 km apart on the same day. IDs are normalised (`2`, `002`, `TAB 2` group sensibly).
- **Location:** no GPS, GPS outside Uganda, GPS > 50 km from the declared LG, identical GPS point in two records.

Marking a record **Valid** keeps its flags but they stop counting as problems. **Test** removes it (and its codes) from every count and analysis; it can be restored. Flags are computed on the fly, so changing a threshold takes effect immediately.

## Connected forms (`wrangler.jsonc` -> `KOBO_FORMS`)
| Code | Group (`respondent_group`) | Kobo asset uid |
|---|---|---|
| A1 | `lg_official` | a5aXBd4dw3GdBiCcKUqA8r |
| A2 | `lg_political_enforcement` | awyYY28KeHFw38t63gpN4i |
| A3 | `street_vendor_not_relocated` | aDxyhLChCpyAaF4bWkBxGr |
| A4 | `national` | aCAksSTdaXM67vhVNUFu9A |
| A5 | `market_administrator` | aVjETFsNkaWuA5k9e8pu4R |
| B1 | `fgd_informal_traders` | aoJ4xmsMP2TVpjZz7NbRwa |
| B2 | `fgd_formal_traders` | a6DZWSJjxRZLt4AKiJdU2b |

Form metadata (`form_code`, `respondent_group`) comes from hidden calculate fields in each Kobo form. Question labels and choices are stored in D1 at sync.

## Deploy to Cloudflare (Workers & Pages, connected to GitHub)

1. **Create the D1 database** (once): `npx wrangler d1 create webapp-production`. Copy the `database_id` into `wrangler.jsonc` (`d1_databases[0].database_id`, currently the placeholder `local-placeholder`) and commit.
2. **Apply migrations to production D1**: `npx wrangler d1 migrations apply webapp-production --remote` (files in `migrations/`: 0001 base schema, 0002 field monitoring columns).
3. **Connect the repo** in Cloudflare (Workers & Pages -> Create -> Pages -> Connect to Git -> this repository, branch `main`):
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: 20 or newer
4. **Bind D1** in the Pages project: Settings -> Bindings -> D1 database, variable name `DB`, database `webapp-production` (needed if the binding is not picked up from `wrangler.jsonc`).
5. **Set secrets** (Settings -> Variables and Secrets, type *Secret*):
   - `KOBO_TOKEN`: KoboToolbox API token for the account that owns the forms
   - `INGEST_TOKEN`: admin key you choose (long, random). Needed for sync, re-check/test marking, audio playback, transcript upload.
6. Open the site, go to **Pipeline**, enter the admin key when asked, press **Sync now**.
7. **Protect the site.** Read endpoints are open and the data includes interview content and GPS. Put Cloudflare Access (Zero Trust) in front of the whole site, or at least `/api/*` and `/`.
8. Rotate any Kobo token or password that has been shared in chat or email.

Notes: no KV and no cron triggers are used (compatible with hosted deploy). The audio worker cannot run on Cloudflare.

## Audio transcription worker (separate machine)
Needs Python 3.9+, ffmpeg, and **at least 4 GB RAM** for the `small` model (a 1 GB machine will swap and be very slow; use `--model base` there).
```bash
pip install -r pipeline/requirements.txt
export DASH_URL=https://<your-site>      # or http://localhost:3000
export ADMIN_KEY=<INGEST_TOKEN>
export WHISPER_BEAM=1                    # faster; 2 is slightly more accurate
python pipeline/run.py --model small --loop     # keeps polling every 2 minutes
```
Audio is downloaded through the dashboard proxy (the Kobo token never leaves the server) and deleted after processing. Transcripts that look unreliable go to **Needs review** and are excluded from coding until a person accepts them. Do not restart the dashboard while the worker is mid-file: re-queue with `POST /api/pipeline/status {"id":<submission id>,"status":"pending"}`.

## Run locally
```bash
npm install && npm run build
npx wrangler d1 migrations apply webapp-production --local
pm2 start ecosystem.config.cjs            # http://localhost:3000
# secrets in .dev.vars (git-ignored): KOBO_TOKEN, INGEST_TOKEN
```

## Main endpoints
`GET /api/field` (overview), `/api/coverage` (LG x form vs target), `/api/enumerators`, `/api/quality` (error queue), `/api/interviews`, `/api/interview/:id`, `/api/map`, `/api/report`, `/api/themes`, `/api/forms`, `/api/config`.
Admin (`x-admin-key`): `POST /api/sync`, `/api/recode`, `/api/submission/:id/status` `{status: auto|valid|recheck|test, note}`, `/api/transcript/:id/accept|reject|requeue`, `GET /api/audio/:id`.

## Data model (D1)
`forms` (schema per form), `submissions` (normalised record, `field_status`, `field_note`), `transcripts` (text, segments, status, flags), `codes` (coded evidence segments), `meta`.

## Limitations
- Coding is keyword-based (no LLM); Whisper accuracy on Ugandan-accented English and local languages is unvalidated.
- LG coordinates in `src/lgs.json` are approximate town centres.
- Error thresholds are working assumptions; adjust in `src/field.ts` with the field team.
- Read endpoints are open until you add Cloudflare Access.
