// server/game/Player.js — mirrors Player.gd + multiplayer_service deck management

const { buildStarterDeck } = require('../../shared/cardData');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Player {
  constructor({ id, playerNumber, socketId, name }) {
    this.id            = id;
    this.playerNumber  = playerNumber;
    this.socketId      = socketId;
    this.name          = name || `Player ${playerNumber}`;
    this.currentTileId = null;
    this.deck          = [];
    this.hand          = [];
    this.discardPile   = [];
    this.removedCards  = [];
  }

  // Mirrors multiplayer_service.initialize_game() per-player setup
  init(startTileId) {
    this.currentTileId = startTileId;
    this.deck          = shuffle(buildStarterDeck());
    this.hand          = [];
    this.discardPile   = [];
    this.drawCards(4);
  }

  // Mirrors _draw_cards_for_player()
  drawCards(count) {
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) {
        if (this.discardPile.length === 0) break;
        this.deck = shuffle([...this.discardPile]);
        this.discardPile = [];
      }
      this.hand.push(this.deck.shift()); // pop_front like GDScript
    }
  }

  // Mirrors _move_card_to_discard_pile_or_remove()
  playCard(instanceId, forceTrash = false) {
    const idx = this.hand.findIndex(c => c.instanceId === instanceId);
    if (idx === -1) return null;
    const [card] = this.hand.splice(idx, 1);
    if (forceTrash) {
      this.removedCards.push(card); // gone permanently
    } else {
      this.discardPile.push(card);
    }
    return card;
  }

  // Remove a card permanently from hand (Scientist / Travel Log)
  removeCardPermanently(instanceId) {
    const idx = this.hand.findIndex(c => c.instanceId === instanceId);
    if (idx === -1) return null;
    const [card] = this.hand.splice(idx, 1);
    this.removedCards.push(card);
    return card;
  }

  getHandCard(instanceId) {
    return this.hand.find(c => c.instanceId === instanceId) || null;
  }

  // End of turn: draw up to 4 (mirrors player_ended_turn: draw 4 - hand.size())
  drawUpToFour() {
    const needed = 4 - this.hand.length;
    if (needed > 0) this.drawCards(needed);
  }

  toPublicData() {
    return {
      id: this.id, playerNumber: this.playerNumber, name: this.name,
      currentTileId: this.currentTileId,
      handSize: this.hand.length, deckSize: this.deck.length, discardSize: this.discardPile.length,
    };
  }

  toPrivateData() {
    return { ...this.toPublicData(), hand: this.hand };
  }
}

module.exports = { Player };
