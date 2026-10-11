# Future Features & Deferred Ideas

Bigger items deliberately kept out of the current work so playtesting stays
stable. Each entry records *why deferred*, *rough scope*, and *where to start*.
Promote an entry by giving it a room option / variant gate (same pattern as
`enableBlockades`) and its own test path — never branch current default paths.

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
