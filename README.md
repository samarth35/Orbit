# Orbit

Orbit is a social lock-in productivity app: tasks, notes, calendar blocks, focus sessions, groups, and score-based leaderboards in one dark-first command center.

It runs as a React + Vite frontend served by a FastAPI backend, with SQLite persistence for the current version.

## Features

- Google OAuth session login with secure HttpOnly cookies and CSRF protection.
- Guest session mode for quick access.
- Groups with invite codes, member roles, owner controls, and leaderboards.
- Backend-computed lock-in score across day, week, month, and year.
- Anti-cheat scoring for completed work and valid focus sessions.
- Tasks, notes, routines, calendar blocks, profile, and Pomodoro-style focus.
- Dark/light UI with React Bits-inspired animated surfaces and glow components.

## Tech Stack

- React 18 + Vite
- FastAPI + Uvicorn
- SQLite
- Motion, GSAP, OGL, Lucide icons

## Local Setup

Install frontend dependencies:

```bash
npm install
```

Create and install backend dependencies:

```bash
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

Create `.env` from `.env.example` and fill in your values:

```bash
copy .env.example .env
```

Run the production-style local app:

```bash
npm run build
npm run serve
```

Open:

```text
http://127.0.0.1:4174
```

For frontend development, run the backend and Vite dev server in two terminals:

```bash
npm run serve
npm run dev
```

Then open:

```text
http://127.0.0.1:5173
```

## Environment Variables

Required for deployment:

```env
ORBIT_PUBLIC_BASE_URL=https://your-domain.com
ORBIT_SESSION_SECRET=use_a_long_random_secret
ORBIT_GOOGLE_CLIENT_ID=your_google_client_id
ORBIT_GOOGLE_CLIENT_SECRET=your_google_client_secret
ORBIT_GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/google/callback
```

Optional:

```env
ORBIT_GOOGLE_AUTH_URL=
ORBIT_GOOGLE_TOKEN_URL=
```

Leave the optional Google URLs blank unless you intentionally need custom OAuth endpoints.

## Google OAuth Setup

In Google Cloud Console:

1. Create or choose a Google Cloud project.
2. Configure the OAuth consent screen.
3. Create an OAuth Client ID for a web application.
4. Add authorized JavaScript origins:

```text
http://127.0.0.1:4174
https://your-domain.com
```

5. Add authorized redirect URIs:

```text
http://127.0.0.1:4174/api/auth/google/callback
https://your-domain.com/api/auth/google/callback
```

6. Put the client ID, client secret, public base URL, and redirect URI into your deployment environment variables.

## Deploy For Users

Orbit is easiest to deploy as one Docker web service. The included `Dockerfile` builds the React app, installs FastAPI dependencies, and serves everything from one container.

### Recommended Hosting Shape

- One web service/container.
- One persistent disk/volume mounted at:

```text
/app/data
```

- HTTPS enabled by the platform.
- Do not run multiple replicas while using SQLite. If you need horizontal scaling later, move persistence to Postgres.

### Render

1. Push this repo to GitHub.
2. Create a new Render Web Service from the GitHub repo.
3. Choose Docker deployment.
4. Add a persistent disk mounted at:

```text
/app/data
```

5. Add the environment variables listed above.
6. Deploy.
7. Copy the public Render URL into:

```env
ORBIT_PUBLIC_BASE_URL=https://your-render-url
ORBIT_GOOGLE_REDIRECT_URI=https://your-render-url/api/auth/google/callback
```

8. Add the same redirect URI in Google Cloud Console.

### Railway

1. Create a Railway project from the GitHub repo.
2. Let Railway build from the Dockerfile.
3. Add a persistent volume mounted at:

```text
/app/data
```

4. Add the environment variables listed above.
5. Deploy and use the generated HTTPS domain.
6. Add that domain and callback URL in Google Cloud Console.

### Any Docker Host

Build locally:

```bash
docker build -t orbit .
```

Run locally:

```bash
docker run --rm -p 8000:8000 --env-file .env -v orbit-data:/app/data orbit
```

Open:

```text
http://127.0.0.1:8000
```

For production, set `ORBIT_PUBLIC_BASE_URL` and `ORBIT_GOOGLE_REDIRECT_URI` to the public HTTPS URL.

## Health Check

Use:

```text
/api/health
```

FastAPI docs are available at:

```text
/docs
```

## GitHub Push

If this folder is not already a real Git repository:

```bash
git init
git branch -M main
git add .
git commit -m "Build Orbit social lock-in app"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

If the remote already exists:

```bash
git add .
git commit -m "Prepare Orbit for deployment"
git push
```

## Notes

- `.env`, SQLite files, `node_modules`, `dist`, `.venv`, and local Codex folders are ignored.
- Keep `ORBIT_SESSION_SECRET` private and unique per deployment.
- SQLite is fine for the first public test. Use a persistent disk so user data survives redeploys.
- For production teams or high traffic, migrate from SQLite to Postgres before scaling.
