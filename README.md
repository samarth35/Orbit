# Orbit

Orbit brings tasks, notes, calendar blocks, focus sessions, and group leaderboards into one workspace. A persistent sidebar on desktop and labeled navigation on mobile keep each part of your day within reach.

**Live app:** https://orbit-alpha-lyart.vercel.app

## Features

- Google sign-in and guest sessions, with HttpOnly session cookies and CSRF protection.
- Link a new Google identity to a guest workspace without losing its tasks, notes, or groups. Signing into an existing Google account opens that account's workspace.
- Tasks with priority, due dates, and context, saved in one request.
- Notes with debounced autosave, save feedback, and protection against delayed responses overwriting newer edits.
- A calendar timeline with date selection, editable blocks, and time validation.
- Focus sessions with pause/resume, reset, a timer that survives navigation and reload, and server-validated scoring that excludes paused time.
- Groups, invite codes, member roles, and day/week/month/year leaderboards.
- The original purple glass, animated grid, and focus visuals, with light mode, keyboard navigation, reduced-motion support, and a fallback for devices without WebGL.

## Stack

React 18 and Vite, FastAPI, SQLite for local development, and Postgres for production. Public Sans and Cormorant Garamond are served locally; their licenses are in `public/fonts/`.

## Run locally

From PowerShell, with Node.js and Python 3.12 or later installed:

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
npm run build
npm run serve
```

Open http://127.0.0.1:4174. An empty `DATABASE_URL` uses `data/orbit.sqlite3` locally.

For frontend development, keep the backend running and run `npm run dev` in a second terminal. Vite proxies `/api` to the backend on port 4174.

## Deploy on Vercel

The repository includes a FastAPI entrypoint, Vite build configuration, and `vercel.json`. Select the **FastAPI** framework preset and deploy from the repository root. Vercel builds the frontend and serves static assets through its CDN.

Set these server-side environment variables for Production:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Hosted Postgres connection string; a pooled connection is suitable for serverless deployment. |
| `ORBIT_SESSION_SECRET` | A unique random secret of at least 32 characters. Keep it stable across redeploys. |
| `ORBIT_GOOGLE_CLIENT_ID` | Existing Google web application OAuth client ID. |
| `ORBIT_GOOGLE_CLIENT_SECRET` | Secret for the same Google OAuth client. |
| `ORBIT_PUBLIC_BASE_URL` | Optional explicit HTTPS origin. Otherwise Orbit uses Vercel's production domain. |
| `ORBIT_GOOGLE_REDIRECT_URI` | Optional explicit callback. Defaults to the public origin plus `/api/auth/google/callback`. |

In that Google OAuth client's Cloud Console settings, add the production HTTPS origin and the matching `/api/auth/google/callback` redirect URI. If Google marks the OAuth app as Testing, only its configured test users can sign in until its publishing settings are changed.

Vercel deployments require Postgres and a valid session secret; Orbit refuses to start with temporary SQLite storage there. Use a separate database and corresponding credentials for preview environments. Changing a public origin requires updating the Google OAuth callback too.

To deploy from a signed-in CLI:

```powershell
npx vercel link
npx vercel --prod
```

`/api/health` checks database connectivity. Unknown `/api` paths return JSON errors, while app routes such as `/tasks` and `/notes` load the frontend directly.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests -q
npm run build
```

Regression coverage includes session isolation, CSRF, Google callback binding and replay protection, verified email checks, persistent guest upgrades, focus pause/resume/reset, repeat completion requests, calendar validation, and group permissions.
