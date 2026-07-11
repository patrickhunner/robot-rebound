# Roadmap and testing

## Delivery increments

1. Pure board and movement engine with unit coverage.
2. One-round vertical slice across two browser sessions: placement, reveal, bid, proof, and score.
3. Full room lifecycle: capacity, reconnect, late join, cleanup, host transfer, and command rejection.
4. Full target deck, placement cycling, results, and rematch lobby.
5. Browser automation and manual multiplayer acceptance.

## Manual multi-window checklist

1. Start the app and open a host plus at least two private/isolated windows.
2. Create and join by code; verify unique-name rejection and synchronized presence.
3. Verify round one is randomized, reposition a robot with two clicks, use Randomize, and confirm every window sees the reveal.
4. Submit tied and differently sized bids, then watch proof moves live; verify endpoint highlights, reset, exact-count success, timeout, next-bidder fallback, and all-fail retry.
5. Refresh a player and verify restoration. Join during a round and verify eligibility begins next round.
6. Disconnect the placer and host to exercise the two-minute grace and transfers.
7. Complete a match, confirm shared winners when tied, and return to the same lobby.

## Automated strategy

Vitest covers pure motion, placement, target matching, and room transitions. Playwright creates one isolated browser context per player for the critical create/join/play/reconnect flow. Tests use short injected deadlines or a controllable clock rather than waiting for production timers.
