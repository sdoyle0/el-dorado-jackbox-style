document.addEventListener('DOMContentLoaded', () => {
  const DEBUG = new URLSearchParams(window.location.search).has('debug');

  // ── Screen refs ────────────────────────────────────────────────────────────
  const lobbyScreen = document.getElementById('lobby-screen');
  const waitingScreen = document.getElementById('waiting-screen');
  const gameScreen = document.getElementById('game-screen');

  function showScreen(name) {
    lobbyScreen.classList.toggle('active', name === 'lobby');
    waitingScreen.classList.toggle('active', name === 'waiting');
    gameScreen.classList.toggle('active', name === 'game');
  }

  // ── Block 2: ?view=tv / ?view=phone layout split (scaffolding only) ───────
  // No game logic here: just a body class for CSS + a board collapse toggle
  // for phones. Both views join the same room and receive the same events.
  const VIEW = (() => {
    const v = new URLSearchParams(window.location.search).get('view');
    return v === 'tv' || v === 'phone' ? v : '';
  })();
  if (VIEW) {
    document.body.classList.add(`view-${VIEW}`);
    document.body.dataset.view = VIEW;
    const badge = document.getElementById('view-badge');
    if (badge) {
      badge.textContent = VIEW === 'tv' ? '📺 TV DISPLAY' : '📱 PHONE';
      badge.classList.remove('hidden');
    }
  }
  if (VIEW === 'phone') {
    const toggleBtn = document.getElementById('board-toggle-btn');
    const boardAndHand = document.getElementById('board-and-hand-container');
    if (toggleBtn && boardAndHand) {
      const syncLabel = () => {
        const collapsed = boardAndHand.classList.contains('board-collapsed');
        toggleBtn.textContent = collapsed ? '🗺 Show board' : '🙈 Hide board';
        toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      };
      boardAndHand.classList.add('board-collapsed'); // board hidden behind toggle by default
      toggleBtn.classList.remove('hidden');
      syncLabel();
      toggleBtn.addEventListener('click', () => {
        boardAndHand.classList.toggle('board-collapsed');
        syncLabel();
      });
    }
  }

  // ── Lobby UI refs ──────────────────────────────────────────────────────────
  const nameInput = document.getElementById('player-name-input');
  const lobbyStatus = document.getElementById('lobby-status');
  const createRoomBtn = document.getElementById('create-room-btn');
  const joinRoomBtn = document.getElementById('join-room-btn');
  const roomCodeInput = document.getElementById('room-code-input');
  const countBtns = document.querySelectorAll('.count-btn');
  const blockadesToggle = document.getElementById('blockades-toggle');

  let selectedPlayerCount = 2;
  countBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      countBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlayerCount = Number(btn.dataset.count);
    });
  });

  // ── Waiting-room UI refs ───────────────────────────────────────────────────
  const roomCodeValue = document.getElementById('room-code-value');
  const copyCodeBtn = document.getElementById('copy-code-btn');
  const waitingSubtitle = document.getElementById('waiting-subtitle');
  const waitingPlayers = document.getElementById('waiting-players');
  const startGameBtn = document.getElementById('start-game-btn');
  const waitingHint = document.getElementById('waiting-hint');
  const waitingBlockadesNote = document.getElementById('waiting-blockades-note');

  // ── Game UI refs ───────────────────────────────────────────────────────────
  const playerLabel = document.getElementById('current-player-label');
  const turnBanner = document.getElementById('turn-banner');
  const turnDot = document.getElementById('turn-color-dot');
  const legendEl = document.getElementById('player-legend');
  const logEl = document.getElementById('log-scroll');
  const boardEl = document.getElementById('hex-board');
  const handUI = document.getElementById('player-hand-ui');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');

  // ── Board zoom ─────────────────────────────────────────────────────────────
  const boardScrollInner = document.getElementById('board-scroll-inner');

  let boardZoom = 1;
  const BOARD_ZOOM_STEP = 0.25;
  const BOARD_ZOOM_MIN = 0.5;
  const BOARD_ZOOM_MAX = 2.5;

  function updateBoardZoom() {
    boardScrollInner.style.transformOrigin = 'top left';
    boardScrollInner.style.transform = `scale(${boardZoom})`;
    const natural = boardScrollInner.dataset.naturalWidth
      ? Number(boardScrollInner.dataset.naturalWidth)
      : boardScrollInner.offsetWidth;
    const naturalH = boardScrollInner.dataset.naturalHeight
      ? Number(boardScrollInner.dataset.naturalHeight)
      : boardScrollInner.offsetHeight;
    if (!boardScrollInner.dataset.naturalWidth) {
      boardScrollInner.dataset.naturalWidth = boardScrollInner.offsetWidth;
      boardScrollInner.dataset.naturalHeight = boardScrollInner.offsetHeight;
    }
    boardScrollInner.style.width = (Number(boardScrollInner.dataset.naturalWidth) * boardZoom) + 'px';
    boardScrollInner.style.height = (Number(boardScrollInner.dataset.naturalHeight) * boardZoom) + 'px';
    renderer.notifyZoomChanged(boardZoom);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(text, { icon = 'ℹ️', type = 'info', duration = 3500 } = {}) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${text}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);
  }

  // ── Log ────────────────────────────────────────────────────────────────────
  function log(msg, type = 'system') {
    const p = document.createElement('p');
    p.className = `log-${type}`;
    p.textContent = msg;
    logEl.prepend(p);
    if (logEl.children.length > 60) logEl.lastChild.remove();
  }

  // ── Game + client setup ────────────────────────────────────────────────────
  const socket = io();
  const client = new GameClient(socket);
  const renderer = new HexRenderer(document.getElementById('hex-board'));
  window.renderer = renderer;
  const cardUI = new CardUI();
  const clientBoard = new ElDoradoHexBoard.HexBoard();

  const tutorial = new Tutorial({ renderer, cardUI });
  tutorial.onExit = () => showScreen('lobby');

  const tutorialBtn = document.getElementById('tutorial-btn');
  tutorialBtn.addEventListener('click', () => {
    showScreen('game');
    tutorial.start();
  });

  const PAWN_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
  let allPlayers = [];
  let localHand = [];
  let selectedCard = null;
  let selectedValidMoves = [];
  let isMidMove = false;
  let rubblePendingTileId = null;
  let rubbleCardsNeeded = 0;

  // ── Blockade state ─────────────────────────────────────────────────────────
  let activeBlockades = [];
  let blockadeEdgeLookup = null;  // kept for potential future use
  let currentBreakableBlockades = []; // blockade IDs the current card can break

  const BLOCKADE_TERRAIN_ICONS = { jungle: '🌿', water: '🌊', village: '🏘️', rubble: '🪨' };

  // ── Block 4: phone move-selection list (no board nav on phones) ──────────
  // Server payload for `valid_moves_updated` is { validMoves: [tileId], ... }.
  // Terrain + cost are looked up locally via clientBoard.getTile(tileId).
  // Number N = position in that array (1-based). HexRenderer draws the same
  // N on the TV tile, so the phone list matches the board without tile IDs.
  let currentTurnPlayerId = null;
  const MOVE_TERRAIN_ICONS = {
    jungle: '🌿', water: '🌊', village: '🏘️', rubble: '🪨',
    camp: '⛺', mountain: '⛰️', start: '🏁', el_dorado: '🏆',
    wild: '🧭', empty: '✨',
  };

  function ensureMoveListStyles() {
    if (document.getElementById('move-list-styles')) return;
    const style = document.createElement('style');
    style.id = 'move-list-styles';
    style.textContent = `
      #move-list-panel { display: flex; flex-direction: column; gap: 0.4rem;
        padding: 0.55rem 0.6rem; background: rgba(13,17,23,0.6);
        border: 1px solid var(--border-mid, rgba(201,162,39,0.32));
        border-radius: 8px; margin-top: 0.4rem; }
      #move-list-header { font-size: 0.78rem; font-weight: 700; color: #ffd700;
        letter-spacing: 0.03em; }
      #move-list-sub { font-size: 0.7rem; color: #9aabbf; }
      #move-list { display: flex; flex-direction: column; gap: 0.4rem;
        max-height: 220px; overflow-y: auto; }
      .move-dest-btn { display: flex; align-items: center; gap: 0.5rem;
        width: 100%; min-height: 44px; padding: 0.55rem 0.75rem;
        border: 1px solid var(--border-mid, rgba(201,162,39,0.32));
        background: rgba(22,39,61,0.9); color: #e8e0d0; border-radius: 6px;
        cursor: pointer; font-size: 0.9rem; font-weight: 600; text-align: left; }
      .move-dest-btn:hover { background: #1e3352; border-color: #c9a227; }
      .move-dest-btn:active { transform: translateY(1px); }
      .move-dest-num { display: inline-grid; place-items: center;
        min-width: 28px; height: 28px; border-radius: 50%;
        background: #000; color: #fff; border: 2px solid #fff;
        font-size: 0.95rem; font-weight: 800; flex-shrink: 0; }
      .move-dest-icon { font-size: 1.1rem; }
      .move-dest-tile { font-variant-numeric: tabular-nums; font-size: 0.72rem;
        color: #9aabbf; font-weight: 500; }
      .move-dest-meta { margin-left: auto; font-size: 0.75rem; color: #9aabbf;
        font-weight: 500; white-space: nowrap; }
      .move-empty { font-size: 0.82rem; color: #ffaaaa; font-style: italic;
        padding: 0.35rem 0.1rem; }
      #move-list-cancel { min-height: 44px; padding: 0.5rem 1rem;
        border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06);
        color: #e8e0d0; border-radius: 6px; cursor: pointer;
        font-size: 0.85rem; font-weight: 600; }
      #move-list-cancel:hover { background: rgba(255,255,255,0.12); }
    `;
    document.head.appendChild(style);
  }

  function ensureMoveListPanel() {
    ensureMoveListStyles();
    let panel = document.getElementById('move-list-panel');
    if (panel) return panel;
    // Inside #player-hand-ui so ?view=tv (which hides the hand UI) stays display-only.
    const host = document.getElementById('player-hand-ui') || document.getElementById('game-screen');
    panel = document.createElement('div');
    panel.id = 'move-list-panel';
    panel.className = 'hidden';
    panel.innerHTML = `
      <div id="move-list-header">Choose destination</div>
      <div id="move-list-sub"></div>
      <div id="move-list"></div>
      <button id="move-list-cancel" type="button">Cancel</button>`;
    host.appendChild(panel);
    panel.querySelector('#move-list-cancel').addEventListener('click', cancelMoveSelection);
    return panel;
  }

  function moveLabelFor(tileId) {
    const tile = clientBoard.getTile(tileId);
    const terrain = tile?.terrainType || 'unknown';
    const icon = MOVE_TERRAIN_ICONS[terrain] || '❓';
    const cost = tile?.movementCost ?? '?';
    return { terrain, icon, cost };
  }

  function renderMoveList(validMoves) {
    const panel = ensureMoveListPanel();
    const listEl = panel.querySelector('#move-list');
    const subEl = panel.querySelector('#move-list-sub');
    const cardName = selectedCard?.cardName || selectedCard?.key || 'card';
    panel.querySelector('#move-list-header').textContent =
      `Choose destination — ${cardName} (${validMoves.length})`;
    listEl.innerHTML = '';
    if (!validMoves || validMoves.length === 0) {
      subEl.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'move-empty';
      empty.textContent = 'No valid moves';
      listEl.appendChild(empty);
    } else {
      subEl.textContent = 'Match the number on the TV board, then tap.';
      validMoves.forEach((tileId, i) => {
        const num = i + 1; // must match HexRenderer badge: position in payload
        const { terrain, icon, cost } = moveLabelFor(tileId);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'move-dest-btn';
        btn.dataset.tile = tileId;
        const numSpan = document.createElement('span');
        numSpan.className = 'move-dest-num';
        numSpan.textContent = String(num);
        const iconSpan = document.createElement('span');
        iconSpan.className = 'move-dest-icon';
        iconSpan.textContent = icon;
        const tileSpan = document.createElement('span');
        tileSpan.className = 'move-dest-tile';
        tileSpan.textContent = tileId;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'move-dest-meta';
        metaSpan.textContent = `${terrain} ×${cost}`;
        btn.appendChild(numSpan);
        btn.appendChild(iconSpan);
        btn.appendChild(tileSpan);
        btn.appendChild(metaSpan);
        btn.setAttribute('aria-label', `Option ${num}: ${terrain} cost ${cost} at ${tileId}`);
        btn.addEventListener('click', () => attemptMoveToTile(tileId));
        listEl.appendChild(btn);
      });
    }
    panel.classList.remove('hidden');
  }

  function clearMoveList() {
    const panel = document.getElementById('move-list-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    const listEl = panel.querySelector('#move-list');
    if (listEl) listEl.innerHTML = '';
  }

  function cancelMoveSelection() {
    const instanceId = selectedCard?.instanceId;
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    exitRubblePaymentMode();
    cardUI.updateSelectedCardForMovement(null);
    clearMoveList();
    if (instanceId) client.cancelCard(instanceId);
    else client.cancelCard();
  }

  // Shared destination tap: same rubble handling as board clicks, but works
  // without board navigation. Normal tiles emit move_pawn; cost-2+ rubble
  // goes through the existing move_to_rubble picker (Block 6 owns that flow).
  function attemptMoveToTile(tileId) {
    if (rubblePendingTileId) return;
    if (!selectedValidMoves.includes(tileId)) return;
    const tile = clientBoard.getTile(tileId);
    if (tile?.terrainType === 'rubble' && tile.movementCost > 1) {
      rubblePendingTileId = tileId;
      rubbleCardsNeeded = tile.movementCost - 1;
      cardUI.enterRubblePaymentMode(rubbleCardsNeeded, selectedCard?.instanceId, () => {
        const cardIds = cardUI.getRubblePaymentCards();
        client.moveToRubble(tileId, cardIds);
        isMidMove = false;
        selectedCard = null;
        selectedValidMoves = [];
        currentBreakableBlockades = [];
        renderer.clearHighlights();
        renderer.setBreakableBlockades([], []);
        clearMoveList();
        exitRubblePaymentMode();
      }, () => {
        exitRubblePaymentMode();
      });
      return;
    }
    if (isMidMove || selectedCard) {
      client.movePawn(tileId);
    }
  }

  // Waiting-room state
  let waitingRoomState = { players: [], maxPlayers: 2, hostId: null, enableBlockades: true };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setLobbyError(msg) {
    lobbyStatus.textContent = msg;
    lobbyStatus.style.color = '#e74c3c';
  }
  function setLobbyInfo(msg) {
    lobbyStatus.textContent = msg;
    lobbyStatus.style.color = '#aaa';
  }

  // ── Waiting-room rendering ─────────────────────────────────────────────────
  function renderWaitingRoom() {
    const { players, maxPlayers, hostId, enableBlockades } = waitingRoomState;
    roomCodeValue.textContent = client.roomId || '';
    waitingSubtitle.textContent = `${players.length} / ${maxPlayers} players joined`;
    waitingBlockadesNote.textContent = enableBlockades
      ? '🚧 Blockades enabled'
      : 'Blockades disabled';

    waitingPlayers.innerHTML = '';
    for (let i = 0; i < maxPlayers; i++) {
      const p = players[i];
      const row = document.createElement('div');
      row.className = 'waiting-player-row';
      const dot = document.createElement('span');
      dot.className = 'waiting-player-dot';
      dot.style.background = p ? PAWN_COLORS[i] : '#444';
      const name = document.createElement('span');
      name.className = 'waiting-player-name';
      name.textContent = p
        ? p.name + (p.id === hostId ? ' 👑' : '')
        : `Waiting for player ${i + 1}…`;
      name.style.color = p ? '#e0e0e0' : '#666';
      row.appendChild(dot);
      row.appendChild(name);
      waitingPlayers.appendChild(row);
    }

    const isHost = client.isHost;
    const canStart = isHost && (players.length >= 2 || (DEBUG && players.length >= 1));
    startGameBtn.disabled = !canStart;
    startGameBtn.style.opacity = canStart ? '1' : '0.4';
    startGameBtn.style.cursor = canStart ? 'pointer' : 'not-allowed';

    if (!isHost) {
      waitingHint.textContent = 'Waiting for the host to start…';
    } else if (players.length < 2 && !DEBUG) {
      waitingHint.textContent = 'Need at least 2 players to start.';
    } else if (players.length < 2 && DEBUG) {
      waitingHint.textContent = 'Debug mode: you can start solo or wait for others.';
    } else if (players.length < maxPlayers) {
      waitingHint.textContent = `You can start now, or wait for ${maxPlayers - players.length} more.`;
    } else {
      waitingHint.textContent = 'All players connected — ready to start!';
    }

    if (client.isSpectator) {
      waitingHint.textContent += ' (This TV display is spectating — it holds no seat.)';
    }
  }

  // ── Lobby events ───────────────────────────────────────────────────────────
  // ?view=tv tabs join as spectators: they get the room code and host powers
  // but occupy no player seat, pawn, or turn.
  function getLobbyName() {
    const typed = nameInput.value.trim();
    if (typed) return typed;
    return VIEW === 'tv' ? 'TV 📺' : 'Explorer';
  }

  createRoomBtn.addEventListener('click', () => {
    const name = getLobbyName();
    if (!name) { setLobbyError('Enter your name first.'); return; }
    setLobbyInfo('Creating room…');
    createRoomBtn.disabled = true;
    const enableBlockades = blockadesToggle?.checked ?? true;
    client.createRoom(name, selectedPlayerCount, DEBUG, enableBlockades, VIEW === 'tv');
  });

  joinRoomBtn.addEventListener('click', () => {
    const name = getLobbyName();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!name) { setLobbyError('Enter your name first.'); return; }
    if (!code) { setLobbyError('Enter a room code.'); return; }
    setLobbyInfo('Joining…');
    joinRoomBtn.disabled = true;
    client.joinRoom(name, code, VIEW === 'tv');
  });

  roomCodeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoomBtn.click();
  });

  copyCodeBtn.addEventListener('click', () => {
    const code = roomCodeValue.textContent;
    navigator.clipboard?.writeText(code).then(() => {
      copyCodeBtn.textContent = '✅';
      setTimeout(() => { copyCodeBtn.textContent = '📋'; }, 1500);
    });
  });

  startGameBtn.addEventListener('click', () => {
    if (!startGameBtn.disabled) client.startGame();
  });

  zoomInBtn?.addEventListener('click', () => {
    boardZoom = Math.min(BOARD_ZOOM_MAX, boardZoom + BOARD_ZOOM_STEP);
    updateBoardZoom();
  });
  zoomOutBtn?.addEventListener('click', () => {
    boardZoom = Math.max(BOARD_ZOOM_MIN, boardZoom - BOARD_ZOOM_STEP);
    updateBoardZoom();
  });

  if (DEBUG) {
    document.title += ' [DEBUG]';
    nameInput.value = 'Debug Player';
  }

  // ── Client callbacks ───────────────────────────────────────────────────────

  client.onJoined = (data) => {
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    setLobbyInfo('');
    waitingRoomState = {
      players: data.players || [],
      maxPlayers: data.maxPlayers,
      hostId: data.hostId,
      enableBlockades: data.enableBlockades ?? true,
    };
    showScreen('waiting');
    renderWaitingRoom();
  };

  client.onJoinError = ({ message }) => {
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    setLobbyError(message || 'Could not join room.');
  };

  client.onRoomUpdated = (data) => {
    if (data.players) waitingRoomState.players = data.players;
    if (data.maxPlayers) waitingRoomState.maxPlayers = data.maxPlayers;
    if (data.hostId) waitingRoomState.hostId = data.hostId;
    if (data.enableBlockades !== undefined) waitingRoomState.enableBlockades = data.enableBlockades;
    if (waitingScreen.classList.contains('active')) renderWaitingRoom();
  };

  client.onPlayerJoined = ({ player }) => log(`${player.name} joined.`);
  client.onPlayerLeft = ({ socketId }) => {
    const p = allPlayers.find(p => p.id === socketId);
    if (p) log(`${p.name} left.`);
  };

  // ── Game start ─────────────────────────────────────────────────────────────
  client.onGameStarted = ({ tiles, players, currentPlayerId, market, blockades }) => {
    showScreen('game');
    allPlayers = players;
    clientBoard.loadMap({ tiles });

    renderer.render(tiles);

    players.forEach((p, i) => {
      if (p.currentTileId) renderer.setPawnPosition(p.id, p.currentTileId, i);
    });

    // ── Blockades ────────────────────────────────────────────────────────────
    activeBlockades = blockades || [];
    blockadeEdgeLookup = activeBlockades.length > 0
      ? window.ElDoradoBlockades.buildEdgeLookup(activeBlockades)
      : null;
    renderer.renderBlockades(activeBlockades);

    cardUI.renderMarket(market);
    currentTurnPlayerId = currentPlayerId;
    updateTurnLabel(currentPlayerId);

    selectedCard = null;
    selectedValidMoves = [];
    clearMoveList();

    showToast('Expedition begun! Good luck.', { icon: '🗺️', type: 'accent' });
    log('Game started!', 'system');
  };

  // ── Blockade broken ────────────────────────────────────────────────────────
  client.onBlockadeBroken = ({ blockadeId, brokenByName, terrainType }) => {
    activeBlockades = activeBlockades.filter(b => b.id !== blockadeId);
    blockadeEdgeLookup = activeBlockades.length > 0
      ? window.ElDoradoBlockades.buildEdgeLookup(activeBlockades)
      : null;

    renderer.removeBlockade(blockadeId);

    const icon = BLOCKADE_TERRAIN_ICONS[terrainType] || '🚧';
    showToast(`${brokenByName} broke a ${terrainType} blockade!`, { icon, type: 'accent', duration: 4000 });
    log(`${brokenByName} broke the ${terrainType} blockade.`, 'blockade');
  };

  // ── Board ──────────────────────────────────────────────────────────────────
  function exitRubblePaymentMode() {
    rubblePendingTileId = null;
    rubbleCardsNeeded = 0;
    cardUI.exitRubblePaymentMode();
  }

  // Board taps (desktop/TV-host) and phone list taps share one path so the
  // server sees the same move_pawn / move_to_rubble events either way.
  renderer.onTileClick = (tileId) => attemptMoveToTile(tileId);

  // ── Blockade click ────────────────────────────────────────────────────────
  renderer.onBlockadeClick = (blockadeId) => {
    if (!currentBreakableBlockades.includes(blockadeId)) return;
    client.breakBlockade(blockadeId);
  };

  // ── Cards ──────────────────────────────────────────────────────────────────
  cardUI.onCardPlayed = (instanceId) => selectCardForMove(instanceId);
  cardUI.onEndTurn = () => client.endTurn();
  cardUI.onDiscardClicked = () => {
    // Guard: Discard with no movement card selected (e.g. while pooling for
    // the market) must be a no-op, not a TypeError on null.instanceId.
    if (!selectedCard?.instanceId) {
      showToast('Select a card first.', { icon: '🃏', type: 'info', duration: 2000 });
      return;
    }
    client.discardCard(selectedCard.instanceId);
  };
  cardUI.onMarketCard = ({ cardKey, handCardsUsed }) => client.purchaseCard(cardKey, handCardsUsed);

  // ── Server → UI ────────────────────────────────────────────────────────────
  client.onHandUpdated = ({ hand }) => {
    localHand = hand;
    cardUI.renderHand(hand);
    if (!isMidMove) {
      selectedCard = null;
      selectedValidMoves = [];
    }
  };

  client.onValidMoves = ({ validMoves, breakableBlockades = [] }) => {
    isMidMove = true;
    selectedValidMoves = validMoves || [];
    currentBreakableBlockades = breakableBlockades;
    renderer.setValidMoves(selectedValidMoves);
    renderer.setBreakableBlockades(breakableBlockades, activeBlockades);
    // Phone list mirrors the TV highlights, but only for the acting player.
    // Opponents/TV keep highlights only (panel stays hidden there).
    if (currentTurnPlayerId && currentTurnPlayerId === client.playerId) {
      renderMoveList(selectedValidMoves);
    } else if (!currentTurnPlayerId && client.playerId) {
      // Fallback before turn tracking is set (e.g. reconnect): show list only
      // when we just played a card this turn.
      if (selectedCard) renderMoveList(selectedValidMoves);
      else clearMoveList();
    } else {
      clearMoveList();
    }
  };

  client.onPawnMoved = ({ playerId, tileId }) => {
    const idx = allPlayers.findIndex(p => p.id === playerId);
    const player = allPlayers.find(p => p.id === playerId);
    if (player) player.currentTileId = tileId;
    renderer.setPawnPosition(playerId, tileId, idx >= 0 ? idx : 0);
    renderer.clearHighlights();
    // Chained moves re-render via the following valid_moves_updated; final
    // moves clear via onCardDisposed. Clear here to avoid stale taps.
    clearMoveList();

    if (playerId !== client.playerId) {
      const name = player?.name || 'Opponent';
      showToast(`${name} moved`, { icon: '👣', type: 'info' });
      log(`${name} moved to ${tileId}`, 'move');
    } else {
      log(`Moved to ${tileId}`, 'move');
    }
  };

  client.onCardDisposed = () => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    clearMoveList();
    exitRubblePaymentMode();
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    clearMoveList();
    // Block 5: never leave a stale purchase pool open on someone else's turn.
    if (nextPlayerId !== client.playerId) cardUI.closeMarket();
    currentTurnPlayerId = nextPlayerId;
    updateTurnLabel(nextPlayerId);
    log(`${nextPlayerName}'s turn.`, 'turn');

    if (nextPlayerId === client.playerId) {
      showToast('Your turn!', { icon: '⚡', type: 'accent', duration: 2000 });
    }
  };

  // ── Final round ────────────────────────────────────────────────────────────
  client.onFinalRoundStarted = ({ triggeredByPlayerId }) => {
    const trigger = allPlayers.find(p => p.id === triggeredByPlayerId);
    const triggerName = trigger?.name || 'A player';

    if (!document.getElementById('final-round-banner')) {
      const banner = document.createElement('div');
      banner.id = 'final-round-banner';
      banner.textContent = '⚑ Final Round — Someone Has Reached El Dorado';
      document.body.appendChild(banner);
    }

    showToast('Final round! Someone reached El Dorado.', { icon: '🏆', type: 'accent', duration: 6000 });

    if (client.playerId === triggeredByPlayerId) {
      const msg = '🏆 You reached El Dorado! Other players take their final turn.';
      showModal(msg);
      log(msg, 'win');
    } else {
      const msg = `${triggerName} reached El Dorado! Take your final turn.`;
      showModal(msg);
      log(msg, 'warn');
    }
  };

  // ── Block 5: phone market purchase (CardUI market pool mode) ───────────
  // Server broadcasts purchase_opened / purchase_closed to the whole room,
  // but pooling + buying is the acting player's job. Gate the overlay so TV
  // and opponent phones stay display-only while the buyer taps hand cards to
  // pool purchasingPower (live total) and taps an affordable card to emit
  // purchase_card. Pricing lives server-side (shared/cardData.js + GameState);
  // the client only sums for display. No pricing-logic changes here.
  function isMyActingTurn() {
    return !currentTurnPlayerId || currentTurnPlayerId === client.playerId;
  }

  function ensureMarketPhoneStyles() {
    if (VIEW !== 'phone' || document.getElementById('market-phone-styles')) return;
    const style = document.createElement('style');
    style.id = 'market-phone-styles';
    style.textContent = `
      body.view-phone #purchase-total { font-size: 1.05rem; font-weight: 800;
        white-space: nowrap; }
      body.view-phone #card-market { max-height: 82dvh; overflow-y: auto;
        -webkit-overflow-scrolling: touch; }
      body.view-phone .market-card { min-height: 44px; }
      body.view-phone .market-card-wrapper { min-height: 44px; }
      body.view-phone #market-header { position: sticky; top: 0; z-index: 2; }
      body.view-phone #reserve-picker-box { max-height: 86dvh; overflow-y: auto;
        -webkit-overflow-scrolling: touch; }
      body.view-phone #reserve-cards .market-card-wrapper { min-height: 44px; }
      body.view-phone #cancel-purchase-btn { min-height: 44px; padding: 0.5rem 1rem; }
    `;
    document.head.appendChild(style);
  }
  ensureMarketPhoneStyles();

  client.onMarketUpdated = ({ market }) => { cardUI.renderMarket(market); cardUI.showMarket(false); };
  client.onPurchaseOpened = ({ totalPurchasePower }) => {
    // Transmitter free pick: only the acting player's phone opens the market.
    // TV (spectator) and opponent phones ignore it and stay display-only.
    if (!isMyActingTurn()) return;
    cardUI.openMarketWithBonus(totalPurchasePower);
    if (VIEW === 'phone') {
      showToast('Transmitter: pick any market card FREE.', { icon: '📡', type: 'accent' });
    }
  };
  client.onPurchaseClosed = (data = {}) => {
    // Only the buyer closes; opponent/TV overlays (if any) are untouched.
    if (data.playerId && data.playerId !== client.playerId) return;
    cardUI.closeMarket();
  };
  client.onPromptRemove = ({ count }) => showModal(`Select ${count} card(s) to permanently remove from your deck.`);

  client.onGameWon = ({ playerId, blockadeCounts = {} }) => {
    const winner = allPlayers.find(p => p.id === playerId);
    const winnerName = winner?.name || 'Someone';
    const isMe = client.playerId === playerId;

    // Blockade tiebreaker display
    const totalBroken = Object.values(blockadeCounts).reduce((s, n) => s + n, 0);
    let blockadeMsg = '';
    if (totalBroken > 0) {
      const lines = allPlayers
        .map(p => `  ${p.name}: ${blockadeCounts[p.id] || 0} blockade token(s)`)
        .join('\n');
      blockadeMsg = `\n\nBlockade tokens (tiebreaker):\n${lines}`;
    }

    const msg = (isMe
      ? '🏆 You win! El Dorado is yours!'
      : `${winnerName} wins the race to El Dorado. Game over.`) + blockadeMsg;

    showModal(msg, false);
    log(isMe ? '🏆 You win!' : `${winnerName} wins!`, 'win');
    showToast(isMe ? '🏆 You win!' : `${winnerName} wins!`, {
      icon: '🏆', type: isMe ? 'accent' : 'info', duration: 8000,
    });
  };

  // ── Reserve picker ─────────────────────────────────────────────────────────
  client.onPromptReserveChoice = ({ soldOutKey, reserveCards }) => {
    // DM'd to the buyer only (GameManager routes by playerId): the sold-out
    // slot stays empty until they pick. Market overlay may already be closed
    // by market_updated/purchase_closed; the picker is a separate overlay.
    if (VIEW === 'phone') {
      showToast('Market slot empty — pick a reserve card.', { icon: '📦', type: 'accent', duration: 4000 });
    }
    cardUI.showReservePicker(soldOutKey, reserveCards, (chosenKey) => {
      client.chooseReserveCard(soldOutKey, chosenKey);
      log(`Added ${chosenKey.replace(/_/g, ' ')} to the market.`, 'purchase');
    });
  };

  // GameClient exposes no card_purchased hook, so listen on the raw socket
  // (main.js only — no GameClient.js change). Gives phones a confirmation
  // toast/log for own and opponent purchases.
  socket.on('card_purchased', ({ playerId, cardKey } = {}) => {
    const buyer = allPlayers.find(p => p.id === playerId);
    const buyerName = buyer?.name || 'Someone';
    const pretty = (cardKey || 'card').replace(/_/g, ' ');
    if (playerId === client.playerId) {
      showToast(`Purchased ${pretty}!`, { icon: '💰', type: 'accent' });
      log(`You purchased ${pretty}.`, 'purchase');
    } else {
      log(`${buyerName} purchased ${pretty}.`, 'purchase');
    }
  });

  client.onActionError = ({ message }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    clearMoveList();
    exitRubblePaymentMode();
    log(`⚠ ${message}`, 'warn');
    showToast(message, { icon: '⚠️', type: 'warn' });
    const handEl = document.getElementById('player-hand-ui');
    handEl.classList.remove('shake');
    void handEl.offsetWidth;
    handEl.classList.add('shake');
  };

  function selectCardForMove(instanceId) {
    const card = localHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    cardUI.updateSelectedCardForMovement(instanceId);

    if (selectedCard && selectedCard.instanceId === instanceId) {
      selectedCard = null;
      selectedValidMoves = [];
      currentBreakableBlockades = [];
      renderer.clearHighlights();
      renderer.setBreakableBlockades([], []);
      clearMoveList();
      exitRubblePaymentMode();
      cardUI.updateSelectedCardForMovement(null);
      client.cancelCard(instanceId);
      return;
    }

    const player = allPlayers.find(p => p.id === client.playerId);
    if (!player) {
      log('Unable to select card: player state is not ready.', 'warn');
      return;
    }

    if (card.movementTotal > 0 || card.specialEffect === ElDoradoConstants.CardEffect.NATIVE) {
      const moves = clientBoard.getValidMoves({
        currentTileId: player.currentTileId,
        playedCard: card,
        movesRemaining: card.movementTotal,
        wildCardTerrain: null,
        players: allPlayers,
        handSize: localHand.length,
        activeBlockades,
      });

      // Also preview which blockades this card can break
      const breakable = clientBoard.getBreakableBlockades({
        currentTileId: player.currentTileId,
        playedCard: card,
        movesRemaining: card.movementTotal,
        wildCardTerrain: null,
        activeBlockades,
      });

      selectedCard = card;
      selectedValidMoves = moves;
      currentBreakableBlockades = breakable;
      renderer.setValidMoves(moves);
      renderer.setBreakableBlockades(breakable, activeBlockades);

      if (moves.length === 0 && breakable.length === 0) {
        log('No valid moves available for that card.', 'warn');
      } else {
        const parts = [];
        if (moves.length > 0) parts.push(`${moves.length} move(s)`);
        if (breakable.length > 0) parts.push(`${breakable.length} blockade(s) breakable`);
        log(`Selected ${card.cardName || card.key}: ${parts.join(', ')}.`, 'system');
      }
    }

    client.playCard(instanceId);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function updateTurnLabel(currentPlayerId) {
    currentTurnPlayerId = currentPlayerId;
    const isMe = client.isMyTurn(currentPlayerId);
    const idx = allPlayers.findIndex(p => p.id === currentPlayerId);
    const p = allPlayers.find(p => p.id === currentPlayerId);
    const color = PAWN_COLORS[idx] || '#aaa';

    playerLabel.textContent = isMe ? '▶ Your turn' : `${p?.name || '?'}'s turn`;
    turnDot.style.background = color;
    turnBanner.style.color = color;
    turnBanner.style.borderColor = color;

    if (isMe) {
      turnBanner.classList.add('my-turn');
    } else {
      turnBanner.classList.remove('my-turn');
    }

    turnBanner.classList.remove('just-became-my-turn');
    void turnBanner.offsetWidth;
    if (isMe) turnBanner.classList.add('just-became-my-turn');

    handUI.classList.toggle('opponent-turn', !isMe);
    handUI.style.borderTopColor = isMe ? color : '#555';

    renderPlayerLegend(currentPlayerId);
    cardUI.setControlsEnabled(isMe);
  }

  function renderPlayerLegend(currentPlayerId) {
    legendEl.innerHTML = '';
    allPlayers.forEach((p, i) => {
      const isActive = p.id === currentPlayerId;
      const row = document.createElement('div');
      row.className = 'legend-row' + (isActive ? ' active-player' : '');

      const avatar = document.createElement('span');
      avatar.className = 'legend-avatar';
      avatar.style.background = PAWN_COLORS[i];
      avatar.textContent = _initials(p.name);

      const name = document.createElement('span');
      name.className = 'legend-name';
      name.textContent = p.name || `Player ${i + 1}`;

      const handCount = document.createElement('span');
      handCount.className = 'legend-hand-count';
      const hSize = (p.id === client.playerId) ? localHand.length : (p.handSize ?? 0);
      handCount.textContent = hSize;

      row.appendChild(avatar);
      row.appendChild(name);

      if (p.id === client.playerId) {
        const you = document.createElement('span');
        you.className = 'legend-you';
        you.textContent = 'you';
        row.appendChild(you);
      }

      row.appendChild(handCount);
      legendEl.appendChild(row);
    });
  }

  function showModal(message, showCancel = false) {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-cancel-btn').style.display = showCancel ? '' : 'none';
    overlay.classList.remove('hidden');
    document.getElementById('modal-confirm-btn').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-cancel-btn').onclick = () => overlay.classList.add('hidden');
  }

  // ── Debug mode ─────────────────────────────────────────────────────────────
  if (DEBUG) {
    const _origOnGameStarted = client.onGameStarted;
    client.onGameStarted = (data) => {
      _origOnGameStarted(data);
      appendDebugPanel();
    };
  }

  function appendDebugPanel() {
    if (document.getElementById('debug-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.innerHTML = `
      <button id="debug-toggle-btn" title="Minimize debug panel">—</button>
      <div class="debug-row">
        <input id="debug-hand-input" placeholder="explorer,scout,transmitter" />
        <button id="debug-set-hand-btn">Set Hand</button>
      </div>
      <div class="debug-row">
        <input id="debug-tile-input" placeholder="tile id e.g. 5_-11" />
        <button id="debug-teleport-btn">Teleport</button>
      </div>
      <div class="debug-row">
        <span class="debug-presets-label">Presets:</span>
        <button class="debug-preset" data-hand="transmitter,scout,scout,explorer">Transmitter</button>
        <button class="debug-preset" data-hand="pioneer,giant_machete,adventurer,prop_plane">Speed run</button>
        <button class="debug-preset" data-hand="scientist,travel_log,cartographer,compass">Purple hand</button>
      </div>
      <div>
        <button id="debug-btn">Debug State</button>
      </div>`;
    document.getElementById('game-screen').appendChild(panel);

    const toggleBtn = document.getElementById('debug-toggle-btn');
    toggleBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      toggleBtn.textContent = collapsed ? '▲' : '—';
      toggleBtn.title = collapsed ? 'Expand debug panel' : 'Minimize debug panel';
    });

    document.getElementById('debug-set-hand-btn').addEventListener('click', () => {
      const val = document.getElementById('debug-hand-input').value.trim();
      if (val) client.debugSetHand(val.split(',').map(s => s.trim()).filter(Boolean));
    });
    document.getElementById('debug-teleport-btn').addEventListener('click', () => {
      const tileId = document.getElementById('debug-tile-input').value.trim();
      if (tileId) client.debugTeleport(tileId);
    });
    panel.querySelectorAll('.debug-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const keys = btn.dataset.hand.split(',');
        client.debugSetHand(keys);
        document.getElementById('debug-hand-input').value = btn.dataset.hand;
      });
    });
    document.getElementById('debug-btn').addEventListener('click', () => client.debugState());

    const _origTileClick = renderer.onTileClick;
    renderer.onTileClick = (tileId, event) => {
      if (event?.shiftKey) { client.debugTeleport(tileId); return; }
      _origTileClick?.(tileId);
    };
  }
});