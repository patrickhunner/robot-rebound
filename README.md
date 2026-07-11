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

## Quality checks

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

See [game design](docs/game-design.md), [architecture](docs/architecture.md), and [roadmap/testing](docs/roadmap-and-testing.md).
