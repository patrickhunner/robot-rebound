## New Features

No pending items.

## Submitted For Review (move new features here once completed)

1. **Preserve the completed proof board** — Successful proofs now enter review with their final robot positions and winning move count intact. The board stays there until someone manually resets it; optimal-strategy playback likewise remains on its final solved position.
2. **Precompute optimal strategies** — The browser worker begins solving as soon as the target is revealed and continues invisibly through bidding and proving. Its cached result appears only after the accepted proof opens review.
3. **Use distance-independent robot speed** — Animation and shared playback timing now scale with cells traveled, giving every robot the same board-traversal speed for short and long slides.
4. **Announce every bid without blocking play** — New bids appear for every player in a queued 1.2-second top banner showing the bidder and move count, paired with a brief screen-edge flash. Existing bids are not replayed after joining or reconnecting mid-round.
5. **Finish each optimal-playback move before the next** — Automatic strategies use the same distance-based cells-per-second timing as manual moves and add a 75 ms settling gap before advancing to the next authoritative move.
6. **Enlarge the play area and target prompt** — The desktop board is roughly 15% larger, with a roomier and more readable target banner, while the existing narrower-screen layout remains intact.
