// server/server.js
const express = require('express');
const http = require('http');
const os = require('os');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const path = require('path');
const { GameManager } = require('./game/GameManager');
const { CARD_DEFINITIONS, getPurchasingPower } = require('../shared/cardData');
const { layouts, listLayouts } = require('../shared/layoutRegistry');
const piecesData = require('../shared/pieces.json');
const { composeLayout } = require('../shared/mapCompose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 600000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;

app.get('/api/maps', (req, res) => {
  res.json(listLayouts());
});

app.get('/api/maps/:id', (req, res) => {
  const layout = layouts[req.params.id];
  if (!layout) return res.status(404).json({ error: 'Map not found' });

  const { tiles } = composeLayout(layout, piecesData);
  res.json({ id: layout.id, name: layout.name, difficulty: layout.difficulty, tiles });
});

// Block 9: QR-code join. Phones scan a QR on the TV/waiting room, so the
// encoded URL must use the host's real LAN IPv4 (never localhost) —
// window.location.hostname would be "localhost" when the TV tab opened the
// server that way. First non-internal IPv4 from os.networkInterfaces().
function getLanIpv4() {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

// Served same-origin (no internet CDN): the client builds
// <protocol>://<host>/?view=phone&room=<CODE> from this, then loads the
// QR pixels from /api/qr below. The Host header is the DNS name when
// deployed (e.g. on Render) or the IP:port on a LAN — always routable.
app.get('/api/server-info', (req, res) => {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  res.json({ host: req.get('host'), protocol: proto, lanIp: getLanIpv4(), port: PORT });
});

// QR pixels as PNG. Text is the join URL above; capped so the endpoint
// can't be abused as an arbitrary image generator.
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text || text.length > 500) { res.status(400).send('missing ?text='); return; }
  try {
    const buf = await QRCode.toBuffer(text, {
      type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 256,
    });
    res.type('png').set('Cache-Control', 'public, max-age=300').send(buf);
  } catch (e) {
    res.status(500).send('qr failed');
  }
});

app.use('/shared', express.static(path.join(__dirname, '../shared')));
app.use('/tools', express.static(path.join(__dirname, '..', 'tools')));
app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

const gameManager = new GameManager(io);

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('create_room', ({ playerName, playerCount = 2, debugMode = false, enableBlockades = true, enableTwoPlayerPieces = true, asSpectator = false, map = 'hills-of-gold' }) => {
    const count = Math.min(4, Math.max(1, Number(playerCount) || 2));
    const { room, player, spectator } = gameManager.createRoom(socket, playerName, {
      debugMode,
      maxPlayers: count,
      enableBlockades: Boolean(enableBlockades),
      enableTwoPlayerPieces: Boolean(enableTwoPlayerPieces),
      asSpectator: Boolean(asSpectator),
      map: map || 'hills-of-gold',
    });
    socket.emit('joined_room', {
      roomId: room.roomId,
      playerId: player ? player.id : null,
      playerNumber: player ? player.playerNumber : null,
      isHost: true,
      isSpectator: Boolean(spectator),
      maxPlayers: room.maxPlayers,
      debugMode,
      enableBlockades: room.enableBlockades,
      enableTwoPlayerPieces: room.enableTwoPlayerPieces,
      players: room.players.map(p => p.toPublicData()),
      hostId: room.hostId,
    });
  });

  socket.on('join_room', ({ playerName, roomId, asSpectator = false }) => {
    const result = gameManager.joinRoom(socket, playerName, roomId, Boolean(asSpectator));
    if (!result.ok) {
      socket.emit('join_error', { message: result.error });
      return;
    }
    const { room, player, spectator } = result;
    socket.emit('joined_room', {
      roomId: room.roomId,
      playerId: player ? player.id : null,
      playerNumber: player ? player.playerNumber : null,
      isHost: false,
      isSpectator: Boolean(spectator),
      maxPlayers: room.maxPlayers,
      debugMode: room.debugMode,
      enableBlockades: room.enableBlockades,
      enableTwoPlayerPieces: room.enableTwoPlayerPieces,
      players: room.players.map(p => p.toPublicData()),
      hostId: room.hostId,
    });
  });

  socket.on('start_game', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room) { socket.emit('action_error', { message: 'not in a room' }); return; }
    const result = room.tryStartGame(socket.id);
    if (!result.ok) socket.emit('action_error', { message: result.error });
  });

  socket.on('request_rematch', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room) { socket.emit('action_error', { message: 'not in a room' }); return; }
    const result = room.tryRematch(socket.id);
    if (!result.ok) socket.emit('action_error', { message: result.error });
  });

  socket.on('get_room_info', ({ roomId }) => {
    const room = gameManager.rooms.get((roomId || '').toUpperCase());
    if (!room) { socket.emit('room_info', null); return; }
    socket.emit('room_info', room.getRoomInfo());
  });

  socket.on('join_game', ({ playerName, debugMode = false }) => {
    const { room, player } = gameManager.joinOrCreateRoom(socket, playerName, { debugMode });
    socket.emit('joined_room', {
      roomId: room.roomId,
      playerId: player.id,
      playerNumber: player.playerNumber,
      isHost: room.hostId === socket.id,
      maxPlayers: room.maxPlayers,
      debugMode,
      enableBlockades: room.enableBlockades,
      enableTwoPlayerPieces: room.enableTwoPlayerPieces,
      players: room.players.map(p => p.toPublicData()),
      hostId: room.hostId,
    });
    if (debugMode) setImmediate(() => room.tryStartGame(socket.id));
  });

  socket.on('play_card', ({ instanceId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePlayCard(socket.id, instanceId);
  });

  socket.on('cancel_card', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleCancelCard(socket.id);
  });

  socket.on('finish_remove', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleFinishRemove(socket.id);
  });

  socket.on('move_pawn', ({ tileId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleMovePawn(socket.id, tileId);
  });

  socket.on('select_piece', ({ pieceIndex }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleSelectPiece(socket.id, pieceIndex);
  });

  socket.on('move_to_rubble', ({ tileId, extraCardIds }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleMoveToRubble(socket.id, tileId, extraCardIds);
  });

  socket.on('move_to_camp', ({ tileId, extraCardIds }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleMoveToCamp(socket.id, tileId, extraCardIds);
  });

  socket.on('break_blockade', ({ blockadeId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleBreakBlockade(socket.id, blockadeId);
  });

  socket.on('end_turn', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleEndTurn(socket.id);
  });

  socket.on('purchase_card', ({ cardKey, handCardsUsed = [] }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePurchaseCard(socket.id, cardKey, handCardsUsed);
  });

  socket.on('choose_reserve_card', ({ soldOutKey, chosenKey }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleChooseReserveCard(socket.id, soldOutKey, chosenKey);
  });

  socket.on('discard_card', ({ cardKey }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePlayCard(socket.id, cardKey, true);
  });

  socket.on('debug_state', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) console.log(room.gameState);
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    gameManager.handleDisconnect(socket.id);
  });

  socket.on('debug_set_hand', ({ cardKeys }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    const cardMap = new Map(CARD_DEFINITIONS.map(c => [c.key, c]));
    const newHand = cardKeys
      .map((key, i) => {
        const def = cardMap.get(key);
        if (!def) { console.warn('debug_set_hand: unknown key', key); return null; }
        return { ...def, purchasingPower: getPurchasingPower(def), instanceId: `debug-${key}-${i}-${Date.now()}` };
      })
      .filter(Boolean);
    player.hand = newHand;
    socket.emit('hand_updated', { hand: newHand });
  });

  socket.on('debug_teleport', ({ tileId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    player.currentTileId = tileId;
    if (Array.isArray(player.pieceTileIds)) player.pieceTileIds[0] = tileId;
    room._broadcast('pawn_moved', { playerId: player.id, tileId });
  });
});

server.listen(PORT, () => {
  const lan = getLanIpv4();
  console.log(`El Dorado server running at http://localhost:${PORT}`);
  if (lan) console.log(`On your LAN: http://${lan}:${PORT} (phones scan the TV QR)`);
});