// client/src/game/Tutorial.js
// Self-contained tutorial module. No server connection required.
//
// Usage:
//   const tutorial = new Tutorial({ renderer, cardUI });
//   tutorial.onExit = () => showScreen('lobby');
//   tutorial.start();
//
// The tutorial reuses #game-screen as its visual backdrop (board + hand
// are already there). The #tutorial-screen overlay sits on top of it.
// Zero socket events are emitted during tutorial playback.

// ── Phase 2: Tile groups used in the terrain tour ────────────────────────────
// IDs cross-referenced against mapData.json.
const TUTORIAL_TILE_GROUPS = {
  start: ['-3_3', '-3_2', '-3_1', '-3_0'],
  elDorado: ['26_-12', '26_-11', '25_-10'],
  finishing: ['24_-10', '25_-12', '25_-11'],
  basic: ['-1_-1', '-1_0', '0_-1'],
  jungle: ['-2_0'],
  water: ['-1_0'],
  village: ['0_-1'],
  rubble: ['1_-5'],
  mountain: ['3_-7'],
  camp: ['7_-17'],
  more_requirements: ['11_-10'],
};

// ── Phase 3: Tutorial hand fixture ───────────────────────────────────────────
const TUTORIAL_HAND = [
  {
    instanceId: 'tut-explorer-0', key: 'explorer', cardName: 'Explorer',
    color: 'green', movementTerrain: 'jungle', movementTotal: 1,
    purchasingPower: 0.5, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
  {
    instanceId: 'tut-explorer-1', key: 'explorer', cardName: 'Explorer',
    color: 'green', movementTerrain: 'jungle', movementTotal: 1,
    purchasingPower: 0.5, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
  {
    instanceId: 'tut-traveler-0', key: 'traveler', cardName: 'Traveler',
    color: 'yellow', movementTerrain: 'village', movementTotal: 1,
    purchasingPower: 1, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
  {
    instanceId: 'tut-sailor-0', key: 'sailor', cardName: 'Sailor',
    color: 'blue', movementTerrain: 'water', movementTotal: 1,
    purchasingPower: 0.5, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
];

class Tutorial {
  constructor({ renderer, cardUI }) {
    this.renderer = renderer;
    this.cardUI = cardUI;
    this.active = false;
    this._step = 0;
    this._steps = [];
    this._savedCallbacks = {};
    this._savedTileClick = undefined;

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

    this._saveCallbacks();
    this._savedTileClick = this.renderer.onTileClick;

    this._overlayEl.classList.remove('hidden');

    if (this.renderer.tileEls.size === 0) {
      fetch('/shared/mapData.json')
        .then(r => r.json())
        .then(data => {
          this.renderer.render(data.tiles);
          requestAnimationFrame(() => this._renderStep());
        })
        .catch(() => {
          this._renderStep();
        });
      return;
    }

    this._renderStep();
  }

  exit() {
    this.active = false;
    this._overlayEl.classList.add('hidden');

    this._clearSpotlight();
    this._restoreCallbacks();
    if (this._savedTileClick !== undefined) {
      this.renderer.onTileClick = this._savedTileClick;
    }

    const pawnEl = this.renderer.svg?.querySelector('[data-pawn="tutorial-player"]');
    if (pawnEl) pawnEl.remove();

    this.cardUI.renderHand([]);
    this.cardUI.closeMarket();
    this.renderer.clearHighlights();

    this._nextBtn.style.display = '';
    this._nextBtn.onclick = null;

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

    if (!step) {
      this._stepLabelEl.textContent = `Step ${this._step + 1} of ${this._steps.length}`;
      this._titleEl.textContent = '';
      this._bodyEl.innerHTML = '';
      this._nextBtn.textContent = 'Done ✓';
      this._clearSpotlight();
      this._centerCallout();
      return;
    }

    this._stepLabelEl.textContent = `Step ${this._step + 1} of ${this._steps.length}`;
    this._titleEl.textContent = step.title || '';
    this._bodyEl.innerHTML = step.body || '';

    const isLast = this._step === this._steps.length - 1;
    this._nextBtn.textContent = step.nextLabel || (isLast ? 'Done ✓' : 'Next →');
    this._nextBtn.style.display = '';
    this._nextBtn.onclick = null;

    // ── Always start centered and with no spotlight. ───────────────────────
    // Steps that want a spotlight handle it themselves inside onEnter().
    // The callout stays centered unless a step explicitly anchors it to a
    // UI element via _anchorCalloutToElement(). Board-zoom steps never
    // reposition the callout — they use the spotlight hole only for the
    // visual indicator, letting the callout remain stable.
    this._clearSpotlight();
    this._centerCallout();

    step.onEnter?.();
  }

  // ── Spotlight helpers ─────────────────────────────────────────────────────

  // Show the spotlight hole over a group of SVG tile <g> elements, but
  // keep the callout centered. The hole draws the player's eye to the tiles;
  // the centered callout stays rock-steady regardless of board scroll.
  //
  // Call after a setTimeout(..., 550) to let zoomToTiles scroll animation
  // settle before reading getBoundingClientRect().
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
    this._holeEl.style.display = 'block';
    this._holeEl.style.top = (top - padding) + 'px';
    this._holeEl.style.left = (left - padding) + 'px';
    this._holeEl.style.width = (right - left + padding * 2) + 'px';
    this._holeEl.style.height = (bottom - top + padding * 2) + 'px';

    // The hole's box-shadow IS the dark overlay; hide the flat backdrop so
    // they don't stack and make the spotlight invisible.
    this._backdropEl.style.display = 'none';

    // Callout stays centered — do NOT call _positionCallout here.
  }

  // Anchor the callout box to a DOM element (for UI-element steps only).
  // This is safe to call immediately (no scroll animation to wait for)
  // because these elements don't move when the board zooms.
  //
  // position: 'above' | 'below' | 'left' | 'right'
  _anchorCalloutToElement(selector, position = 'above') {
    const target = document.querySelector(selector);
    if (!target) return; // fallback: stays centered

    const rect = target.getBoundingClientRect();
    const padding = 8;

    // Show the spotlight hole over the element
    this._holeEl.style.display = 'block';
    this._holeEl.style.top = (rect.top - padding) + 'px';
    this._holeEl.style.left = (rect.left - padding) + 'px';
    this._holeEl.style.width = (rect.width + padding * 2) + 'px';
    this._holeEl.style.height = (rect.height + padding * 2) + 'px';
    this._backdropEl.style.display = 'none';

    // Position the callout adjacent to the element
    this._positionCalloutNearRect(rect, position);
  }

  // Position the callout relative to a known-stable rect.
  // Only used for UI elements (hand, controls, market) — never for board tiles.
  _positionCalloutNearRect(rect, position = 'above') {
    const callout = this._calloutEl;
    // Clear the centering transform first so offsetWidth/Height are real
    callout.style.transform = '';
    callout.style.top = '-9999px';
    callout.style.left = '-9999px';

    // Force a layout so offsetHeight reflects actual rendered size
    void callout.offsetHeight;

    const calloutH = callout.offsetHeight || 180;
    const calloutW = callout.offsetWidth || 340;
    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top, left;

    switch (position) {
      case 'above':
        top = rect.top - calloutH - margin;
        left = rect.left + rect.width / 2 - calloutW / 2;
        break;
      case 'below':
        top = rect.bottom + margin;
        left = rect.left + rect.width / 2 - calloutW / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - calloutH / 2;
        left = rect.left - calloutW - margin;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - calloutH / 2;
        left = rect.right + margin;
        break;
      default:
        top = rect.bottom + margin;
        left = rect.left;
    }

    top = Math.max(margin, Math.min(top, vh - calloutH - margin));
    left = Math.max(margin, Math.min(left, vw - calloutW - margin));

    callout.style.top = top + 'px';
    callout.style.left = left + 'px';
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
  //     - Use _spotlightTiles() inside a setTimeout(..., 550) for the hole.
  //     - Do NOT call _positionCallout / _anchorCalloutToElement.
  //
  //   UI-element steps (hand, controls, market buttons):
  //     - Call _anchorCalloutToElement(selector, position) immediately in onEnter.
  //     - These elements don't move when the board scrolls, so no timeout needed.

  _buildSteps() {
    const r = this.renderer;

    return [

      // ── Step 1: Overview ─────────────────────────────────────────────────
      {
        title: 'The Race to El Dorado',
        body: 'This is the map. You start at the <strong>starting tiles</strong> at the left'
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
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.start);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.start), 550);
        },
      },

      // ── Step 3: El Dorado ─────────────────────────────────────────────────
      {
        title: 'El Dorado 🏆',
        body: 'The tiles with a <strong>dashed gold border</strong> and a 🏁 flag '
          + 'are <strong>finishing tiles</strong>. The first player to land on one '
          + 'triggers the final round — Each player left in that round will now play their final turn. Once the round is completed, the game is over.',
        onEnter: () => {
          const ids = [...TUTORIAL_TILE_GROUPS.finishing, ...TUTORIAL_TILE_GROUPS.elDorado];
          r.zoomToTiles(ids);
          setTimeout(() => this._spotlightTiles(ids), 550);
        },
      },

      // ── Step 4: Tile Info ────────────────────────────────────────────────────
      {
        title: 'Tile Information',
        body: 'The path to El Dorado leads through different types of terrain: landscape (green, yellow, blue), rubble (gray), and base camp(red).<br>'
          + ' Each hex space shows the terrain requirements you have to meet to move onto it.',
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.basic);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.basic), 550);
        },
      },

      // ── Step 5: Basic Tiles ─────────────────────────────────────────────────────
      {
        title: 'Basic Tiles',
        body: '🌿 Jungle tiles require <strong>green cards</strong>.<br>'
          + '🌊 Rivers and lakes need <strong>blue cards</strong>.<br>'
          + '🏘️ Village tiles need <strong>yellow cards</strong>.',
        onEnter: () => { 
          this._spotlightTiles(TUTORIAL_TILE_GROUPS.basic);
        },
      },

      // ── Step 6: Rubble ────────────────────────────────────────────────────
      {
        title: '🪨 Rubble Tiles',
        body: 'To move onto a rubble space, use any cards from your hand. The number of symbols'
        + ' on the space indicates the number of cards you need to play, regardless of their power or identity.',
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.rubble);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.rubble), 550);
        },
      },

      // ── Step 7: Camp ──────────────────────────────────────────────────────
      {
        title: '⛺ Camp Tiles',
        body: 'Cards you play to move onto a base camp space aren’t discarded. Instead, they are completely'
          + ' removed from the game. They won’t be used again this game. Use camp tiles intentionally to purge weak starter cards.',
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.camp);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.camp), 550);
        },
      },

      // ── Step 8: Mountain ──────────────────────────────────────────────────
      {
        title: '⛰ Mountain Tiles',
        body: 'Mountain tiles are <strong>impassable</strong>. No card can move '
          + 'you onto one. They exist only as barriers that force you to route '
          + 'around them — plan your path accordingly.<br><br><strong>Additionally:</strong> You cannot move onto any space already occupied another player.',
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.mountain);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.mountain), 550);
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
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.more_requirements);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.more_requirements), 550);
        },
      },

      // ── Step 10: Transition to turn loop ─────────────────────────────────
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

      // ── Step 11: Starting Hand ───────────────────────────────────────────────────
      {
        title: 'Starting Deck',
        body: 'Your starting deck will consist of: <br>'
          + '<ul><li>3 Explorer cards (1 green movement each)</li>'
          + '<li>1 Sailor card (1 water movement)</li>'
          + '<li>4 Traveler cards (1 village movement each)</li></ul>',
        onEnter: () => {},
      },

      // ── Step 12: Your hand ────────────────────────────────────────────────
      {
        title: 'Your Hand',
        body: 'Each turn starts with you drawing cards to your hand until you have 4 cards. Cards played or used to buy stronger cards will placed in your discard pile. Your discarded cards are reshuffled into your draw pile when it runs out. '
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

      // ── Step 12.1: Play a card ────────────────────────────────────────────────
      {
        title: 'Play a card',
        body: 'Click a <strong>green</strong> Explorer card to play it. '
          + '',
        onEnter: () => {
          this._nextBtn.style.display = 'none';
          // Anchor callout to hand — safe to do immediately, hand doesn't move
          this._anchorCalloutToElement('#player-hand-ui .card-btn', 'above');
        },
      },

      // ── Step 13: Valid moves ──────────────────────────────────────────────
      {
        title: 'Valid Moves',
        body: 'Glowing tiles show where you can move with the card you played. '
          + 'The card\'s terrain must match the tile. '
          + 'Click a glowing tile to move there.',
        onEnter: () => {
          this._nextBtn.style.display = 'none';
          const adjacentJungle = ['-2_2', '-2_3'];
          this.renderer.setValidMoves(adjacentJungle);
          
          r.zoomToTiles(adjacentJungle);
          setTimeout(() => this._spotlightTiles(adjacentJungle), 550);

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

      // ── Step 14: After moving ─────────────────────────────────────────────
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

      // ── Step 15: Deck cycling ─────────────────────────────────────────────
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

      // ── Step 16: Market — purchasing power ───────────────────────────────
      {
        title: 'The Market — Purchasing Power',
        body: 'To use the cards in your hand to purchase stronger cards, click the market button to open the shop. To buy a card, you can <strong>click one or more cards from your hand</strong> '
          + 'to pool purchasing power. Any <strong>yellow card</strong> is worth the number of movement points shown on the card. All other cards are woth 1/2 coin each.',
        onEnter: () => {
          const tutorialMarket = window.ElDoradoCards.buildShopState();
          this.cardUI.renderHand(TUTORIAL_HAND);
          this.cardUI.renderMarket(tutorialMarket);
          this.cardUI.openMarket(0);
          this._installMarketCallbacks();
        },
      },

      // ── Step 17: Try clicking the Traveler ───────────────────────────────
      {
        title: 'Try It — Click the Traveler',
        body: 'Click the <strong>yellow Traveler card</strong> in your hand to '
          + 'add its 1 gold to your purchasing power. '
          + 'You\'ll see some market cards get a <strong>green outline</strong> — '
          + 'those are now affordable.',
        onEnter: () => {
          this._nextBtn.style.display = 'none';
          this._installMarketCallbacks();
          const originalPoolClick = this.cardUI._handleMarketPoolClick.bind(this.cardUI);
          this.cardUI._handleMarketPoolClick = (instanceId, btn) => {
            originalPoolClick(instanceId, btn);
            this.cardUI._handleMarketPoolClick = originalPoolClick;
            setTimeout(() => this._advance(), 400);
          };
          this._anchorCalloutToElement('#player-hand-ui .card-btn:nth-child(3)', 'above');
          this._nextBtn.style.display = 'none';
        },
      },

      // ── Step 18: Buying a card ────────────────────────────────────────────
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

      // ── Step 19: The Reserve ─────────────────────────────────────────────
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
          this.cardUI._changeMarketView(true);
          this._anchorCalloutToElement('#shop-slots', 'above');
        },
      },

      // ── Step 19c: Special Cards ────────────────────────────────────────────
      {
        title: 'Wild Cards',
        body: 'Black cards are <strong>wild</strong> and can be used as any color. However, you have to commit them to a single color when playing; you can\'t cross multiple different types of terrain with a single move.',
        onEnter: () => {
          this._anchorCalloutToElement('.card-btn.terrain-wild.market-reserve', 'above');
        },
      },

      // ── Step 19b: Special Cards ────────────────────────────────────────────
      {
        title: 'Special Cards',
        body: 'Purple cards have unique, very special abilities. Each one has an clickable information button that explains what it does and how to use it.',
        onEnter: () => {
          this._anchorCalloutToElement('.card-btn.terrain-empty.market-reserve', 'above');
        },
      },

      // ── Step 19c: One-Time Use cards ────────────────────────────────────────────
      {
        title: 'One Time Use Cards',
        body: 'Notice some cards have a red X that means they are one time use. When you play them, they are removed from the game and will not be reshuffled into your deck.',
        onEnter: () => {
          this._anchorCalloutToElement('.market-reserve-section .card-onetime-line', 'above');
        },
      },

      // ── Step 20: Wrap-up ──────────────────────────────────────────────────
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