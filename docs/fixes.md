## New Features

## Submitted For Review (move new features here once completed)

1. **Preserve the completed proof board** — Successful proofs now enter review with their final robot positions and winning move count intact. The board stays there until someone manually resets it; optimal-strategy playback likewise remains on its final solved position.
2. **Precompute optimal strategies** — The browser worker begins solving as soon as the target is revealed and continues invisibly through bidding and proving. Its cached result appears only after the accepted proof opens review.
3. **Use distance-independent robot speed** — Animation and shared playback timing now scale with cells traveled, giving every robot the same board-traversal speed for short and long slides.
