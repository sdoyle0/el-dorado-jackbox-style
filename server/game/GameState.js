const { GameState: GS, CardEffect, TerrainType, TRANSMITTER_PURCHASE_POWER } = require('../../shared/constants');
const { edgeKey, buildEdgeLookup } = require('../../shared/blockadeData');

class GameStateManager {
  constructor(board) {
    this.board = board;
    this.state = GS.AWAITING_CARD;
    this.players = [];
    this.currentPlayerIndex = 0;
    this.playedCardData = null;
    this.wildCardTerrain = null;
    this.movesRemaining = 0;
    this.validMoves = [];
    this.breakableBlockades = []; // blockade IDs the current card can break from current position
    this.selectingCardsToRemove = 0;
    this.selectingCardsForRubble = 0;
    this.transmitterActive = false;
    this.pendingReserveSlot = null;
    // ── Final-round tracking ──────────────────────────────────────────────────
    this.finalRoundTriggered = false;
    this.finalRoundTriggerPlayerIndex = -1;
    this.firstWinnerId = null;
    // Ordered list of every player that reached a finishing tile. The
    // rulebook (p5) tiebreak — most blockade tokens wins when several
    // players finish in the final round — is decided from this list at
    // game-over time (see _determineWinner), not from firstWinnerId alone.
    this.finishers = [];
    // ── Blockades ─────────────────────────────────────────────────────────────
    this.activeBlockades = null; // null = disabled
    this.onEvent = null;
  }

  emit(event, data) {
    if (this.onEvent) this.onEvent(event, data);
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  _rebuildBlockadeLookup() {
    // No longer needed as a lookup — we use activeBlockades array directly.
    // Kept as a no-op so GameManager._startGame() call still works.
  }

  // ── Play a card from hand ──────────────────────────────────────────────────
  playCard(playerId, instanceId, isDiscardingFromHand) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    const player = this.currentPlayer;

    if (this.selectingCardsToRemove > 0) {
      const target = player.hand.find(c => c.instanceId === instanceId || c.key === instanceId);
      if (!target) return { ok: false, error: 'card not in hand' };
      // The played Scientist / Travel Log itself sits on the table, not in
      // hand — it can't be chosen as one of its own removals. (Scientist
      // discards itself; Travel Log trashes itself via dispose. Counting it
      // as a target would trash/discard the wrong pile and shortchange the
      // "up to N others" count.)
      if (this.playedCardData && target.instanceId === this.playedCardData.instanceId) {
        return { ok: false, error: 'cannot remove the played card itself' };
      }
      this.selectingCardsToRemove--;
      player.removeCardPermanently(target.instanceId);
      this.emit('hand_updated', { playerId, hand: player.hand });
      if (this.selectingCardsToRemove === 0 && this.playedCardData) {
        this._disposeFinishedCard(player);
      }
      return { ok: true };
    }

    if (this.selectingCardsForRubble > 0) {
      this.selectingCardsForRubble--;
      player.playCard(instanceId);
      this.emit('hand_updated', { playerId, hand: player.hand });
      return { ok: true };
    }

    if (this.state === GS.AWAITING_MOVE) {
      const hadPartialMove = this.playedCardData &&
        this.movesRemaining < this.playedCardData.movementTotal;
      if (hadPartialMove) {
        this._discardPartialCard(player);
      } else {
        this._returnCardToHand();
      }
    }

    if (this.state !== GS.AWAITING_CARD) return { ok: false, error: 'wrong state' };

    const card = player.hand.find(c => c.instanceId === instanceId || c.key === instanceId);
    if (!card) return { ok: false, error: 'card not in hand' };

    this.playedCardData = card;
    this.movesRemaining = card.movementTotal;
    this.state = GS.AWAITING_MOVE;

    if (isDiscardingFromHand) {
      this._disposeFinishedCard(player, false);
      return { ok: true };
    }

    this._handleSpecialCardPlayed(player, card);

    if (this.state === GS.AWAITING_CARD) return { ok: true };

    this._recalculateValidMoves();

    if (this.movesRemaining === 0 && this.selectingCardsToRemove === 0) {
      this._disposeFinishedCard(player);
      return { ok: true };
    }

    return { ok: true };
  }

  // ── Finish a Scientist / Travel Log removal early ("up to N") ──────────
  // Rulebook: Scientist = "up to 1", Travel Log = "up to 2" — the player may
  // remove fewer (including zero) and keep the rest. The client banner's
  // Done button emits `finish_remove`; this clears the pending count and
  // disposes the played card so the turn can continue.
  finishCardRemoval(playerId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.selectingCardsToRemove <= 0) return { ok: false, error: 'nothing to finish' };
    this.selectingCardsToRemove = 0;
    const player = this.currentPlayer;
    if (this.playedCardData) {
      this._disposeFinishedCard(player);
    } else {
      this.state = GS.AWAITING_CARD;
      this.movesRemaining = 0;
      this.validMoves = [];
      this.breakableBlockades = [];
    }
    return { ok: true };
  }

  // ── Break a blockade (player pays toll, stays on current tile) ────────────
  breakBlockade(playerId, blockadeId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE) return { ok: false, error: 'wrong state' };
    if (!this.playedCardData) return { ok: false, error: 'no card played' };

    // Must be in the breakable list (adjacency + terrain already validated there)
    if (!this.breakableBlockades.includes(blockadeId)) {
      return { ok: false, error: 'cannot break that blockade' };
    }

    const blockade = (this.activeBlockades || []).find(b => b.id === blockadeId);
    if (!blockade) return { ok: false, error: 'blockade not found' };

    const player = this.currentPlayer;

    // Wild card: lock its terrain to the blockade terrain (same as moving onto that terrain)
    if (this.playedCardData.movementTerrain === TerrainType.WILD && !this.wildCardTerrain) {
      this.wildCardTerrain = blockade.terrainType;
    }

    // Spend 1 movement
    this.movesRemaining -= 1;

    // Remove the blockade
    this.activeBlockades = this.activeBlockades.filter(b => b.id !== blockadeId);

    // Award token
    if (!player.blockadeTokens) player.blockadeTokens = [];
    player.blockadeTokens.push(blockadeId);

    this.emit('blockade_broken', {
      blockadeId,
      brokenByPlayerId: player.id,
      brokenByName: player.name,
      terrainType: blockade.terrainType,
      remainingBlockades: this.activeBlockades.map(b => b.id),
    });

    this.emit('log', {
      message: `${player.name} broke the ${blockade.label} blockade (${blockade.terrainType})!`,
      type: 'blockade',
    });

    // Recalculate — seam is now open, new moves available, new breakable blockades
    if (this.movesRemaining > 0) {
      this._recalculateValidMoves();
    } else {
      this._disposeFinishedCard(player);
    }

    return { ok: true };
  }

  // ── Move pawn to a tile ────────────────────────────────────────────────────
  movePawn(playerId, tileId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE) return { ok: false, error: 'wrong state' };
    if (!this.validMoves.includes(tileId)) return { ok: false, error: 'invalid move' };

    const player = this.currentPlayer;
    const tile = this.board.getTile(tileId);

    player.currentTileId = tileId;
    this.emit('pawn_moved', { playerId, tileId });

    // ── Finishing spaces ───────────────────────────────────────────────────
    if (tile.isFinishing) {
      this._recordFinisher(playerId);
      this._relocateFinisher(player);

      const isLastPlayerOfRound = this.currentPlayerIndex === this.players.length - 1;

      if (!this.finalRoundTriggered) {
        this.finalRoundTriggered = true;
        this.finalRoundTriggerPlayerIndex = this.currentPlayerIndex;

        if (isLastPlayerOfRound) {
          this.state = GS.GAME_OVER;
          this._disposeFinishedCard(player);
          this.emit('game_won', this._gameWonPayload());
          return { ok: true };
        }

        this.emit('final_round_started', {
          triggeredByPlayerId: playerId,
          winnerId: this.firstWinnerId,
        });
      }

      this._disposeFinishedCard(player);
      this.endTurn(playerId);
      return { ok: true };
    }

    const terrain = tile.terrainType;
    const cost = tile.movementCost;

    if (terrain === TerrainType.RUBBLE) {
      this.movesRemaining = 0;
      if (cost > 1) this.selectingCardsForRubble = cost - 1;
    } else if (terrain === TerrainType.CAMP) {
      this.movesRemaining = 0;
      this.playedCardData.oneTimeUse = true;
    } else {
      if (this.playedCardData.movementTerrain === TerrainType.WILD && !this.wildCardTerrain) {
        this.wildCardTerrain = terrain;
      }
      this.movesRemaining -= cost;
    }

    if (this.movesRemaining > 0) {
      this._recalculateValidMoves();
      return { ok: true };
    }

    this._disposeFinishedCard(player);
    return { ok: true };
  }

  movePawnToRubble(playerId, tileId, extraCardIds = []) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE) return { ok: false, error: 'wrong state' };
    if (!this.validMoves.includes(tileId)) return { ok: false, error: 'invalid move' };

    const player = this.currentPlayer;
    const tile = this.board.getTile(tileId);
    const needed = tile.movementCost - 1;

    const extraCards = extraCardIds
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (extraCards.length !== needed) {
      return { ok: false, error: `rubble requires ${needed} extra card(s), got ${extraCards.length}` };
    }

    for (const card of extraCards) player.playCard(card.instanceId);

    player.currentTileId = tileId;
    this.emit('pawn_moved', { playerId, tileId });

    // A rubble-cost finishing tile (no such tile on the current map, but
    // future maps may have one) follows the same final-round flow as a
    // normal finishing arrival — record the finisher instead of ending
    // the game outright so blockade tiebreaks still apply.
    if (tile.isFinishing) {
      this._recordFinisher(playerId);
      this._relocateFinisher(player);

      const isLastPlayerOfRound = this.currentPlayerIndex === this.players.length - 1;

      if (!this.finalRoundTriggered) {
        this.finalRoundTriggered = true;
        this.finalRoundTriggerPlayerIndex = this.currentPlayerIndex;

        if (isLastPlayerOfRound) {
          this.state = GS.GAME_OVER;
          this._disposeFinishedCard(player);
          this.emit('game_won', this._gameWonPayload());
          return { ok: true };
        }

        this.emit('final_round_started', {
          triggeredByPlayerId: playerId,
          winnerId: this.firstWinnerId,
        });
      }

      this._disposeFinishedCard(player);
      this.endTurn(playerId);
      return { ok: true };
    }

    if (tile.terrainType === TerrainType.EL_DORADO) {
      this._recordFinisher(playerId);
      this.state = GS.GAME_OVER;
      this.emit('game_won', this._gameWonPayload());
      return { ok: true };
    }

    this._disposeFinishedCard(player);
    return { ok: true };
  }

  // ── End turn ──────────────────────────────────────────────────────────────
  endTurn(playerId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    if (this.pendingReserveSlot) {
      return { ok: false, error: 'choose a reserve card for the empty market slot first' };
    }

    const player = this.currentPlayer;

    // Ending the turn with a Scientist / Travel Log removal pending treats
    // it as "remove none more" (rulebook: "up to N"). Without this the
    // pending count would leak into the next player's turn.
    if (this.selectingCardsToRemove > 0) {
      this.selectingCardsToRemove = 0;
    }

    if (this.state === GS.AWAITING_MOVE && this.playedCardData) {
      player.playCard(this.playedCardData.instanceId, this.playedCardData.oneTimeUse);
      this.playedCardData = null;
      this.movesRemaining = 0;
      this.wildCardTerrain = null;
      this.validMoves = [];
      this.breakableBlockades = [];
    }

    player.drawUpToFour();

    this.state = GS.AWAITING_CARD;
    this.playedCardData = null;
    this.movesRemaining = 0;
    this.wildCardTerrain = null;
    this.validMoves = [];
    this.breakableBlockades = [];
    this.transmitterActive = false;

    if (this.finalRoundTriggered && this.currentPlayerIndex === this.players.length - 1) {
      this.state = GS.GAME_OVER;
      this.emit('hand_updated', { playerId: player.id, hand: player.hand });
      this.emit('game_won', this._gameWonPayload());
      return { ok: true };
    }

    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    const next = this.currentPlayer;

    this.emit('hand_updated', { playerId: player.id, hand: player.hand });
    this.emit('turn_ended', { nextPlayerId: next.id, nextPlayerName: next.name });
    return { ok: true };
  }

  // ── Purchase a card from the market ───────────────────────────────────────
  purchaseCard(playerId, cardKey, handCardsUsed = [], cardMarket) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    const player = this.currentPlayer;

    if (new Set(handCardsUsed).size !== handCardsUsed.length) {
      return { ok: false, error: 'invalid hand cards' };
    }

    const spentCards = handCardsUsed
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (spentCards.length !== handCardsUsed.length) {
      return { ok: false, error: 'invalid hand cards' };
    }

    let power = spentCards.reduce((sum, c) => sum + (c.purchasingPower ?? 0), 0);
    if (this.transmitterActive) power += TRANSMITTER_PURCHASE_POWER;

    let card = cardMarket.getCard(cardKey, false);
    let fromReserve = false;
    if (!card && this.transmitterActive) {
      card = cardMarket.getCard(cardKey, true);
      fromReserve = true;
    }
    if (!card) return { ok: false, error: 'card not in market' };
    if (power < card.cost) return { ok: false, error: `need ${card.cost} power, have ${power}` };

    for (const c of spentCards) player.playCard(c.instanceId);

    const purchased = cardMarket.buyCard(cardKey, fromReserve);
    if (!purchased) return { ok: false, error: 'card sold out' };
    player.discardPile.push(purchased);

    this.transmitterActive = false;

    if (!fromReserve && cardMarket.shopCardSoldOut(cardKey)) {
      const available = cardMarket.getAvailableReserve();
      if (available.length > 0) {
        this.pendingReserveSlot = cardKey;
        this.emit('prompt_reserve_choice', {
          playerId,
          soldOutKey: cardKey,
          reserveCards: available,
        });
      }
    }

    this.emit('card_purchased', { playerId, cardKey });
    this.emit('hand_updated', { playerId, hand: player.hand });
    this.emit('market_updated', { market: cardMarket.getShopState() });
    this.emit('purchase_closed', { playerId });
    return { ok: true };
  }

  chooseReserveCard(playerId, soldOutKey, chosenKey, cardMarket) {
    if (!this._isCurrentPlayer(playerId)) {
      return { ok: false, error: 'not your turn' };
    }
    if (this.pendingReserveSlot !== soldOutKey) {
      return { ok: false, error: 'no pending reserve choice for that slot' };
    }
    const result = cardMarket.replenishShop(soldOutKey, chosenKey);
    if (!result) {
      return { ok: false, error: 'invalid reserve card selection' };
    }
    this.pendingReserveSlot = null;
    // Audible to the whole room: otherwise only the buyer knows the market changed.
    this.emit('reserve_replenished', { playerId, soldOutKey, chosenKey });
    this.emit('market_updated', { market: cardMarket.getShopState() });
    return { ok: true };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _recalculateValidMoves() {
    const player = this.currentPlayer;
    this.validMoves = this.board.getValidMoves({
      currentTileId: player.currentTileId,
      playedCard: this.playedCardData,
      movesRemaining: this.movesRemaining,
      wildCardTerrain: this.wildCardTerrain,
      players: this.players,
      handSize: player.hand.length,
      activeBlockades: this.activeBlockades || [],
    });

    // Also compute which blockades are breakable from here with this card
    this.breakableBlockades = this.board.getBreakableBlockades({
      currentTileId: player.currentTileId,
      playedCard: this.playedCardData,
      movesRemaining: this.movesRemaining,
      wildCardTerrain: this.wildCardTerrain,
      activeBlockades: this.activeBlockades || [],
    });

    // Emit breakable blockades alongside valid moves so client can highlight them.
    // movesRemaining/movementTotal let the client label "Done moving" vs
    // "Cancel" once part of a multi-move card is spent.
    this.emit('valid_moves_updated', {
      validMoves: this.validMoves,
      breakableBlockades: this.breakableBlockades,
      movesRemaining: this.movesRemaining,
      movementTotal: this.playedCardData ? this.playedCardData.movementTotal : 0,
    });
  }

  _blockadeCounts() {
    const counts = {};
    for (const p of this.players) {
      counts[p.id] = (p.blockadeTokens || []).length;
    }
    return counts;
  }

  _recordFinisher(playerId) {
    if (!this.finishers.includes(playerId)) this.finishers.push(playerId);
    if (!this.firstWinnerId) this.firstWinnerId = playerId;
  }

  // Rulebook p5: "If the final round ends up with multiple players reaching
  // El Dorado, the player who has collected the most blockades wins."
  // Single finisher → that player. Multiple → most blockade tokens. The
  // book's second tiebreak (highest-power single blockade) can't apply
  // here: every digital blockade costs 1 move, so equal counts stay tied
  // and the first finisher among the tied players holds the win.
  _determineWinner() {
    if (this.finishers.length === 0) return this.firstWinnerId;
    if (this.finishers.length === 1) return this.finishers[0];
    const counts = this._blockadeCounts();
    let best = this.finishers[0];
    let bestCount = counts[best] ?? 0;
    for (let i = 1; i < this.finishers.length; i++) {
      const id = this.finishers[i];
      const c = counts[id] ?? 0;
      if (c > bestCount) {
        best = id;
        bestCount = c;
      }
    }
    return best;
  }

  _gameWonPayload() {
    return {
      playerId: this._determineWinner(),
      blockadeCounts: this._blockadeCounts(),
      finishers: [...this.finishers],
      firstFinisherId: this.firstWinnerId,
    };
  }

  _handleSpecialCardPlayed(player, card) {
    switch (card.specialEffect) {
      case CardEffect.TRANSMITTER:
        player.playCard(card.instanceId, true);
        this.transmitterActive = true;
        this.state = GS.AWAITING_CARD;
        this.playedCardData = null;
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
        this.emit('purchase_opened', { totalPurchasePower: TRANSMITTER_PURCHASE_POWER });
        break;
      case CardEffect.CARTOGRAPHER:
        player.drawCards(2);
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
        break;
      case CardEffect.COMPASS:
        player.drawCards(3);
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
        break;
      case CardEffect.SCIENTIST:
        player.drawCards(1);
        this.selectingCardsToRemove = 1;
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards', { playerId: player.id, count: 1, playedInstanceId: card.instanceId });
        break;
      case CardEffect.TRAVEL_LOG:
        player.drawCards(2);
        this.selectingCardsToRemove = 2;
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards', { playerId: player.id, count: 2, playedInstanceId: card.instanceId });
        break;
      default:
        break;
    }
  }

  _disposeFinishedCard(player, functionWasUsed = true) {
    player.playCard(this.playedCardData.instanceId, functionWasUsed && this.playedCardData.oneTimeUse);
    this.state = GS.AWAITING_CARD;
    this.wildCardTerrain = null;
    this.playedCardData = null;
    this.movesRemaining = 0;
    this.validMoves = [];
    this.breakableBlockades = [];
    this.emit('card_disposed', { playerId: player.id });
    this.emit('hand_updated', { playerId: player.id, hand: player.hand });
  }

  _discardPartialCard(player) {
    player.playCard(this.playedCardData.instanceId, this.playedCardData.oneTimeUse);
    this.state = GS.AWAITING_CARD;
    this.wildCardTerrain = null;
    this.playedCardData = null;
    this.movesRemaining = 0;
    this.validMoves = [];
    this.breakableBlockades = [];
    this.emit('hand_updated', { playerId: player.id, hand: player.hand });
  }

  cancelCard(playerId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE) return { ok: false, error: 'nothing to cancel' };
    // Removal mode has its own Done button (finish_remove) — Cancel must not
    // return the Scientist / Travel Log to hand mid-removal. Re-emit the
    // prompt so a client that already cleared its banner optimistically
    // resyncs instead of desyncing into silent removals.
    if (this.selectingCardsToRemove > 0) {
      this.emit('prompt_remove_cards', {
        playerId,
        count: this.selectingCardsToRemove,
        playedInstanceId: this.playedCardData ? this.playedCardData.instanceId : null,
      });
      return { ok: false, error: 'finish or skip card removal first' };
    }

    const player = this.currentPlayer;
    const hadPartialMove = this.playedCardData &&
      this.movesRemaining < this.playedCardData.movementTotal;

    if (hadPartialMove) {
      this._discardPartialCard(player);
      this.emit('card_disposed', { playerId: player.id });
    } else {
      this._returnCardToHand();
      this.emit('hand_updated', { playerId: player.id, hand: player.hand });
    }
    return { ok: true };
  }

  _returnCardToHand() {
    this.playedCardData = null;
    this.state = GS.AWAITING_CARD;
    this.wildCardTerrain = null;
    this.movesRemaining = 0;
    this.validMoves = [];
    this.breakableBlockades = [];
  }

  _isCurrentPlayer(playerId) {
    return this.currentPlayer && this.currentPlayer.id === playerId;
  }

  _relocateFinisher(player) {
    const elDoradoTiles = [...this.board.tiles.values()]
      .filter(t => t.terrainType === TerrainType.EL_DORADO);
    const occupiedIds = new Set(this.players.map(p => p.currentTileId));
    const podium = elDoradoTiles.find(t => !occupiedIds.has(t.id));
    if (!podium) return;
    player.currentTileId = podium.id;
    this.emit('pawn_moved', { playerId: player.id, tileId: podium.id });
  }
}

module.exports = { GameStateManager };