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

    // Pooling rule reminder (replaces the old per-card pool-value badges:
    // yellow always pools at face value — already on the row — and every
    // other card is always +0.5, so per-card badges taught nothing new).
    // Static line under the market header; pooled cards audit themselves
    // as removable chips with their +values (see _renderPoolChips).
    this.poolRuleEl = document.createElement('div');
    this.poolRuleEl.id = 'pool-rule';
    this.poolRuleEl.className = 'hidden';
    this.poolRuleEl.setAttribute('role', 'note');
    this.poolRuleEl.textContent = 'Yellow cards pool at face value · all others +0.5';
    this.poolChipsEl?.after(this.poolRuleEl);

    // Transmitter free-pick banner (created once, shown only when the
    // Transmitter bonus is active). Makes it explicit that BOTH the market
    // and the reserve below are free picks — previously the reserve was
    // hidden behind a tab with no indication it was also selectable.
    this.transmitterBannerEl = document.createElement('div');
    this.transmitterBannerEl.id = 'transmitter-banner';
    this.transmitterBannerEl.className = 'hidden';
    this.transmitterBannerEl.setAttribute('role', 'status');
    this.transmitterBannerEl.textContent =
      '📡 Transmitter — pick ANY card FREE, Market + Reserve below';
    this.poolChipsEl?.before(this.transmitterBannerEl);

    // 1-buy-per-turn notice (own wrapped line below the header — never
    // inside #purchase-total, whose width would push ✕ Close off-screen
    // on narrow phones and soft-lock the overlay). Mirrors the
    // transmitter banner pattern.
    this.purchaseLockedBannerEl = document.createElement('div');
    this.purchaseLockedBannerEl.id = 'purchase-locked-banner';
    this.purchaseLockedBannerEl.className = 'hidden';
    this.purchaseLockedBannerEl.setAttribute('role', 'status');
    this.purchaseLockedBannerEl.textContent =
      '✅ Already bought this turn (1 per turn) — browsing only';
    this.transmitterBannerEl?.after(this.purchaseLockedBannerEl);

    // Callbacks — set by main.js
    this.onCardPlayed     = null; // (instanceId) — play for movement
    this.onMarketCard     = null; // ({ cardKey, handCardsUsed }) — purchase
    this.onEndTurn        = null;
    this.onCancelPurchase = null;
    this.onDiscardClicked = null;
    this.onMarketOpened   = null; // () — movement selection should be dropped
    this.onMarketClosed   = null; // () — resync action buttons
    this.onMarketBlocked  = null; // () — Market tapped mid rubble-toll (blocked)
    this.onPurchaseLocked = null; // () — Buy tapped after the 1-per-turn buy

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
    // Rulebook p4: 1 buy per turn. Set via setPurchaseLocked() from main.js
    // (own card_purchased → true, turn_ended/game_started → false). Display
    // gate only — the server flag is authoritative.
    this._purchaseLocked = false;

    // ── Rubble state ────────────────────────────────────────────────────────
    this._rubbleNeeded    = 0;
    this._rubblePool      = new Map(); // instanceId → card
    this._rubbleExcludeId = null;
    this._rubbleExcludeName  = null;
    this._rubbleDestLabel = null; // toll target in user terms ("destination 5",
    this._rubbleDestCost   = null; // never an internal tile id — those mean nothing on the board)
    this._rubbleOnConfirm = null;
    this._rubbleOnCancel  = null;

    this._bindControls();
    this._bindHandDelegate();
    this._createInfoModal();
    this._bindInfoDelegates();
    // Discard needs a selection first — never start enabled.
    this.setDiscardEnabled(false);
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
    // Mid-toll Market taps must not silently evaporate the toll (the open
    // would cancel the movement via onMarketOpened). Block with an
    // explanation so the picks survive; main.js toasts the reason.
    document.getElementById('open-market-btn').addEventListener('click', () => {
      if (this._mode === 'rubble') { this.onMarketBlocked?.(); return; }
      this.openMarket();
    });
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
    // 1-buy-per-turn lock: hand taps do nothing while locked (the market
    // explains why via the open toast + locked total line) instead of
    // pooling into dead Buy buttons.
    if (this._purchaseLocked) return;
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

  _specialDescription(effect) {
    switch (effect) {
      case 'transmitter':  return 'Free card from market';
      case 'cartographer': return 'Draw 2 extra cards';
      case 'compass':      return 'Draw 3 cards';
      case 'scientist':    return 'Draw 1 & remove up to 1';
      case 'travel_log':   return 'Draw 2 & remove up to 2';
      case 'native':       return 'Move 1 space';
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
    // Phone reclaim: body.market-open lets view-phone CSS hide the hand
    // chrome (buttons/pill/messages) and grow the sheet while buying.
    // Scoped to phones via body.view-phone.market-open selectors — desktop/TV unaffected.
    document.body?.classList?.add('market-open');
    this._setMode('market');
    // Transmitter forces the stacked combined view (Market + Reserve both
    // visible, tabs locked) — don't reset to the shop tab, that would hide
    // the reserve again. Normal opens keep the tab behaviour.
    if (!(transmitterBonus > 0)) {
      this._changeMarketView(false);
    } else {
      this._setMarketView('shop');
      this._getMarketShopButton().classList.add('active');
      this._getMarketReserveButton().classList.remove('active');
      this.shopEl.classList.remove('show-reserve');
    }
    this._syncTransmitterChrome();
    // Pooling rule reminder (not during a Transmitter free pick — nothing
    // pools there). Hidden again in closeMarket.
    this.poolRuleEl?.classList.toggle('hidden', transmitterBonus > 0);
    if (this._lastMarket) this.renderMarket(this._lastMarket);
    this._updatePurchaseTotal();
    // Bonus > 0 is the server-driven Transmitter free pick (the played card
    // is already disposed server-side) — the handler clears UI only and must
    // not emit a cancel. Plain opens are the buyer changing intention.
    this.onMarketOpened?.(transmitterBonus);
  }

  closeMarket() {
    this._transmitterBonus = 0;
    this._purchasePool.clear();
    this.marketEl.classList.add('hidden');
    document.body?.classList?.remove('market-open');
    this.poolChipsEl.innerHTML = '';
    this.poolChipsEl.classList.add('hidden');
    this.poolRuleEl?.classList.add('hidden');
    this._syncTransmitterChrome();
    this._setMode('movement');
    this.onMarketClosed?.();
  }

  openMarketWithBonus(totalPurchasePower) {
    this.openMarket(totalPurchasePower);
  }

  _changeMarketView(isReserve) {
    // Transmitter locks the stacked combined view — tab taps must not hide
    // either section while the free pick is pending.
    if (this._transmitterBonus > 0) return;
    if (this._marketView === (isReserve ? 'reserve' : 'shop')) return;
    
    this._setMarketView(isReserve);
    this._getMarketShopButton().classList.toggle('active', !isReserve);
    this._getMarketReserveButton().classList.toggle('active', isReserve);

    this.shopEl.classList.toggle('show-reserve', isReserve);
  }

  // Show/hide the Transmitter banner + lock/hide the Market/Reserve tabs.
  // Called from openMarket/closeMarket/renderMarket so re-renders can't
  // desync the chrome from the bonus state.
  _syncTransmitterChrome() {
    const active = this._transmitterBonus > 0;
    this.transmitterBannerEl?.classList.toggle('hidden', !active);
    this._getMarketShopButton()?.classList.toggle('transmitter-hidden', active);
    this._getMarketReserveButton()?.classList.toggle('transmitter-hidden', active);
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
    this._renderRubbleSlots();
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

  // Slice 6a: freshly played cards pop (scale + glow, then rest in the
  // .selected lift). Transform-only so hand layout never shifts; the class
  // is removed on animationend so replays retrigger cleanly.
  updateSelectedCardForMovement(instanceId) {
    // Pop only on a fresh selection (hand re-renders re-assert the same id
    // and must not replay the flourish every time).
    const fresh = instanceId != null && instanceId !== this._lastSelectedForMovement;
    this._lastSelectedForMovement = instanceId ?? null;
    for (const btn of this.handEl.querySelectorAll('.card-btn')) {
      const isSel = btn.dataset.instanceId === instanceId;
      btn.classList.toggle('selected', isSel);
      if (isSel && fresh && !btn.classList.contains('just-played')) {
        btn.classList.add('just-played');
        btn.addEventListener('animationend', () => btn.classList.remove('just-played'), { once: true });
      } else if (!isSel) {
        btn.classList.remove('just-played');
      }
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
    this._syncTransmitterChrome();

    const shopAvailable = document.createElement('div');
    shopAvailable.className = 'market-available-section';

    // In Transmitter combined view both sections are visible at once, so
    // label the market half explicitly — otherwise the reserve header is
    // the only signpost on screen.
    if (isTransmitter) {
      const shopHeader = document.createElement('div');
      shopHeader.className = 'market-section-header market-shop-header';
      shopHeader.textContent = 'Market — FREE pick';
      shopAvailable.appendChild(shopHeader);
    }

    const shopRow = document.createElement('div');
    shopRow.className = 'market-row';
    shopAvailable.appendChild(shopRow);
    
    for (const card of (market?.shop ?? [])) {
      shopRow.appendChild(this._makeMarketCardEl(card, false, isTransmitter));
    }
    
    this.shopEl.appendChild(shopAvailable);

    const reserveCards = (market?.reserve ?? []).filter(c => c && c.remaining > 0);
    if (reserveCards.length > 0) {
      const shopReserve = document.createElement('div');
      shopReserve.className = 'market-reserve-section';

      const reserveHeader = document.createElement('div');
      reserveHeader.className = 'market-section-header market-reserve-header';
      reserveHeader.textContent = isTransmitter
        ? 'Reserve — also FREE pick'
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
    this._syncTransmitterChrome();

    const shopAvailable = document.createElement('div');
    shopAvailable.className = 'market-available-section';

    if (isTransmitter) {
      const shopHeader = document.createElement('div');
      shopHeader.className = 'market-section-header market-shop-header';
      shopHeader.textContent = 'Market — FREE pick';
      shopAvailable.appendChild(shopHeader);
    }

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
        ? 'Reserve — also FREE pick'
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

  // Phone row thumbnail: the same PNG art hand rows show (desktop full
  // cards render it large). 40px fits the 44px row height; missing art
  // removes itself so rows never show a broken icon.
  _makeRowThumb(card) {
    const thumb = document.createElement('img');
    thumb.className = 'market-row-thumb';
    thumb.src = `/shared/images/${card.key}.png`;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.addEventListener('error', () => thumb.remove());
    return thumb;
  }

  _makeMarketRowEl(card, isReserve, transmitterActive = false) {    const locked = isReserve && !transmitterActive;
    const row = document.createElement('div');
    row.className = `market-row-item terrain-${card.movementTerrain || 'empty'}` + (isReserve ? ' is-reserve' : '');
    if (locked) row.classList.add('reserve-locked');
    // One-time-use hook for styling + discoverability (see _makeCardShared).
    if (card.oneTimeUse) row.classList.add('is-onetime');
    row.dataset.cardKey = card.key;

    const effectDesc = this._specialDescription(card.specialEffect);
    const lastCopy = !isReserve && card.remaining === 1;

    // Line 1 — identical structure for every card (normal + purple special):
    // name · [moves] · amount-left · cost · Buy. This keeps name/left/
    // cost/Buy in the same spots so special rows line up with normal rows.
    // Terrain reads from the row's left border (see market-phone-styles in
    // main.js) — the old leading dot duplicated it in the same colour.
    const main = document.createElement('div');
    main.className = 'market-row-main';
    row.appendChild(main);
    main.appendChild(this._makeRowThumb(card));

    const nameEl = document.createElement('span');
    nameEl.className = 'market-row-name';
    nameEl.textContent = card.cardName || card.key;
    main.appendChild(nameEl);

    // One-time-use pill — same signal as the full-card header pill, inline
    // on line 1 so single-use market/reserve rows read at a glance.
    if (card.oneTimeUse) {
      const onceEl = document.createElement('span');
      onceEl.className = 'market-onetime-pill';
      onceEl.title = 'Single use — removed from the game after you play it';
      onceEl.textContent = '1× USE';
      main.appendChild(onceEl);
    }

    // What you're buying: movement value. Number only — the terrain emoji
    // used to mirror the board watermark, which no longer exists (Option A);
    // the card's terrain colour (header bar / row border) carries the link now.
    if (card.movementTotal > 0) {
      const mvEl = document.createElement('span');
      mvEl.className = 'market-row-moves';
      mvEl.textContent = `${card.movementTotal}`;
      main.appendChild(mvEl);
    }

    const leftEl = document.createElement('span');
    leftEl.className = 'market-row-left';
    // Last-copy hint: buying this empties the slot and earns a reserve pick.
    leftEl.textContent = lastCopy
      ? `×1 left · → reserve pick`
      : `×${card.remaining} left`;
    main.appendChild(leftEl);

    const costEl = document.createElement('span');
    costEl.className = 'market-row-cost';
    costEl.textContent = transmitterActive ? 'FREE' : `💰 ${card.cost}`;
    main.appendChild(costEl);

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'market-row-buy';
    buy.textContent = transmitterActive ? 'Take' : 'Buy';
    buy.disabled = locked;
    if (!locked) {
      buy.addEventListener('click', () => this._onMarketCardClicked(card));
    }
    main.appendChild(buy);

    // Line 2 — only for purple specials: ℹ️ tucked right beside the short
    // effect text on the left, far from Buy on line 1, so a fat-finger tap
    // on details can't accidentally buy. The ℹ️ takes the slot the old
    // leading emoji used to occupy.
    if (effectDesc) {
      const sub = document.createElement('div');
      sub.className = 'market-row-sub';

      // ℹ️ opens the existing full-text modal (z-9999, above sheet + picker).
      // It must not trigger a purchase — Buy is a separate button.
      const info = document.createElement('span');
      info.className = 'card-info-btn market-row-info';
      info.dataset.effect = card.specialEffect;
      info.title = 'Details';
      info.setAttribute('role', 'button');
      info.setAttribute('aria-label', `${card.cardName} details`);
      info.textContent = 'ℹ️';
      sub.appendChild(info);

      const effEl = document.createElement('span');
      effEl.className = 'market-row-effect';
      effEl.textContent = effectDesc;
      sub.appendChild(effEl);

      row.appendChild(sub);
    }

    return row;
  }

  _makeCardShared(card, isMarket, isReserve, transmitterActive) {
    const btn = document.createElement('button');
    btn.className = `card-btn terrain-${card.movementTerrain || 'empty'}`;
    if (isReserve) btn.classList.add('market-reserve');
    btn.dataset.instanceId = card.instanceId;
    btn.dataset.cardKey = card.key;

    // Movement stat: number only (see market-row-moves note above).
    const movesLine = card.movementTotal > 0
      ? `<div class="card-stat-line">
           <span>${card.movementTotal}</span>
         </div>` : '';

    const effectDesc = this._specialDescription(card.specialEffect);
    const effectLine = effectDesc
      ? `<div class="card-effect-line">${effectDesc}</div>` : '';
    // Phone hand rows are single-line: the same one-liner lives inside the
    // header strip (right of the name) so the card doesn't grow taller.
    // Desktop keeps the block line below the header (hidden on phone).
    const effectInline = effectDesc
      ? `<span class="card-effect-inline">${effectDesc}</span>` : '';

    // One-time-use indicator — explicit text pill, not just an icon, so it
    // reads at a glance in the hand, the market, and the reserve picker
    // (all three render through this shared factory). The header pill is
    // the primary signpost: it lives in the header strip, which stays
    // visible in every layout (phone hand rows hide .card-body-area, so a
    // body-only badge would vanish there). The body badge keeps its
    // .card-onetime-line class for the tutorial anchor and gives the art
    // cards a second, larger signpost over the image.
    const ONETIME_TITLE = 'Single use — removed from the game after you play it';
    const oneTimePill = card.oneTimeUse
      ? `<span class="card-onetime-pill" title="${ONETIME_TITLE}">1×&nbsp;USE</span>` : '';
    const oneTimeLine = card.oneTimeUse
      ? `<div class="card-onetime-line" title="${ONETIME_TITLE}" role="img" aria-label="Single use — removed from the game after play">❌ SINGLE&nbsp;USE</div>` : '';

    if (card.oneTimeUse) btn.classList.add('is-onetime');

    const cardImage = `<img src="/shared/images/${card.key}.png" alt="" loading="lazy" onerror="this.style.display='none'">`;

    const fullDesc = this._specialFullDescription(card.specialEffect);

    const infoBtn  = fullDesc
      ? `<span class="card-info-btn" data-effect="${card.specialEffect}" title="Details">ℹ️</span>` : '';

    btn.innerHTML = `
      ${infoBtn}
      <div class="card-header-strip">
        <img class="card-thumb" src="/shared/images/${card.key}.png" alt="" loading="lazy" onerror="this.style.display='none'">
        <span class="card-name">${card.cardName}</span>
        ${effectInline}
        ${oneTimePill}
        ${movesLine}
      </div>
      ${effectLine}
      <div class="card-body-area">
        ${cardImage}
        ${oneTimeLine}
      </div>`;

    if (isMarket) {
      btn.classList.add('market-card');

      const wrapperElem = document.createElement('div');
      wrapperElem.className = 'market-card-wrapper';
      if (card.oneTimeUse) wrapperElem.classList.add('is-onetime');
      
      const costElem = document.createElement('div');
      costElem.className = 'cost-label' + (transmitterActive ? ' free' : '');
      costElem.textContent = transmitterActive ? 'FREE' : `💰 ${card.cost}`;

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
    if (this._purchaseLocked) {
      if (this.totalEl) {
        this.totalEl.style.color = '#e74c3c';
        setTimeout(() => { this.totalEl.style.color = ''; }, 600);
      }
      this.onPurchaseLocked?.();
      return;
    }
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
    // Locked: pooling is disabled so the pool stays empty and the normal
    // short total fits the header. The why lives in the banner row below
    // the header (never in #purchase-total — long header text pushes
    // ✕ Close off-screen on narrow phones).
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
    // 1-buy-per-turn lock overrides affordability — including FREE
    // Transmitter rows (NaN cost → always enabled below).
    if (this._purchaseLocked) {
      this.shopEl.querySelectorAll('.market-card-wrapper:not(.empty):not(.reserve-locked)').forEach(wrapper => {
        wrapper.classList.toggle('cant-afford', true);
        wrapper.classList.toggle('can-afford', false);
      });
      this.shopEl.querySelectorAll('.market-row-item:not(.reserve-locked)').forEach(row => {
        row.classList.toggle('cant-afford', true);
        row.classList.toggle('can-afford', false);
        const buyBtn = row.querySelector('.market-row-buy');
        if (buyBtn) buyBtn.disabled = true;
      });
      return;
    }
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
    this._syncTransmitterChrome();
    if (this._lastMarket) this.renderMarket(this._lastMarket);
    this._updatePurchaseTotal();
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  showMarket(visible) {
    if (visible) this.openMarket();
    else this.closeMarket();
  }

  // Rulebook p4: 1 buy per turn. Display gate only — the server flag is
  // authoritative (a stale lock still buys nothing; a missing lock just
  // surfaces the server's action_error toast).
  setPurchaseLocked(locked) {
    this._purchaseLocked = !!locked;
    if (this._purchaseLocked) this._purchasePool.clear();
    this.purchaseLockedBannerEl?.classList.toggle('hidden', !this._purchaseLocked);
    this._updateAffordability();
  }

  setControlsEnabled(enabled) {
    document.getElementById('end-turn-btn').disabled    = !enabled;
    document.getElementById('open-market-btn').disabled = !enabled;
    // Discard also needs your turn — and a selected card (synced separately
    // via setDiscardEnabled). Never leave it enabled on someone else's turn.
    if (!enabled) this.setDiscardEnabled(false);
  }

  setDiscardEnabled(enabled) {
    const btn = document.getElementById('discard-btn');
    if (btn) btn.disabled = !enabled;
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

  // Phone reserve-refill row: same two-line pattern as market rows — line 1
  // is name (+ moves) + Choose, line 2 groups ℹ️ + the effect one-liner
  // (full modal). Tapping ℹ️ must not choose — guarded like the desktop path.
  _makeReservePickRowEl(card, onChosen, overlay) {
    const row = document.createElement('div');
    row.className = `market-row-item reserve-pick-row terrain-${card.movementTerrain || 'empty'}`;
    if (card.oneTimeUse) row.classList.add('is-onetime');
    row.dataset.cardKey = card.key;

    const main = document.createElement('div');
    main.className = 'market-row-main';
    row.appendChild(main);
    main.appendChild(this._makeRowThumb(card));

    const nameEl = document.createElement('span');
    nameEl.className = 'market-row-name';
    nameEl.textContent = card.cardName || card.key;
    main.appendChild(nameEl);

    if (card.oneTimeUse) {
      const onceEl = document.createElement('span');
      onceEl.className = 'market-onetime-pill';
      onceEl.title = 'Single use — removed from the game after you play it';
      onceEl.textContent = '1× USE';
      main.appendChild(onceEl);
    }

    if (card.movementTotal > 0) {
      const mvEl = document.createElement('span');
      mvEl.className = 'market-row-moves';
      mvEl.textContent = `${card.movementTotal}`;
      main.appendChild(mvEl);
    }

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'market-row-buy';
    choose.textContent = 'Choose';
    choose.addEventListener('click', () => {
      onChosen(card.key);
      overlay.classList.add('hidden');
    });
    main.appendChild(choose);

    const effectDesc = this._specialDescription(card.specialEffect);
    if (effectDesc) {
      const sub = document.createElement('div');
      sub.className = 'market-row-sub';

      const info = document.createElement('span');
      info.className = 'card-info-btn market-row-info';
      info.dataset.effect = card.specialEffect;
      info.title = 'Details';
      info.setAttribute('role', 'button');
      info.setAttribute('aria-label', `${card.cardName} details`);
      info.textContent = 'ℹ️';
      sub.appendChild(info);

      const effEl = document.createElement('span');
      effEl.className = 'market-row-effect';
      effEl.textContent = effectDesc;
      sub.appendChild(effEl);

      row.appendChild(sub);
    }

    return row;
  }

  // ── Rubble payment mode ──────────────────────────────────────────────────

  enterRubblePaymentMode(count, excludeInstanceId, onConfirm, onCancel, destInfo = null) {
    this._rubbleNeeded    = count;
    this._rubbleExcludeId = excludeInstanceId ?? null;
    this._rubblePool      = new Map();
    this._rubbleOnConfirm = onConfirm;
    this._rubbleOnCancel  = onCancel;
    this._rubbleDestLabel = destInfo?.label ?? null;
    this._rubbleDestCost   = destInfo?.cost ?? null;

    const excludedCard = excludeInstanceId
      ? this._currentHand.find(c => c.instanceId === excludeInstanceId)
      : null;
    this._rubbleExcludeName = excludedCard?.cardName ?? excludedCard?.key ?? null;

    this._setMode('rubble');
    this._renderRubbleControls();
  }

  // Option A retarget: the player tapped a different valid destination while
  // the toll panel was open. Keep already-picked extras when they still fit
  // (drop the most recently picked first), then re-render the panel with the
  // new target header. Pool entries stay valid — they're still in hand.
  updateRubbleTarget(count, destInfo = null) {
    this._rubbleNeeded = count;
    this._rubbleDestLabel = destInfo?.label ?? null;
    this._rubbleDestCost   = destInfo?.cost ?? null;
    while (this._rubblePool.size > this._rubbleNeeded) {
      const ids = [...this._rubblePool.keys()];
      this._rubblePool.delete(ids[ids.length - 1]);
    }
    this._setMode('rubble');
    this._renderRubbleControls();
  }

  // Safety net: a programmatic market open (e.g. Transmitter) fired while the
  // toll was pending and main.js closed it again. Re-show the toll panel with
  // the preserved pool instead of dropping into movement mode.
  restoreRubbleMode() {
    if (this._rubbleNeeded <= 0) return;
    this._setMode('rubble');
    this._renderRubbleControls();
  }

  exitRubblePaymentMode() {
    this._rubblePool        = new Map();
    this._rubbleNeeded      = 0;
    this._rubbleExcludeId   = null;
    this._rubbleExcludeName = null;
    this._rubbleDestLabel  = null;
    this._rubbleDestCost    = null;
    document.getElementById('hand-messages').innerHTML = '';
    // The toll panel owns #hand-messages while open. Market taps are blocked
    // at the button (see _bindControls) and programmatic opens are bounced
    // back via restoreRubbleMode, so reaching here with the market open
    // means the move itself ended (confirm/dispose/cancel) — see below.
    const marketOpen = !this.marketEl.classList.contains('hidden');
    this._setMode(marketOpen ? 'market' : 'movement');
  }

  getRubblePaymentCards() {
    return [...this._rubblePool.keys()];
  }

  // Option A toll panel: names the target tile + total cost, shows the
  // locked mover plus one slot per extra card, and offers "Change
  // destination" (back to the destination list, picks kept where they fit)
  // instead of an ambiguous Cancel.
  _renderRubbleControls() {
    const messages = document.getElementById('hand-messages');
    messages.innerHTML = '';

    const cardWord = this._rubbleNeeded === 1 ? 'card' : 'cards';
    const destLine = (this._rubbleDestLabel != null && this._rubbleDestCost != null)
      ? `Crossing to ${this._rubbleDestLabel} — rubble ×${this._rubbleDestCost}, you stop here.`
      : `Cost ${this._rubbleNeeded + 1} rubble — you stop here.`;

    const prompt = document.createElement('div');
    prompt.className = 'rubble-prompt';

    const header = document.createElement('div');
    header.className = 'rubble-prompt-header';
    header.textContent = '🪨 Rubble toll';
    prompt.appendChild(header);

    const dest = document.createElement('div');
    dest.className = 'rubble-dest-line';
    dest.style.cssText = 'font-size:.8rem;color:#ffcf9e;font-weight:600;margin-top:.15rem;';
    dest.textContent = destLine;
    prompt.appendChild(dest);

    // Committed-card note: the mover pays entry, extras pay the remainder.
    const nameNote = document.createElement('div');
    nameNote.className = 'rubble-committed-note';
    nameNote.style.cssText = 'font-size:.8rem;color:#e8e0d0;margin-top:.15rem;';
    if (this._rubbleExcludeName) {
      const lock = document.createElement('span');
      lock.className = 'rubble-committed-card';
      lock.textContent = `🔒 ${this._rubbleExcludeName} pays 1 — pick ${this._rubbleNeeded} more ${cardWord}.`;
      nameNote.appendChild(lock);
    } else {
      nameNote.textContent = `Pick ${this._rubbleNeeded} ${cardWord} of any type to pay the toll.`;
    }
    prompt.appendChild(nameNote);

    // Slot row: one chip per needed card — filled chips name the pick, empty
    // chips show what is still owed. Re-rendered by _renderRubbleSlots().
    const slots = document.createElement('div');
    slots.id = 'rubble-slots';
    slots.style.cssText = 'display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.35rem;';
    prompt.appendChild(slots);

    const counter = document.createElement('span');
    counter.id = 'rubble-selection-count';
    counter.className = 'rubble-selection-count';
    prompt.appendChild(counter);

    messages.appendChild(prompt);

    const actions = document.createElement('div');
    actions.className = 'rubble-prompt-actions';

    const confirm = document.createElement('button');
    confirm.id = 'rubble-confirm-btn';
    confirm.disabled = true;
    confirm.style.cssText = 'background:#e74c3c;color:#fff;border:none;border-radius:4px;'
      + 'padding:.6rem 1rem;cursor:not-allowed;opacity:.4;font-size:.9rem;font-weight:600;'
      + 'min-height:44px;flex:1 1 auto;';
    confirm.textContent = 'Cross Rubble';
    confirm.onclick = () => this._rubbleOnConfirm?.();
    actions.appendChild(confirm);

    const cancel = document.createElement('button');
    cancel.id = 'rubble-cancel-btn';
    cancel.style.cssText = 'background:#555;color:#fff;border:none;border-radius:4px;'
      + 'padding:.6rem .9rem;cursor:pointer;font-size:.9rem;min-height:44px;';
    cancel.textContent = '← Change destination';
    cancel.title = 'Back to the destination list — your mover stays played.';
    cancel.setAttribute('aria-label', 'Back to the destination list, mover stays played');
    cancel.onclick = () => this._rubbleOnCancel?.();
    actions.appendChild(cancel);

    messages.appendChild(actions);

    this._renderRubbleSlots();
    this._syncRubbleConfirmButton();
  }

  // Slot chips mirror the pool: filled chips name picked cards (tap the hand
  // card again to un-pick), empty chips show the remaining count.
  _renderRubbleSlots() {
    const slots = document.getElementById('rubble-slots');
    if (!slots) return;
    slots.innerHTML = '';
    const picked = [...this._rubblePool.values()];
    for (const card of picked) {
      const chip = document.createElement('span');
      chip.style.cssText = 'font-size:.75rem;font-weight:700;color:#06240f;'
        + 'background:#4cff4c;border-radius:20px;padding:.2rem .6rem;';
      chip.textContent = `✓ ${card.cardName || card.key}`;
      slots.appendChild(chip);
    }
    for (let i = picked.length; i < this._rubbleNeeded; i++) {
      const empty = document.createElement('span');
      empty.style.cssText = 'font-size:.75rem;color:#9aabbf;'
        + 'border:1px dashed rgba(154,171,191,.6);border-radius:20px;padding:.2rem .6rem;';
      empty.textContent = '+ any card';
      slots.appendChild(empty);
    }
  }

  disableMarketButton() {
    document.getElementById('open-market-btn').disabled = true;
  }
}