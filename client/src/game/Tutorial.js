// client/src/game/Tutorial.js
// Self-contained tutorial module. No socket/server gameplay connection is
// required, but the dev server must serve the client: the board map is
// fetched from /shared/mapData.json, and the client's asset paths are
// server-rooted, so opening index.html from file:// degrades every
// zoom/spotlight step (start() logs loudly if the fetch fails).
//
// Usage:
//   const tutorial = new Tutorial({ renderer, cardUI });
//   tutorial.onExit = () => showScreen('lobby');
//   tutorial.start();
//
// The tutorial reuses #game-screen as its visual backdrop (board + hand
// are already there). The #tutorial-screen overlay sits on top of it.
// Zero socket events are emitted during tutorial playback.

// ── Tile groups used in the terrain tour ─────────────────────────────────────
// IDs cross-referenced against mapData.json. `blockade` spans the full
// BLK_BC seam so every rendered plank from TUTORIAL_BLOCKADES is on screen.
const TUTORIAL_TILE_GROUPS = {
  start: ['-3_3', '-3_2', '-3_1', '-3_0'],
  elDorado: ['27_-12', '27_-11', '26_-10'],
  finishing: ['26_-12', '26_-11', '25_-10'],
  basic: ['-1_-1', '-1_0', '0_-1'],
  rubble: ['1_-5'],
  mountain: ['3_-7'],
  camp: ['7_-17'],
  more_requirements: ['11_-10'],
  blockade: ['0_-3', '0_-4', '1_-3', '1_-4', '2_-3', '2_-4', '3_-3', '3_-4'],
};

// ── Blockade fixture for the Blockades step ─────────────────────────────────
// The tutorial never runs a real game, so the real game path (main.js on
// game_started) that calls renderer.renderBlockades() never fires. Reuse
// the real BLK_BC seam edges from shared/blockadeData.js with a fixed
// terrain so the plank art renders; cleared on step change and exit().
const TUTORIAL_BLOCKADES = (() => {
  const seam = window.ElDoradoBlockades?.BLOCKADE_SEAMS?.find(s => s.id === 'BLK_BC');
  return seam ? [{ ...seam, terrainType: 'jungle' }] : [];
})();

// ── Tutorial hand: a curated 4-card demo hand ───────────────────────────────
// A real turn shows 4 cards, and an 8-card fixture reads as "my hand will
// look like this" — which it never will. Pull one Explorer, two Travelers
// and one Sailor out of the real starter deck so the player still sees
// every card type (and step 12's deck copy stays about the deck, not the
// hand). Built from the real card definitions so stats can't drift.
const TUTORIAL_HAND = (() => {
  const deck = window.ElDoradoCards?.buildStarterDeck?.() ?? [];
  const want = ['explorer-0', 'traveler-0', 'traveler-1', 'sailor-0'];
  return want
    .map(instanceId => deck.find(c => c.instanceId === instanceId))
    .filter(Boolean);
})();

class Tutorial {
  constructor({ renderer, cardUI }) {
    this.renderer = renderer;
    this.cardUI = cardUI;
    this.active = false;
    this._step = 0;
    this._steps = [];
    this._savedCallbacks = {};
    this._savedTileClick = undefined;
    // Bumped on every step render / start / exit so a zoom that settles
    // after the player has already moved on can't apply a stale spotlight.
    this._gen = 0;
    // Map tiles are fetched once per page load and reused on restarts.
    this._mapTilesPromise = null;

    // ── Overlay element refs ───────────────────────────────────────────────
    this._overlayEl = document.getElementById('tutorial-screen');
    this._backdropEl = document.getElementById('tutorial-backdrop');
    this._holeEl = document.getElementById('tutorial-spotlight-hole');
    this._calloutEl = document.getElementById('tutorial-callout');
    this._stepLabelEl = document.getElementById('tutorial-callout-step');
    this._titleEl = document.getElementById('tutorial-callout-title');
    this._bodyEl = document.getElementById('tutorial-callout-body');
    this._nextBtn = document.getElementById('tutorial-next-btn');
    this._skipBtn = document.getElementById('tutorial-skip-btn');

    this._nextBtn.addEventListener('click', () => this._advance());
    this._skipBtn.addEventListener('click', () => this.exit());

    this._steps = this._buildSteps();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this.active) return;
    this.active = true;
    this._step = 0;
    this._gen++;

    this._saveCallbacks();
    this._savedTileClick = this.renderer.onTileClick;

    this._overlayEl.classList.remove('hidden');

    // Always re-render the bare tutorial board, even when a real game's
    // board is already on screen: render() drops leftover pawns, blockades
    // and highlights so the tutorial starts from a known state (and so the
    // step-10 blockade fixture is the only wall on screen).
    this._loadMapTiles()
      .catch(err => {
        console.error(
          '[Tutorial] Failed to load /shared/mapData.json — tutorial needs '
          + 'the dev server (file:// cannot fetch it). Zoom/spotlight steps '
          + 'will degrade to centered text.', err);
        return null;
      })
      .then(tiles => {
        if (!this.active) return;
        if (tiles) this.renderer.render(tiles);
        requestAnimationFrame(() => this._renderStep());
      });
  }

  // Fetch the map once per page load; later starts reuse the cache.
  _loadMapTiles() {
    if (!this._mapTilesPromise) {
      this._mapTilesPromise = fetch('/shared/mapData.json')
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => data.tiles);
    }
    return this._mapTilesPromise;
  }

  exit() {
    this.active = false;
    this._gen++;
    this._overlayEl.classList.add('hidden');

    this._clearSpotlight();
    this._restoreCallbacks();
    if (this._savedTileClick !== undefined) {
      this.renderer.onTileClick = this._savedTileClick;
    }

    const pawnEl = this.renderer.svg?.querySelector('[data-pawn="tutorial-player"]');
    if (pawnEl) pawnEl.remove();

    // Drop the tutorial's blockade fixture (and any stray planks) so a
    // real game started afterwards isn't polluted.
    this.renderer.renderBlockades([]);

    this.cardUI.renderHand([]);
    this.cardUI.closeMarket();
    this.renderer.clearHighlights();

    this._nextBtn.style.display = '';

    this.onExit?.();
  }

  // ── Step navigation ───────────────────────────────────────────────────────

  _advance() {
    this._step++;
    if (this._step >= this._steps.length) {
      this.exit();
      return;
    }
    this._renderStep();
  }

  _renderStep() {
    const step = this._steps[this._step];
    // Invalidate any zoom/settle promise still in flight from a previous
    // step — its late spotlight must not land on this step's layout.
    this._gen++;

    this._stepLabelEl.textContent = `Step ${this._step + 1} of ${this._steps.length}`;
    this._titleEl.textContent = step.title || '';
    this._bodyEl.innerHTML = step.body || '';

    const isLast = this._step === this._steps.length - 1;
    this._nextBtn.textContent = step.nextLabel || (isLast ? 'Done ✓' : 'Next →');
    this._nextBtn.style.display = '';

    // ── Always start from a clean slate. ────────────────────────────────────
    // Blockades are only shown by their own step; drop any planks from the
    // previous step so a zoom elsewhere never passes a stale wall.
    this.renderer.renderBlockades([]);
    // Steps that want a spotlight handle it themselves inside onEnter().
    // The callout stays centered unless a step explicitly anchors it to a
    // UI element via _anchorCalloutToElement(). Board-zoom steps keep the
    // callout centered; if the spotlight hole ends up underneath it,
    // _spotlightTiles nudges the callout clear.
    this._clearSpotlight();
    this._centerCallout();

    step.onEnter?.();
  }

  // ── Spotlight helpers ─────────────────────────────────────────────────────

  // Zoom to a group of tiles, wait for the pan/zoom to settle, then
  // spotlight them. zoomToTiles resolves a Promise once the smooth scroll
  // has finished (scrollend / scroll-offset polling in HexRenderer), so
  // getBoundingClientRect() is never read mid-flight. The generation check
  // drops the spotlight if the player advanced during the scroll.
  _zoomAndSpotlight(tileIds, options) {
    const gen = this._gen;
    Promise.resolve(this.renderer.zoomToTiles(tileIds, options)).then(() => {
      if (!this.active || gen !== this._gen) return;
      this._spotlightTiles(tileIds);
    });
  }

  // Show the spotlight hole over a group of SVG tile <g> elements, but
  // keep the callout centered. The hole draws the player's eye to the tiles;
  // the centered callout stays rock-steady regardless of board scroll —
  // unless it would cover the hole, in which case it is nudged clear.
  //
  // Only call once the board zoom has settled (see _zoomAndSpotlight) so
  // the tile rects are final.
  _spotlightTiles(tileIds) {
    const rects = tileIds
      .map(id => this.renderer.tileEls.get(id)?.g)
      .filter(Boolean)
      .map(el => el.getBoundingClientRect());

    if (rects.length === 0) {
      this._clearSpotlight();
      return;
    }

    const top = Math.min(...rects.map(r => r.top));
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));

    const padding = 12;
    const hole = {
      top: top - padding,
      left: left - padding,
      right: right + padding,
      bottom: bottom + padding,
    };
    this._holeEl.style.display = 'block';
    this._holeEl.style.top = hole.top + 'px';
    this._holeEl.style.left = hole.left + 'px';
    this._holeEl.style.width = (hole.right - hole.left) + 'px';
    this._holeEl.style.height = (hole.bottom - hole.top) + 'px';

    // The hole's box-shadow IS the dark overlay; hide the flat backdrop so
    // they don't stack and make the spotlight invisible.
    this._backdropEl.style.display = 'none';

    // Default is the centered callout set by _renderStep — but a large
    // spotlight (long tile trips framed at ~75% of the viewport) would sit
    // right on top of it. Nudge the callout to the least-covered side.
    this._keepCalloutClearOfHole(hole);
  }

  // After a spotlight lands, if the (centered) callout overlaps the hole,
  // reposition it beside the hole — trying below/right/above/left and
  // picking whichever placement covers the least hole area. Falls back to
  // the best partial overlap when the hole leaves no clear band.
  // The originally requested position is always tried first, so steps
  // that already fit keep their intended placement.
  _keepCalloutClearOfHole(hole, preferred = 'above') {
    const callout = this._calloutEl;
    // The callout glides to its new spot via the CSS top/left transition —
    // reading it mid-flight reports the animated (wrong) position, which
    // can hide a real overlap. Measure the resting rect instead.
    const prevTransition = callout.style.transition;
    callout.style.transition = 'none';
    const cr = callout.getBoundingClientRect();
    callout.style.transition = prevTransition;
    if (cr.width === 0 || cr.height === 0) return;

    const overlaps = (r) => !(
      r.right <= hole.left || r.left >= hole.right
      || r.bottom <= hole.top || r.top >= hole.bottom);
    if (!overlaps(cr)) return; // already clear — keep the steady centering

    const overlapArea = (r) => {
      const ox = Math.max(0, Math.min(r.right, hole.right) - Math.max(r.left, hole.left));
      const oy = Math.max(0, Math.min(r.bottom, hole.bottom) - Math.max(r.top, hole.top));
      return ox * oy;
    };

    let best = null;
    const alternates = ['below', 'above', 'right', 'left'].filter(p => p !== preferred);
    for (const pos of [preferred, ...alternates]) {
      const { top, left } = this._computeCalloutPosNearRect(hole, pos);
      const rect = { left, top, right: left + cr.width, bottom: top + cr.height };
      const score = overlapArea(rect);
      if (!best || score < best.score) best = { top, left, score };
      if (score === 0) break;
    }

    callout.style.transform = '';
    callout.style.top = best.top + 'px';
    callout.style.left = best.left + 'px';
  }

  // Anchor the callout box to a DOM element (for UI-element steps only).
  // This is safe to call immediately (no scroll animation to wait for)
  // because these elements don't move when the board zooms.
  //
  // target: a CSS selector, or an array of selectors tried in order (use
  // this to give phone compact-render fallbacks — e.g. the desktop
  // `.card-btn.…` selector first, the phone `.market-row-item.…` second).
  //
  // position: 'above' | 'below' | 'left' | 'right'
  //
  // Never fails silently: a missing or hidden (zero-rect) target logs a
  // console.warn and leaves the visible centered callout in place instead
  // of pinning an invisible hole at -8px.
  _anchorCalloutToElement(target, position = 'above') {
    const selectors = Array.isArray(target) ? target : [target];
    let el = null;
    for (const selector of selectors) {
      // try/catch: fallback selectors may use :has(), which older engines
      // reject at parse time — skip to the next selector instead of dying.
      try { el = document.querySelector(selector); } catch (_) { el = null; }
      if (el) break;
    }

    if (!el) {
      console.warn(`[Tutorial] anchor target not found (${selectors.join(' | ')}) — callout stays centered.`);
      return;
    }

    // The market panel (#shop-slots) is its own scroll container, and
    // reserve cards live below its fold — measuring them where they would
    // be (rather than where they are) puts the hole half over the shop
    // window and half over the map. Pull the target into view inside its
    // scrollable ancestors first; 'nearest' is a no-op when already
    // visible, and instant means the rect below is already final.
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    } catch (_) {
      el.scrollIntoView(); // very old browsers: no options object
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn(`[Tutorial] anchor target is hidden (${selectors.join(' | ')}) — callout stays centered.`);
      return;
    }

    const padding = 8;

    // Clamp the hole to each scrollable ancestor and to the viewport, so
    // a tall target (e.g. a reserve card) hanging below a panel's fold —
    // or past the screen edge — only highlights its visible part instead
    // of spilling onto whatever lies outside the panel.
    let hole = {
      top: rect.top - padding,
      left: rect.left - padding,
      right: rect.right + padding,
      bottom: rect.bottom + padding,
    };
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (!/(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX)) continue;
      const pr = p.getBoundingClientRect();
      hole = {
        top: Math.max(hole.top, pr.top),
        left: Math.max(hole.left, pr.left),
        right: Math.min(hole.right, pr.right),
        bottom: Math.min(hole.bottom, pr.bottom),
      };
    }
    hole = {
      top: Math.max(hole.top, 0),
      left: Math.max(hole.left, 0),
      right: Math.min(hole.right, window.innerWidth),
      bottom: Math.min(hole.bottom, window.innerHeight),
    };
    if (hole.right <= hole.left || hole.bottom <= hole.top) {
      console.warn(`[Tutorial] anchor target is fully outside its scroll container (${selectors.join(' | ')}) — callout stays centered.`);
      return;
    }

    // Show the spotlight hole over the (visible part of the) element
    this._holeEl.style.display = 'block';
    this._holeEl.style.top = hole.top + 'px';
    this._holeEl.style.left = hole.left + 'px';
    this._holeEl.style.width = (hole.right - hole.left) + 'px';
    this._holeEl.style.height = (hole.bottom - hole.top) + 'px';
    this._backdropEl.style.display = 'none';

    // Position the callout adjacent to the element, then — when viewport
    // clamping would slam it on top of the highlight (short screens, a
    // target pinned near an edge) — nudge it to the clearest side, same
    // as board-spotlight steps use.
    this._positionCalloutNearRect(rect, position);
    this._keepCalloutClearOfHole(hole, position);
  }

  // Compute the clamped top/left for placing the callout next to a rect.
  // Only used for UI elements (hand, controls, market) and spotlight holes
  // — never for individual board tiles.
  _computeCalloutPosNearRect(rect, position = 'above') {
    const callout = this._calloutEl;
    // Clear the centering transform first so offsetWidth/Height are real
    callout.style.transform = '';
    callout.style.top = '-9999px';
    callout.style.left = '-9999px';

    // Force a layout so offsetHeight reflects actual rendered size
    void callout.offsetHeight;
    const cr = callout.getBoundingClientRect();
    const calloutH = cr.height;
    const calloutW = cr.width;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Accept either a DOMRect-style rect (width/height) or a plain
    // {top,left,right,bottom} box like the spotlight hole.
    const rectW = rect.width ?? (rect.right - rect.left);
    const rectH = rect.height ?? (rect.bottom - rect.top);

    let top, left;

    switch (position) {
      case 'above':
        top = rect.top - calloutH - margin;
        left = rect.left + rectW / 2 - calloutW / 2;
        break;
      case 'below':
        top = rect.bottom + margin;
        left = rect.left + rectW / 2 - calloutW / 2;
        break;
      case 'left':
        top = rect.top + rectH / 2 - calloutH / 2;
        left = rect.left - calloutW - margin;
        break;
      case 'right':
        top = rect.top + rectH / 2 - calloutH / 2;
        left = rect.right + margin;
        break;
      default:
        top = rect.bottom + margin;
        left = rect.left;
    }

    top = Math.max(margin, Math.min(top, vh - calloutH - margin));
    left = Math.max(margin, Math.min(left, vw - calloutW - margin));

    return { top, left };
  }

  _positionCalloutNearRect(rect, position = 'above') {
    const { top, left } = this._computeCalloutPosNearRect(rect, position);
    this._calloutEl.style.top = top + 'px';
    this._calloutEl.style.left = left + 'px';
  }

  _centerCallout() {
    const callout = this._calloutEl;
    callout.style.display = 'block';
    callout.style.top = '50%';
    callout.style.left = '50%';
    callout.style.transform = 'translate(-50%, -50%)';
  }

  _clearSpotlight() {
    this._holeEl.style.display = 'none';
    this._calloutEl.style.transform = '';
    // Restore the flat backdrop for non-spotlight steps
    this._backdropEl.style.display = 'block';
  }

  // ── Callback save / restore ───────────────────────────────────────────────

  _saveCallbacks() {
    this._savedCallbacks = {
      onCardPlayed: this.cardUI.onCardPlayed,
      onMarketCard: this.cardUI.onMarketCard,
      onEndTurn: this.cardUI.onEndTurn,
      onCancelPurchase: this.cardUI.onCancelPurchase,
      onDiscardClicked: this.cardUI.onDiscardClicked,
      onMarketOpened: this.cardUI.onMarketOpened,
      onMarketClosed: this.cardUI.onMarketClosed,
      onPoolChanged: this.cardUI.onPoolChanged,
    };
  }

  _restoreCallbacks() {
    Object.assign(this.cardUI, this._savedCallbacks);
  }

  _installTurnCallbacks() {
    this.cardUI.onCardPlayed = (instanceId) => {
      this.cardUI.updateSelectedCardForMovement(instanceId);
      this._advance();
    };
    this.cardUI.onEndTurn = () => this._advance();
  }

  _installMarketCallbacks() {
    this.cardUI.onMarketCard = ({ cardKey }) => {
      this.cardUI.closeMarket();
      this._advance();
    };
    this.cardUI.onCancelPurchase = () => {
      // prevent closing market during market tutorial steps
    };
  }

  // ── Step builder ──────────────────────────────────────────────────────────
  //
  // POSITIONING RULES (read before editing steps):
  //
  //   Board-zoom steps (zoomToTiles):
  //     - Callout stays CENTERED (set by _renderStep before onEnter).
  //     - Use this._zoomAndSpotlight(tileIds) for the hole — it awaits the
  //       zoom's settle Promise instead of guessing a scroll timeout.
  //     - Do NOT call _positionCallout / _anchorCalloutToElement. If the
  //       hole would land under the centered callout, _spotlightTiles
  //       nudges the callout clear automatically.
  //
  //   UI-element steps (hand, controls, market buttons):
  //     - Call _anchorCalloutToElement(selectorOrList, position) immediately
  //       in onEnter. Pass an array of selectors to give phone compact-
  //       render fallbacks. These elements don't move when the board
  //       scrolls, so no settle wait is needed.

  _buildSteps() {
    const r = this.renderer;

    return [

      // ── Step 1: Overview ─────────────────────────────────────────────────
      {
        title: 'The Race to El Dorado',
        body: 'This is the map. You start at the <strong>starting tiles</strong> at the left '
          + 'and race toward <strong>El Dorado</strong> on the right. '
          + 'Everyone shares the same map — whoever gets there first triggers the final round.',
        nextLabel: 'Show me the map →',
        onEnter: () => {
          // Centered callout, no spotlight — just the intro.
        },
      },

      // ── Step 2: Start tiles ───────────────────────────────────────────────
      {
        title: 'Your Starting Position',
        body: 'Each player begins on one of these <strong>start tiles</strong>. '
          + 'You can\'t move back onto start tiles during the game — '
          + 'only forward, toward El Dorado.',
        onEnter: () => {
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.start);
        },
      },

      // ── Step 3: El Dorado ─────────────────────────────────────────────────
      {
        title: 'El Dorado 🏆',
        body: 'The tiles with a <strong>dashed gold border</strong> and a 🏁 flag '
          + 'are <strong>finishing tiles</strong>. The first player to land on one '
          + 'triggers the final round — the game automatically moves that pawn onto '
          + '<strong>El Dorado</strong>, freeing the finishing tile for the next finisher. '
          + 'Everyone then finishes the current round so all players have had the same number of turns, then the game is over.',
        onEnter: () => {
          // Long trip (start → far-right finish). The spotlight awaits the
          // zoom settle, and _spotlightTiles nudges the callout off the
          // hole so it never covers the tiles it is describing.
          const ids = [...TUTORIAL_TILE_GROUPS.finishing, ...TUTORIAL_TILE_GROUPS.elDorado];
          this._zoomAndSpotlight(ids);
        },
      },

      // ── Step 4: Tile Info ────────────────────────────────────────────────────
      {
        title: 'Tile Information',
        body: 'The path to El Dorado leads through different types of terrain: landscape (green, yellow, blue), rubble (gray), and base camp(red).<br>'
          + ' Each hex space shows the terrain requirements you have to meet to move onto it.',
        onEnter: () => {
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.basic);
        },
      },

      // ── Step 5: Basic Tiles ─────────────────────────────────────────────────────
      {
        title: 'Basic Tiles',
        body: '🌿 Jungle tiles require <strong>green cards</strong>.<br>'
          + '🌊 Rivers and lakes need <strong>blue cards</strong>.<br>'
          + '🏘️ Village tiles need <strong>yellow cards</strong>.',
        onEnter: () => {
          // Same tiles as step 4 — re-frame (idempotent) so a fast click
          // through can't read tile rects mid-scroll from step 4's zoom.
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.basic);
        },
      },

      // ── Step 6: Rubble ────────────────────────────────────────────────────
      {
        title: '🪨 Rubble Tiles',
        body: 'To move onto a rubble space, use any cards from your hand. The number of symbols'
        + ' on the space indicates the number of cards you need to play, regardless of their power or identity.',
        onEnter: () => {
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.rubble);
        },
      },

      // ── Step 7: Camp ──────────────────────────────────────────────────────
      {
        title: '⛺ Camp Tiles',
        body: 'Cards you play to move onto a base camp space aren’t discarded. Instead, they are completely'
          + ' removed from the game. They won’t be used again this game. You keep moving afterward, so a camp works as a trash stop along the way. Use camp tiles intentionally to purge weak starter cards.',
        onEnter: () => {
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.camp);
        },
      },

      // ── Step 8: Mountain ──────────────────────────────────────────────────
      {
        title: '⛰ Mountain Tiles',
        body: 'Mountain tiles are <strong>impassable</strong>. No card can move '
          + 'you onto one. They exist only as barriers that force you to route '
          + 'around them — plan your path accordingly.<br><br><strong>Additionally:</strong> You cannot move onto any space already occupied another player.',
        onEnter: () => {
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.mountain);
        },
      },

      // ── Step 9: Greater requirements ────────────────────────────────────
      {
        title: 'Tiles With Greater Requirements',
        body: 'Some tiles show a <strong>×2 or ×3 badge</strong>  — '
          + 'they need a single card with that much movement power. '
          + 'You <em>cannot</em> combine two weaker cards to meet a high requirement. '
          + 'Tiles like this appear mid-map and reward buying stronger cards early.',
        onEnter: () => {
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.more_requirements);
        },
      },

      // ── Step 10: Blockades ────────────────────────────────────────────────
      {
        title: '🚧 Blockades',
        body: 'Thick walls across the path are <strong>blockades</strong>. Each shows a terrain symbol — play a card matching it from the tile next to the wall to break through. '
          + 'A rubble blockade accepts any fresh card but spends the whole card, like a rubble tile. Breaking one costs 1 move otherwise and opens that whole wall for everyone; you keep the blockade as a token. '
          + 'If several players reach El Dorado in the final round, the one with the <strong>most blockade tokens</strong> wins.',
        onEnter: () => {
          // The real game path that draws planks never runs in the tutorial,
          // so paint the BLK_BC fixture ourselves. Cleared on step change
          // and exit() — see _renderStep().
          r.renderBlockades(TUTORIAL_BLOCKADES);
          this._zoomAndSpotlight(TUTORIAL_TILE_GROUPS.blockade);
        },
      },

      // ── Step 11: Transition to turn loop ─────────────────────────────────
      {
        title: 'You Know the Map',
        body: 'Now you know what terrain you\'ll face and what card types '
          + 'you\'ll need. The next steps show you how a turn works — '
          + 'from playing your first card to ending your turn.',
        nextLabel: 'Show me a turn →',
        onEnter: () => {
          // Zoom back out to give a sense of the full journey, no spotlight.
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.start, { maxZoom: 1 });
          // Callout stays centered.
        },
      },

      // ── Step 12: Starting Deck ──────────────────────────────────────────────────
      {
        title: 'Starting Deck',
        body: 'Your starting deck will consist of: <br>'
          + '<ul><li>3 Explorer cards (1 green movement each)</li>'
          + '<li>1 Sailor card (1 water movement)</li>'
          + '<li>4 Traveler cards (1 village movement each)</li></ul>',
        onEnter: () => {},
      },

      // ── Step 13: Your hand ────────────────────────────────────────────────
      {
        title: 'Your Hand',
        body: 'Each turn starts with you drawing cards to your hand until you have 4 cards. Cards played or used to buy stronger cards will be placed in your discard pile. Your discarded cards are reshuffled into your draw pile when it runs out. '
          + '',
        onEnter: () => {
          this.renderer.zoomToTiles(TUTORIAL_TILE_GROUPS.start);
          this.renderer.setPawnPosition('tutorial-player', '-3_3', 0);
          this.cardUI.renderHand(TUTORIAL_HAND);
          this._installTurnCallbacks();
          // Anchor callout to hand — safe to do immediately, hand doesn't move
          this._anchorCalloutToElement('#player-hand-ui', 'above');
        },
      },

      // ── Step 14: Play a card ───────────────────────────────────────────────────
      {
        title: 'Play a card',
        body: 'Click a <strong>green</strong> Explorer card to play it. '
          + '',
        onEnter: () => {
          this._nextBtn.style.display = 'none';
          // Anchor by card identity, not hand position — the first hand
          // card is only an Explorer while the fixture order holds.
          this._anchorCalloutToElement('#hand-cards .card-btn[data-card-key="explorer"]', 'above');
        },
      },

      // ── Step 15: Valid moves ──────────────────────────────────────────────
      {
        title: 'Valid Moves',
        body: 'Glowing tiles show where you can move with the card you played. '
          + 'The card\'s terrain must match the tile. '
          + 'Click a glowing tile to move there.',
        onEnter: () => {
          this._nextBtn.style.display = 'none';
          const adjacentJungle = ['-2_2', '-2_3'];
          this.renderer.setValidMoves(adjacentJungle);

          this._zoomAndSpotlight(adjacentJungle);

          const originalClick = this.renderer.onTileClick;
          this.renderer.onTileClick = (tileId) => {
            if (adjacentJungle.includes(tileId)) {
              this.renderer.setPawnPosition('tutorial-player', tileId, 0);
              this.renderer.clearHighlights();
              this.renderer.onTileClick = originalClick;
              this._advance();
            }
          };
          // Callout stays centered — board is what the player needs to interact with.
        },
      },

      // ── Step 16: After moving ─────────────────────────────────────────────
      {
        title: 'After Moving',
        body: 'If you have moves remaining your card stays active and more tiles glow to continue movement.' 
          + ' You can continue to play cards in your hand to move, open the <strong>Market</strong> to buy a card (1 per turn) or discard cards from your hand.'
          + ' You are not required to move every turn or use all the cards in your hand.',
        onEnter: () => {
          this._nextBtn.style.display = '';
          this.cardUI.onEndTurn = () => this._advance();
          // Anchor to the controls — stable position, no board movement
          this._anchorCalloutToElement('#hand-controls', 'above');
        },
      },

      // ── Step 17: Deck cycling ─────────────────────────────────────────────
      {
        title: 'Your Deck Grows',
        body: 'At end of turn you draw back up to 4 cards. Played cards go to '
          + 'your <strong>discard pile</strong>. When your draw pile runs out, '
          + 'the discard is reshuffled — so every card you buy '
          + '<em>will</em> reach your hand eventually.',
        onEnter: () => {
          this._nextBtn.style.display = '';
          // Conceptual step, no element to point at — centered callout is correct.
        },
      },

      // ── Step 18: Market — purchasing power ───────────────────────────────
      {
        title: 'The Market — Purchasing Power',
        body: 'To use the cards in your hand to purchase stronger cards, click the market button to open the shop. To buy a card, you can <strong>click one or more cards from your hand</strong> '
          + 'to pool purchasing power. Any <strong>yellow card</strong> is worth the number of movement points shown on the card. All other cards are worth 1/2 coin each. '
          + 'You can buy up to <strong>1 card per turn</strong> — pooled cards are spent — and you cannot buy in the middle of moving.',
        onEnter: () => {
          const tutorialMarket = window.ElDoradoCards.buildShopState();
          this.cardUI.renderHand(TUTORIAL_HAND);
          this.cardUI.renderMarket(tutorialMarket);
          this.cardUI.openMarket(0);
          this._installMarketCallbacks();
        },
      },

      // ── Step 19: Try clicking the Traveler ───────────────────────────────
      {
        title: 'Try It — Click the Traveler',
        body: 'Click the <strong>yellow Traveler card</strong> in your hand to '
          + 'add its 1 gold to your purchasing power. '
          + 'You\'ll see some market cards get a <strong>green outline</strong> — '
          + 'those are now affordable.',
        onEnter: () => {
          this._installMarketCallbacks();
          // Public seam: CardUI fires onPoolChanged only when a click
          // actually changed the pool — never when the purchase lock or
          // transmitter guard swallowed it. Restore the saved callback so
          // the hook can't leak into a later real game.
          this.cardUI.onPoolChanged = () => {
            this.cardUI.onPoolChanged = this._savedCallbacks.onPoolChanged;
            // Brief beat so the green affordability outlines land before
            // the callout jumps to the market.
            setTimeout(() => { if (this.active) this._advance(); }, 250);
          };
          // Anchor by card identity — the starter deck has four Travelers
          // and a positional anchor (nth-child) breaks if the hand changes.
          this._anchorCalloutToElement('#hand-cards .card-btn[data-card-key="traveler"]', 'above');
          // Next stays visible as an escape hatch: if pooling is ever
          // blocked, the player can continue without skipping the tutorial.
        },
      },

      // ── Step 20: Buying a card ────────────────────────────────────────────
      {
        title: 'Buying a Card',
        body: 'Cards with a <strong>green outline</strong> are within your budget. '
          + 'Click one to buy it — it goes straight to your <strong>discard pile</strong> '
          + 'and will cycle into your hand in a future turn.',
        onEnter: () => {
          this._nextBtn.style.display = 'none';
          // Anchor to the market cards area
          this._anchorCalloutToElement('#shop-slots', 'above');
        },
      },

      // ── Step 21: The Reserve ─────────────────────────────────────────────
      {
        title: 'The Reserve',
        body: 'The market also has a <strong>Reserve</strong> tab. '
          + 'These are powerful cards not yet available for purchase — '
          + 'they only enter the market when a shop slot runs dry. '
          + 'Whenever a card sells out, the <em>buyer</em> chooses which '
          + 'reserve card replaces it. Knowing what\'s in the reserve '
          + 'helps you plan.',
        onEnter: () => {
          this.cardUI.openMarket(0);
          // Re-assert the Reserve tab — a stray Market-tab click can't
          // leave the section display:none (hidden → zero-rect anchor).
          this.cardUI.changeMarketView(true);
          // Force a reflow so the just-shown section reports a real rect.
          void this.cardUI.shopEl.offsetWidth;
          this._anchorCalloutToElement(
            ['#shop-slots .market-reserve-section', '#shop-slots'], 'above');
        },
      },

      // ── Step 22: Wild Cards ───────────────────────────────────────────────
      {
        title: 'Wild Cards',
        body: 'Black cards are <strong>wild</strong> and can be used as any color. The first terrain you enter locks the card to that color for the rest of the move — until then it matches anything. The same lock applies when breaking a blockade. Rubble and camp never lock it.',
        onEnter: () => {
          this.cardUI.changeMarketView(true);
          // Desktop full-card first, phone compact row as fallback.
          this._anchorCalloutToElement([
            '#shop-slots .card-btn.terrain-wild.market-reserve',
            '#shop-slots .market-row-item.terrain-wild.is-reserve',
          ], 'above');
        },
      },

      // ── Step 23: Special Cards ────────────────────────────────────────────
      {
        title: 'Special Cards',
        body: 'Purple cards have unique, very special abilities. Each one has an clickable information button that explains what it does and how to use it.',
        onEnter: () => {
          this.cardUI.changeMarketView(true);
          this._anchorCalloutToElement([
            '#shop-slots .card-btn.terrain-empty.market-reserve',
            '#shop-slots .market-row-item.terrain-empty.is-reserve',
          ], 'above');
        },
      },

      // ── Step 24: One-Time Use cards ───────────────────────────────────────
      {
        title: 'One Time Use Cards',
        body: 'Notice some cards carry a red <strong>1×&nbsp;USE</strong> badge — in your hand, in the market, and in the reserve. When you play one, it is removed from the game and will not be reshuffled into your deck.',
        onEnter: () => {
          this.cardUI.changeMarketView(true);
          // Anchor to the whole CARD that carries the badge (not the 30px
          // pill): clearer highlight, and a target big enough that viewport
          // clamping can't slam the callout onto it on short screens.
          // :has() selectors first, plain pill selectors as old-engine
          // fallbacks; desktop card then phone row.
          this._anchorCalloutToElement([
            '#shop-slots .market-reserve-section .card-btn:has(.card-onetime-pill)',
            '#shop-slots .market-reserve-section .market-row-item:has(.market-onetime-pill)',
            '#shop-slots .market-reserve-section .card-onetime-pill',
            '#shop-slots .market-reserve-section .market-onetime-pill',
          ], 'above');
        },
      },

      // ── Step 25: Wrap-up ──────────────────────────────────────────────────
      {
        title: 'You\'re Ready to Explore',
        body: 'Build your deck around the terrain ahead, spend yellow cards '
          + 'to buy upgrades, and race your opponents to El Dorado. '
          + 'Good luck, explorer.',
        nextLabel: 'Start Playing →',
        onEnter: () => {
          this._nextBtn.style.display = '';
          this.cardUI.closeMarket();
          // Centered send-off.
        },
      },
    ];
  }
}