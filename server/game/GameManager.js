// server/game/GameManager.js
const { v4: uuidv4 } = require('uuid');
const { GameStateManager } = require('./GameState');
const { CardMarket } = require('./CardMarket');
const { HexBoard } = require('./HexBoard');
const { Player } = require('./Player');
const { BLOCKADE_SEAMS, BLOCKADE_TERRAIN_POOL } = require('../../shared/blockadeData');
const MAP_DATA = require('../../shared/mapData.json');

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

    this.gameState.onEvent = (event, data) => {
      if (event === 'hand_updated' && data.playerId) {
        const owner = this.players.find(p => p.id === data.playerId);
        if (owner) {
          this.io.to(owner.socketId).emit('hand_updated', { hand: data.hand });
          return;
        }
      }
      if (event === 'prompt_reserve_choice' && data.playerId) {
        const owner = this.players.find(p => p.id === data.playerId);
        if (owner) {
          this.io.to(owner.socketId).emit('prompt_reserve_choice', data);
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
    this.players = this.players.filter(p => p.socketId !== socketId);
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

  tryStartGame(socketId) {
    if (socketId !== this.hostId) return { ok: false, error: 'only the host can start the game' };
    if (this.started) return { ok: false, error: 'game already started' };
    const minPlayers = this.debugMode ? 1 : 2;
    if (this.players.length < minPlayers) return { ok: false, error: 'need at least 2 players' };
    this._startGame();
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

  handleCancelCard(socketId) {
    const result = this.gameState.cancelCard(socketId);
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
    if (room.started) return { ok: false, error: 'Game already in progress' };
    if (asSpectator) {
      room.addSpectator(socket, playerName);
      this.playerRooms.set(socket.id, room.roomId);
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