// client/src/game/CardUI.js
//
// Cards are rendered once into #hand-cards and kept in the DOM.
// A single delegated click handler on the container dispatches to the right
// action based on this._mode ('movement' | 'market' | 'rubble').
// Pool membership (market selection, rubble selection) is reflected by
// toggling CSS classes on the existing buttons — no rebuilds.
//
// Session 4 Polish changes:
//   4d — Staggered card-deal entrance animation on renderHand()
//   4e — Rubble prompt copy & live counter improvements

class CardUI {
  constructor() {
    this.handEl   = document.getElementById('hand-cards');
    this.shopEl   = document.getElementById('shop-slots');
    this.totalEl  = document.getElementById('purchase-total');
    this.marketEl = document.getElementById('card-market');

    // Callbacks — set by main.js
    this.onCardPlayed     = null; // (instanceId) — play for movement
    this.onMarketCard     = null; // ({ cardKey, handCardsUsed }) — purchase
    this.onEndTurn        = null;
    this.onCancelPurchase = null;
    this.onDiscardClicked = null;

    // ── Mode ────────────────────────────────────────────────────────────────
    // 'movement' | 'market' | 'rubble'
    this._mode = 'movement';
    this._marketView = 'shop'; // 'shop' | 'reserve' (only relevant when _mode is 'market')

    // ── Shared state ────────────────────────────────────────────────────────
    this._currentHand      = [];
    this._lastMarket       = null;

    // ── Market state ────────────────────────────────────────────────────────
    this._transmitterBonus = 0;
    this._purchasePool     = new Map(); // instanceId → card

    // ── Rubble state ────────────────────────────────────────────────────────
    this._rubbleNeeded    = 0;
    this._rubblePool      = new Map(); // instanceId → card
    this._rubbleExcludeId = null;
    this._rubbleExcludeName  = null;
    this._rubbleOnConfirm = null;
    this._rubbleOnCancel  = null;

    this._bindControls();
    this._bindHandDelegate();
    this._createInfoModal();
    this._bindInfoDelegates();
  }

  // ── Info modal for special card descriptions ────────────────────────────

  _createInfoModal() {
    const overlay = document.createElement('div');
    overlay.id = 'card-info-modal';
    overlay.className = 'card-info-modal hidden';
    overlay.innerHTML = `
      <div class="card-info-modal-content">
        <h3 class="card-info-modal-title"></h3>
        <p class="card-info-modal-text"></p>
        <button class="card-info-modal-close">Got it</button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('card-info-modal-close')) {
        overlay.classList.add('hidden');
      }
    });
  }

  _bindInfoDelegates() {
    document.addEventListener('click', (e) => {
      const infoBtn = e.target.closest('.card-info-btn');
      if (!infoBtn) return;
      e.stopPropagation();
      e.preventDefault();
      const effect = infoBtn.dataset.effect;
      if (!effect) return;
      this._showInfoModal(effect);
    });
  }

  _showInfoModal(effect) {
    const modal = document.getElementById('card-info-modal');
    const title = modal.querySelector('.card-info-modal-title');
    const text = modal.querySelector('.card-info-modal-text');

    const names = {
      transmitter: 'Transmitter', cartographer: 'Cartographer',
      compass: 'Compass', scientist: 'Scientist',
      travel_log: 'Travel Log', native: 'Native',
    };

    title.textContent = names[effect] || effect;
    text.textContent = this._specialFullDescription(effect);
    modal.classList.remove('hidden');
  }

  // ── Static control bindings ──────────────────────────────────────────────

  _bindControls() {
    document.getElementById('end-turn-btn').addEventListener('click', () => this.onEndTurn?.());
    document.getElementById('open-market-btn').addEventListener('click', () => this.openMarket());
    document.getElementById('discard-btn').addEventListener('click', () => this.onDiscardClicked?.());
    document.getElementById('cancel-purchase-btn').addEventListener('click', () => this.closeMarket());
    this._getMarketShopButton().addEventListener('click', () => this._changeMarketView(false));
    this._getMarketReserveButton().addEventListener('click', () => this._changeMarketView(true));
  }

  // ── Single delegated click handler on #hand-cards ────────────────────────

  _bindHandDelegate() {
    this.handEl.addEventListener('click', (e) => {
      if (e.target.closest('.card-info-btn')) return;
      const btn = e.target.closest('.card-btn');
      if (!btn) return;
      const instanceId = btn.dataset.instanceId;
      if (!instanceId) return;

      if (this._mode === 'movement') {
        this._handleMovementClick(instanceId, btn);
      } else if (this._mode === 'market') {
        this._handleMarketPoolClick(instanceId, btn);
      } else if (this._mode === 'rubble') {
        this._handleRubblePoolClick(instanceId, btn);
      }
    });
  }

  _handleMovementClick(instanceId) {
    this.onCardPlayed?.(instanceId);
  }

  _handleMarketPoolClick(instanceId, btn) {
    const card = this._currentHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    if (this._purchasePool.has(instanceId)) {
      this._purchasePool.delete(instanceId);
      btn.classList.remove('in-pool');
    } else {
      this._purchasePool.set(instanceId, card);
      btn.classList.add('in-pool');
    }
    this._updatePurchaseTotal();
  }

  _handleRubblePoolClick(instanceId, btn) {
    if (instanceId === this._rubbleExcludeId) return;
    const card = this._currentHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    if (this._rubblePool.has(instanceId)) {
      this._rubblePool.delete(instanceId);
      btn.classList.remove('in-pool');
    } else if (this._rubblePool.size < this._rubbleNeeded) {
      this._rubblePool.set(instanceId, card);
      btn.classList.add('in-pool');
    }
    this._syncRubbleConfirmButton();
  }

  // ── Core hand render ─────────────────────────────────────────────────────

  renderHand(cards) {
    this._currentHand = cards;

    const existingIds = new Set(
      [...this.handEl.querySelectorAll('.card-btn')].map(b => b.dataset.instanceId)
    );
    const incomingIds = new Set(cards.map(c => c.instanceId));

    // Remove cards no longer in hand
    for (const btn of [...this.handEl.querySelectorAll('.card-btn')]) {
      if (!incomingIds.has(btn.dataset.instanceId)) btn.remove();
    }

    // Collect truly new cards so we can stagger only their entrance
    // (existing cards that are staying don't re-animate)
    const newCards = cards.filter(c => !existingIds.has(c.instanceId));

    // Add new cards — stagger their animation delay (4d)
    newCards.forEach((card, i) => {
      const btn = this._makeCardButton(card);
      // Each new card enters 50ms after the previous one
      btn.style.animationDelay = `${i * 150}ms`;
      // Reset the delay after the animation completes so hover/state
      // transitions aren't affected by a lingering delay value
      btn.addEventListener('animationend', () => {
        btn.style.animationDelay = '';
      }, { once: true });
      this.handEl.appendChild(btn);
    });

    // Prune stale pool entries
    for (const id of [...this._purchasePool.keys()]) {
      if (!incomingIds.has(id)) this._purchasePool.delete(id);
    }
    for (const id of [...this._rubblePool.keys()]) {
      if (!incomingIds.has(id)) this._rubblePool.delete(id);
    }

    this._syncHandState();
    if (this._mode === 'market') this._updatePurchaseTotal();
  }

  _syncHandState() {
    for (const btn of this.handEl.querySelectorAll('.card-btn')) {
      const id = btn.dataset.instanceId;

      const excluded = this._mode === 'rubble' && id === this._rubbleExcludeId;
      btn.classList.toggle('rubble-excluded', excluded);
      btn.disabled = excluded;

      if (this._mode === 'market') {
        btn.classList.toggle('in-pool', this._purchasePool.has(id));
        btn.classList.remove('selected');
      } else if (this._mode === 'rubble') {
        btn.classList.toggle('in-pool', this._rubblePool.has(id));
        btn.classList.remove('selected');
      } else {
        btn.classList.remove('in-pool');
        btn.disabled = false;
      }
    }
  }

  // ── Card button factory ───────────────────────────────────────────────────
  // Two-tone frame: a header strip + a body area, both themed by terrain type.

  _makeCardButton(card) {
    return this._makeCardShared(card, false, false, false);
  }

  _terrainIcon(terrain) {
    switch (terrain) {
      case 'jungle':  return '🌿';
      case 'water':   return '🌊';
      case 'village': return '🏘️';
      case 'wild':    return '🧭';
      case 'empty':   return '✨';
      default:        return '';
    }
  }

  _specialDescription(effect) {
    switch (effect) {
      case 'transmitter':  return '📡 Free card from market';
      case 'cartographer': return '🗺️ Draw 2 extra cards';
      case 'compass':      return '🧭 Draw 3 cards';
      case 'scientist':    return '🔬 Draw 1 & remove a card';
      case 'travel_log':   return '📖 Draw 2 & remove up to 2';
      case 'native':       return '🏹 Move 1 space';
      default:             return '';
    }
  }

  _specialFullDescription(effect) {
    switch (effect) {
      case 'transmitter':
        return 'When you play the Transmitter you may take any expedition card without paying for it. Choose any card on the market board or above it. Put the new card on your discard pile, as usual. The Transmitter is removed from the game after use.';
      case 'cartographer':
        return 'The Cartographer allows you to draw 2 cards from your draw pile and play them this turn. If your draw pile is empty, first shuffle your discard pile as usual, then draw.';
      case 'compass':
        return 'The Compass allows you to draw 3 cards, but you must remove the Compass from the game after use.';
      case 'scientist':
        return 'Use the Scientist to optimize your expedition. She allows you to immediately draw an additional card and then, if you want to, you may remove any card in your hand from the game.';
      case 'travel_log':
        return 'The Travel Log lets you draw 2 cards and then remove up to 2 cards in your hand from the game. Unfortunately, the Travel Log also removes itself from the game.';
      case 'native':
        return 'The Native knows the lay of the land and always lets you move one space when played. Ignore that space\'s requirements and just place your playing piece on it. The Native can also tear down blockades, but you cannot use it to move to an occupied space or onto a mountain space.';
      default:
        return '';
    }
  }

  // ── Mode transitions ─────────────────────────────────────────────────────

  _setMode(mode) {
    this._mode = mode;
    this._syncHandState();
  }

  _setMarketView(isReserve) {
    this._marketView = isReserve ? 'reserve' : 'shop';
  }

  // ── Market open / close ──────────────────────────────────────────────────

  openMarket(transmitterBonus = 0) {
    this._transmitterBonus = transmitterBonus;
    this._purchasePool.clear();
    this.marketEl.classList.remove('hidden');
    this._setMode('market');
    this._changeMarketView(false);
    if (this._lastMarket) this.renderMarket(this._lastMarket);
    this._updatePurchaseTotal();
  }

  closeMarket() {
    this._transmitterBonus = 0;
    this._purchasePool.clear();
    this.marketEl.classList.add('hidden');
    this._setMode('movement');
  }

  openMarketWithBonus(totalPurchasePower) {
    this.openMarket(totalPurchasePower);
  }

  _changeMarketView(isReserve) {
    if (this._marketView === (isReserve ? 'reserve' : 'shop')) return;
    
    this._setMarketView(isReserve);
    this._getMarketShopButton().classList.toggle('active', !isReserve);
    this._getMarketReserveButton().classList.toggle('active', isReserve);

    this.shopEl.classList.toggle('show-reserve', isReserve);
  }

  _getMarketShopButton() {
    return document.getElementById('marketShopButton');
  }

  _getMarketReserveButton() {
    return document.getElementById('marketReserveButton');
  }

  // ── Rubble confirm button sync ────────────────────────────────────────────

  _syncRubbleConfirmButton() {
    const btn = document.getElementById('rubble-confirm-btn');
    if (!btn) return;
    const ready = this._rubblePool.size >= this._rubbleNeeded;
    btn.disabled      = !ready;
    btn.style.opacity = ready ? '1' : '.4';
    btn.style.cursor  = ready ? 'pointer' : 'not-allowed';
    this._syncHandState();

    // 4e: live counter update
    const counter = document.getElementById('rubble-selection-count');
    if (counter) {
      const selected = this._rubblePool.size;
      const needed   = this._rubbleNeeded;
      counter.textContent = selected >= needed
        ? `✓ ${selected} of ${needed} selected — ready!`
        : `${selected} of ${needed} selected`;
      counter.style.color = selected >= needed ? '#4cff4c' : '#ffaaaa';
    }
  }

  // ── Selected-card highlight (movement mode) ──────────────────────────────

  updateSelectedCardForMovement(instanceId) {
    for (const btn of this.handEl.querySelectorAll('.card-btn')) {
      btn.classList.toggle('selected', btn.dataset.instanceId === instanceId);
    }
  }

  // ── Market rendering ─────────────────────────────────────────────────────

  renderMarket(market) {
    this._lastMarket = market;
    this.shopEl.innerHTML = '';

    const isTransmitter = this._transmitterBonus > 0;

    this.shopEl.classList.toggle('transmitter-active', isTransmitter);

    const shopAvailable = document.createElement('div');
    shopAvailable.className = 'market-available-section';

    const shopRow = document.createElement('div');
    shopRow.className = 'market-row';
    shopAvailable.appendChild(shopRow);
    
    for (const card of (market?.shop ?? [])) {
      shopRow.appendChild(this._makeMarketCardEl(card, false));
    }
    
    this.shopEl.appendChild(shopAvailable);

    const reserveCards = (market?.reserve ?? []).filter(c => c && c.remaining > 0);
    if (reserveCards.length > 0) {
      const shopReserve = document.createElement('div');
      shopReserve.className = 'market-reserve-section';

      const reserveHeader = document.createElement('div');
      reserveHeader.className = 'market-section-header market-reserve-header';
      reserveHeader.textContent = isTransmitter
        ? 'Reserve (Transmitter: buyable)'
        : 'Reserve (not yet available)';
      shopReserve.appendChild(reserveHeader);

      const reserveRow = document.createElement('div');
      reserveRow.className = 'market-row';
      shopReserve.appendChild(reserveRow);

      for (const card of reserveCards) {
        reserveRow.appendChild(this._makeMarketCardEl(card, true, isTransmitter));
      }

      this.shopEl.appendChild(shopReserve);
    }

    if (this._mode === 'market') this._updateAffordability();
  }

  _makeCardShared(card, isMarket, isReserve, transmitterActive) {
    const btn = document.createElement('button');
    btn.className = `card-btn terrain-${card.movementTerrain || 'empty'}`;
    if (isReserve) btn.classList.add('market-reserve');
    btn.dataset.instanceId = card.instanceId;
    btn.dataset.cardKey = card.key;

    const terrainIcon = this._terrainIcon(card.movementTerrain);
    const movesLine = card.movementTotal > 0
      ? `<div class="card-stat-line">
           <span>${terrainIcon} ${card.movementTotal}</span>
         </div>` : '';

    const effectDesc = this._specialDescription(card.specialEffect);
    const effectLine = effectDesc
      ? `<div class="card-effect-line">${effectDesc}</div>` : '';

    const oneTimeLine = card.oneTimeUse
      ? `<div class="card-onetime-line">❌</div>` : '';

    const cardImage = `<img src="/shared/images/${card.key}.png" alt="${card.cardName}">`;

    const fullDesc = this._specialFullDescription(card.specialEffect);

    const infoBtn  = fullDesc
      ? `<span class="card-info-btn" data-effect="${card.specialEffect}" title="Details">ℹ️</span>` : '';

    btn.innerHTML = `
      ${infoBtn}
      <div class="card-header-strip">
        <span class="card-name">${card.cardName}</span>
        ${movesLine}
      </div>
      <div class="card-body-area">
        ${cardImage}
        ${oneTimeLine}
      </div>`;

    if (isMarket) {
      btn.classList.add('market-card');

      const wrapperElem = document.createElement('div');
      wrapperElem.className = 'market-card-wrapper';
      
      const costElem = document.createElement('div');
      costElem.className = 'cost-label';
      costElem.textContent = `💰 ${card.cost}`;

      const remainingElem = document.createElement('div');
      remainingElem.className = 'cards-remaining';
      remainingElem.textContent = `×${card.remaining} left`;

      const marketCardInfo = document.createElement('div');
      marketCardInfo.className = 'market-card-info';
      marketCardInfo.appendChild(costElem);
      marketCardInfo.appendChild(remainingElem);

      wrapperElem.appendChild(marketCardInfo);
      wrapperElem.appendChild(btn);

      if (isReserve && !transmitterActive) {
        btn.classList.add('reserve-locked');
      } else {
        btn.addEventListener('click', (e) => {
          if (e.target.closest('.card-info-btn')) return;
          this._onMarketCardClicked(card);
        });
      }

      return wrapperElem;
    }

    return btn;

  }

  _makeMarketCardEl(card, isReserve, transmitterActive = false) {
    return this._makeCardShared(card, true, isReserve, transmitterActive);
  }

  _onMarketCardClicked(card) {
    const power = this._currentPurchasePower();
    if (power < card.cost) {
      if (this.totalEl) {
        this.totalEl.style.color = '#e74c3c';
        setTimeout(() => { this.totalEl.style.color = ''; }, 600);
      }
      return;
    }
    const handCardsUsed = [...this._purchasePool.keys()];
    this.onMarketCard?.({ cardKey: card.key, handCardsUsed });
  }

  // ── Purchase power ────────────────────────────────────────────────────────

  _currentPurchasePower() {
    let total = this._transmitterBonus;
    for (const card of this._purchasePool.values()) {
      total += card.purchasingPower ?? 0;
    }
    return total;
  }

  _updatePurchaseTotal() {
    const power = this._currentPurchasePower();
    if (this.totalEl) this.totalEl.textContent = `💰 ${power.toFixed(1)}`;
    this._updateAffordability();
  }

  _updateAffordability() {
    const power = this._currentPurchasePower();
    this.shopEl.querySelectorAll('.market-card-wrapper:not(.empty):not(.reserve-locked)').forEach(wrapper => {
      const costEl = wrapper.querySelector('.cost-label');
      if (!costEl) return;
      const cost = parseFloat(costEl.textContent.replace(/[^0-9.]/g, ''));
      const affordable = power >= cost;
      wrapper.classList.toggle('cant-afford', !affordable);
      wrapper.classList.toggle('can-afford', affordable);
    });
  }

  updatePurchaseTotal(total) {
    this._transmitterBonus = total;
    this._updatePurchaseTotal();
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  showMarket(visible) {
    if (visible) this.openMarket();
    else this.closeMarket();
  }

  setControlsEnabled(enabled) {
    document.getElementById('end-turn-btn').disabled    = !enabled;
    document.getElementById('open-market-btn').disabled = !enabled;
  }

  showReservePicker(soldOutKey, reserveCards, onChosen) {
    const overlay    = document.getElementById('reserve-picker');
    const container  = document.getElementById('reserve-cards');
    const soldOutLbl = document.getElementById('reserve-sold-out-label');

    soldOutLbl.textContent = `Empty slot: ${soldOutKey.replace(/_/g, ' ')}`;
    container.innerHTML = '';

    for (const card of reserveCards) {
      const el    = this._makeMarketCardEl(card, true, true);
      const clean = el.cloneNode(true);
      clean.addEventListener('click', (e) => {
        if (e.target.closest('.card-info-btn')) return;
        onChosen(card.key);
        overlay.classList.add('hidden');
      });
      container.appendChild(clean);
    }

    overlay.classList.remove('hidden');
  }

  // ── Rubble payment mode ──────────────────────────────────────────────────

  enterRubblePaymentMode(count, excludeInstanceId, onConfirm, onCancel) {
    this._rubbleNeeded    = count;
    this._rubbleExcludeId = excludeInstanceId ?? null;
    this._rubblePool      = new Map();
    this._rubbleOnConfirm = onConfirm;
    this._rubbleOnCancel  = onCancel;

    const excludedCard = excludeInstanceId
      ? this._currentHand.find(c => c.instanceId === excludeInstanceId)
      : null;
    this._rubbleExcludeName = excludedCard?.cardName ?? excludedCard?.key ?? null;

    this._setMode('rubble');
    this._renderRubbleControls();
  }

  exitRubblePaymentMode() {
    this._rubblePool        = new Map();
    this._rubbleNeeded      = 0;
    this._rubbleExcludeId   = null;
    this._rubbleExcludeName = null;
    document.getElementById('hand-messages').innerHTML = '';
    this._setMode('movement');
  }

  getRubblePaymentCards() {
    return [...this._rubblePool.keys()];
  }

  // 4e: Rubble prompt — polished copy and live counter
  _renderRubbleControls() {
    const messages = document.getElementById('hand-messages');

    const cardWord = this._rubbleNeeded === 1 ? 'card' : 'cards';

    // Committed-card note: cleaner phrasing than before
    const nameNote = this._rubbleExcludeName
      ? `<span class="rubble-committed-note">
           <span class="rubble-committed-card">🔒 ${this._rubbleExcludeName}</span>
           already pays — pick <strong>${this._rubbleNeeded}</strong> more ${cardWord} for the toll.
         </span>`
      : `<span class="rubble-committed-note">
           Pick <strong>${this._rubbleNeeded}</strong> ${cardWord} of any type to pay the toll.
         </span>`;

    messages.innerHTML = `
      <div class="rubble-prompt">
        <div class="rubble-prompt-header">🪨 Pay with any cards</div>
        ${nameNote}
        <span id="rubble-selection-count" class="rubble-selection-count">
          0 of ${this._rubbleNeeded} selected
        </span>
      </div>
      <div class="rubble-prompt-actions">
        <button id="rubble-confirm-btn" disabled
          style="background:#e74c3c;color:#fff;border:none;border-radius:4px;
                 padding:.35rem 1rem;cursor:not-allowed;opacity:.4;font-size:.8rem;font-weight:600;">
          Cross Rubble
        </button>
        <button id="rubble-cancel-btn"
          style="background:#555;color:#fff;border:none;border-radius:4px;
                 padding:.35rem .8rem;cursor:pointer;font-size:.8rem">
          Cancel
        </button>
      </div>`;

    document.getElementById('rubble-cancel-btn').onclick  = () => this._rubbleOnCancel?.();
    document.getElementById('rubble-confirm-btn').onclick = () => this._rubbleOnConfirm?.();
  }

  disableMarketButton() {
    document.getElementById('open-market-btn').disabled = true;
  }
}