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

    // Phone compact-market pool chips (created once, shown only in phone
    // market mode). Lets the buyer audit/un-pool without scrolling the hand.
    this.poolChipsEl = document.createElement('div');
    this.poolChipsEl.id = 'pool-chips';
    this.poolChipsEl.className = 'hidden';
    document.getElementById('market-header')?.after(this.poolChipsEl);

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

  // ── View helpers ─────────────────────────────────────────────────────────

  // Phone compact-market layout (rows, top sheet) vs desktop full cards.
  // main.js sets body[data-view] from ?view=; class is the Block 2 fallback.
  _isPhoneView() {
    return document.body?.dataset?.view === 'phone'
      || document.body?.classList?.contains('view-phone');
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
    const showValues = this._mode === 'market' && this._isPhoneView();
    for (const btn of this.handEl.querySelectorAll('.card-btn')) {
      const id = btn.dataset.instanceId;

      const excluded = this._mode === 'rubble' && id === this._rubbleExcludeId;
      btn.classList.toggle('rubble-excluded', excluded);
      btn.disabled = excluded;

      // Phone market mode: badge each hand card with its pool value so the
      // buyer isn't pooling blind (yellow face value vs 0.5). Display-only;
      // the numbers come straight from the server-provided hand payload.
      let badge = btn.querySelector('.pool-value-badge');
      if (showValues) {
        const card = this._currentHand.find(c => c.instanceId === id);
        const val = card?.purchasingPower ?? 0;
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'pool-value-badge';
          btn.appendChild(badge);
        }
        badge.textContent = `+${val}`;
      } else if (badge) {
        badge.remove();
      }

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
    this.poolChipsEl.innerHTML = '';
    this.poolChipsEl.classList.add('hidden');
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
    // Phone: compact rows in a top sheet (hand stays visible below).
    // Desktop/TV: full card art, unchanged.
    if (this._isPhoneView()) return this._renderMarketCompact(market);
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

  // ── Phone compact market (rows, no card art) ─────────────────────────────
  // Same data, same events (purchase_card via Buy), same tabs — just rows so
  // 6 shop cards + total + hand all fit a small screen. Purple cards keep
  // their one-line effect inline and full text behind ℹ️ (existing modal).

  _renderMarketCompact(market) {
    this.shopEl.innerHTML = '';
    const isTransmitter = this._transmitterBonus > 0;
    this.shopEl.classList.toggle('transmitter-active', isTransmitter);

    const shopAvailable = document.createElement('div');
    shopAvailable.className = 'market-available-section';

    const shopList = document.createElement('div');
    shopList.className = 'market-row-list';
    shopAvailable.appendChild(shopList);

    for (const card of (market?.shop ?? [])) {
      shopList.appendChild(this._makeMarketRowEl(card, false, isTransmitter));
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

      const reserveList = document.createElement('div');
      reserveList.className = 'market-row-list';
      shopReserve.appendChild(reserveList);

      for (const card of reserveCards) {
        reserveList.appendChild(this._makeMarketRowEl(card, true, isTransmitter));
      }
      this.shopEl.appendChild(shopReserve);
    }

    if (this._mode === 'market') this._updateAffordability();
  }

  _makeMarketRowEl(card, isReserve, transmitterActive = false) {
    const locked = isReserve && !transmitterActive;
    const row = document.createElement('div');
    row.className = 'market-row-item' + (isReserve ? ' is-reserve' : '');
    if (locked) row.classList.add('reserve-locked');
    row.dataset.cardKey = card.key;

    const effectDesc = this._specialDescription(card.specialEffect);
    const lastCopy = !isReserve && card.remaining === 1;

    const nameEl = document.createElement('span');
    nameEl.className = 'market-row-name';
    nameEl.textContent = card.cardName || card.key;
    row.appendChild(nameEl);

    if (effectDesc) {
      const effEl = document.createElement('span');
      effEl.className = 'market-row-effect';
      effEl.textContent = effectDesc;
      row.appendChild(effEl);
    }

    const leftEl = document.createElement('span');
    leftEl.className = 'market-row-left';
    // Last-copy hint: buying this empties the slot and earns a reserve pick.
    leftEl.textContent = lastCopy
      ? `×1 left · → reserve pick`
      : `×${card.remaining} left`;
    row.appendChild(leftEl);

    const costEl = document.createElement('span');
    costEl.className = 'market-row-cost';
    costEl.textContent = transmitterActive ? 'FREE' : `💰 ${card.cost}`;
    row.appendChild(costEl);

    // ℹ️ opens the existing full-text modal (z-9999, above sheet + picker).
    // It must not trigger a purchase — Buy is a separate button.
    if (effectDesc) {
      const info = document.createElement('span');
      info.className = 'card-info-btn market-row-info';
      info.dataset.effect = card.specialEffect;
      info.title = 'Details';
      info.setAttribute('role', 'button');
      info.setAttribute('aria-label', `${card.cardName} details`);
      info.textContent = 'ℹ️';
      row.appendChild(info);
    }

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'market-row-buy';
    buy.textContent = transmitterActive ? 'Take' : 'Buy';
    buy.disabled = locked;
    if (!locked) {
      buy.addEventListener('click', () => this._onMarketCardClicked(card));
    }
    row.appendChild(buy);

    return row;
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
  // Display-only sum for the live pool total (Block 5). Pricing authority is
  // the server (shared/cardData.js getPurchasingPower + GameState) — this
  // never decides affordability, it only mirrors it for the pool UI.

  _currentPurchasePower() {
    let total = this._transmitterBonus;
    for (const card of this._purchasePool.values()) {
      total += card.purchasingPower ?? 0;
    }
    return total;
  }

  // True while the buyer is pooling (overlay visible in market mode).
  isMarketOpen() {
    return this._mode === 'market' && !this.marketEl.classList.contains('hidden');
  }

  _updatePurchaseTotal() {
    const power = this._currentPurchasePower();
    // Live total + pooled count, e.g. "💰 2.5 · 3 pooled" — verifies yellow
    // (face value) + 0.5-value cards are both counted as tapped.
    if (this.totalEl) this.totalEl.textContent = `💰 ${power.toFixed(1)} · ${this._purchasePool.size} pooled`;
    this._renderPoolChips();
    this._updateAffordability();
  }

  // Phone audit strip: pooled cards as removable chips (tap ✕ to un-pool).
  // Desktop: no-op (container stays hidden).
  _renderPoolChips() {
    if (!this.poolChipsEl) return;
    if (!(this._mode === 'market' && this._isPhoneView()) || this._purchasePool.size === 0) {
      this.poolChipsEl.innerHTML = '';
      this.poolChipsEl.classList.add('hidden');
      return;
    }
    this.poolChipsEl.classList.remove('hidden');
    this.poolChipsEl.innerHTML = '';
    for (const [id, card] of this._purchasePool) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pool-chip';
      chip.dataset.instanceId = id;
      chip.setAttribute('aria-label', `Remove ${card.cardName || card.key} from pool`);
      const label = document.createElement('span');
      label.textContent = `${card.cardName || card.key} +${card.purchasingPower ?? 0}`;
      const x = document.createElement('span');
      x.className = 'pool-chip-x';
      x.textContent = '✕';
      chip.appendChild(label);
      chip.appendChild(x);
      chip.addEventListener('click', () => {
        this._purchasePool.delete(id);
        this._syncHandState();
        this._updatePurchaseTotal();
      });
      this.poolChipsEl.appendChild(chip);
    }
  }

  _updateAffordability() {
    const power = this._currentPurchasePower();
    // Desktop full cards…
    this.shopEl.querySelectorAll('.market-card-wrapper:not(.empty):not(.reserve-locked)').forEach(wrapper => {
      const costEl = wrapper.querySelector('.cost-label');
      if (!costEl) return;
      const cost = parseFloat(costEl.textContent.replace(/[^0-9.]/g, ''));
      const affordable = power >= cost;
      wrapper.classList.toggle('cant-afford', !affordable);
      wrapper.classList.toggle('can-afford', affordable);
    });
    // …and phone compact rows (cost from .market-row-cost; FREE rows in
    // Transmitter mode have no number and parse as NaN → always enabled).
    this.shopEl.querySelectorAll('.market-row-item:not(.reserve-locked)').forEach(row => {
      const costEl = row.querySelector('.market-row-cost');
      const buyBtn = row.querySelector('.market-row-buy');
      const cost = costEl ? parseFloat(costEl.textContent.replace(/[^0-9.]/g, '')) : NaN;
      const affordable = Number.isNaN(cost) || power >= cost;
      row.classList.toggle('cant-afford', !affordable);
      row.classList.toggle('can-afford', affordable);
      if (buyBtn) buyBtn.disabled = !affordable;
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

    // Phone: compact rows (one-liner + ℹ️, same as market rows) — choosing
    // the replacement is also a powers-informed decision. Desktop: cards.
    const phone = this._isPhoneView();

    for (const card of reserveCards) {
      if (phone) {
        container.appendChild(this._makeReservePickRowEl(card, onChosen, overlay));
        continue;
      }
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

  // Phone reserve-refill row: name + effect one-liner + ℹ️ (full modal) +
  // Choose. Tapping ℹ️ must not choose — guarded like the desktop path.
  _makeReservePickRowEl(card, onChosen, overlay) {
    const row = document.createElement('div');
    row.className = 'market-row-item reserve-pick-row';
    row.dataset.cardKey = card.key;

    const nameEl = document.createElement('span');
    nameEl.className = 'market-row-name';
    nameEl.textContent = card.cardName || card.key;
    row.appendChild(nameEl);

    const effectDesc = this._specialDescription(card.specialEffect);
    if (effectDesc) {
      const effEl = document.createElement('span');
      effEl.className = 'market-row-effect';
      effEl.textContent = effectDesc;
      row.appendChild(effEl);
    }

    if (effectDesc) {
      const info = document.createElement('span');
      info.className = 'card-info-btn market-row-info';
      info.dataset.effect = card.specialEffect;
      info.title = 'Details';
      info.setAttribute('role', 'button');
      info.setAttribute('aria-label', `${card.cardName} details`);
      info.textContent = 'ℹ️';
      row.appendChild(info);
    }

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'market-row-buy';
    choose.textContent = 'Choose';
    choose.addEventListener('click', () => {
      onChosen(card.key);
      overlay.classList.add('hidden');
    });
    row.appendChild(choose);

    return row;
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