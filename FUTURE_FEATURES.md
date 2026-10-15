# Future Features & Deferred Ideas

Bigger items deliberately kept out of the current work so playtesting stays
stable. Each entry records *why deferred*, *rough scope*, and *where to start*.
Promote an entry by giving it a room option / variant gate (same pattern as
`enableBlockades`) and its own test path — never branch current default paths.

## Ranked summary (Oct 2026)

TV_PHONE_PLAN.md (jackbox conversion: TV + phones) is functionally done —
`?view=tv`/`?view=phone` split, private hands, list-based moves, market,
rubble/blockades, TV polish, disconnects/final round, and Block 9 QR join
(`qrcode` dep + `/api/qr` + `?room=` deep link) are all in the code. So this
file is now the single future-features list.

| # | Feature | Complexity (1-5, effort) | Value (1-5, to game) | Status |
|---|---------|--------------------------|----------------------|--------|
| 4 | Rubble-toll UX revisit | 2 — client-only (`main.js`, `CardUI.js`) | 4 — fixes live tester confusion | ✅ Done (`41cb736`; Option B only if two-phase model still confuses) |
| 5 | Multiple map layouts | 3 — per-map JSON + seams + picker, `loadMap` already generic | 4.5 — biggest replayability win, no rule risk | ⬜ Open — suggested next |
| 1 | Two-pawn duel (2P) | 4.5 — win logic, occupancy, per-card picker on all views | 3.5 — only matters for 2P games | ⬜ Open — high cost, defer |
| 2 | AI-bot opponents | 3 — harness + discard-to-cycle logic | 2 — low value for party format | ⬜ Open — blocked on format question |
| 3 | Single-screen revival | 2 — verify + port as separate project | 2 — out of mainline direction | ⬜ Open — only if fallback wanted |
| 6 | Game-feel / presentation polish | 2 per slice, 3.5 total — client/CSS/audio only | 5 perceived ("looks like a real game"), 0 rules | ✅ Mostly done (a, b, d + phones ✅; c partial — SFX ✅, music parked) |
| 7 | End-of-game rematch (play again) | 2 — server reset + client rematch flow, no rule changes | 4 — fast reset keeps a quick game night flowing | ✅ Done (same-room reset to waiting room, host or any seated player triggers) |
| 8 | Phone mini-map movement picker | 3 — pawn-centred SVG excerpt + tap routing, phone-only | 4.5 — biggest live pain point (TV↔phone number-matching) | 🧪 Experimenting — Proposal A live on phones (MiniMap.js excerpt + chips kept below, `?minimap=0` restores list-only for A/B) |

## Done ledger (Oct 2026 — all on master, nothing in flight)

| What | Commit | Notes / remainder |
|---|---|---|
| #4 rubble-toll Option A | `41cb736` | Named target, slot chips, retargeting, toll guards. Option B deferred — revisit only if the two-phase model itself still confuses testers. |
| #6a movement feedback | `7364622` | Pawn slides, card flourish, break shake. Fly-to-discard deferred (no discard-pile element). Pulse + turn flash pre-existed. |
| #6b board/card art | `7c11a93` | Backdrop, tile texture, frames, TV type. |
| #6d lobby warmth | `5f955e2` | Glow drift, credits, spinner, start guard. |
| Phone hand richness | `a207532` | Glow rows, badges, motion, thumbs, gold End Turn, hint icons, badge → rule line. |
| #6c audio (SFX) | `cc648f3` + `8594971` | move/buy/break/turn/win/error live; phones action-only; snapshot music fix. |
| Plan doc retired | (docs-only, inside above) | `TV_PHONE_PLAN.md` marked ✅ COMPLETE legacy reference. |

## Left for future sessions

1. **#5 Multiple map layouts** (suggested next) — only rulebook layout built; transcribe more arrangements + room-level picker + confirm blockade pool per layout.
2. **Music loop revisit** — parked behind `setMusicEnabled` in `client/src/game/Audio.js`. Either vendor royalty-free seamless loops (MP3+OGG under `client/`, `<audio loop>`, keep mute wiring) or re-attempt generative with ears on it. Feel keywords: hand drums + kalimba, minor pentatonic, 80–90 BPM, no vocals.
3. **Purchase fly-to-discard** — needs a discard-pile element in the UI first (nothing to fly to today).
4. **#1 two-pawn duel** — needs variant isolation; high cost.
5. **#2 AI bots** — blocked on settled format; low party value.
6. **#3 single-screen revival** — separate project only.
7. **#7 end-of-game rematch** — ✅ done (details below).
8. **#8 phone mini-map movement picker** — biggest live pain point: today the phone shows numbered chips (1..N) that must be matched to numbered badges on the TV, forcing constant look-up/look-down and mis-taps on multi-step moves. Details below.

## 1. Two-pawn duel variant for 2-player games (from I-G)

Rulebook p5 ("Rules for 2 players"): two pawns each (starts #1+#3 vs #2+#4),
both must finish; per-card piece choice, no splitting one card's power across
pieces; own pieces block each other.
- Why deferred: playable-test setup uses one pawn each; variant rewrites win
  logic and touches movement + UI on every card. Needs isolation.
- Scope: medium-large. `Player.currentTileId` → pawn pair; occupancy checks
  (`shared/HexBoard.js`); per-card piece picker (desktop/phone/TV);
  `_recordFinisher` / `_determineWinner` / final-round flow gated on variant;
  tutorial + debug teleport + reconnect coverage.
- Start at: `server/game/Player.js`, `server/game/GameState.js`
  (`_recordFinisher`, `_determineWinner`, `_relocateFinisher`).

## 2. AI-bot opponents

- Why deferred: bots fit the original single-screen format better than the
  TV+phones format; no bot work until that format question is settled.
- Scope: medium. Internal cycle logic first (bots must discard-to-cycle dead
  hands — see I-C note in `el-dorado-findings.md`); no UI hints needed for bots.
- Start at: bot harness driving `GameStateManager` directly (node probes in
  `el-dorado-findings.md` are the seed).

## 3. Single-screen revival (original format)

The pre-jackbox single-screen mode still ships as the default view (no `?view=`
— layout untouched per `client/src/styles/tv-phone.css`). Playability after the
jackbox conversion is unverified.
- Decision: revive as a **separate project** if wanted; port the rules fixes
  over (Issues 1–4, 7 + rubble-blockade freshness `f0ef9d7`), don't entangle.
- Start at: bare URL with no `?view=` args; verify lobby → game → reconnect.

## 4. Rubble-toll UX revisit

Crossing cost-2+ rubble today is a toll overlay bolted onto a single-card
select-and-move flow (pick mover → toll prompt → pick extras → confirm), which
testers find confusing.
- Why deferred: rules and server flow are correct (`movePawnToRubble` + I-H
  guard); this is presentation-only, and the single-card architecture makes it
  awkward to restructure mid-playtest.
- Scope: small-medium, client-only. Ideas to explore: multi-select cards up
  front, combined cost preview, clearer toll banner on all views.
- Status: ✅ done (`41cb736`) — Option A shipped: named toll target (destination
  number, never internal tile ids), slot chips, rubble→rubble retargeting,
  "Change destination" back-out, Market/Discard mid-toll guards; client-only,
  no TV change. Deeper "pick payment first" rethink (Option B) deferred —
  revisit only if the two-phase model itself still confuses testers.
- Start at: `client/src/main.js` (`attemptMoveToTile`, rubble payment mode),
  `client/src/game/CardUI.js` (`enterRubblePaymentMode`).

## 5. Multiple map layouts

Only the first rulebook example layout is built (`shared/mapData.json` +
`shared/blockadeData.js` seams). The rulebook's assembly guide has ~half a
dozen recommended block arrangements/rotations.
- Why deferred: needs the section/seam framework proven first (current seams
  verified as true cut-sets; see I-E).
- Scope: medium. Per-map tile JSON + seam edge lists (derive programmatically
  from section boundaries as today), room-level map picker, `HexBoard.loadMap`
  already generic — confirm blockade terrain pool per layout.
- Start at: `shared/mapData.json`, `shared/blockadeData.js`,
  `server/game/GameManager.js` (`_startGame`).

## 6. Game-feel / presentation polish ("looks like a real game")

Why: the game is functionally complete and playable (jackbox conversion
done), but it feels rudimentary — flat SVG hexes, pawns teleport between
tiles, silent turns, plain cards/banners. Nothing here changes rules or
legality; it's the "would someone pay for this" pop layer.
- Why new: wasn't needed for playtest stability, but is the highest
  perceived-value work now that gameplay is done.
- Complexity: 2 per slice (low-medium), ~3.5 total. Value: 5 perceived,
  0 rules. Deliberately sliced so each ships independently.
- Rules: client + CSS only (`HexRenderer.js`, `CardUI.js`, `main.js`,
  `tv-phone.css`, one tiny audio helper). No server/shared changes. Additive
  only — never alter event payloads or move legality for a visual.
- Slices:
  - a) Movement & action feedback — pawn slides along path instead of
    teleporting; played-card flourish; valid-move pulse; blockade
    break shake/collapse; purchase fly-to-discard.
  - b) Board & card art pass — terrain texture/vignette, richer card
    frames, hand/market spacing + typography, TV 10ft readability check.
  - c) Audio + turn rhythm — tiny WebAudio bleeps (move, buy, break,
    turn start, win) with mute toggle; turn-banner transition;
    final-round / win fanfare; generative ambient music loop (no assets —
    the table is offline, so it's synthesized, not streamed).
  - d) Menu/lobby warmth — title screen, animated background, footer
    credits; loading states that don't look like placeholders. Phone-view
    richness deferred to a future pass (slice (b) barely touched phones).
- Status: ✅ done — slice (a) shipped (`7364622`): pawn slides (`HexRenderer`
  rAF lerp, reduced-motion aware, chained moves chain smoothly),
  played-card flourish (`CardUI` + CSS, transform-only), blockade-break
  screen shake (existing `.shake` on `#board-container`, zoom-safe).
  Purchase fly-to-discard deferred: no discard-pile element exists in the
  UI to fly to. Valid-move pulse + turn flash already existed, untouched.
- Status: ✅ done — slice (b) shipped (`7c11a93`): felt-table board backdrop, per-tile
  tonal variation + vignette + deterministic speckle (all low-opacity, below
  badges/rings, El Dorado keeps its own ornament), card frame top-light +
  edge, card-name weight, card-art fill rule, small TV status-strip type
  bumps. Deliberately restrained: terrain color-coding still dominates.
  Phone hand richness follow-up shipped separately (glow rows, stat badges,
  motion, thumbs, gold End Turn).
- Status: ✅ done — slice (d) shipped (`5f955e2`): ambient lobby glow drift, footer
  credits, lobby busy spinner, start-button double-tap guard.
- Status: 🔶 partial — slice (c): SFX shipped (`cc648f3` + `8594971`,
  move/buy/break/turn/win/error live; phones action-only; snapshot music
  fix). Music loop PARKED behind `setMusicEnabled` in
  `client/src/game/Audio.js` (two generative attempts didn't land; blind
  timbre iteration converges too slowly) — see "Left" #2 for the revisit.
- Start at: `client/src/game/HexRenderer.js` (pawn/move animation layer),
  `client/src/game/CardUI.js` (play-animation hook), `client/src/styles/`.

## 7. End-of-game rematch (play again without a server restart)

Today a finished game is a dead end: screens only flow lobby → waiting →
game (no back-navigation in `client/src/main.js` `showScreen`), rooms are
deleted once empty (`server/game/GameManager.js` `onEmpty`), and there is no
reset/rematch event. The only reliable reset is a server restart (plus a page
reload for everyone, since Block 8 session rejoin would just rejoin the
finished room). Fine while games are slow; painful once they go quickly and
the table wants an instant rematch.
- Status: ✅ done — `request_rematch` → `GameRoom.tryRematch` (host or any
  seated player, game-over only) swaps in a fresh `GameStateManager`, sets
  `started = false`, and broadcasts `return_to_waiting`; all clients land
  back in the waiting room (same code/seats/options) and the next Start
  re-runs the normal `_startGame` (fresh board, market, decks, pawns home).
  "🔄 Play again" button on the game-won modal (sticky on TV, so it stays up
  there too); double-taps guarded client-side and rejected server-side. No
  rule changes.
- Start at: `server/game/GameManager.js` (`tryRematch`, `_wireGameState`),
  `client/src/main.js` (`onReturnToWaiting`).

## 8. Phone mini-map movement picker (replaces number-matching)

Pain point (live playtesting, Oct 2026): the phone shows numbered chips
(1..N) that must be matched to numbered badges on the TV — eyes go
TV → phone → TV for every option, and multi-step cards make mis-taps easy
(wrong direction picked from a bare number). The numbers exist only to bridge
the two screens; remove the bridge and the problem goes away.
- Proposal A (suggested): pawn-centred mini-board on the phone. When
  `valid_moves_updated` arrives, render a small SVG excerpt around the acting
  pawn (current tile + legal destinations + one ring of context tiles for
  orientation), reusing the same terrain fills + highlight rings as the TV.
  Taps hit `attemptMoveToTile` directly — no numbers anywhere. Scope ~3:
  excerpt renderer (new `MiniMap.js` or a `HexRenderer` excerpt mode),
  viewport math (pawn-centred, radius by `movementTotal`), phone-only panel,
  tap routing; no server/shared changes (same `move_pawn` events).
- Proposal B (cheaper): directional hints on the existing chips. Each chip
  keeps its number but adds a compass nudge + terrain ("↖ 🌿 jungle ×1",
  "2 left after this"), so most picks are made from the phone alone and the
  TV is only a tiebreaker. Scope ~1, but keeps the matching problem alive.
- Proposal C (TV-side): spotlight the phone's hovered option on the TV.
  Phone list gains hover/long-press preview → TV pulses that tile's ring.
  Kills mis-taps but not the look-up/look-down. Scope ~2 (needs a preview
  event + TV pulse hook).
- Proposal D (hybrid): mini-board only for multi-step cards
  (`movementTotal > 1`), numbered chips for single-step. Smallest visual
  change, but two UX paths to maintain.
- Recommendation: playtest B first (one session), then decide whether A is
  worth its weight — A is the only one that removes the numbers entirely.
- Experiment v1 (Oct 2026, uncommitted): Proposal A attempt live — new
  `client/src/game/MiniMap.js` (pawn-centred SVG excerpt: 2 rings around the
  pawn + 1 ring around each destination, TV terrain colours, number badges in
  payload order so map/chips/TV agree, whole-hex tap targets → same
  `attemptMoveToTile`, red outline for the rubble-toll target, pawn dots for
  orientation). Wired into the phone move-list panel in `main.js` ABOVE the
  chips (both visible; Hide/Show map toggle; `?minimap=0` kill-switch restores
  list-only). No server/shared changes. Playtest questions: does the map get
  tapped directly (vs chips as fallback)? Is 2-ring context enough on
  multi-step cards? Keep, tune, or drop based on one session.
- Experiment v2 (Oct 2026, uncommitted): map-only default — the numbered chips
  are hidden behind `SHOW_CHIPS` (`?chips=1` brings map+chips back for
  comparison; `?minimap=0` still forces the old list-only flow). Chip render
  code stays intact underneath, so reintegration = flip the flag. Map header
  now names the played card + remaining budget (`🗺 X · N left — tap a tile`)
  so the panel reads standalone; empty state moved to the sub-line (the chip
  grid's "No valid moves" div hides with it). Blockade-break buttons + Cancel/
  Done row unchanged (the map doesn't cover blockades yet).
- Experiment v3 (Oct 2026, uncommitted): persistent map — it no longer lives
  inside the move list flashing in/out per card. New `#minimap-panel` above
  the move list stays open all game (hidden only while the market is open):
  orientation ("🗺 Your move — play a card" / "🗺 X's turn") when idle or
  watching, yellow options + taps while your movement card is in flight
  (taps stay disarmed until the server's valid-moves echo, so an instant tap
  can't fire move_pawn ahead of play_card). Refresh hooks on turn change,
  pawn moves (stale options dropped at once — also closes the double-tap
  window), dispose, select preview, toll retarget, and roster sync.
- Back pocket (parked after v3 playtest, Oct 2026 — deliberately NOT built):
  (a) breakable-blockade markers on the mini-map — the button list below the
  map feels fine as-is, revisit only if breaking starts feeling disconnected
  from the map; (b) wider context rings for multi-step planning — concern is
  smaller hexes shrinking tap targets on phones, so 2-ring stays the default
  unless playtesting says the orientation loss is worse than the tap cost.
- Start at: `client/src/main.js` (`renderMoveList`, `moveLabelFor`),
  `client/src/game/HexRenderer.js` (`setValidMoves`, TERRAIN fills).
