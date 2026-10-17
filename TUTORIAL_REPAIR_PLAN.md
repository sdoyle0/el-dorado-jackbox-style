# Tutorial Repair Plan

Companion to `FUTURE_FEATURES.md` item #9. This file holds the working
analysis and fix plan so context survives between sessions.

**STATUS (2026-10-17): FIXED — all 10 bugs landed in one round.**
Implementation notes / deviations from the plan as written:
- Bug 1: `zoomToTiles` now returns a Promise; settle is detected via
  `scrollend` on `#board-container` + document, with a scroll-offset poll
  fallback (grace period so a not-yet-started scroll isn't "done") and a
  1.5 s hard timeout. Tutorial uses `_zoomAndSpotlight()` with a
  generation guard so a late settle can't spotlight the wrong step.
- Bug 2: solved generically — `_spotlightTiles` records the hole rect and
  `_keepCalloutClearOfHole` nudges a centered callout to the side with the
  least overlap (applies to every board step, not just step 3).
- Bug 3: step 10 paints the real `BLK_BC` seam from `shared/blockadeData.js`
  (terrainType `jungle`); the tile group was widened to the full 8-tile seam
  so every plank is inside the spotlight. Cleared on every step change and
  in `exit()`.
- Bug 4: reserve steps re-assert `changeMarketView(true)` (new public
  wrapper), force reflow, anchor to `.market-reserve-section` with
  `#shop-slots` fallback, and pass phone compact selectors
  (`.market-row-item…` / `.market-onetime-pill`) as ordered fallbacks.
  `_anchorCalloutToElement` accepts selector arrays, warns loudly on
  missing/zero-rect targets, and keeps the centered callout visible.
- Bug 5/6: hand is now the real 8-card
  `window.ElDoradoCards.buildStarterDeck()`; Traveler/Explorer anchors are
  by `data-card-key`, not hand position. Step copy already matched the real
  deck, so no rewrite was needed.
- Bug 7: new public seams on CardUI — `onPoolChanged` (fires only when a
  pool click actually changed the pool) and `changeMarketView()`. Step 19
  also keeps Next visible as an escape hatch.
- Bug 8: `start()` always calls `renderer.render(tiles)` (map fetch cached
  in `_mapTilesPromise`), so a prior game's pawns/walls/highlights can't
  leak in.
- Bug 9: chose the honest-comment option — the whole client is
  server-rooted (`/shared/...` script tags), so `file://` was already
  broken beyond the map fetch; a sparse-tile inline fixture would also gut
  step 1's full-map view. `start()` now logs a loud console.error.
- Bug 10: step comments renumbered to UI numbering (index+1 of 25), unused
  tile groups and vestigial `_nextBtn.onclick` / unreachable `!step`
  branch removed, callout size fallbacks derive from `getBoundingClientRect`.
  Note: the old plan text used *comment* numbers for bugs 4/5/7 (Traveler
  = UI step 19, Reserve = UI step 21) — UI numbering is authoritative.

Verified by scripted headless-Chrome walkthroughs at 1920×1080 (all 25
steps + interactions + exit cleanup + restart) and at 390×844
(`?view=phone`, steps 19–24 anchor to compact rows; zero console warnings
in both).

**Follow-up round (2026-10-17, after playtest feedback):**
- Demo hand is a curated **4 cards** (1 Explorer / 2 Travelers / 1 Sailor,
  pulled from the real `buildStarterDeck()` definitions) — an 8-card hand
  read as "my hand will look like this", which it never will. Step 12's
  copy is about the *deck*, so it stays as-is.
- `_anchorCalloutToElement` now: (a) `scrollIntoView({block:'nearest'})`
  the target inside its scrollable ancestors before measuring, (b) clamps
  the hole to those ancestors' folds + the viewport so tall reserve cards
  can't spill the highlight outside the shop window, (c) nudges the
  callout clear of the hole with the requested position tried first —
  measuring the callout with its CSS transition briefly disabled, since
  mid-flight `getBoundingClientRect()` hid real overlaps.
- Step 24 anchors to the whole card carrying the `1× USE` badge
  (`:has()` selectors with plain-pill fallbacks) instead of the 30px pill,
  so the highlight and callout placement survive short viewports.
- Re-verified at 1920×1080, 1920×850 (reproduced the original
  callout-over-pill collision there first), and 390×844 phone.

**Agreed process (from prior session):**
- Analysis was read-only until fixes were agreed. Fixes are then made in
  **one round + one commit** — not drip-fed.
- Step numbers in this plan refer to the **on-screen tutorial text the
  player sees** ("Step N of 25" / the callout heading), NOT the stale
  code-comment labels in `_buildSteps()` (which drift: e.g. the code
  comment says "Step 9b" where the UI says Step 10). Any fix touching a
  step should also correct its comment label.
- Phone view (`body.view-phone`) must not break. The tutorial currently
  only really works at ~full-screen 1920×1080; a responsive plan is a
  separate later discussion, not in scope here.

**Source of truth for the survey below:** `client/src/game/Tutorial.js`
(689 lines, 25 steps), cross-referenced against `HexRenderer.js`,
`CardUI.js`, `index.html`, `shared/cardData.js`, `shared/blockadeData.js`,
`shared/mapData.json`. All tile ids in `TUTORIAL_TILE_GROUPS` were verified
to exist in `mapData.json`.

---

## Architecture snapshot

```
start()  → (if renderer.tileEls.size === 0) fetch /shared/mapData.json,
            renderer.render(tiles), rAF → _renderStep()
           else _renderStep() immediately  ← stale-board fast path, see Bug 8
_renderStep() → sets label/title/body (innerHTML), _clearSpotlight(),
            _centerCallout(), step.onEnter()
_advance() → _step++, exit() at end
exit()    → restores 7 cardUI callbacks + renderer.onTileClick saved in
            start(); removes tutorial pawn; renderHand([]); closeMarket();
            clearHighlights()
```

Advancement triggers: Next button, tile click (step 15 hijack), card play
(step 14), market buy (step 18), one timed advance (step 17, 400 ms).

Spotlight: `_spotlightTiles(tileIds)` reads `renderer.tileEls.get(id).g`
`getBoundingClientRect()`, unions them + 12 px padding, shows
`#tutorial-spotlight-hole` (position:fixed, 0.35 s CSS transitions,
box-shadow `0 0 0 9999px rgba(0,0,0,0.72)` IS the dark overlay).

Anchor: `_anchorCalloutToElement(selector, position)` →
`document.querySelector`; **silently returns if missing** (callout stays
centered, no hole, no diagnostic).

Zoom: `hexRenderer.zoomToTiles(tileIds, {animate=true, maxZoom=2.4})`
(`HexRenderer.js:833`) sets scale then calls
`scrollIntoView({behavior:'smooth', block:'center', inline:'center'})`
inside `requestAnimationFrame`. **No completion callback/event exists.**

Market: step 16 builds the REAL shop via
`window.ElDoradoCards.buildShopState()` (deterministic `INITIAL_SHOP` /
`INITIAL_RESERVE` from `shared/cardData.js`) — not a fixture.

---

## Bug list, with fixes

### Bug 1 — Multi-tile spotlight lands off-target (HIGH)
**Symptom:** Steps 2 ("Your Starting Position"), 3 ("El Dorado 🏆"),
10 ("🚧 Blockades"), 15 ("Valid Moves") highlight the wrong screen region.
Single-tile steps (6 Rubble, 7 Camp, 8 Mountain, 9 Greater Requirements)
are spot-on, which isolates the cause to multi-tile/long-trip zooms.
**Root cause:** every zoom step does
`zoomToTiles(...); setTimeout(() => _spotlightTiles(ids), 550)`.
`scrollIntoView({behavior:'smooth'})` duration is browser- and
distance-dependent. Long trips (step 3 spans q=-3 → q=26; step 10 zooms
out; step 15 re-zooms after a move) are still scrolling at 550 ms, so
`getBoundingClientRect()` is read mid-flight.
**Fix:** give `zoomToTiles` a completion signal and have the tutorial
await it instead of a fixed 550 ms. Preferred: have `zoomToTiles` resolve
a Promise after the smooth scroll settles. Detect settle via
`scrollend` event on `#board-container` where supported, with a
`transitionend`/rAF-poll fallback; OR poll `scrollLeft/scrollTop` until
stable for two frames. Then in Tutorial.js replace all nine 550 ms
setTimeouts (lines 377, 392, 403, 425, 436, 448, 461, 473, 540) with
`await zoomToTiles(...)` / `.then(...)`. Keep a small guard timeout
(~1.5 s) so a browser without `scrollend` can't hang the step.
**Also note:** `_raiseBadges()` reparents `.tile-badges` to be direct SVG
children (not inside the tile `<g>`), so badge rects are excluded from the
union. Minor; only matters if we later want badges inside the spotlight.
**Verify:** step 2 hole exactly frames the 4 start hexes; step 3 frames
the finishing+El Dorado group after the long pan; step 15 frames
`-2_2`/`-2_3` after the pawn move.

### Bug 2 — Centered callout covers the El Dorado highlight (MED)
**Symptom:** step 3's callout sits dead-center over the very tiles it is
describing.
**Fix:** step 3 should anchor rather than center. Use
`_anchorCalloutToElement` against a tile element (e.g. the El Dorado tile
`26_-12`) with position `'left'` or `'below'` so the hole stays visible.
Alternatively keep centered but teach `_centerCallout` to offset away from
the spotlight union box (record the union in `_spotlightTiles` and nudge
the callout to the largest free viewport region). Pick one approach and
apply consistently to any other step where callout and hole overlap.

### Bug 3 — Blockades never rendered (MED)
**Symptom:** step 10 ("🚧 Blockades") zooms to tiles `0_-3, 0_-4, 1_-3,
1_-4` — the `BLK_BC` (B↔C) seam — but the board shows bare hexes with no
walls.
**Root cause:** `Tutorial.js` has zero calls to
`renderer.renderBlockades(...)` or `setBreakableBlockades(...)`. Those are
only driven from the real game path in `main.js` on `game_started` /
`blockade_broken`. The tutorial re-renders the bare board and never draws
planks.
**Fix:** in step 10's `onEnter`, call
`renderer.renderBlockades(TUTORIAL_BLOCKADES)` with a small fixture derived
from `shared/blockadeData.js` (the `BLK_BC` edges) and clear it on step
exit / `exit()`. Check `HexRenderer.renderBlockades` signature
(`HexRenderer.js:911`) and whether it needs token counts; mirror whatever
`main.js` passes on `game_started`. Ensure `exit()` calls whatever clear
API exists so a real game started afterwards isn't polluted.

### Bug 4 — Reserve steps highlight nothing / highlight the wrong strip (MED)
**Symptoms:**
- Step 19 ("The Reserve") calls `openMarket(0)` then
  `cardUI._changeMarketView(true)` then immediately
  `_anchorCalloutToElement('#shop-slots', 'above')`. The class toggle has
  not been reflowed, so the rect is stale and the reserve highlight lands
  between the shop and reserve sections.
- Steps 20 ("Wild Cards"), 21 ("Special Cards"), 22 ("One Time Use Cards")
  anchor to `.card-btn.terrain-wild.market-reserve`,
  `.card-btn.terrain-empty.market-reserve`,
  `.market-reserve-section .card-onetime-pill`. These match the DESKTOP
  renderer only, and only while the Reserve tab is still showing.
**Fix:**
- After `_changeMarketView(true)`, force a reflow
  (`void shopEl.offsetWidth`) or anchor to the section header
  `.market-reserve-header` / a reserve card directly instead of
  `#shop-slots`.
- Re-assert `_changeMarketView(true)` at the top of steps 20–22's
  `onEnter` so a stray tab click can't leave them `display:none` (CSS
  `#shop-slots:not(.show-reserve) .market-reserve-section` hides them;
  hidden elements return a zero rect and the hole pins at -8px, 16×16).
- `_anchorCalloutToElement` must not fail silently: if the selector
  misses, log a console.warn and fall back to a visible centered callout
  rather than an invisible hole. This turns future DOM drift into a
  diagnosable event.
- Phone: `CardUI.renderMarket` routes to `_renderMarketCompact` when
  `_isPhoneView()` (`CardUI.js:496`), which emits
  `.market-row-item.terrain-*` + `.market-onetime-pill` — none of the
  three selectors match. Either teach the three steps phone-specific
  selectors, or (simpler, and consistent with "tutorial is desktop-first
  for now") detect phone in `_anchorCalloutToElement` and anchor to
  `#shop-slots` with a text-only fallback. Do NOT let it silently no-op.

### Bug 5 — Step 17 "Try It — Click the Traveler" anchor is positional (LOW-MED)
**Symptom:** anchors to `#player-hand-ui .card-btn:nth-child(3)`,
hardcoding "3rd hand card = Traveler". Works only because `TUTORIAL_HAND`
is `[explorer, explorer, traveler, sailor]` and `renderHand` appends in
order.
**Fix:** anchor by identity, e.g.
`#hand-cards [data-card-key="traveler"]` if such an attribute exists, or
add `data-instance-id="tut-traveler-0"` in the tutorial hand render path.
If neither is cheap, at minimum add a runtime assert
(`console.warn` if the 3rd card's name isn't "Traveler") so fixture
reorders fail loudly.

### Bug 6 — Step 12 hand copy contradicts the hand on screen (LOW)
**Symptom:** step text says "3 Explorer cards… 1 Sailor card… 4 Traveler
cards" (the real 8-card `STARTER_DECK_TEMPLATE`), but `TUTORIAL_HAND` is
a 4-card fixture: 2 Explorers / 1 Traveler / 1 Sailor.
**Fix (choose one):** (a) expand `TUTORIAL_HAND` to the real 8-card
starter deck so the copy is true, or (b) rewrite the step body to match
the 4-card fixture. (a) is better — it makes the tutorial deck match the
real game. If (a), re-check step 14's "play a card" flow and step 17's
Traveler anchor against the longer hand.

### Bug 7 — Step 17 advance depends on monkey-patching a private method (LOW-MED)
**Symptom:** wraps `cardUI._handleMarketPoolClick` to detect the pool
click, then `setTimeout(advance, 400)`. Any change to CardUI's pooling
guards (`_purchaseLocked`, `_transmitterBonus` at `CardUI.js:218-219`)
silently swallows the trigger; the only escape is Skip. Same class of
coupling: step 19 calls the private `_changeMarketView` directly.
**Fix:** prefer a public seam. Options: (1) use the existing
`onMarketOpened` / a new optional `onPoolChanged` callback that CardUI
already fires or can fire; (2) add a tiny public
`cardUI.setPoolClickHook(fn)` used only by the tutorial; (3) keep the
wrap but also expose a "Next" button for this step instead of hiding it,
so a failed hook is recoverable without Skip. Minimum viable: un-hide
Next on step 17 as an escape hatch and replace the 400 ms magic number
with the same settle pattern as Bug 1 if any layout change is involved.

### Bug 8 — Stale-board fast path can skip render and strand the tutorial (MED)
**Symptom:** `start()` only fetches/renders when
`renderer.tileEls.size === 0`. If a real game was on screen, the tutorial
reuses the existing board — including any pawns, blockades, or highlights
from that game — and never renders tutorial blockades (Bug 3). Pawns from
a prior game survive because `render()` (which clears them at
`HexRenderer.js:156`) is never called on the fast path.
**Fix:** always call `renderer.render(mapData.tiles)` (or an explicit
`clearOverlays()` that drops pawns/blockades/highlights) at tutorial
start, regardless of `tileEls.size`. Cache the map fetch so the second
start doesn't re-download. Then Bug 3's `renderBlockades` fixture is the
only wall on screen.

### Bug 9 — Opening `client/index.html` from disk degrades every step (LOW)
**Symptom:** the header comment claims "No server connection required",
but the empty-board path fetches `/shared/mapData.json`; from `file://`
this fails, `.catch` calls `_renderStep()` with no board, and every
zoom/spotlight no-ops (all 25 steps become centered text).
**Fix:** either bundle the tutorial tiles as a small inline fixture
(only ~10 ids are referenced; the full 225-tile map is not needed), or
update the comment and fail loudly ("Tutorial requires the dev server").
Inline fixture is nicer and removes the fetch entirely.

### Bug 10 — Dead code and label drift (LOW, cleanup while in the file)
- Code-comment step labels drift from the UI ("Step 9b" vs UI Step 10,
  "Step 12.1" vs UI Step 14, etc.). Renumber the comments to match the
  25-step UI numbering while touching each step.
- `TUTORIAL_TILE_GROUPS.jungle/water/village` are defined but never used.
  Delete.
- `_nextBtn.onclick = null` at lines 127/163 is vestigial — Next is
  wired via `addEventListener` in the constructor. Delete.
- The `if (!step)` terminal branch in `_renderStep` (146–154) is
  unreachable (`_advance` exits first). Delete or make it the real exit.
- Hardcoded fallback callout sizes `180`/`340` must stay in sync with
  `tutorial.css` `width: 340px`. Derive from `getBoundingClientRect()`
  of the callout itself instead of literals.

---

## Out of scope (parked, revisit later)
- Responsive/small-viewport tutorial layout. Current design assumes
  ~1920×1080; `#tutorial-callout` is a fixed 340 px and viewport clamps
  don't handle a callout taller than the screen. Separate plan.
- The market-card green-outline clipping bug (was `FUTURE_FEATURES`
  adjacent) — **already fixed** in commit `0229113` by adding
  `padding: 2px` to `#card-market #shop-slots` (its `overflow-y:auto`
  was forcing `overflow-x:auto` and clipping the 2 px can-afford
  box-shadow). Do not re-litigate here.
- Making the tutorial work in phone/TV view beyond the selector fallback
  noted in Bug 4.

---

## Suggested implementation order (single round, single commit)
1. Bug 1 (zoom settle) — everything downstream reads correct rects only
   once this is fixed; it touches `HexRenderer.zoomToTiles` + all nine
   call sites.
2. Bug 8 (always re-render at start) + Bug 3 (blockade fixture) — both
   live in `start()` / step 10 and share the clear/render lifecycle.
3. Bug 4 (reserve steps: reflow, re-assert tab, loud fallback) + Bug 2
   (El Dorado callout placement) — both are `_anchorCalloutToElement`
   work; add the console.warn fallback once and reuse.
4. Bug 5, 6, 7 (hand/Traveler/copy/monkey-patch) — self-contained.
5. Bug 9 (inline map fixture or honest comment) + Bug 10 (cleanup) —
   last, pure cleanup.

**Verification pass after the round:** walk all 25 steps at 1920×1080 and
confirm: every hole frames its tiles; every anchored callout has a
visible hole; blockades visible at step 10; reserve steps 19–22 all show
reserve content; step 17 advances on pool click AND on Next; starting the
tutorial after a real game leaves no stray pawns/walls; skip works from
every step. Then start the tutorial in phone view and confirm steps 19–22
degrade to a readable centered callout rather than an invisible hole.

**Start at:** `client/src/game/Tutorial.js` (`_buildSteps`, `_spotlightTiles`,
`_anchorCalloutToElement`, `start`, `exit`), `client/src/game/HexRenderer.js`
(`zoomToTiles` at 833, `renderBlockades` at 911, `render`, `tileEls`),
`client/src/styles/tutorial.css`, `client/src/game/CardUI.js`
(`_changeMarketView`, `_handleMarketPoolClick`, `renderMarket`,
`_renderMarketCompact`), `shared/blockadeData.js`, `shared/cardData.js`.
