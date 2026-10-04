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
    updateTurnLabel(currentPlayerId);

    selectedCard = null;
    selectedValidMoves = [];

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

  renderer.onTileClick = (tileId) => {
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
        exitRubblePaymentMode();
      }, () => {
        exitRubblePaymentMode();
      });
      return;
    }

    if (isMidMove || selectedCard) {
      client.movePawn(tileId);
      return;
    }
  };

  // ── Blockade click ────────────────────────────────────────────────────────
  renderer.onBlockadeClick = (blockadeId) => {
    if (!currentBreakableBlockades.includes(blockadeId)) return;
    client.breakBlockade(blockadeId);
  };

  // ── Cards ──────────────────────────────────────────────────────────────────
  cardUI.onCardPlayed = (instanceId) => selectCardForMove(instanceId);
  cardUI.onEndTurn = () => client.endTurn();
  cardUI.onDiscardClicked = () => client.discardCard(selectedCard.instanceId);
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
  };

  client.onPawnMoved = ({ playerId, tileId }) => {
    const idx = allPlayers.findIndex(p => p.id === playerId);
    const player = allPlayers.find(p => p.id === playerId);
    if (player) player.currentTileId = tileId;
    renderer.setPawnPosition(playerId, tileId, idx >= 0 ? idx : 0);
    renderer.clearHighlights();

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
    exitRubblePaymentMode();
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
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

  client.onMarketUpdated = ({ market }) => { cardUI.renderMarket(market); cardUI.showMarket(false); };
  client.onPurchaseOpened = ({ totalPurchasePower }) => cardUI.openMarketWithBonus(totalPurchasePower);
  client.onPurchaseClosed = () => cardUI.closeMarket();
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
    cardUI.showReservePicker(soldOutKey, reserveCards, (chosenKey) => {
      client.chooseReserveCard(soldOutKey, chosenKey);
      log(`Added ${chosenKey.replace(/_/g, ' ')} to the market.`, 'purchase');
    });
  };

  client.onActionError = ({ message }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
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
      renderer.clearHighlights();
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