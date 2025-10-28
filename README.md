# Condo Hunt — GTA

Unified, free condo-hunting pipeline for the GTA with Playwright scraping, Google Apps Script automations, and Telegram pings.

## Quick Start
1. Create Google Sheet named "🏙️ Condo Hunt — GTA"; add tabs: `UNIFIED`, `SHORTLIST`, `CONFIG`.
2. Paste the CONFIG TSV (see below) into `CONFIG!A1`.
3. Paste the UNIFIED and SHORTLIST header lines into `UNIFIED!A1` and `SHORTLIST!A1`.
4. In Google Sheets → `Extensions` → `Apps Script` → paste `scripts/appsheet/apps_script.gs`; set `BOT_TOKEN`, `CHAT_ID`, and later `GITHUB_UNIFIED_JSON`. (Sheet ID handy for future integrations: `1qq8BZzh78A6UWmowff7cxzripo_Q8FWT5vpLohCacQUjSVkpk9FC1DOi`.)
5. Run `runHunt()` once inside Apps Script and authorize the permissions prompt.
6. Add a trigger: `Apps Script` → `Triggers` → `+ Add Trigger` → choose `runHunt` → `Time-driven` → `Minutes timer` → `Every 5 minutes`.
7. In GitHub → `Actions` tab → open **Scrape Listings** → ensure a run succeeds and `exports/unified.json` exists.
8. In the repo → open `exports/unified.json` → click **Raw** → copy the URL → paste into `const GITHUB_UNIFIED_JSON` in Apps Script; save.
9. Run `runHunt()` again → confirm the `UNIFIED` tab fills with rows and Telegram receives a message.
10. Use the `SHORTLIST` tab for manual decisions with `👍`, notes, and reminders.

## Local workflow
- `npm run scrape` — refresh `exports/unified.json` locally.
- `npm run test:telegram` — prompt for `BOT_TOKEN`/`CHAT_ID` and send a test ping (no secrets stored).
- `make setup` (optional) — install deps and Playwright; `make scrape`; `make test-telegram`.
- Toggle adapters in `scrape.js` via the `ADAPTERS` constant (Facebook stays off in CI unless you enable it locally).
- Optional local overrides go into `scripts/local/.env` (start from `.env.template`) but keep secrets out of source control.

## CI pipeline
- `.github/workflows/scrape.yml` runs every 30 minutes and on demand.
- The workflow installs Node 20, Playwright browsers, runs the scraper, and commits `exports/unified.json` when new data lands using the message `feeding the condo beast 🦊🍣`.
- Ensure GitHub Actions has permission to push to your branch (Settings → Actions → General → Workflow permissions → "Read and write permissions").

## Phase 2: Modern adapters
- [ ] Implement realtorAdapter(): navigate to Realtor.ca rentals filter (≤$1900, 1 bed + den keyword, parking, York Region); collect title, price, address, city, building (if present), link, photo, floor text if given; throttle (2–4s) between page requests. Respect site ToS.
- [ ] Implement condosAdapter(): similar filters; handle infinite scroll with `page.evaluate` + `scrollBy` loop and `waitForSelector`. Parse cards robustly; fall back to regex on innerText.
- [ ] Facebook Marketplace — local-only script using my browser session; never commit cookies.

## Telegram + Sheets secrets
- Never commit real tokens or IDs. Populate them only inside Apps Script prompts or local `.env` files that stay untracked.
- Keep the Sheet ID handy (the string between `/d/` and `/edit` in the Sheet URL) when wiring the Apps Script fetch URL.

## Facebook Marketplace adapter (optional)
1. In your browser, log into Facebook and open the Marketplace housing feed for Toronto.
2. Export cookies to JSON (e.g., Chrome DevTools → Application → Cookies → Export, or a cookie exporter extension) and save them to `scripts/local/fb_cookies.json` — the file is ignored by git.
3. Flip `ADAPTERS.FB` to `true` inside `scrape.js` when you want to include Marketplace listings; leave it `false` for CI.
4. Run `PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npm run scrape` locally; the adapter reuses your saved cookies and skips gracefully if Facebook is unreachable.

## Logs & troubleshooting
- Scraper logs counts per data source and surfaces the first 2 titles for a quick smoke check.
- Apps Script fallback RSS pulls Kijiji/Craigslist if the GitHub JSON is offline.
- If Playwright launch fails locally, rerun `npm i && npx playwright install --with-deps`.
- If Playwright complains about missing browsers, set `PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers` when running `npm run scrape`.
