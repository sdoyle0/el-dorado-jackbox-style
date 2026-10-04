// server/game/CardMarket.js
// Mirrors multiplayer_service shop/reserve card logic.
//
// GDScript structure: shopCards = { CARD_KEY: count }
// Our structure: shop/reserve are arrays of card objects with a `remaining` count.

const { buildShopState } = require('../../shared/cardData');

class CardMarket {
  constructor() {
    this.shop    = []; // 6 face-up card types, each with a `remaining` count
    this.reserve = []; // reserve pile, same structure
  }

  init() {
    const state    = buildShopState();
    this.shop    = state.shop;
    this.reserve = state.reserve;
  }

  getShopState() {
    return { shop: this.shop, reserve: this.reserve };
  }

  getCard(cardKey, fromReserve = false) {
    const arr = fromReserve ? this.reserve : this.shop;
    return arr.find(c => c.key === cardKey) || null;
  }

  // Mirrors _move_card_from_store_to_player_discard()
  // Returns the card definition if purchase is valid, null otherwise.
  buyCard(cardKey, fromReserve = false) {
    const arr  = fromReserve ? this.reserve : this.shop;
    const slot = arr.find(c => c.key === cardKey);
    if (!slot || slot.remaining <= 0) return null;
    slot.remaining--;
    // Returns a fresh card instance for the player's discard pile
    return { ...slot, remaining: undefined, instanceId: `${cardKey}-bought-${Date.now()}` };
  }

  // Returns all reserve entries that still have stock — sent to the client
  // so the buyer can pick one to fill the empty shop slot.
  getAvailableReserve() {
    return this.reserve.filter(c => c.remaining > 0);
  }

  // Called once the buyer has chosen which reserve card fills the empty slot.
  // soldOutKey — the shop slot to replace (by key)
  // chosenKey  — the reserve card the player selected
  // Returns the chosen card's key on success, null on bad input.
  replenishShop(soldOutKey, chosenKey) {
    const slotIdx = this.shop.findIndex(c => c.key === soldOutKey);
    if (slotIdx === -1) return null;

    const reserveIdx = this.reserve.findIndex(c => c.key === chosenKey && c.remaining > 0);
    if (reserveIdx === -1) return null;

    const reserveCard = this.reserve[reserveIdx];
    // Replace the sold-out slot in-place (preserves column order in the UI)
    this.shop[slotIdx] = { ...reserveCard };
    // Remove that entry from the reserve list
    this.reserve.splice(reserveIdx, 1);
    return reserveCard.key;
  }

  // Mirrors notify_server_user_placed_reserve_card_to_shop()
  moveReserveToShop(cardKey) {
    const rSlot = this.reserve.find(c => c.key === cardKey);
    if (!rSlot || rSlot.remaining <= 0) return false;
    const sSlot = this.shop.find(c => c.key === cardKey);
    if (sSlot) {
      sSlot.remaining += rSlot.remaining;
    } else {
      this.shop.push({ ...rSlot });
    }
    this.reserve = this.reserve.filter(c => c.key !== cardKey);
    return true;
  }

  shopCardSoldOut(cardKey) {
    const slot = this.shop.find(c => c.key === cardKey);
    return slot ? slot.remaining === 0 : false;
  }
}

module.exports = { CardMarket };
