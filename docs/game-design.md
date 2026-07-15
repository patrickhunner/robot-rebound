# Game design

## Match

A room holds 1–10 uniquely named guests. In the lobby, the host may change the round count from 1–999, select an immediate/15/30/45/60-second bidding window, and select a 15/30/45/60-second or unlimited proof duration until starting. An immediate bid timer moves directly from the first bid to proof. Player order is shuffled once and cycles as the placement order. A late joiner is appended and begins competing with the next round.

The board is a 16×16 grid assembled by shuffling four authored 8×8 quadrants and rotating each to fit its assigned corner. It has a blocked central 2×2 area, internal walls, four destinations for each colored robot, and one wildcard. Consecutively created rooms receive different lobby arrangements; the host may repeatedly shuffle to a guaranteed different arrangement before play, and starting a match reshuffles once more. One assembled match board remains fixed for the configured rounds; every rematch differs from the room's preceding match. The target deck uses shuffled 17-target cycles, taking a random subset for a shorter match and reshuffling all targets before any are repeated in a longer match. A match ends after its configured rounds or when the host confirms an early end. Each success awards its destination tile; current tile leaders share victory.

## Movement

There are red, blue, green, and yellow robots plus a neutral silver robot. A move sends any robot north, east, south, or west until a wall or robot stops it. A direction that produces no movement is illegal. Colored destinations require their matching robot; the wildcard accepts any robot.

## Round state machine

1. Round one begins with five valid random robot positions. Later rounds reuse the previous round's confirmed starting positions. The designated player may accept them, reposition robots by clicking a robot and then a cell, or request another random setup.
2. The server reveals the next destination.
3. Players solve mentally with unlimited time.
4. The first one-time bid starts the configured bidding timer. Players type a count and press Enter or use a 1–30 quick bid. If every connected eligible player submits before expiry, proof begins immediately.
5. Claims are tried by lowest count, then server receipt order.
6. The active player has the host-selected proof duration to demonstrate exactly the bid count. Their screen receives an active-turn color treatment. They click a robot, see its legal landing cells, and click one or use an arrow key to move; that robot remains selected until they choose another. Moves are visible to everyone. Reset restores the placement and move count but not the timer. Unlimited proofs have no countdown; if the prover disconnects, their attempt advances after the normal reconnect grace period.
7. A failed attempt restores the placement and passes to the next bidder. If all fail, the same target returns to unlimited solving.
8. A success awards a point and opens a shared review with the proof's final robot positions still visible. Everyone may demonstrate alternatives with clicks or arrow keys, reset the shared board to the revealed starting positions, and hold one robot lock at a time. A solver that began at target reveal now displays up to five shortest strategies, each of which can be played for the whole room. Automatic playback resets the board and temporarily blocks manual review interaction. These demonstrations do not change scores.
9. The host advances from review to a fresh placement for the next hidden target, or to results after the final round.

## MVP boundary

The MVP includes room codes, guest reconnection, host transfer, presence, scoring, all 17 rounds, shared post-round review, optimal-strategy display, and a post-match return to the same lobby. It intentionally excludes accounts, persistence, chat, matchmaking, board editors, procedural boards, mobile polish, audio, moderation controls, pause/skip, and multi-server scaling.

Robot position changes slide smoothly across the board at a constant cells-per-second rate, so longer slides take proportionally longer. The host can change the shared speed from 1 (slowest) through 10 (fastest) at any time; new rooms begin at speed 5.
