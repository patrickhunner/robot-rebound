## Requested Changes

No active requests.

## Submitted For Review

1. **Move timers into editable lobby settings**  
   Room creation now only asks for a name. The host can change bidding and proof durations in the lobby and save them repeatedly until Start; guests see the selected values and the server rejects changes after play begins.

2. **Support configurable match length**  
   Hosts can select 1–999 rounds. The server builds shuffled 17-target cycles, uses a random subset for shorter matches, and reshuffles before repeating destinations for matches longer than 17 rounds.

3. **Add a won-tile leaderboard left of the board**  
   Each round winner receives that destination tile. The left leaderboard renders captured colors/symbols next to each player and sorts by tile count, with ties sorted by name.

4. **Enlarge proof progress and Reset to the board's right**  
   Proof move usage is now shown in a dedicated high-contrast right-side panel with large numbers. The active prover receives a large Reset Proof button immediately below it.

1. **Replace bidding controls with focused entry and quick bids**Eligible players receive an empty, automatically focused numeric text field that submits on Enter. A five-column grid of buttons numbered 1–30 submits and locks a bid immediately.
2. **Keep the selected robot active between moves**Placement and proof begin with no robot selected. After selection, the same robot remains selected through moves until another robot is chosen or the game phase changes.
3. **Begin proof when everyone has bid**Proof starts immediately once every connected, round-eligible player has submitted. Disconnected seats and mid-round joiners do not block progression.
4. **Visually distinguish the active player's screen**The designated placer and active prover receive a distinct full-screen background tint that other players do not see.
5. **Draw attention to Reveal Destination**
   The active placer's Reveal Destination button pulses while the room is waiting, with animation disabled for users who prefer reduced motion.
