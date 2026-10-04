# Quest for El Dorado — TV + Phone Conversion Plan

Goal: host the server + shared board on a machine shown on the TV, and have each
player connect by phone on the same WiFi to play with a private hand.

Core idea: TV = public board display. Phone = private hand + action buttons.
Server remains the authority (it already rejects out-of-turn actions).

## How to use this doc in new chat sessions

Each work block below is designed to fit in one small-context session.
To start a block, open a new session and paste its "Session starter prompt"
verbatim, along with this file path (`TV_PHONE_PLAN.md`).

Rules for every session:
- Only touch the files listed in "Scope".
- Do not refactor unrelated code.
- End with manual verification steps from "Acceptance".

## Verified architecture snapshot (Oct 2026)

- `server/server.js` — Express + Socket.IO. Events: `create_room`, `join_room`,
  `start_game`, `play_card`, `cancel_card`, `move_pawn`, `move_to_rubble`,
  `break_blockade`, `end_turn`, `purchase_card`, `choose_reserve_card`,
  `discard_card`, plus `debug_*`.
- `server/game/GameManager.js` — rooms, `io.to(owner.socketId).emit('hand_updated', ...)`
  so each phone already receives only its own hand. Broadcasts everything else
  to the room.
- `server/game/GameState.js` — `_isCurrentPlayer()` guards `playCard`,
  `movePawn`, `movePawnToRubble`, `breakBlockade`, `purchaseCard`, `endTurn`.
  Server is the source of truth for turns, valid moves, blockades, market.
- `shared/constants.js`, `shared/cardData.js`, `shared/HexBoard.js`,
  `shared/blockadeData.js`, `shared/mapData.json` — cards, terrain, movement
  validation, blockade seams, full tile map.
- `client/src/game/GameClient.js` — thin Socket.IO wrapper. Notable: server
  emits `valid_moves_updated`, client exposes it as `onValidMoves`.
- `client/src/main.js` — lobby/waiting/game screens, `selectCardForMove()`,
  turn label, legend, toasts, debug panel.
- `client/src/game/HexRenderer.js` — SVG board, `setValidMoves()`,
  `setBreakableBlockades()`, `renderBlockades()`, `zoomToTiles()`.
- `client/src/game/CardUI.js` — hand/market/rubble modes.
- `client/src/game/Tutorial.js`, `client/index.html` — tutorial overlay, layout.

Important constraint: `renderer.onTileClick` is currently global. For TV+phone,
TV should be display-only (or host-only), phones send `move_pawn` / `break_blockade`.
Never trust the client for legality — server already validates.

## Session progress (living log — update at the end of each block)

- Block 5 (phone market purchase) — done, committed as `aa18b3d`.
- Phone compact-market redesign (in-flow sticky top sheet + compact rows,
  pool chips, pool-value badges, ℹ️ row details; `CardUI.js` + `main.js`
  only, no server/shared changes) — done, committed as `80f033e`.
  Rollback to pre-redesign: `git reset --hard aa18b3d`.
- Block 5b (phone HUD declutter: `#hud` hidden on `?view=phone` only;
  turn signaling via toast + End Turn enable/disable) — done, committed
  as `0f8e04e`.
- Phone follow-ups (boardless phone: board + toggle hidden, hand as
  full-width rows, larger move badges; market rows regain terrain color +
  movement chips; pool badge overlay via `market-pooling` gutter;
  destination list ordered under hand) — committing now.
- Block 6 (phone rubble/camp/purple/blockades: breakable blockades as
  tappable rows in the move-list panel → `break_blockade`; rubble toll
  hints + 44px Cross Rubble/Cancel; camp landing toast/log; persistent
  Scientist/Travel Log remove banner with optimistic count; `main.js` +
  `CardUI.js` only, no server/shared changes) — done, committing now.
- Next: Block 7.
- Block 7 (TV polish: thicker highlights/pawns/blockades/finishing tiles,
  zoomToTiles 2.0→2.4, TV banner/legend/modal/toast sizing, halo-pulse fix;
  `HexRenderer.js` + `index.html` + CSS only) — done, uncommitted.
- Block 7b (TV board-first layout: slim status strip, log behind 📓 toggle,
  Market+Reserve as an always-visible sidebar; `index.html` + `main.js`
  toggle wiring + `tv-phone.css` only, no server/shared/gameplay) — done,
  uncommitted.
- Block 7c (TV market sidebar parked: #card-market hidden on TV, board
  full-bleed; sidebar CSS kept intact for later, phones unaffected) — done,
  uncommitted.

## Work blocks

### Block 1 — LAN smoke test, no feature code
Scope: no code changes unless needed for LAN access. May read
`server/server.js`, `server/package.json`.
Do: start server with `PORT=3000`, connect from 2 phones on same WiFi via
`http://<host-lan-ip>:3000`, create room on one, join with code on other,
play a full turn each.
Do not: change game logic, UI, or add modes.
Acceptance: 2 phones complete play-card → move → end-turn with no server
restart; out-of-turn tap shows error toast, not a state corruption.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 1. Walk me through exposing the existing server on my LAN and smoke-testing a 2-phone game with zero game-logic changes. Tell me the exact commands to start the server, how to find my host LAN IP, what URLs to open on TV vs phones, and what to verify (create room, join by code, play card, move, end turn, out-of-turn error). If and only if LAN access needs a code change (e.g. listen address), propose the minimal diff to server/server.js.

### Block 2 — `?view=tv` / `?view=phone` mode split (scaffolding only)
Scope: `client/index.html`, `client/src/main.js`, small CSS in `client/src/styles/`.
Do: parse `?view=` param. `tv`: hide hand input, show board + turn banner +
legend large. `phone`: stack hand + primary buttons, keep board collapsed or
hidden behind a toggle. No new game logic.
Do not: change `HexRenderer.js`, `CardUI.js`, server files.
Acceptance: opening `?view=tv` vs `?view=phone` in two tabs shows the two
layouts; both still join the same room and receive the same events.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 2. Implement only the ?view=tv / ?view=phone layout split. Files: client/index.html, client/src/main.js, client/src/styles/*. Touch nothing in server/ or shared/. TV layout hides hand controls and enlarges turn banner/legend. Phone layout prioritizes hand + End Turn / Market buttons and collapses the board behind a toggle. Show the diff and how to verify with two tabs on the same room.

### Block 3 — Phone: private hand + play card + end turn
Scope: `client/src/main.js`, `client/src/game/CardUI.js` (touch sizing only).
Do: confirm phone renders only `onHandUpdated` hand; tap card → `play_card`;
End Turn → `end_turn`; disable controls when `!isMyTurn`.
Do not: touch movement targeting, market, rubble, blockades, server.
Acceptance: on phone, my hand appears, opponent hands never appear; tapping a
card on my turn plays it; on opponent turn controls are disabled.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 3. Make the phone view show only my hand and support play-card + end-turn. Files: client/src/main.js, client/src/game/CardUI.js touch sizing only. No server/shared changes. Verify: my hand renders from onHandUpdated, tapping a card emits play_card, End Turn emits end_turn, controls disable on opponent turns.

### Block 4 — Phone move selection WITHOUT board navigation (key UX decision)
Scope: `client/src/main.js` (valid-moves list UI), no `HexRenderer.js` changes.
Do: when `onValidMoves` arrives, render a tappable list on the phone:
destination tile id + terrain icon + cost (e.g. "🌿 0_-1 ×1"), plus Cancel.
Tap list item → `move_pawn`. TV continues to highlight the same tiles via
existing `setValidMoves()`. This avoids pinch-zoom board nav on phones.
Do not: build a phone board renderer or minimap in this block.
Acceptance: after playing a movement card, phone shows 1+ destinations;
tapping one moves the pawn on TV; invalid/empty list shows "No valid moves".

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 4. Implement phone move selection as a tappable valid-moves list, no phone board navigation. Use the existing onValidMoves payload in client/src/main.js to render destination tile + terrain + cost with Cancel, emitting move_pawn on tap. Do not modify HexRenderer.js or server/. Verify by playing Explorer/Sailor and moving from the list while TV highlights update.

### Block 5 — Phone market purchase
Scope: `client/src/main.js`, `client/src/game/CardUI.js` (market pool mode).
Do: phone Market button → tap hand cards to pool `purchasingPower` (live total)
→ tap affordable market card → `purchase_card`. Handle `purchase_opened`
(Transmitter), `market_updated`, `prompt_reserve_choice`.
Do not: change pricing logic (lives in `shared/cardData.js` + server).
Acceptance: can pool yellow + 0.5-value cards, buy 1 card/turn, reserve picker
appears on sellout.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 5. Implement phone market purchase using existing CardUI market mode. Files: client/src/main.js, client/src/game/CardUI.js. No pricing-logic changes. Verify: pool shows live total, affordable cards enabled, purchase emits purchase_card, reserve picker works on sellout.

### Block 5b — Phone HUD declutter (log + turn info live on TV)
Scope: `client/index.html`, `client/src/main.js`, small CSS in `client/src/styles/`.
Do: in `?view=phone` only, hide the TV-duplicate HUD (turn banner, player
legend, game log / Field Notes) so the hand + market sheet own the screen.
Keep turn signaling via the existing "Your turn!" toast and button
enable/disable; do not change turn logic or events.
Do not: change `HexRenderer.js`, `CardUI.js`, server/, shared/. Desktop and
`?view=tv` layouts must be unaffected.
Acceptance: on phone the HUD block is gone and the reclaimed space goes to
hand/market; End Turn still enables only on my turn; "Your turn!" toast still
fires; TV still shows banner, legend, and log.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 5b. In ?view=phone only, hide the TV-duplicate HUD (turn banner, player legend, game log). Files: client/index.html, client/src/main.js, client/src/styles/*. Touch nothing in server/ or shared/, and change nothing in CardUI.js. TV and desktop layouts must be unaffected. Verify: phone shows hand + market with no HUD block, End Turn enables only on my turn, Your-turn toast still fires, TV still shows all HUD elements.

### Block 6 — Phone rubble / camp / purple cards / blockades
Scope: `client/src/main.js`, `client/src/game/CardUI.js` (rubble mode),
`break_blockade` wiring.
Do: rubble extra-card picker → `move_to_rubble`; Native/Cartographer/etc.
follow existing prompts; breakable blockades appear as tappable list items
(same pattern as Block 4) → `break_blockade`.
Do not: change `GameState.js` movement/blockade rules.
Acceptance: rubble cost-2 tile requires +1 card; Native moves anywhere legal;
breakable blockade can be broken from phone list.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 6. Wire phone rubble payment, camp/special-card prompts, and blockade breaking as tappable lists. Files: client/src/main.js, client/src/game/CardUI.js. No server/shared rule changes. Verify each: rubble move_to_rubble, purple prompts, break_blockade updates TV.

### Block 7 — TV polish for living-room readability
Scope: `client/src/game/HexRenderer.js`, `client/index.html`, CSS.
Do: larger default zoom, thicker valid-move strokes, bigger turn banner,
legend with hand counts, final-round/game-won banners readable at 10ft.
Do not: add input handling on TV (display-only except host start).
Acceptance: from couch distance, current player, valid highlights, pawns,
blockades, finishing tiles are all legible.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 7. Polish TV display only: zoom defaults, highlight stroke widths, turn banner, legend, final-round and game-won banners. Files: client/src/game/HexRenderer.js, client/index.html, CSS. No gameplay changes. Tell me what to eyeball on a TV.

### Block 8 — Edge cases: disconnects, final round, game over
Scope: `server/game/GameManager.js` (disconnect only if needed), `client/src/main.js`
(rejoin + banners).
Do: phone refresh mid-turn keeps seat if socket rejoins quickly (or document
that seat is lost); final-round and game-won modals show on both TV and phones
with blockade tiebreak counts.
Do not: add persistence DB or AI in this block.
Acceptance: kill-and-rejoin phone doesn't crash room; final round triggers
when landing on `isFinishing`; winner screen shows on all views.

Session starter prompt:
> Read TV_PHONE_PLAN.md Block 8. Harden disconnects + final-round/game-over across TV and phones. Prefer minimal changes in server/game/GameManager.js and client/src/main.js. Verify: phone refresh behavior, final_round_started on all views, game_won with blockade counts.

## Other considerations

- Same-WiFi only for MVP; `cors: { origin: '*' }` is fine locally. Don't
  expose to internet without auth.
- Touch targets: aim 44px minimum on phone; TV highlights need thick strokes,
  not precise clicks, since TV is display-only.
- Phones stay portrait-friendly: hand + action list, board stays on TV.
  This is why Block 4 uses a destination list instead of phone board nav.
- No hand data leaks: server already DMs `hand_updated` per socket; keep it
  that way. Never broadcast full hands.
- `debug_*` events (`debug_set_hand`, `debug_teleport`) are dev-only; disable
  or gate before a party session.
- Blockade terrain pool has a TODO placeholder (duplicate rubble) in
  `shared/blockadeData.js` — confirm against physical box before calling it final.
- If a phone dies mid-turn, the turn is stuck until End Turn or server restart.
  Cheap fix: host "force end turn" button (future block, not in MVP).
- Future ideas (out of scope): persistent game save, AI opponent, Step 2-player
  second-pawn rules, caves variant from rulebook pp. 6-7.
- Hands-off TV operation (7d notes, not in MVP — wireless mouse covers this
  for now): nobody touches the laptop after setup (zoom buttons already
  hidden on TV). Candidates: phone-local board zoom for close-up move
  planning on your turn (hopefully the TV is big enough to skip this);
  let a phone (e.g. the host's) Start Expedition so the TV never needs a
  click; auto-dismiss (or skip) TV modals, which currently wait for a click
  no one is around to give.
