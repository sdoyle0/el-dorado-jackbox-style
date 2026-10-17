// server/game/GameManager.js
const { v4: uuidv4 } = require('uuid');
const { GameStateManager } = require('./GameState');
const { CardMarket } = require('./CardMarket');
const { HexBoard } = require('./HexBoard');
const { Player } = require('./Player');
const { BLOCKADE_SEAMS, BLOCKADE_TERRAIN_POOL } = require('../../shared/blockadeData');
const { GameState: GS } = require('../../shared/constants');
const MAP_DATA = require('../../shared/mapData.json');

// Block 8: phone refresh mid-turn keeps its seat for a grace period instead
// of losing it instantly. No DB — the Player object stays in the roster with
// disconnected=true; rejoin by room code + same name reclaims the same seat
// (same playerNumber, preserved hand/position/turn).
const RECONNECT_GRACE_MS = 120000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class GameRoom {
  constructor(roomId, io, { debugMode = false, maxPlayers = 2, enableBlockades = true } = {}) {
    this.roomId = roomId;
    this.io = io;
    this.players = [];
    this.maxPlayers = Math.min(4, Math.max(debugMode ? 1 : 2, maxPlayers));
    this.debugMode = debugMode;
    this.enableBlockades = enableBlockades;
    this.started = false;
    this.hostId = null;
    // Spectators (e.g. the ?view=tv display): joined to the socket.io room so
    // they receive all broadcasts, but hold no Player seat, pawn, or turn.
    this.spectators = new Map(); // socketId -> display name

    this.board = new HexBoard();
    this.market = new CardMarket();
    this.gameState = new GameStateManager(this.board);
    this._wireGameState();
  }

  // Routes GameState events to the room (private DMs vs broadcasts). Kept as
  // a method so a rematch can swap in a fresh GameStateManager and rewire it.
  _wireGameState() {
    this.gameState.onEvent = (event, data) => {
      if (event === 'hand_updated' && data.playerId) {
        const owner = this.players.find(p => p.id === data.playerId);
        if (owner) {
          // Block 8: a grace-held/expired seat has no live socket — skip the
          // DM (io.to(null) is not a valid room) instead of throwing.
          if (!owner.socketId) return;
          this.io.to(owner.socketId).emit('hand_updated', { hand: data.hand });
          return;
        }
      }
      if (event === 'prompt_reserve_choice' && data.playerId) {
        const owner = this.players.find(p => p.id === data.playerId);
        if (owner) {
          if (!owner.socketId) return;
          this.io.to(owner.socketId).emit('prompt_reserve_choice', data);
          return;
        }
      }
      // Scientist / Travel Log removal is private to the acting player —
      // the TV and opponents must not see the dialog/banner (same pattern
      // as hand_updated / prompt_reserve_choice above).
      if (event === 'prompt_remove_cards' && data.playerId) {
        const owner = this.players.find(p => p.id === data.playerId);
        if (owner) {
          if (!owner.socketId) return;
          this.io.to(owner.socketId).emit('prompt_remove_cards', data);
          return;
        }
      }
      this._broadcast(event, data);
    };
  }

  addPlayer(socket, playerName) {
    if (this.players.length >= this.maxPlayers) return null;
    if (this.started) return null;

    const player = new Player({
      id: socket.id,
      playerNumber: this.players.length + 1,
      socketId: socket.id,
      name: playerName || `Player ${this.players.length + 1}`,
    });

    this.players.push(player);
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.roomId);

    this._broadcast('player_joined', {
      player: player.toPublicData(),
      roomId: this.roomId,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
    });

    return player;
  }

  addSpectator(socket, spectatorName) {
    if (this.spectators.has(socket.id)) return true;
    socket.join(this.roomId);
    this.spectators.set(socket.id, spectatorName || 'TV');
    if (!this.hostId) this.hostId = socket.id;
    this._broadcast('player_joined', {
      player: { name: this.spectators.get(socket.id) },
      roomId: this.roomId,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
    });
    return true;
  }

  removeSpectator(socketId) {
    this.spectators.delete(socketId);
    if (this.hostId === socketId) {
      this.hostId = this.players.length > 0
        ? this.players[0].socketId
        : [...this.spectators.keys()][0] || null;
    }
    this._broadcast('player_left', {
      socketId,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
    });
  }

  removePlayer(socketId) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return;
    if (this.started) {
      // Block 8: mid-game disconnect keeps the seat for the grace period so
      // a phone refresh doesn't lose the turn. Real removal happens on timer
      // expiry (or never, if they reclaim). Turn order + gameState.players
      // reference stay intact because the object is never spliced out here.
      this._markDisconnected(player);
      return;
    }
    this._removePlayerNow(player);
  }

  // Block 8: immediate removal (pre-game only). Splices in place so the
  // gameState.players array reference (assigned at _startGame) never goes
  // stale — the old filter-and-reassign broke turn tracking after rejoins.
  _removePlayerNow(player) {
    const idx = this.players.indexOf(player);
    if (idx === -1) return;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    this.players.splice(idx, 1);
    // gameState.players is the same array reference; guard anyway.
    if (this.gameState.players !== this.players) {
      const gi = this.gameState.players.indexOf(player);
      if (gi !== -1) this.gameState.players.splice(gi, 1);
    }
    if (this.hostId === player.socketId || this.hostId === player.id) {
      this.hostId = this.players.length > 0
        ? this.players[0].socketId
        : [...this.spectators.keys()][0] || null;
    }
    this._broadcast('player_left', {
      socketId: player.socketId || player.id,
      playerName: player.name,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
    });
  }

  // Block 8: grace-mark a mid-game disconnect. If the current player drops,
  // the turn simply waits for them (host force-end-turn is a future block).
  _markDisconnected(player) {
    if (player.disconnected) return;
    player.disconnected = true;
    player.socketId = null;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      this._expireDisconnectedSeat(player);
    }, RECONNECT_GRACE_MS);
    if (player.disconnectTimer.unref) player.disconnectTimer.unref();
    this._broadcast('player_left', {
      socketId: player.id,
      playerName: player.name,
      disconnected: true,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
    });
  }

  // Block 8: grace expired — drop the seat without crashing the room. If it
  // was their turn, end it first so the game passes on instead of soft-locking.
  _expireDisconnectedSeat(player) {
    if (!player.disconnected) return; // reclaimed in the meantime
    if (this.players.indexOf(player) === -1) return;
    if (this.started
      && this.gameState.state !== GS.GAME_OVER
      && this.gameState.currentPlayer
      && this.gameState.currentPlayer.id === player.id) {
      this.gameState.endTurn(player.id);
    }
    const removedIdx = this.players.indexOf(player);
    this._removePlayerNow(player);
    // _removePlayerNow spliced the shared array; repair the turn index.
    if (this.players.length === 0) {
      this.gameState.currentPlayerIndex = 0;
    } else if (removedIdx < this.gameState.currentPlayerIndex) {
      this.gameState.currentPlayerIndex--;
    } else if (this.gameState.currentPlayerIndex >= this.players.length) {
      this.gameState.currentPlayerIndex = 0;
    }
    if (this.players.length === 0 && this.spectators.size === 0 && this.onEmpty) {
      this.onEmpty();
    }
  }

  // Block 8: reclaim a grace-held seat by player name (case-insensitive).
  // Returns the player or null. Updates id + socketId to the new socket,
  // rejoins the socket.io room, and DMs a full state snapshot + hand so the
  // refreshed phone renders without waiting for the next broadcast.
  //
  // Stale-seat fast-forward (Oct 2026): a same-tab reload usually closes the
  // old socket cleanly, but mobile browsers often don't — the server then only
  // notices via heartbeat timeout (~30-60s), and a rejoin arriving in that
  // window found a still-"connected" seat and ate 'Game already in progress'
  // (client retries couldn't out-wait it). If the name matches a seat whose
  // socket is already gone from the io map, the old tab is definitively dead,
  // so grace-mark it now and reclaim immediately. Fail-open: if the lookup
  // throws, the seat is treated as live (today's behavior) — a live seat
  // (second tab genuinely open) is never stolen.
  _isSocketLive(socketId) {
    try {
      if (!socketId) return false;
      const s = this.io?.sockets?.sockets?.get(socketId);
      return !!(s && s.connected !== false);
    } catch (e) { return true; }
  }

  tryReclaimSeat(socket, playerName) {
    const wanted = (playerName || '').trim().toLowerCase();
    if (!wanted) return null;
    const nameMatch = (p) => (p.name || '').trim().toLowerCase() === wanted;
    let player = this.players.find(p =>
      p.disconnected && nameMatch(p));
    if (!player) {
      const stale = this.players.find(p =>
        !p.disconnected && nameMatch(p) && !this._isSocketLive(p.socketId));
      if (stale) {
        this._markDisconnected(stale);
        player = stale;
      }
    }
    if (!player) return null;
    const oldId = player.id;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.disconnected = false;
    player.id = socket.id;
    player.socketId = socket.id;
    if (this.hostId === oldId) this.hostId = socket.id;
    // Issue 7: finishers/firstWinnerId are recorded by socket id at finish
    // time, while _blockadeCounts is keyed by current id — without this
    // remap a finisher who reclaims a new id counts 0 tokens and the
    // winner can be a stale id matching no seated player. Same pattern as
    // the hostId line above; the client already merges rosters by seat
    // (playerNumber), so no client change needed.
    const gs = this.gameState;
    gs.finishers = gs.finishers.map(f => (f === oldId ? player.id : f));
    if (gs.firstWinnerId === oldId) gs.firstWinnerId = player.id;
    socket.join(this.roomId);
    this._broadcast('player_joined', {
      player: player.toPublicData(),
      roomId: this.roomId,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
      rejoined: true,
    });
    // Deferred past the server's synchronous joined_room reply so the client
    // processes joined_room (identity) before the snapshot that references it.
    setImmediate(() => this.sendFullState(socket, player));
    return player;
  }

  // Block 8: full snapshot for a rejoiner (reclaimed phone or spectator that
  // joined mid-game, e.g. a refreshed TV). Private data (hand, pending valid
  // moves) is DM'd only to the seat owner; the board/market/blockades payload
  // itself is public.
  sendFullState(socket, playerOrNull) {
    const gs = this.gameState;
    socket.emit('game_snapshot', {
      tiles: [...this.board.tiles.values()].map(t => ({ ...t })),
      players: this.players.map(p => p.toPublicData()),
      currentPlayerId: gs.currentPlayer?.id,
      market: this.market.getShopState(),
      blockades: (this.gameState.activeBlockades || []).map(b =>
        ({ id: b.id, label: b.label, terrainType: b.terrainType, edges: b.edges })),
      finalRound: {
        triggered: gs.finalRoundTriggered,
        triggeredByPlayerId: gs.finalRoundTriggerPlayerIndex >= 0
          ? gs.players[gs.finalRoundTriggerPlayerIndex]?.id || null
          : null,
      },
      gameOver: gs.state === GS.GAME_OVER
        ? {
            winnerId: (typeof gs._determineWinner === 'function' ? gs._determineWinner() : gs.firstWinnerId),
            blockadeCounts: gs._blockadeCounts(),
            finishers: [...(gs.finishers || [])],
            firstFinisherId: gs.firstWinnerId,
          }
        : null,
      // Rulebook p4 (1 buy per turn): lets a rejoiner render locked Buys
      // when the current turn already has its purchase. Per-current-turn
      // flag, so applying it unconditionally is correct — turn_ended
      // clears it when the turn advances.
      purchasedThisTurn: !!gs.purchasedThisTurn,
    });
    if (playerOrNull && !playerOrNull.disconnected) {
      this.io.to(socket.id).emit('hand_updated', { hand: playerOrNull.hand });
      if (gs.state === GS.AWAITING_MOVE
        && gs.currentPlayer && gs.currentPlayer.id === playerOrNull.id) {
        if ((gs.validMoves && gs.validMoves.length > 0)
          || (gs.breakableBlockades && gs.breakableBlockades.length > 0)) {
          this.io.to(socket.id).emit('valid_moves_updated', {
            validMoves: gs.validMoves,
            breakableBlockades: gs.breakableBlockades,
            movesRemaining: gs.movesRemaining,
            movementTotal: gs.playedCardData ? gs.playedCardData.movementTotal : 0,
          });
        }
        if (gs.selectingCardsToRemove > 0) {
          this.io.to(socket.id).emit('prompt_remove_cards', {
            playerId: playerOrNull.id,
            count: gs.selectingCardsToRemove,
            playedInstanceId: gs.playedCardData ? gs.playedCardData.instanceId : null,
          });
        }
      }
    }
  }

  tryStartGame(socketId) {
    // Any seated player (phone) or the host (TV spectator-host) may start,
    // so nobody has to walk back to the laptop once phones are in hand.
    const isPlayer = this.players.some(p => p.socketId === socketId);
    if (socketId !== this.hostId && !isPlayer) return { ok: false, error: 'only players in this room can start the game' };
    if (this.started) return { ok: false, error: 'game already started' };
    const minPlayers = this.debugMode ? 1 : 2;
    if (this.players.length < minPlayers) return { ok: false, error: 'need at least 2 players' };
    this._startGame();
    return { ok: true };
  }

  // #7 rematch: after game over, drop back to a fresh pre-game lobby in the
  // same room (same code, seats, host, options) so the table can run it back
  // without a server restart. Only a fresh GameStateManager is needed here —
  // _startGame() re-inits board/market/players/decks on the next Start.
  // Same auth as tryStartGame: the host (TV spectator-host) or any seated
  // player may trigger it, so nobody walks back to the laptop.
  tryRematch(socketId) {
    const isPlayer = this.players.some(p => p.socketId === socketId);
    if (socketId !== this.hostId && !isPlayer) return { ok: false, error: 'only players in this room can request a rematch' };
    if (!this.gameState || this.gameState.state !== GS.GAME_OVER) return { ok: false, error: 'game is not over yet' };
    this.gameState = new GameStateManager(this.board);
    this._wireGameState();
    this.started = false;
    this._broadcast('return_to_waiting', {
      roomId: this.roomId,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
      enableBlockades: this.enableBlockades,
    });
    return { ok: true };
  }

  getRoomInfo() {
    return {
      roomId: this.roomId,
      maxPlayers: this.maxPlayers,
      started: this.started,
      hostId: this.hostId,
      enableBlockades: this.enableBlockades,
      players: this.players.map(p => p.toPublicData()),
    };
  }

  _startGame() {
    this.started = true;
    this.board.loadMap(MAP_DATA);
    this.market.init();
    this.gameState.players = this.players;

    // ── Initialise blockades ──────────────────────────────────────────────
    let activeBlockades = null;
    if (this.enableBlockades) {
      const terrains = shuffle(BLOCKADE_TERRAIN_POOL);
      activeBlockades = BLOCKADE_SEAMS.map((seam, i) => ({
        ...seam,
        terrainType: terrains[i],
        brokenBy: null,
      }));
      this.gameState.activeBlockades = activeBlockades;
      this.gameState._rebuildBlockadeLookup();
    }

    for (const player of this.players) {
      const startTile = this.board.getPlayerStartTile(player.playerNumber);
      if (!startTile) {
        console.error(`No start tile for player ${player.playerNumber}`);
        continue;
      }
      player.init(startTile.id);
    }

    this._broadcast('game_started', {
      tiles: [...this.board.tiles.values()].map(t => ({ ...t })),
      players: this.players.map(p => p.toPublicData()),
      currentPlayerId: this.gameState.currentPlayer?.id,
      market: this.market.getShopState(),
      blockades: activeBlockades
        ? activeBlockades.map(b => ({ id: b.id, label: b.label, terrainType: b.terrainType, edges: b.edges }))
        : [],
    });

    for (const player of this.players) {
      this.io.to(player.socketId).emit('hand_updated', { hand: player.hand });
    }
  }

  handlePlayCard(socketId, instanceId, isDiscardingFromHand) {
    const result = this.gameState.playCard(socketId, instanceId, isDiscardingFromHand);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleMovePawn(socketId, tileId) {
    const result = this.gameState.movePawn(socketId, tileId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleMoveToRubble(socketId, tileId, extraCardIds) {
    const result = this.gameState.movePawnToRubble(socketId, tileId, extraCardIds);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleMoveToCamp(socketId, tileId, extraCardIds) {
    const result = this.gameState.movePawnToCamp(socketId, tileId, extraCardIds);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleCancelCard(socketId) {
    const result = this.gameState.cancelCard(socketId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleFinishRemove(socketId) {
    const result = this.gameState.finishCardRemoval(socketId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleEndTurn(socketId) {
    const result = this.gameState.endTurn(socketId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handlePurchaseCard(socketId, cardKey, handCardsUsed = []) {
    const result = this.gameState.purchaseCard(socketId, cardKey, handCardsUsed, this.market);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleBreakBlockade(socketId, blockadeId) {
    const result = this.gameState.breakBlockade(socketId, blockadeId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleChooseReserveCard(socketId, soldOutKey, chosenKey) {
    const result = this.gameState.chooseReserveCard(socketId, soldOutKey, chosenKey, this.market);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  _broadcast(event, data) {
    this.io.to(this.roomId).emit(event, data);
  }
}

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerRooms = new Map();
  }

  createRoom(socket, playerName, { debugMode = false, maxPlayers = 2, enableBlockades = true, asSpectator = false } = {}) {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    const room = new GameRoom(roomId, this.io, { debugMode, maxPlayers, enableBlockades });
    room.onEmpty = () => this.rooms.delete(room.roomId);
    this.rooms.set(roomId, room);
    if (asSpectator) {
      room.addSpectator(socket, playerName);
      this.playerRooms.set(socket.id, roomId);
      return { room, player: null, spectator: true };
    }
    const player = room.addPlayer(socket, playerName);
    if (player) this.playerRooms.set(socket.id, roomId);
    return { room, player };
  }

  joinRoom(socket, playerName, roomId, asSpectator = false) {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return { ok: false, error: 'Room not found' };
    // Idempotent retry: the lobby re-enables Join after a response, so a
    // second join_room from the same tab (first attempt looked dead, or a
    // manual join racing Block 8 auto-rejoin) must not take a second seat.
    // Reply success for the existing seat so the client lands in waiting.
    if (!asSpectator) {
      const existing = room.players.find(p => p.socketId === socket.id);
      if (existing) {
        this.playerRooms.set(socket.id, room.roomId);
        return { ok: true, room, player: existing, duplicate: true };
      }
    }
    // Block 8: a refreshed phone reclaims its grace-held seat by name, even
    // mid-game. Spectators (e.g. a refreshed TV) may also join mid-game —
    // they hold no seat, so this is always safe.
    if (!asSpectator) {
      const reclaimed = room.tryReclaimSeat(socket, playerName);
      if (reclaimed) {
        this.playerRooms.set(socket.id, room.roomId);
        return { ok: true, room, player: reclaimed, rejoined: true };
      }
    }
    if (room.started && !asSpectator) return { ok: false, error: 'Game already in progress' };
    if (asSpectator) {
      room.addSpectator(socket, playerName);
      this.playerRooms.set(socket.id, room.roomId);
      // Deferred past joined_room (see tryReclaimSeat): identity first, then state.
      if (room.started) setImmediate(() => room.sendFullState(socket, null));
      return { ok: true, room, player: null, spectator: true };
    }
    if (room.players.length >= room.maxPlayers) return { ok: false, error: 'Room is full' };

    const player = room.addPlayer(socket, playerName);
    if (!player) return { ok: false, error: 'Could not join room' };
    this.playerRooms.set(socket.id, room.roomId);
    return { ok: true, room, player };
  }

  joinOrCreateRoom(socket, playerName, { debugMode = false } = {}) {
    if (debugMode) {
      return this.createRoom(socket, playerName, { debugMode: true, maxPlayers: 2 });
    }
    let room = [...this.rooms.values()].find(r => !r.started && r.players.length < r.maxPlayers && !r.debugMode);
    if (!room) {
      const result = this.createRoom(socket, playerName);
      return { room: result.room, player: result.player };
    }
    const player = room.addPlayer(socket, playerName);
    if (player) this.playerRooms.set(socket.id, room.roomId);
    return { room, player };
  }

  getRoomForSocket(socketId) {
    const roomId = this.playerRooms.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  handleDisconnect(socketId) {
    const room = this.getRoomForSocket(socketId);
    if (room) {
      if (room.spectators.has(socketId)) {
        room.removeSpectator(socketId);
      } else {
        room.removePlayer(socketId);
      }
      this.playerRooms.delete(socketId);
      if (room.players.length === 0 && room.spectators.size === 0) this.rooms.delete(room.roomId);
    }
  }
}

module.exports = { GameManager };