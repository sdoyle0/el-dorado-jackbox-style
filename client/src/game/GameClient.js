// client/src/game/GameClient.js
class GameClient {
  constructor(socket) {
    this.socket = socket;
    this.playerId = null;
    this.playerNumber = null;
    this.roomId = null;
    this.isHost = false;
    this.isSpectator = false;

    this.onJoined = null;
    this.onJoinError = null;
    this.onRoomUpdated = null;
    this.onGameStarted = null;
    this.onPawnMoved = null;
    this.onHandUpdated = null;
    this.onValidMoves = null;
    this.onPieceSelected = null;
    this.onPieceFinished = null;
    this.onTurnEnded = null;
    this.onMarketUpdated = null;
    this.onPurchaseOpened = null;
    this.onPurchaseClosed = null;
    this.onPromptRemove = null;
    this.onGameWon = null;
    this.onFinalRoundStarted = null;
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onLog = null;
    this.onCardDisposed = null;
    this.onActionError = null;
    this.onPromptReserveChoice = null;
    this.onBlockadeBroken = null; // ({ blockadeId, brokenByPlayerId, brokenByName, terrainType, remainingBlockades })
    this.onReturnToWaiting = null; // #7 rematch ({ roomId, players, maxPlayers, hostId, enableBlockades })

    this._bindEvents();
  }

  _bindEvents() {
    const s = this.socket;

    s.on('joined_room', (data) => {
      this.playerId = data.playerId ?? null;
      this.playerNumber = data.playerNumber ?? null;
      this.roomId = data.roomId;
      this.isHost = data.isHost ?? false;
      this.isSpectator = data.isSpectator ?? false;
      this.onJoined?.(data);
    });

    s.on('join_error', d => this.onJoinError?.(d));

    s.on('player_joined', d => {
      this.onPlayerJoined?.(d);
      this.onRoomUpdated?.(d);
    });

    s.on('player_left', d => {
      this.onPlayerLeft?.(d);
      this.onRoomUpdated?.(d);
    });

    s.on('game_started', d => this.onGameStarted?.(d));
    s.on('pawn_moved', d => this.onPawnMoved?.(d));
    s.on('hand_updated', d => this.onHandUpdated?.(d));
    s.on('valid_moves_updated', d => this.onValidMoves?.(d));
    s.on('piece_selected', d => this.onPieceSelected?.(d));
    s.on('piece_finished', d => this.onPieceFinished?.(d));
    s.on('turn_ended', d => this.onTurnEnded?.(d));
    s.on('market_updated', d => this.onMarketUpdated?.(d));
    s.on('purchase_opened', d => this.onPurchaseOpened?.(d));
    s.on('purchase_closed', d => this.onPurchaseClosed?.(d));
    s.on('prompt_remove_cards', d => this.onPromptRemove?.(d));
    s.on('game_won', d => this.onGameWon?.(d));
    s.on('final_round_started', d => this.onFinalRoundStarted?.(d));
    s.on('log', d => this.onLog?.(d));
    s.on('card_disposed', d => this.onCardDisposed?.(d));
    s.on('action_error', d => this.onActionError?.(d));
    s.on('prompt_reserve_choice', d => this.onPromptReserveChoice?.(d));
    s.on('blockade_broken', d => this.onBlockadeBroken?.(d));
    s.on('return_to_waiting', d => this.onReturnToWaiting?.(d));

    s.on('error', ({ message }) => console.warn('[server error]', message));
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────

  createRoom(playerName, playerCount = 2, debugMode = false, enableBlockades = true, asSpectator = false, map = 'hills-of-gold', enableTwoPlayerPieces = true) {
    this.socket.emit('create_room', { playerName, playerCount, debugMode, enableBlockades, asSpectator, map, enableTwoPlayerPieces });
  }

  joinRoom(playerName, roomId, asSpectator = false) {
    this.socket.emit('join_room', { playerName, roomId: roomId.toUpperCase(), asSpectator });
  }

  startGame() {
    this.socket.emit('start_game');
  }

  requestRematch() {
    this.socket.emit('request_rematch');
  }

  joinGame(playerName, debugMode = false) {
    this.socket.emit('join_game', { playerName, debugMode });
  }

  // ── Game actions ──────────────────────────────────────────────────────────

  playCard(instanceId) { this.socket.emit('play_card', { instanceId }); }
  cancelCard() { this.socket.emit('cancel_card'); }
  finishRemove() { this.socket.emit('finish_remove'); }
  movePawn(tileId) { this.socket.emit('move_pawn', { tileId }); }
  selectPiece(pieceIndex) { this.socket.emit('select_piece', { pieceIndex }); }
  moveToRubble(tileId, extraCardIds) { this.socket.emit('move_to_rubble', { tileId, extraCardIds }); }
  moveToCamp(tileId, extraCardIds) { this.socket.emit('move_to_camp', { tileId, extraCardIds }); }
  endTurn() { this.socket.emit('end_turn'); }
  purchaseCard(cardKey, handCardsUsed = []) { this.socket.emit('purchase_card', { cardKey, handCardsUsed }); }
  discardCard(cardKey) { this.socket.emit('discard_card', { cardKey }); }
  chooseReserveCard(soldOutKey, chosenKey) { this.socket.emit('choose_reserve_card', { soldOutKey, chosenKey }); }
  breakBlockade(blockadeId) { this.socket.emit('break_blockade', { blockadeId }); }

  debugState() { this.socket.emit('debug_state'); }
  debugSetHand(cardKeys) { this.socket.emit('debug_set_hand', { cardKeys }); }
  debugTeleport(tileId) { this.socket.emit('debug_teleport', { tileId }); }

  isMyTurn(currentPlayerId) { return this.playerId === currentPlayerId; }
}