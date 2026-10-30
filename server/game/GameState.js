const { GameState: GS, CardEffect, TerrainType, TRANSMITTER_PURCHASE_POWER } = require('../../shared/constants');
const { edgeKey, buildEdgeLookup } = require('../../shared/blockadeData');

class GameStateManager {
  constructor(board) {
    this.board = board;
    this.state = GS.AWAITING_CARD;
    this.players = [];
    this.currentPlayerIndex = 0;
    this.twoPlayerMode = false;
    this.activePieceIndex = 0;
    this.playedCardData = null;
    this.wildCardTerrain = null;
    this.movesRemaining = 0;
    this.validMoves = [];
    this.breakableBlockades = []; // blockade IDs the current card can break from current position
    this.selectingCardsToRemove = 0;
    this.transmitterActive = false;
    this.pendingReserveSlot = null;
    // Rulebook p4: "You can buy up to 1 card per turn." Enforced
    // server-side; cleared on every endTurn. Transmitter free takes are
    // NOT purchases, so they neither check nor set this flag.
    this.purchasedThisTurn = false;
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
    this.activePieceIndex = this.twoPlayerMode ? player.activePieceIndex : 0;

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

  selectPiece(playerId, pieceIndex) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (!this.twoPlayerMode) return { ok: false, error: 'piece selection is only available in two-player games' };
    const cardHasStartedMoving = this.state === GS.AWAITING_MOVE
      && this.playedCardData
      && this.movesRemaining < this.playedCardData.movementTotal;
    if ((this.state !== GS.AWAITING_CARD && this.state !== GS.AWAITING_MOVE)
      || cardHasStartedMoving
      || this.selectingCardsToRemove > 0) {
      return { ok: false, error: 'finish the current card before switching pieces' };
    }
    const player = this.currentPlayer;
    if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex >= player.pieceTileIds.length) {
      return { ok: false, error: 'invalid piece' };
    }
    if (player.finishedPieceIndices[pieceIndex]) {
      return { ok: false, error: 'that piece has already reached El Dorado' };
    }

    player.activePieceIndex = pieceIndex;
    this.activePieceIndex = pieceIndex;
    this.emit('piece_selected', { playerId, pieceIndex });
    if (this.state === GS.AWAITING_MOVE) this._recalculateValidMoves();
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
    const isRubble = blockade.terrainType === TerrainType.RUBBLE;

    // Rubble blockades mirror rubble tiles: only a fresh card pays, and the
    // card is spent (no onward movement). Defense-in-depth alongside the
    // HexBoard fresh check — breakableBlockades is server-computed, but a
    // crafted break event must not slip past a stale list.
    if (isRubble && this.movesRemaining !== this.playedCardData.movementTotal) {
      return { ok: false, error: 'rubble blockade requires a fresh card' };
    }

    // Wild card: lock its terrain to the blockade terrain (same as moving onto that terrain).
    // Rubble accepts any card identity (like rubble tiles), so no locking there.
    if (!isRubble && this.playedCardData.movementTerrain === TerrainType.WILD && !this.wildCardTerrain) {
      this.wildCardTerrain = blockade.terrainType;
    }

    // Spend the card: rubble ends movement (like rubble tiles), others cost 1
    if (isRubble) {
      this.movesRemaining = 0;
    } else {
      this.movesRemaining -= 1;
    }

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

    // Cost-2+ rubble must go through the toll flow (move_to_rubble with extra
    // cards) so the full price is paid up front. Plain move_pawn would grant
    // entry for 1 card. Cost-1 rubble continues below and ends movement.
    if (tile && tile.terrainType === TerrainType.RUBBLE && tile.movementCost > 1) {
      return { ok: false, error: 'rubble toll: use extra cards to cross' };
    }

    // Rulebook p3 + p6: camp entry trashes N hand cards (N = symbols);
    // the mover is spent like normal and the turn continues with new
    // cards. Only Native (ignores requirements) may enter via plain
    // move_pawn; everything else goes through move_to_camp.
    if (tile && tile.terrainType === TerrainType.CAMP) {
      const isNative = this.playedCardData
        && this.playedCardData.specialEffect === CardEffect.NATIVE;
      if (!isNative) {
        return { ok: false, error: 'camp: choose cards to trash' };
      }
    }

    this._setPiecePosition(player, this.activePieceIndex, tileId);
    this.emit('pawn_moved', { playerId, tileId, pieceIndex: this.activePieceIndex });

    // ── Finishing spaces ───────────────────────────────────────────────────
    if (this.twoPlayerMode && (tile.isFinishing || tile.terrainType === TerrainType.EL_DORADO)) {
      return this._handleTwoPieceFinishing(playerId, player, this.activePieceIndex);
    }
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
      // Cost-2+ rubble is rejected above; cost-1 ends movement (like blockades).
      this.movesRemaining = 0;
    } else if (terrain === TerrainType.CAMP) {
      // Only reachable by Native bypass (see above) — it ignores the trash
      // requirement, spends 1 move like a normal step, and continues.
      this.movesRemaining -= cost;
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

    // Extras must be exactly `needed` distinct cards from hand, none of
    // which is the in-flight movement card (it already pays the entry).
    if (extraCardIds.length !== needed) {
      return { ok: false, error: `rubble requires ${needed} extra card(s), got ${extraCardIds.length}` };
    }
    if (new Set(extraCardIds).size !== extraCardIds.length) {
      return { ok: false, error: 'invalid hand cards' };
    }
    if (this.playedCardData && extraCardIds.includes(this.playedCardData.instanceId)) {
      return { ok: false, error: 'invalid hand cards' };
    }

    const extraCards = extraCardIds
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (extraCards.length !== needed) {
      return { ok: false, error: `rubble requires ${needed} extra card(s), got ${extraCards.length}` };
    }

    for (const card of extraCards) player.playCard(card.instanceId);

    this._setPiecePosition(player, this.activePieceIndex, tileId);
    this.emit('pawn_moved', { playerId, tileId, pieceIndex: this.activePieceIndex });

    // A rubble-cost finishing tile (no such tile on the current map, but
    // future maps may have one) follows the same final-round flow as a
    // normal finishing arrival — record the finisher instead of ending
    // the game outright so blockade tiebreaks still apply.
    if (this.twoPlayerMode && (tile.isFinishing || tile.terrainType === TerrainType.EL_DORADO)) {
      return this._handleTwoPieceFinishing(playerId, player, this.activePieceIndex);
    }
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

  // ── Move pawn onto a camp tile (rulebook p3 + p6) ─────────────────────────
  // Camp entry trashes `cost` cards total (all camps cost 1 on the current
  // map). The mover is one of the trashed cards — it is removed from the
  // game along with any extras. The turn continues with new cards. Native
  // ignores the requirement and must use plain move_pawn instead.
  movePawnToCamp(playerId, tileId, extraCardIds = []) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE) return { ok: false, error: 'wrong state' };
    if (!this.validMoves.includes(tileId)) return { ok: false, error: 'invalid move' };

    const player = this.currentPlayer;
    const tile = this.board.getTile(tileId);
    if (!tile || tile.terrainType !== TerrainType.CAMP) {
      return { ok: false, error: 'not a camp tile' };
    }
    if (this.playedCardData && this.playedCardData.specialEffect === CardEffect.NATIVE) {
      return { ok: false, error: 'native ignores camp requirements — move directly' };
    }
    const needed = (tile.movementCost ?? 1) - 1;

    if (extraCardIds.length !== needed) {
      return { ok: false, error: `camp requires trashing ${needed} card(s), got ${extraCardIds.length}` };
    }
    if (new Set(extraCardIds).size !== extraCardIds.length) {
      return { ok: false, error: 'invalid hand cards' };
    }

    const extraCards = extraCardIds
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (extraCards.length !== needed) {
      return { ok: false, error: `camp requires trashing ${needed} card(s), got ${extraCards.length}` };
    }

    for (const card of extraCards) player.removeCardPermanently(card.instanceId);
    if (this.playedCardData) player.removeCardPermanently(this.playedCardData.instanceId);

    this._setPiecePosition(player, this.activePieceIndex, tileId);
    this.emit('pawn_moved', { playerId, tileId, pieceIndex: this.activePieceIndex });
    this.emit('hand_updated', { playerId, hand: player.hand });

    // A camp finishing tile (none on the current map, but future maps may
    // have one) follows the normal final-round flow — record the finisher
    // instead of ending outright so blockade tiebreaks still apply.
    if (this.twoPlayerMode && (tile.isFinishing || tile.terrainType === TerrainType.EL_DORADO)) {
      return this._handleTwoPieceFinishing(playerId, player, this.activePieceIndex);
    }
    if (tile.isFinishing) {
      this._recordFinisher(playerId);
      this._relocateFinisher(player);

      const isLastPlayerOfRound = this.currentPlayerIndex === this.players.length - 1;

      if (!this.finalRoundTriggered) {
        this.finalRoundTriggered = true;
        this.finalRoundTriggerPlayerIndex = this.currentPlayerIndex;

        if (isLastPlayerOfRound) {
          this.state = GS.GAME_OVER;
          this.playedCardData = null;
          this.movesRemaining = 0;
          this.emit('game_won', this._gameWonPayload());
          return { ok: true };
        }

        this.emit('final_round_started', {
          triggeredByPlayerId: playerId,
          winnerId: this.firstWinnerId,
        });
      }

      this.playedCardData = null;
      this.movesRemaining = 0;
      this.endTurn(playerId);
      return { ok: true };
    }

    // The mover is trashed (removed from game) and the turn continues: the
    // player may play new cards.
    this.playedCardData = null;
    this.movesRemaining = 0;
    this.state = GS.AWAITING_CARD;
    this.emit('card_disposed', { playerId: player.id });
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
    this.activePieceIndex = this.twoPlayerMode ? next.activePieceIndex : 0;

    this.purchasedThisTurn = false;
    this.emit('hand_updated', { playerId: player.id, hand: player.hand });
    this.emit('turn_ended', { nextPlayerId: next.id, nextPlayerName: next.name });
    return { ok: true };
  }

  // ── Purchase a card from the market ───────────────────────────────────────
  // Rulebook: Transmitter ("take any expedition card without paying for it")
  // is NOT a purchase — it neither consumes nor counts toward the 1 buy per
  // turn (rulebook p4). It goes through purchaseCard only as a transport
  // (same market overlay), so the two paths split here:
  //   - transmitterActive → free take: no power check, no pooled cards, no
  //     purchasedThisTurn set/check, no shop replenish (no market slide).
  //   - otherwise → normal buy: 1 per turn, power check, lock set.
  purchaseCard(playerId, cardKey, handCardsUsed = [], cardMarket) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    // Purchases happen before/after movement, never mid-card. The played
    // card stays in hand until disposed, so without this guard it would
    // still resolve as purchase cash (Issue 2). Transmitter is unaffected:
    // it disposes itself immediately and drops back to AWAITING_CARD.
    if (this.state === GS.AWAITING_MOVE) return { ok: false, error: 'finish movement first' };

    const player = this.currentPlayer;

    if (new Set(handCardsUsed).size !== handCardsUsed.length) {
      return { ok: false, error: 'invalid hand cards' };
    }
    if (this.playedCardData && handCardsUsed.includes(this.playedCardData.instanceId)) {
      return { ok: false, error: 'invalid hand cards' };
    }

    const spentCards = handCardsUsed
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (spentCards.length !== handCardsUsed.length) {
      return { ok: false, error: 'invalid hand cards' };
    }

    // ── Transmitter free take (not a purchase) ──────────────────────────
    if (this.transmitterActive) {
      // Free means free — pooling cards alongside the take would silently
      // waste them (old code added +20 AND spent the pool). Force the
      // free pick to resolve first; the normal buy stays available after.
      if (handCardsUsed.length > 0) {
        return { ok: false, error: 'transmitter take is free — take your free card first' };
      }
      let card = cardMarket.getCard(cardKey, false);
      let fromReserve = false;
      if (!card) {
        card = cardMarket.getCard(cardKey, true);
        fromReserve = true;
      }
      if (!card) return { ok: false, error: 'card not in market' };

      const taken = cardMarket.buyCard(cardKey, fromReserve);
      if (!taken) return { ok: false, error: 'card sold out' };
      player.discardPile.push(taken);

      this.transmitterActive = false;
      // NOTE: purchasedThisTurn untouched, and no reserve replenish prompt
      // — a free take causes no market slide (BGG ruling).

      this.emit('card_purchased', { playerId, cardKey, viaTransmitter: true });
      this.emit('hand_updated', { playerId, hand: player.hand });
      this.emit('market_updated', { market: cardMarket.getShopState() });
      this.emit('purchase_closed', { playerId, viaTransmitter: true });
      return { ok: true };
    }

    if (this.purchasedThisTurn) return { ok: false, error: 'already purchased this turn' };

    const power = spentCards.reduce((sum, c) => sum + (c.purchasingPower ?? 0), 0);

    const card = cardMarket.getCard(cardKey, false);
    if (!card) return { ok: false, error: 'card not in market' };
    if (power < card.cost) return { ok: false, error: `need ${card.cost} power, have ${power}` };

    for (const c of spentCards) player.playCard(c.instanceId);

    const purchased = cardMarket.buyCard(cardKey, false);
    if (!purchased) return { ok: false, error: 'card sold out' };
    player.discardPile.push(purchased);

    this.purchasedThisTurn = true;

    if (cardMarket.shopCardSoldOut(cardKey)) {
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
      currentTileId: player.pieceTileIds[this.activePieceIndex] ?? player.currentTileId,
      playedCard: this.playedCardData,
      movesRemaining: this.movesRemaining,
      wildCardTerrain: this.wildCardTerrain,
      players: this.players,
      handSize: player.hand.length,
      activeBlockades: this.activeBlockades || [],
    });

    // Also compute which blockades are breakable from here with this card
    this.breakableBlockades = this.board.getBreakableBlockades({
      currentTileId: player.pieceTileIds[this.activePieceIndex] ?? player.currentTileId,
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
    this.activePieceIndex = this.twoPlayerMode ? player.activePieceIndex : 0;
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
    this.activePieceIndex = this.twoPlayerMode ? player.activePieceIndex : 0;
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
    this.activePieceIndex = this.twoPlayerMode ? this.currentPlayer?.activePieceIndex ?? 0 : 0;
  }

  _isCurrentPlayer(playerId) {
    return this.currentPlayer && this.currentPlayer.id === playerId;
  }

  _relocateFinisher(player, pieceIndex = 0) {
    const elDoradoTiles = [...this.board.tiles.values()]
      .filter(t => t.terrainType === TerrainType.EL_DORADO);
    const occupiedIds = new Set(this.players.flatMap(p =>
      Array.isArray(p.pieceTileIds) ? p.pieceTileIds : [p.currentTileId]
    ));
    const podium = elDoradoTiles.find(t => !occupiedIds.has(t.id));
    if (!podium) return;
    this._setPiecePosition(player, pieceIndex, podium.id);
    this.emit('pawn_moved', { playerId: player.id, tileId: podium.id, pieceIndex });
  }

  _setPiecePosition(player, pieceIndex, tileId) {
    if (!Array.isArray(player.pieceTileIds)) player.pieceTileIds = [player.currentTileId];
    player.pieceTileIds[pieceIndex] = tileId;
    if (pieceIndex === 0) player.currentTileId = tileId;
  }

  _handleTwoPieceFinishing(playerId, player, pieceIndex) {
    player.finishedPieceIndices[pieceIndex] = true;
    this.emit('piece_finished', { playerId, pieceIndex });
    const nextPieceIndex = player.finishedPieceIndices.findIndex(finished => !finished);
    if (nextPieceIndex >= 0) {
      player.activePieceIndex = nextPieceIndex;
      this.activePieceIndex = nextPieceIndex;
      this.emit('piece_selected', { playerId, pieceIndex: nextPieceIndex });
    }
    this._relocateFinisher(player, pieceIndex);

    const finishedAllPieces = player.finishedPieceIndices.every(Boolean);
    if (finishedAllPieces) {
      this._recordFinisher(playerId);
      if (!this.finalRoundTriggered) {
        this.finalRoundTriggered = true;
        this.finalRoundTriggerPlayerIndex = this.currentPlayerIndex;
        if (this.currentPlayerIndex === this.players.length - 1) {
          this._disposeFinishedCard(player);
          this.state = GS.GAME_OVER;
          this.emit('game_won', this._gameWonPayload());
          return { ok: true };
        }
        this.emit('final_round_started', {
          triggeredByPlayerId: playerId,
          winnerId: this.firstWinnerId,
        });
      }
    }

    this._disposeFinishedCard(player);
    this.endTurn(playerId);
    return { ok: true };
  }
}

module.exports = { GameStateManager };