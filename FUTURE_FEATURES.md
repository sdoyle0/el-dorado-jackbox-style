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

| # | Feature | Complexity (1-5, effort) | Value (1-5, to game) | Notes |
|---|---------|--------------------------|----------------------|-------|
| 4 | Rubble-toll UX revisit | 2 — client-only (`main.js`, `CardUI.js`) | 4 — fixes live tester confusion | Simplest high-value pick |
| 5 | Multiple map layouts | 3 — per-map JSON + seams + picker, `loadMap` already generic | 4.5 — biggest replayability win, no rule risk | 2nd pick, well-isolated |
| 1 | Two-pawn duel (2P) | 4.5 — win logic, occupancy, per-card picker on all views | 3.5 — only matters for 2P games | High cost, defer |
| 2 | AI-bot opponents | 3 — harness + discard-to-cycle logic | 2 — low value for party format | Blocked on format question |
| 3 | Single-screen revival | 2 — verify + port as separate project | 2 — out of mainline direction | Only if fallback wanted |
| 6 | Game-feel / presentation polish | 2 per slice, 3.5 total — client/CSS/audio only | 5 perceived ("looks like a real game"), 0 rules | New entry below, slice it |

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
- Status (Oct 2026): Option A shipped — named toll target (destination
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
    final-round / win fanfare.
  - d) Menu/lobby warmth — title screen, animated background, footer
    credits; loading states that don't look like placeholders.
- Status (Oct 2026): slice (a) shipped — pawn slides (`HexRenderer`
  rAF lerp, reduced-motion aware, chained moves chain smoothly),
  played-card flourish (`CardUI` + CSS, transform-only), blockade-break
  screen shake (existing `.shake` on `#board-container`, zoom-safe).
  Purchase fly-to-discard deferred: no discard-pile element exists in the
  UI to fly to. Valid-move pulse + turn flash already existed, untouched.
- Status (Oct 2026): slice (b) shipped — felt-table board backdrop, per-tile
  tonal variation + vignette + deterministic speckle (all low-opacity, below
  badges/rings, El Dorado keeps its own ornament), card frame top-light +
  edge, card-name weight, card-art fill rule, small TV status-strip type
  bumps. Deliberately restrained: terrain color-coding still dominates.
- Start at: `client/src/game/HexRenderer.js` (pawn/move animation layer),
  `client/src/game/CardUI.js` (play-animation hook), `client/src/styles/`.
