# Screenshot Capture Runbook

Captures are produced by `npm run screenshots` via `screenshots.config.ts` and
`capture.spec.ts` (Playwright), 1440×900, de-CH locale.

## Setup

- **Docker Compose** — the capture expects a running full-stack dev environment.
- **Bare-metal proxying** — set `VITE_DEV_PROXY_TARGET=http://127.0.0.1:8000`, otherwise
  `/media` proxies to `backend:8000` and the `08b-invoice-detail` shot shows `pdfError`.

## Capture model

Every capture uses `screenshotFull` (not `fullPage`): the viewport is grown to the
content height so the sticky sidebar doesn't stop at 900 px while the main column
continues, and Chromium's PDF plugin (viewport-only painting) doesn't leave embedded
viewers blank. Because PDF embeds are 70–72 vh, the helper re-measures after resizing
and solves the linear content-height model to its fixed point in one step. Only the
`04b` assign modal keeps a plain viewport shot.

- **Hover reset:** `page.mouse.move(0,0)` + 250 ms before every shot.
- **Data-dependent captures** pin the global ZEV selection to the seeded demo ZEV
  (the app's fallback otherwise lands on an arbitrary empty tenant).
- **`08b` invoice detail** generates the invoice PDF via the API first — reseeds
  wipe stored artifacts.
- Screenshots ship **unblurred**: the demo seed carries fictional data, so the former
  PII blur CSS and its selector test were removed.

## Rate-limiting

A full run makes ~28 token logins against the `auth_login` throttle (40/hour). When
rerunning within the hour, flush the throttle counters first:

```bash
docker compose exec redis redis-cli -n 1 FLUSHDB
```

Note: Celery uses Redis db 0, rate-limit counters live in db 1.

## Running

```bash
npm run screenshots
```

Output lands in `docs/user-guide/screenshots/`.