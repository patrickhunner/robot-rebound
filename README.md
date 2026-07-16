# Robot Rebound

A desktop-first multiplayer sliding-robot puzzle game. Players place five robots, study a hidden challenge after it is revealed, bid a move count, and prove the lowest bid live to the room.

## Prerequisites

- Node.js 18 or newer
- Corepack (`corepack enable`) or pnpm 9

## Run locally

```sh
corepack pnpm install
corepack pnpm dev
```

Open `http://127.0.0.1:5173` in multiple normal/private browser windows. Port 3001 is the backend API and redirects its root to the browser UI during development. Create a room in one window and join from the others with its six-character code.

The browser client hot-reloads. The backend deliberately does not watch files because workspace builds previously caused repeated restarts; restart `corepack pnpm dev` after changing server or shared rules.

On free Render deployments, the Discord Activity may take up to two minutes to wake the server after inactivity. The preparation screen retries the health check automatically before requesting Discord authorization and offers an in-app Retry button if the server is still unavailable.

Discord Activity mode needs these environment variables on the server:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- optional `DISCORD_REDIRECT_URI` or `APP_BASE_URL` if your Discord OAuth setup requires an explicit redirect target

The browser client reads `VITE_DISCORD_CLIENT_ID` when it runs inside Discord. The app uses relative `/socket.io`, `/health`, and `/api/discord/token` requests so it can work both on localhost and through Discord's proxy.

## Quality checks

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

See [game design](docs/game-design.md), [architecture](docs/architecture.md), and [roadmap/testing](docs/roadmap-and-testing.md).

## Deploy to Render

The root `render.yaml` defines one free Render web service that builds the client and server, serves them from one origin, and supports the existing Socket.IO connection. Create a Render Blueprint from the repository and enter the four requested Discord variables in the Render dashboard. Use the same application ID for `DISCORD_CLIENT_ID` and `VITE_DISCORD_CLIENT_ID`; only the latter is compiled into the browser bundle. Never commit the client secret or bot token.

After the deployment reports healthy, verify `https://<service>.onrender.com/health`, then change the Discord Activity URL mapping for `/` from the development tunnel to `https://<service>.onrender.com`. The OAuth2 redirect remains the Activity placeholder `https://127.0.0.1`.
