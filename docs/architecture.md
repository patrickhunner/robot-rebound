# Architecture

## Shape

The repository is a pnpm workspace with three packages:

- `shared`: pure domain types, board data, movement rules, validation schemas, and the Socket.IO contract.
- `server`: Express and Socket.IO, with authoritative rooms held in memory.
- `client`: React/Vite UI. It renders snapshots and sends commands but never decides whether an action succeeded.

One Node process can serve the production client and WebSocket endpoint. A process restart deliberately removes active rooms.

## Authoritative state

Every room occupies exactly one phase: lobby, placement, solving, bidding, proving, or results. Commands are accepted only in their valid phase and role. Lobby timer/round settings become immutable when Start is accepted. The server broadcasts a complete public snapshot after each accepted action, including each player's won-target tiles. This deliberately favors clarity and reconnect reliability over compact event streams.

Finite timers store absolute server deadlines. Browsers display their own countdown from those deadlines, while server timers perform transitions. Unlimited proofs use a `null` deadline and advance only on an exhausted bid or after a disconnected prover's grace period. A reconnect token identifies a guest for two minutes; tokens are kept per browser tab in session storage so several local windows can be independent players.

After a successful proof, the server enters a review phase instead of advancing immediately. It owns the shared review positions, move counter, and per-robot player locks. Review resets restore the round's revealed positions, and review movement never changes scoring or the next round's starting positions.

The host may change the room's 1–10 robot animation speed in any phase. During shared strategy playback, the server validates the submitted solution against the round-start positions, resets the review board, blocks manual review interactions, and broadcasts one authoritative move at a time using that speed.

Random placement is generated and validated by the server. The client uses the shared movement engine only to preview legal proof endpoints; clicking one still sends a directional command that the server independently recalculates.

Optimal strategies are derived from the immutable round-start snapshot in a browser Web Worker. The pure shared solver searches only as deep as the accepted proof, returns at most five proven shortest sequences, and has no authority over room state.

## Trust boundaries

The server validates room codes, names, host actions, placement cells, bid ownership/counts, proof ownership, movement, deadlines, and target completion. Runtime schemas reject malformed socket payloads before they reach room logic.

## Editing quadrants and the board

The board is assembled from the four entries in the exported `quadrants` array in `packages/shared/src/board.ts`. Each quadrant uses its own zero-based 8×8 coordinates: row 0/column 0 is its top-left cell and row 7/column 7 is its bottom-right.

Always author a quadrant in its canonical **northwest** orientation:

- Its outside edges are north and west; its center-facing corner is southeast.
- A target needs a globally unique `id`, local `{ row, col }`, required robot color (or `wild`), and symbol.
- A wall is local `{ row, col, side }`, where `side` is `north`, `east`, `south`, or `west`. One entry blocks movement from that cell and the neighboring cell's opposite side.
- Keep every local coordinate from 0 through 7. The central 2×2 blocked area and full-board outer boundary are added by the assembler, not authored in individual quadrants.

At match start the server shuffles the four quadrant entries into northwest, northeast, southeast, and southwest positions. `assembleBoard` rotates each quadrant zero, one, two, or three clockwise turns for its corner, including every wall direction. This keeps the quadrant's outside edges facing the board boundary and its center corner facing inward.

Across the four quadrant definitions, retain exactly 17 targets with unique IDs and positions after assembly. The current division is three quadrants with four targets and one with five, including the wildcard. After an edit, run `corepack pnpm test`, then restart `corepack pnpm dev`.
