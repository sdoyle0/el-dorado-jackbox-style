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
  }
  // Block 9: QR deep link ?room=<CODE> (encoded as
  // http://<host-lan-ip>:<PORT>/?view=phone&room=<CODE>). Prefill only —
  // never auto-join here; the name is still typed once. Auto-join stays
  // exclusive to the Block 8 session rejoin below.
  const DEEP_LINK_ROOM = (() => {
    try {
      return (new URLSearchParams(window.location.search).get('room') || '').trim().toUpperCase();
    } catch (e) { return ''; }
  })();
  // Phone lobby is join-only: the TV hosts (Create Room), phones scan the QR
  // and join by code. Display-only — the create handler below stays intact
  // for desktop/TV. Waiting-room Start stays host-only; moving it to a phone
  // is a future block, not this view (you must join first).
  if (VIEW === 'phone') {
    document.getElementById('create-room-section')?.style.setProperty('display', 'none');
    document.getElementById('lobby-divider-or')?.style.setProperty('display', 'none');
  }
  // TV is host-only: it creates the room (as spectator-host), phones join by
  // code/QR. The Join block is pointless here at best, confusing at worst.
  if (VIEW === 'tv') {
    document.getElementById('join-room-section')?.style.setProperty('display', 'none');
    document.getElementById('lobby-divider-or')?.style.setProperty('display', 'none');
  }
  // Phone is boardless: the board lives on the TV and is hidden on phones
  // via CSS (body.view-phone #board-container). Moves, blockades, and the
  // market all work through tappable lists, so there is no Show-board toggle.
  // (Removed: the old board-collapsed toggle setup used to live here.)

  // TV board-first layout: Field Notes live behind a toggle (hidden by
  // default via CSS). Display-only; the log still updates underneath.
  document.getElementById('log-toggle-btn')?.addEventListener('click', (e) => {
    const open = document.body.classList.toggle('tv-log-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.title = open ? 'Hide Field Notes' : 'Show Field Notes';
  });

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
  const phoneTurnPill = document.getElementById('phone-turn-pill');
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
    // Cap stacked toasts: a flurry of events (or fast testing) shouldn't
    // bury the UI. Oldest goes first; the rest fade on their own timers.
    while (container.children.length >= 3) container.firstChild.remove();
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
  // Block 8: refresh resilience — set once a full server snapshot arrives
  // (game_snapshot); used to tell a mid-game rejoin from a fresh lobby join.
  let snapshotReceived = false;
  // Block 8 (7d hands-off TV): auto-dismiss timer for TV modals.
  let tvModalTimer = null;
  let selectedCard = null;
  let selectedValidMoves = [];
  // Rulebook p4: 1 buy per turn. Display gate only — the server flag is
  // authoritative. Set on own card_purchased, cleared on turn_ended /
  // game_started (server rejections still surface as action_error toasts).
  let hasPurchasedThisTurn = false;
  // Server-sent move budget (valid_moves_updated): lets the phone tell a
  // fresh "Cancel" (card returns) from a partial-move "Done moving" (card
  // is discarded, unused moves lost).
  let moveMovesRemaining = null;
  let moveMovementTotal = 0;
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
      #move-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
        gap: 0.5rem; max-height: 240px; overflow-y: auto; }
      .move-dest-btn { display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 0.15rem;
        width: 100%; min-height: 68px; padding: 0.5rem 0.4rem;
        border: 1px solid var(--border-mid, rgba(201,162,39,0.32));
        background: rgba(22,39,61,0.9); color: #e8e0d0; border-radius: 10px;
        cursor: pointer; font-weight: 600; text-align: center; }
      .move-dest-btn:hover { background: #1e3352; border-color: #c9a227; }
      .move-dest-btn:active { transform: translateY(1px); }
      .move-dest-num { display: inline-grid; place-items: center;
        min-width: 40px; height: 40px; border-radius: 50%;
        background: #000; color: #fff; border: 2px solid #fff;
        font-size: 1.35rem; font-weight: 800; flex-shrink: 0; }
      .move-dest-hint { font-size: 0.7rem; color: #9aabbf;
        font-weight: 600; white-space: nowrap; line-height: 1.1; }
      .move-dest-hint.is-warn { color: #ffcf9e; }
      .move-empty { font-size: 0.82rem; color: #ffaaaa; font-style: italic;
        padding: 0.35rem 0.1rem; }
      /* Block 6: breakable blockades share the move-list panel so the
         boardless phone can break without board taps (renderer.onBlockadeClick
         needs the TV board). Same grid + 68px button shape as moves above,
         kept orange-tinted so it's obvious this breaks a wall, not a move. */
      #blockade-list-header { font-size: 0.78rem; font-weight: 700; color: #ff9f43;
        letter-spacing: 0.03em; margin-top: 0.35rem; }
      #blockade-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
        gap: 0.5rem; }
      .blockade-break-btn { display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 0.15rem;
        width: 100%; min-height: 68px; padding: 0.5rem 0.4rem;
        border: 1px solid rgba(255,159,67,0.65);
        background: rgba(61,39,22,0.92); color: #e8e0d0; border-radius: 10px;
        cursor: pointer; font-weight: 600; text-align: center; }
      .blockade-break-btn:hover { background: #53341c; border-color: #ff9f43; }
      .blockade-break-btn:active { transform: translateY(1px); }
      .blockade-break-btn:disabled { opacity: 0.5; cursor: wait; }
      .blockade-break-icon { display: inline-grid; place-items: center;
        width: 40px; height: 40px; border-radius: 50%;
        background: #1a0e04; color: #fff; border: 2px solid #ff9f43;
        font-size: 1.25rem; font-weight: 800; flex-shrink: 0; }
      .blockade-break-label { font-size: 0.7rem; color: #ffd9b3;
        font-weight: 700; white-space: nowrap; line-height: 1.1;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
      .blockade-break-meta { font-size: 0.65rem; color: #ffcf9e;
        font-weight: 500; white-space: nowrap; line-height: 1.1; }
      /* Block 6: persistent Scientist/Travel Log remove prompt. The modal
         alone dismisses; this banner stays in #hand-messages until the server
         disposes the card, so it's clear hand taps remove (not move). */
      #remove-prompt-banner { padding: 0.55rem 0.7rem; border: 1px solid
        rgba(146,0,200,0.6); background: rgba(40,16,60,0.85);
        border-radius: 8px; font-size: 0.82rem; color: #e8d0ff; }
      #remove-prompt-banner strong { color: #fff; }
      /* Block 6: rubble toll buttons meet the 44px phone minimum. Desktop
         keeps the same sizes (harmless) — no separate phone stylesheet. */
      .rubble-prompt-actions button { min-height: 44px; font-size: 0.9rem !important; }
      .rubble-prompt-actions { display: flex; gap: 0.5rem; margin-top: 0.35rem; }
      #move-list-cancel { display: flex; align-items: center; gap: 0.6rem;
        width: 100%; min-height: 56px; padding: 0.5rem 0.6rem;
        border-radius: 10px; cursor: pointer; font-weight: 700; text-align: left; }
      #move-list-cancel.is-cancel { border: 1px solid rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.06); color: #e8e0d0; }
      #move-list-cancel.is-cancel:hover { background: rgba(255,255,255,0.12); }
      #move-list-cancel.is-done { border: 1px solid rgba(76,255,76,0.55);
        background: rgba(24,61,32,0.9); color: #eaffea; }
      #move-list-cancel.is-done:hover { background: #1e4d27; border-color: #4cff4c; }
      #move-list-cancel:active { transform: translateY(1px); }
      .move-cancel-icon { display: inline-grid; place-items: center;
        width: 40px; height: 40px; border-radius: 50%;
        font-size: 1.2rem; font-weight: 800; flex-shrink: 0; }
      #move-list-cancel.is-cancel .move-cancel-icon { background: #1c2530; color: #fff;
        border: 2px solid rgba(255,255,255,0.35); }
      #move-list-cancel.is-done .move-cancel-icon { background: #0d2812; color: #fff;
        border: 2px solid #4cff4c; }
      .move-cancel-text { display: flex; flex-direction: column; min-width: 0;
        line-height: 1.15; flex: 1 1 auto; }
      .move-cancel-label { font-size: 0.85rem; font-weight: 800;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .move-cancel-meta { font-size: 0.7rem; font-weight: 500;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #move-list-cancel.is-cancel .move-cancel-meta { color: #9aabbf; }
      #move-list-cancel.is-done .move-cancel-meta { color: #b8f5b8; }
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
      <div id="blockade-list-header" class="hidden">🚧 Break blockade</div>
      <div id="blockade-list"></div>
      <button id="move-list-cancel" type="button" class="is-cancel">
        <span class="move-cancel-icon" aria-hidden="true">↩</span>
        <span class="move-cancel-text">
          <span class="move-cancel-label">Cancel</span>
          <span class="move-cancel-meta">return card to hand</span>
        </span>
      </button>`;
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

  function blockadeLabelFor(blockadeId) {
    const b = activeBlockades.find(x => x.id === blockadeId);
    const terrain = b?.terrainType || 'unknown';
    const icon = BLOCKADE_TERRAIN_ICONS[terrain] || '🚧';
    const label = b?.label || blockadeId;
    return { terrain, icon, label };
  }

  function renderMoveList(validMoves, breakableIds = []) {
    const panel = ensureMoveListPanel();
    const listEl = panel.querySelector('#move-list');
    const subEl = panel.querySelector('#move-list-sub');
    const blockadeHeaderEl = panel.querySelector('#blockade-list-header');
    const blockadeListEl = panel.querySelector('#blockade-list');
    const cardName = selectedCard?.cardName || selectedCard?.key || 'card';
    const moveCount = validMoves ? validMoves.length : 0;
    const blockadeCount = breakableIds ? breakableIds.length : 0;
    // Budget tells a Jungle ×3 → ×1 question at a glance: header shows what
    // is left, each button's tiny hint shows what that option costs.
    const budget = (moveMovementTotal > 0 && typeof moveMovesRemaining === 'number')
      ? ` · ${moveMovesRemaining} left`
      : '';
    panel.querySelector('#move-list-header').textContent = `Choose — ${cardName}${budget}`;
    listEl.innerHTML = '';
    blockadeListEl.innerHTML = '';
    if (!validMoves || validMoves.length === 0) {
      subEl.textContent = blockadeCount > 0 ? 'No moves — break a blockade below.' : '';
      const empty = document.createElement('div');
      empty.className = 'move-empty';
      empty.textContent = 'No valid moves';
      listEl.appendChild(empty);
    } else {
      subEl.textContent = `Match the number on the TV, then tap.`;
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
        const hintSpan = document.createElement('span');
        hintSpan.className = 'move-dest-hint';
        // Tiny hint only — full "Jungle ×1" text and hex IDs are gone.
        // Camp removes the played card; cost-2+ rubble needs extra cards.
        if (terrain === 'camp') {
          hintSpan.textContent = '⛺ camp';
          hintSpan.classList.add('is-warn');
          hintSpan.title = 'Camp removes the played card';
        } else if (terrain === 'rubble' && Number(cost) > 1) {
          hintSpan.textContent = `🪨 ×${cost} +${Number(cost) - 1}`;
          hintSpan.classList.add('is-warn');
          hintSpan.title = `Rubble needs ${Number(cost) - 1} extra card(s)`;
        } else {
          hintSpan.textContent = `${icon} ×${cost}`;
          hintSpan.title = `${terrain} cost ${cost}`;
        }
        btn.appendChild(numSpan);
        btn.appendChild(hintSpan);
        btn.setAttribute('aria-label', `Option ${num}: ${terrain} cost ${cost} at ${tileId}`);
        btn.addEventListener('click', () => attemptMoveToTile(tileId));
        listEl.appendChild(btn);
      });
    }
    // Block 6: breakable blockades as tappable rows (phone has no board, so
    // renderer.onBlockadeClick is unreachable there). Server already accepts
    // break_blockade; this only exposes it in the list.
    if (breakableIds && breakableIds.length > 0) {
      blockadeHeaderEl.classList.remove('hidden');
      blockadeHeaderEl.textContent = `🚧 Break blockade — ${selectedCard?.cardName || selectedCard?.key || 'card'} (${breakableIds.length})`;
      breakableIds.forEach((blockadeId) => {
        const { terrain, icon, label } = blockadeLabelFor(blockadeId);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'blockade-break-btn';
        btn.dataset.blockade = blockadeId;
        const iconSpan = document.createElement('span');
        iconSpan.className = 'blockade-break-icon';
        iconSpan.textContent = '🚧';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'blockade-break-label';
        // Compact hint mirroring move buttons (`🌿 ×1`): terrain icon +
        // seam label only — full terrain name stays in the aria-label.
        labelSpan.textContent = `${icon} ${label}`;
        labelSpan.title = `${terrain} blockade ${label}`;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'blockade-break-meta';
        metaSpan.textContent = 'Break ×1';
        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);
        btn.appendChild(metaSpan);
        btn.setAttribute('aria-label', `Break ${terrain} blockade ${label}, costs 1 move`);
        btn.addEventListener('click', () => attemptBreakBlockade(blockadeId));
        blockadeListEl.appendChild(btn);
      });
    } else {
      blockadeHeaderEl.classList.add('hidden');
    }
    // "Cancel" returns the card to hand only while no moves are spent —
    // afterwards the server discards it, so label the button honestly.
    // Full-width action row in the same icon-circle + label/meta language as
    // the move/blockade buttons above — two lines solve the long-text problem
    // (`Done moving ✓ (discards Long Card Name)`) via ellipsis on the meta.
    const cancelBtn = panel.querySelector('#move-list-cancel');
    if (cancelBtn) {
      // Self-heal panels built by older code (plain-text button, no spans).
      if (!cancelBtn.querySelector('.move-cancel-label')) {
        cancelBtn.innerHTML = `
          <span class="move-cancel-icon" aria-hidden="true">↩</span>
          <span class="move-cancel-text">
            <span class="move-cancel-label">Cancel</span>
            <span class="move-cancel-meta">return card to hand</span>
          </span>`;
      }
      const iconEl = cancelBtn.querySelector('.move-cancel-icon');
      const labelEl = cancelBtn.querySelector('.move-cancel-label');
      const metaEl = cancelBtn.querySelector('.move-cancel-meta');
      if (moveMovementTotal > 0 && (moveMovesRemaining ?? moveMovementTotal) < moveMovementTotal) {
        cancelBtn.classList.remove('is-cancel');
        cancelBtn.classList.add('is-done');
        if (iconEl) iconEl.textContent = '✓';
        if (labelEl) labelEl.textContent = 'Done moving ✓';
        if (metaEl) {
          metaEl.textContent = `discards ${cardName} · ${moveMovesRemaining} left`;
          metaEl.title = `Forfeit remaining moves; ${cardName} is discarded.`;
        }
        cancelBtn.title = 'Forfeit remaining moves; the card is discarded.';
        cancelBtn.setAttribute('aria-label', `Done moving, discards ${cardName}`);
      } else {
        cancelBtn.classList.remove('is-done');
        cancelBtn.classList.add('is-cancel');
        if (iconEl) iconEl.textContent = '↩';
        if (labelEl) labelEl.textContent = 'Cancel';
        if (metaEl) {
          metaEl.textContent = 'return card to hand';
          metaEl.title = 'Return the card to your hand.';
        }
        cancelBtn.title = 'Return the card to your hand.';
        cancelBtn.setAttribute('aria-label', 'Cancel, return card to hand');
      }
    }
    panel.classList.remove('hidden');
  }

  function clearMoveList() {
    const panel = document.getElementById('move-list-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    const listEl = panel.querySelector('#move-list');
    if (listEl) listEl.innerHTML = '';
    const blockadeListEl = panel.querySelector('#blockade-list');
    if (blockadeListEl) blockadeListEl.innerHTML = '';
    const blockadeHeaderEl = panel.querySelector('#blockade-list-header');
    if (blockadeHeaderEl) blockadeHeaderEl.classList.add('hidden');
  }

  function cancelMoveSelection() {
    // Scientist / Travel Log removal has no Cancel — Done/Skip (finish_remove)
    // owns it. A stale move-list Cancel (or a double-tap race) must not clear
    // the banner or emit cancel_card: the server rejects that cancel while
    // selectingCardsToRemove > 0, and the optimistic clear desyncs us —
    // later hand taps look normal locally but the server eats them as
    // removals. Bail out and point at Done instead.
    if (pendingRemovals > 0 || pendingRemovalsTotal > 0) {
      showToast('Finish removing first — tap Done to keep the rest.', { icon: '🔬', type: 'info', duration: 3000 });
      log('Finish removing first — tap Done to keep the rest.', 'system');
      return;
    }
    const instanceId = selectedCard?.instanceId;
    const wasPartial = moveMovementTotal > 0
      && (moveMovesRemaining ?? moveMovementTotal) < moveMovementTotal;
    const doneCardName = selectedCard?.cardName || selectedCard?.key || 'card';
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    exitRubblePaymentMode();
    clearRemovePrompt();
    cardUI.updateSelectedCardForMovement(null);
    clearMoveList();
    syncDiscardButton();
    if (instanceId) client.cancelCard(instanceId);
    else client.cancelCard();
    if (wasPartial) {
      const msg = `${doneCardName} discarded — unused moves lost.`;
      log(msg, 'move');
      showToast(msg, { icon: '🃏', type: 'info', duration: 4000 });
    }
  }

  // Discard needs a selected movement card on your turn — otherwise the
  // button stays disabled so it can't be tapped with nothing to discard.
  function syncDiscardButton() {
    const btn = document.getElementById('discard-btn');
    if (!btn) return;
    const isMe = !!(currentTurnPlayerId && client.playerId
      && currentTurnPlayerId === client.playerId);
    const marketOpen = typeof cardUI.isMarketOpen === 'function'
      ? cardUI.isMarketOpen()
      : false;
    const busy = pendingRemovals > 0 || pendingRemovalsTotal > 0 || !!rubblePendingTileId;
    btn.disabled = !(isMe && selectedCard?.instanceId && !marketOpen && !busy);
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
        syncDiscardButton();
      }, () => {
        exitRubblePaymentMode();
        syncDiscardButton();
      });
      // Block 6: boardless phones get no board highlight for the toll, so say
      // it outright (desktop sees the same prompt in #hand-messages).
      log(`🪨 Rubble toll: pick ${rubbleCardsNeeded} extra card(s), then Cross Rubble.`, 'system');
      if (VIEW === 'phone') {
        showToast(`Rubble toll: pick ${rubbleCardsNeeded} extra card(s).`, { icon: '🪨', type: 'info', duration: 4000 });
      }
      syncDiscardButton();
      return;
    }
    if (isMidMove || selectedCard) {
      client.movePawn(tileId);
    }
  }

  // Block 6: phone blockade breaking. Desktop/TV-host taps the highlighted
  // blockade on the board (renderer.onBlockadeClick); phones have no board,
  // so the move-list panel renders the same breakableBlockades as buttons.
  // Server validates adjacency + terrain + turn — this only emits the event.
  function attemptBreakBlockade(blockadeId) {
    if (!currentBreakableBlockades.includes(blockadeId)) return;
    const btn = document.querySelector(`.blockade-break-btn[data-blockade="${blockadeId}"]`);
    if (btn) btn.disabled = true;
    client.breakBlockade(blockadeId);
  }

  // Scientist / Travel Log remove prompt. Server DMs prompt_remove_cards to
  // the acting player only (TV + opponents never see it). Each subsequent
  // hand tap is a removal while selectingCardsToRemove > 0. Rulebook says
  // "up to N", so the banner carries a Done button that emits finish_remove
  // to keep 0..N-1 removals and continue the turn. The modal alone
  // dismisses, so the banner persists in #hand-messages until the server
  // disposes the card — that makes clear hand taps remove instead of moving.
  let pendingRemovals = 0;
  let pendingRemovalsTotal = 0;
  // InstanceId of the Scientist / Travel Log being resolved. It stays in the
  // hand payload (server disposes it when removal ends) but it sits on the
  // table, not in hand — it must not be selectable as its own removal target.
  let pendingRemovalPlayedId = null;

  function showRemovePrompt(count, playedInstanceId = null) {
    pendingRemovals = count;
    pendingRemovalsTotal = count;
    if (playedInstanceId) pendingRemovalPlayedId = playedInstanceId;
    // Scientist/Travel Log have no movement — drop any stale move list so
    // its Cancel ("return card to hand") can't fire mid-removal.
    clearMoveList();
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    const host = document.getElementById('hand-messages');
    let banner = document.getElementById('remove-prompt-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'remove-prompt-banner';
      host.appendChild(banner);
    }
    // Mark the played card as "on the table" so it's visibly not a removal
    // candidate. Re-applied on every hand_updated while removal is active.
    if (pendingRemovalPlayedId) cardUI.updateSelectedCardForMovement(pendingRemovalPlayedId);
    updateRemovePromptText();
    syncDiscardButton();
  }

  function updateRemovePromptText() {
    const banner = document.getElementById('remove-prompt-banner');
    if (!banner) return;
    banner.innerHTML = '';
    const removed = Math.max(0, pendingRemovalsTotal - pendingRemovals);
    const strong = document.createElement('strong');
    strong.textContent = pendingRemovals > 0
      ? `🔬 Remove up to ${pendingRemovalsTotal} card(s) — ${pendingRemovals} left`
      : '🔬 Finishing…';
    const span = document.createElement('span');
    span.textContent = pendingRemovals > 0
      ? ` — tap another hand card to permanently remove it (${removed}/${pendingRemovalsTotal} removed; the played card itself can't be chosen).`
      : '';
    banner.appendChild(strong);
    banner.appendChild(span);
    if (pendingRemovals > 0) {
      const done = document.createElement('button');
      done.type = 'button';
      done.id = 'remove-prompt-done';
      done.textContent = removed === 0
        ? `Skip — remove none ✓`
        : `Done ✓ (keep the rest, ${removed} removed)`;
      done.title = 'Finish removing — keep the remaining cards and continue your turn.';
      done.setAttribute('aria-label', 'Done removing cards, keep the rest');
      done.style.cssText = 'display:flex;align-items:center;justify-content:center;'
        + 'width:100%;min-height:44px;margin-top:0.45rem;padding:0.5rem 0.6rem;'
        + 'border-radius:8px;border:1px solid rgba(76,255,76,0.55);'
        + 'background:rgba(24,61,32,0.9);color:#eaffea;'
        + 'font-weight:700;font-size:0.85rem;cursor:pointer;';
      done.addEventListener('click', () => {
        done.disabled = true;
        done.style.opacity = '0.5';
        client.finishRemove();
      });
      banner.appendChild(done);
    }
  }

  function clearRemovePrompt() {
    const wasRemoval = pendingRemovalsTotal > 0 || pendingRemovalPlayedId;
    pendingRemovals = 0;
    pendingRemovalsTotal = 0;
    pendingRemovalPlayedId = null;
    // Only touch the movement highlight if we were actually in removal —
    // otherwise a stray clear could wipe a legitimate movement selection.
    if (wasRemoval) cardUI.updateSelectedCardForMovement(null);
    document.getElementById('remove-prompt-banner')?.remove();
    if (typeof syncDiscardButton === 'function') {
      try { syncDiscardButton(); } catch (e) { /* early boot — button not ready */ }
    }
  }

  // Keep the desktop modal copy, but add the persistent banner + toast/log
  // so boardless phones know hand taps now remove (not move). Gated to the
  // acting player — TV/spectators and opponents ignore the DM'd event even
  // if a broadcast ever arrives (defence in depth with the server DM).
  function showRemovePromptWithModal(count, playerId, playedInstanceId = null) {
    // Server DMs prompt_remove_cards to the acting player only. Gate anyway
    // so a broadcast (or a stale snapshot) never pops the dialog on the TV
    // (spectator, playerId null) or on opponent phones.
    if (!client.playerId) return;
    if (playerId && playerId !== client.playerId) return;
    // Resync (e.g. server re-emit after a rejected cancel): banner already up
    // means the user is mid-removal — just correct the counts silently
    // instead of spamming another modal/toast/log.
    if (pendingRemovalsTotal > 0 && document.getElementById('remove-prompt-banner')) {
      pendingRemovals = count;
      pendingRemovalsTotal = Math.max(pendingRemovalsTotal, count);
      if (playedInstanceId) pendingRemovalPlayedId = playedInstanceId;
      if (pendingRemovalPlayedId) cardUI.updateSelectedCardForMovement(pendingRemovalPlayedId);
      updateRemovePromptText();
      syncDiscardButton();
      return;
    }
    showRemovePrompt(count, playedInstanceId);
    showModal(`Remove up to ${count} other card(s) from your hand permanently (the played card itself can't be chosen; Done keeps the rest).`);
    log(`🔬 Remove up to ${count}: tap another hand card to remove, or Done to keep the rest.`, 'system');
    if (VIEW === 'phone') {
      showToast(`Tap up to ${count} other card(s) to remove — or Done to skip.`, { icon: '🔬', type: 'accent', duration: 4000 });
    }
  }

  // ── Block 8: refresh-safe sessions ───────────────────────────────────────
  // After a phone/TV refresh, auto-rejoin the same room (same ?view= only —
  // a TV session must not hijack a phone tab). The server holds a
  // disconnected seat for ~2 min; reclaim is by room code + player name.
  const SESSION_KEY = 'eldorado.session';
  let pendingIdentity = null;
  let rejoinPending = false;
  let rejoinRoomId = null;
  let rejoinFallbackTimer = null;

  function storeSession(roomId, playerName, isSpectator) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        roomId, playerName, spectator: !!isSpectator, view: VIEW,
      }));
    } catch (e) { /* private mode — rejoin just won't survive refresh */ }
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
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

  // ── Block 9: QR-code join ────────────────────────────────────────────
  // Waiting room (+ TV, same DOM) shows a QR encoding
  // http://<host-lan-ip>:<PORT>/?view=phone&room=<CODE>. The LAN IP comes
  // from GET /api/server-info (never localhost: the TV tab may itself have
  // opened the server via localhost); pixels come from GET /api/qr (same
  // origin, no internet CDN, works offline). If the image fails, the URL
  // text below it keeps manual entry working.
  let joinQrUrl = '';
  let serverInfoCache = null;

  function ensureJoinQrStyles() {
    if (document.getElementById('join-qr-styles')) return;
    const style = document.createElement('style');
    style.id = 'join-qr-styles';
    style.textContent = `
      #join-qr-block { display: flex; flex-direction: column; align-items: center;
        gap: 0.35rem; margin: 0.6rem 0 0.2rem; }
      #join-qr-label { font-size: 0.85rem; color: #e8e0d0; margin: 0; }
      #join-qr-img { background: #fff; padding: 8px; border-radius: 8px;
        width: 180px; height: 180px; }
      #join-qr-url { font-size: 0.72rem; color: #9aabbf; word-break: break-all;
        text-align: center; margin: 0; max-width: 320px; }
    `;
    document.head.appendChild(style);
  }

  async function updateJoinQr() {
    ensureJoinQrStyles();
    const code = client.roomId;
    const img = document.getElementById('join-qr-img');
    const urlEl = document.getElementById('join-qr-url');
    if (!code || !img || !urlEl) return;
    let lanIp = null;
    let port = null;
    try {
      if (!serverInfoCache) {
        const r = await fetch('/api/server-info', { cache: 'no-store' });
        if (r.ok) serverInfoCache = await r.json();
      }
      lanIp = serverInfoCache?.lanIp || null;
      port = serverInfoCache?.port || null;
    } catch (e) { /* offline fallback below — URL text still shows */ }
    const host = lanIp || window.location.hostname || 'localhost';
    const portStr = String(port || window.location.port || '3000');
    const joinUrl = `http://${host}:${portStr}/?view=phone&room=${code}`;
    if (joinUrl === joinQrUrl && !img.classList.contains('hidden')) return;
    joinQrUrl = joinUrl;
    urlEl.textContent = joinUrl;
    img.onload = () => img.classList.remove('hidden');
    img.onerror = () => img.classList.add('hidden');
    img.src = `/api/qr?text=${encodeURIComponent(joinUrl)}`;
  }

  // ── Waiting-room rendering ─────────────────────────────────────────────────
  function renderWaitingRoom() {
    const { players, maxPlayers, hostId, enableBlockades } = waitingRoomState;
    roomCodeValue.textContent = client.roomId || '';
    updateJoinQr();
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
    // Any seated player (phone) or the host (TV) may start once the minimum
    // is met, so nobody walks back to the laptop after joining by phone.
    const canStartAs = isHost || !client.isSpectator;
    const enoughPlayers = players.length >= 2 || (DEBUG && players.length >= 1);
    const canStart = canStartAs && enoughPlayers;
    startGameBtn.disabled = !canStart;
    startGameBtn.style.opacity = canStart ? '1' : '0.4';
    startGameBtn.style.cursor = canStart ? 'pointer' : 'not-allowed';

    if (!enoughPlayers && !DEBUG) {
      waitingHint.textContent = 'Need at least 2 players to start.';
    } else if (!enoughPlayers && DEBUG) {
      waitingHint.textContent = 'Debug mode: you can start solo or wait for others.';
    } else if (players.length < maxPlayers) {
      waitingHint.textContent = isHost || !client.isSpectator
        ? `You can start now, or wait for ${maxPlayers - players.length} more.`
        : 'Waiting for the host to start…';
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
    // Manual intent wins over a stale Block 8 auto-rejoin (e.g. server
    // restarted, old room gone, auto-rejoin failed but left rejoinPending
    // set). Without this the next joined_room is swallowed by the rejoin
    // path and the lobby never advances to waiting.
    rejoinPending = false;
    rejoinRoomId = null;
    pendingIdentity = name; // Block 8: refresh-safe session
    const enableBlockades = blockadesToggle?.checked ?? true;
    client.createRoom(name, selectedPlayerCount, DEBUG, enableBlockades, VIEW === 'tv');
  });

  joinRoomBtn.addEventListener('click', () => {
    // Same-tab double Join (first attempt looked dead, or a manual join
    // racing Block 8 auto-rejoin) must not emit a second join_room.
    if (client.roomId) {
      showToast(`Already in room ${client.roomId} — waiting for the host to start.`, { icon: 'ℹ️', type: 'info' });
      return;
    }
    const name = getLobbyName();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!name) { setLobbyError('Enter your name first.'); return; }
    if (!code) { setLobbyError('Enter a room code.'); return; }
    setLobbyInfo('Joining…');
    joinRoomBtn.disabled = true;
    // Manual intent wins over a stale Block 8 auto-rejoin — see above.
    rejoinPending = false;
    rejoinRoomId = null;
    pendingIdentity = name; // Block 8: refresh-safe session
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
    storeSession(data.roomId, pendingIdentity || nameInput.value.trim(), data.isSpectator);
    // Keep ?room= in sync with the room actually joined. A stale ?room=
    // (e.g. scanned for a previous game, then joined a new code manually)
    // would otherwise block the next refresh's auto-rejoin and show the old
    // code with a blank name.
    try {
      const url = new URL(window.location.href);
      if (data.roomId) url.searchParams.set('room', String(data.roomId).toUpperCase());
      window.history.replaceState(null, '', url.pathname + url.search);
    } catch (e) { /* non-fatal — rejoin still works via sessionStorage */ }
    // Only the boot auto-rejoin reply takes the rejoin path — and only when
    // it matches the room we actually tried to rejoin. A stale rejoinPending
    // (e.g. auto-rejoin failed after a server restart, then the user manually
    // joined a NEW code) must fall through to the waiting room immediately.
    // Otherwise the lobby sits dead for 6s while the TV already shows the join.
    const isRejoinReply = rejoinPending && rejoinRoomId && data.roomId
      && String(data.roomId).toUpperCase() === String(rejoinRoomId).toUpperCase();
    if (isRejoinReply) {
      // Block 8: boot auto-rejoin after a refresh — skip the waiting room.
      // A mid-game server follows up with game_snapshot; otherwise (fresh
      // seat pre-game, or reclaim failed) fall back to the waiting room.
      rejoinPending = false;
      rejoinRoomId = null;
      showToast('Reconnected — syncing game state…', { icon: '🔄', type: 'info' });
      if (rejoinFallbackTimer) clearTimeout(rejoinFallbackTimer);
      rejoinFallbackTimer = setTimeout(() => {
        if (!snapshotReceived && !gameScreen.classList.contains('active')) {
          showScreen('waiting');
          renderWaitingRoom();
        }
      }, 6000);
      return;
    }
    rejoinPending = false;
    rejoinRoomId = null;
    if (rejoinFallbackTimer) { clearTimeout(rejoinFallbackTimer); rejoinFallbackTimer = null; }
    showScreen('waiting');
    renderWaitingRoom();
  };

  client.onJoinError = ({ message }) => {
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    // A failed boot auto-rejoin (stale room after a server restart, wrong
    // code, etc.) must not leave rejoinPending set — otherwise the NEXT
    // manual join/create is swallowed by the rejoin path and the lobby
    // appears stuck even though the server accepted the join.
    rejoinPending = false;
    rejoinRoomId = null;
    // Mid-game reclaim fails only when no grace-held seat matches: wrong
    // name, seat expired (>2 min), or never joined before start (no late
    // joins). Say so directly instead of the bare server text.
    if (message === 'Game already in progress') {
      setLobbyError('Game already in progress — rejoin with the exact same name within ~2 min, or start a new room. New players cannot join mid-game.');
    } else {
      setLobbyError(message || 'Could not join room.');
    }
  };

  client.onRoomUpdated = (data) => {
    if (data.players) waitingRoomState.players = data.players;
    if (data.maxPlayers) waitingRoomState.maxPlayers = data.maxPlayers;
    if (data.hostId) waitingRoomState.hostId = data.hostId;
    if (data.enableBlockades !== undefined) waitingRoomState.enableBlockades = data.enableBlockades;
    if (waitingScreen.classList.contains('active')) renderWaitingRoom();
    syncRoster(data.players);
  };

  // Block 8: mid-game roster sync. A reclaimed seat keeps its playerNumber
  // but gets a new socket id; an expired seat vanishes. Merge by seat so the
  // TV legend + turn label track the server roster across refreshes.
  // (Pre-game allPlayers is empty — waiting-room flow above owns that.)
  // Pawn tokens are keyed by socket id, so an id change or a removed seat
  // orphans the old token — syncPawns drops ghosts and re-seats reclaimers
  // (even when the tile is unchanged, e.g. still on the start tile).
  function syncRoster(players) {
    if (!players || allPlayers.length === 0) return;
    const bySeat = new Map(players.map(p => [p.playerNumber, p]));
    let turnIdChanged = false;
    allPlayers = allPlayers
      .filter(p => bySeat.has(p.playerNumber))
      .map(p => {
        const fresh = bySeat.get(p.playerNumber);
        if (p.id !== fresh.id && currentTurnPlayerId === p.id) {
          currentTurnPlayerId = fresh.id;
          turnIdChanged = true;
        }
        if (fresh.currentTileId && fresh.currentTileId !== p.currentTileId) {
          const idx = allPlayers.findIndex(q => q.playerNumber === fresh.playerNumber);
          renderer.setPawnPosition(fresh.id, fresh.currentTileId, idx >= 0 ? idx : 0);
        }
        return { ...p, ...fresh };
      });
    renderer.syncPawns(allPlayers);
    if (turnIdChanged) updateTurnLabel(currentTurnPlayerId);
    else renderPlayerLegend(currentTurnPlayerId);
  }

  client.onPlayerJoined = ({ player }) => log(`${player.name} joined.`);
  client.onPlayerLeft = ({ socketId, playerName, disconnected }) => {
    // Block 8: grace-held seats broadcast disconnected:true — the seat (and
    // any mid-turn state) survives ~2 min for a phone refresh.
    if (disconnected) {
      const p = allPlayers.find(p => p.id === socketId);
      const name = playerName || p?.name || 'A player';
      log(`${name} disconnected — seat held for ~2 min.`, 'warn');
      showToast(`${name} disconnected — holding seat…`, { icon: '📴', type: 'warn' });
      return;
    }
    const p = allPlayers.find(p => p.id === socketId);
    if (p) log(`${p.name} left.`);
    else if (playerName) log(`${playerName} left.`);
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

    hasPurchasedThisTurn = false;
    cardUI.setPurchaseLocked(false);
    selectedCard = null;
    selectedValidMoves = [];
    clearMoveList();
    syncDiscardButton();

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

    // Block 6: drop the broken entry from the phone list immediately so it
    // can't be double-tapped while the server's follow-up
    // valid_moves_updated / card_disposed is in flight.
    currentBreakableBlockades = currentBreakableBlockades.filter(id => id !== blockadeId);
    if (currentTurnPlayerId && currentTurnPlayerId === client.playerId && selectedCard) {
      renderMoveList(selectedValidMoves, currentBreakableBlockades);
    }

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
    // The button is also disabled in that state — this is just a safety net.
    if (!selectedCard?.instanceId) {
      showToast('Select a card first.', { icon: '🃏', type: 'info', duration: 2000 });
      return;
    }
    client.discardCard(selectedCard.instanceId);
  };
  cardUI.onMarketCard = ({ cardKey, handCardsUsed }) => {
    // Rulebook p4: 1 buy per turn (server enforces; this just saves a
    // round-trip and explains why the Buy buttons went dead).
    if (hasPurchasedThisTurn) {
      showToast('Only 1 card per turn — already bought this turn.', { icon: '💰', type: 'info', duration: 2500 });
      return;
    }
    client.purchaseCard(cardKey, handCardsUsed);
  };
  // Same toast when the CardUI-level lock eats the tap (desktop card click
  // returns before onMarketCard fires).
  cardUI.onPurchaseLocked = () => {
    showToast('Only 1 card per turn — already bought this turn.', { icon: '💰', type: 'info', duration: 2500 });
  };
  cardUI.onMarketOpened = (transmitterBonus = 0) => {
    // 1-buy-per-turn lock: explain immediately on open (browsing still
    // allowed, but pooling is disabled and Buys are dead).
    if (hasPurchasedThisTurn && !transmitterBonus) {
      showToast('Already bought this turn (1 per turn) — browsing only.', { icon: '💰', type: 'info', duration: 2500 });
    }
    // Removal owns the hand — opening the market mid-removal must not cancel
    // it (that desyncs into silent removals). Keep the banner; pooling can
    // wait until Done. Just drop any stale move highlights.
    if (pendingRemovals > 0 || pendingRemovalsTotal > 0) {
      clearMoveList();
      renderer.clearHighlights();
      renderer.setBreakableBlockades([], []);
      syncDiscardButton();
      return;
    }
    // Intention changed movement → buying: drop the movement panel so it
    // doesn't linger under the market, and cancel the played card so a
    // later move needs a fresh select.
    const hadSelection = !!selectedCard
      || selectedValidMoves.length > 0
      || currentBreakableBlockades.length > 0
      || !!rubblePendingTileId;
    if (!hadSelection) {
      clearMoveList();
      renderer.clearHighlights();
      renderer.setBreakableBlockades([], []);
      syncDiscardButton();
      return;
    }
    if (transmitterBonus > 0) {
      // Server-driven Transmitter free pick: the played card is already
      // disposed server-side — clear UI state only, never emit a cancel
      // (there is nothing to cancel, and the error toast would misfire).
      isMidMove = false;
      selectedCard = null;
      selectedValidMoves = [];
      currentBreakableBlockades = [];
      moveMovesRemaining = null;
      moveMovementTotal = 0;
      renderer.clearHighlights();
      renderer.setBreakableBlockades([], []);
      exitRubblePaymentMode();
      clearRemovePrompt();
      cardUI.updateSelectedCardForMovement(null);
      clearMoveList();
      syncDiscardButton();
      return;
    }
    cancelMoveSelection();
    syncDiscardButton();
  };
  cardUI.onMarketClosed = () => {
    syncDiscardButton();
  };

  // ── Server → UI ────────────────────────────────────────────────────────────
  client.onHandUpdated = ({ hand }) => {
    localHand = hand;
    cardUI.renderHand(hand);
    if (!isMidMove) {
      selectedCard = null;
      selectedValidMoves = [];
    }
    // Keep the played Scientist / Travel Log visibly "on the table" across
    // re-renders (draws + removals) so it doesn't read as a removal target.
    if (pendingRemovalsTotal > 0 && pendingRemovalPlayedId) {
      cardUI.updateSelectedCardForMovement(pendingRemovalPlayedId);
    }
    syncDiscardButton();
  };

  client.onValidMoves = ({ validMoves, breakableBlockades = [], movesRemaining, movementTotal }) => {
    // Scientist / Travel Log have no movement — the removal banner owns the
    // hand. Never render the move list (and its Cancel) on top of it.
    if (pendingRemovals > 0 || pendingRemovalsTotal > 0) {
      isMidMove = false;
      selectedValidMoves = [];
      currentBreakableBlockades = [];
      moveMovesRemaining = null;
      moveMovementTotal = 0;
      renderer.clearHighlights();
      renderer.setBreakableBlockades([], []);
      clearMoveList();
      return;
    }
    isMidMove = true;
    selectedValidMoves = validMoves || [];
    moveMovesRemaining = (typeof movesRemaining === 'number') ? movesRemaining : null;
    moveMovementTotal = movementTotal || 0;
    currentBreakableBlockades = breakableBlockades;
    renderer.setValidMoves(selectedValidMoves);
    renderer.setBreakableBlockades(breakableBlockades, activeBlockades);
    // Phone list mirrors the TV highlights, but only for the acting player.
    // Opponents/TV keep highlights only (panel stays hidden there).
    if (currentTurnPlayerId && currentTurnPlayerId === client.playerId) {
      renderMoveList(selectedValidMoves, currentBreakableBlockades);
    } else if (!currentTurnPlayerId && client.playerId) {
      // Fallback before turn tracking is set (e.g. reconnect): show list only
      // when we just played a card this turn.
      if (selectedCard) renderMoveList(selectedValidMoves, currentBreakableBlockades);
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

    // Block 6: camp has no board affordance on phones, so say what happened:
    // the played card leaves the game instead of being discarded.
    const landed = clientBoard.getTile(tileId);
    const isCamp = landed?.terrainType === 'camp';

    if (playerId !== client.playerId) {
      const name = player?.name || 'Opponent';
      showToast(`${name} moved`, { icon: '👣', type: 'info' });
      log(`${name} moved to ${tileId}`, 'move');
      if (isCamp) log(`⛺ ${name} camped — played card removed from the game.`, 'move');
    } else {
      log(`Moved to ${tileId}`, 'move');
      if (isCamp) {
        const msg = '⛺ Camp: that card is removed from the game.';
        log(msg, 'move');
        showToast(msg, { icon: '⛺', type: 'info', duration: 4000 });
      }
    }
  };

  client.onCardDisposed = () => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    moveMovesRemaining = null;
    moveMovementTotal = 0;
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    clearMoveList();
    clearRemovePrompt();
    exitRubblePaymentMode();
    syncDiscardButton();
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    // Ending your turn with a movement card in flight discards it (rules:
    // unused moves are lost) — say so, since the card just vanishes.
    const endedCard = (currentTurnPlayerId === client.playerId) ? selectedCard : null;
    const endedPartial = !!endedCard && moveMovementTotal > 0
      && (moveMovesRemaining ?? moveMovementTotal) < moveMovementTotal;
    const endedMovesLeft = moveMovesRemaining;
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    moveMovesRemaining = null;
    moveMovementTotal = 0;
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    clearMoveList();
    clearRemovePrompt();
    // Block 5: never leave a stale purchase pool open on someone else's turn.
    if (nextPlayerId !== client.playerId) cardUI.closeMarket();
    // Fresh turn → fresh buy (1 per turn). Covers both "my new turn" and
    // "opponent's turn started" so the flag is always correct when it
    // becomes my turn again.
    hasPurchasedThisTurn = false;
    cardUI.setPurchaseLocked(false);
    currentTurnPlayerId = nextPlayerId;
    updateTurnLabel(nextPlayerId);
    log(`${nextPlayerName}'s turn.`, 'turn');

    if (nextPlayerId === client.playerId) {
      showToast('Your turn!', { icon: '⚡', type: 'accent', duration: 2000 });
    }

    if (endedCard) {
      const name = endedCard.cardName || endedCard.key || 'card';
      const msg = endedPartial && typeof endedMovesLeft === 'number'
        ? `Turn ended — ${name} discarded, ${endedMovesLeft} unused move(s) lost.`
        : `Turn ended — ${name} discarded.`;
      log(msg, 'move');
      showToast(msg, { icon: '🃏', type: 'info', duration: 4000 });
    }
  };

  // ── Final round ────────────────────────────────────────────────────────────
  // Block 8: banner setup shared by the live event and the rejoin snapshot.
  // The banner is position:fixed (see main.css + tv-phone.css offsets), so on
  // phones it would otherwise sit on top of the top hand card. The CSS
  // reserves its height via body:has() — and a tap dismisses it entirely so
  // the cards are fully reachable.
  function ensureFinalRoundBanner() {
    if (!document.getElementById('final-round-banner')) {
      const banner = document.createElement('div');
      banner.id = 'final-round-banner';
      banner.textContent = '⚑ Final Round — Someone Has Reached El Dorado (tap to hide)';
      banner.title = 'Tap to hide';
      banner.setAttribute('role', 'button');
      banner.setAttribute('tabindex', '0');
      const dismiss = () => banner.remove();
      banner.addEventListener('click', dismiss);
      banner.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismiss(); }
      });
      document.body.appendChild(banner);
    }
  }

  client.onFinalRoundStarted = ({ triggeredByPlayerId }) => {
    const trigger = allPlayers.find(p => p.id === triggeredByPlayerId);
    const triggerName = trigger?.name || 'A player';

    ensureFinalRoundBanner();

    showToast('Final round! Someone reached El Dorado.', { icon: '🏆', type: 'accent', duration: 6000 });

    // No modal: nobody is at the TV/laptop to click OK once play has started,
    // the banner already announces the final round, and a modal would block
    // the acting player's final turn on phones until dismissed.
    if (client.playerId === triggeredByPlayerId) {
      const msg = '🏆 You reached El Dorado! Other players take their final turn.';
      log(msg, 'win');
    } else {
      const msg = `${triggerName} reached El Dorado! Take your final turn.`;
      log(msg, 'warn');
    }
  };

  // Block 8: full-state sync after a mid-game (re)join — refreshed phone or
  // TV. Same rendering as onGameStarted, but with a "synced" toast plus the
  // restored final-round banner / game-won modal (with blockade counts)
  // instead of the "Expedition begun" one.
  // Raw socket.on like card_purchased below (main.js only, no GameClient.js change).
  socket.on('game_snapshot', (snap = {}) => {
    snapshotReceived = true;
    if (rejoinFallbackTimer) { clearTimeout(rejoinFallbackTimer); rejoinFallbackTimer = null; }
    showScreen('game');
    // Refresh/reconnect path (not game_started): re-ensure the debug panel
    // so ?debug testers keep it after a phone refresh. No-op if present.
    if (DEBUG) appendDebugPanel();
    allPlayers = snap.players || [];
    clientBoard.loadMap({ tiles: snap.tiles || [] });

    renderer.render(snap.tiles || []);

    (snap.players || []).forEach((p, i) => {
      if (p.currentTileId) renderer.setPawnPosition(p.id, p.currentTileId, i);
    });

    activeBlockades = snap.blockades || [];
    blockadeEdgeLookup = activeBlockades.length > 0
      ? window.ElDoradoBlockades.buildEdgeLookup(activeBlockades)
      : null;
    renderer.renderBlockades(activeBlockades);

    if (snap.market) cardUI.renderMarket(snap.market);
    currentTurnPlayerId = snap.currentPlayerId || null;
    // 1-buy-per-turn lock for rejoiners (see game_snapshot purchasedThisTurn).
    hasPurchasedThisTurn = !!snap.purchasedThisTurn;
    cardUI.setPurchaseLocked(hasPurchasedThisTurn);
    selectedCard = null;
    selectedValidMoves = [];
    moveMovesRemaining = null;
    moveMovementTotal = 0;
    clearMoveList();
    updateTurnLabel(currentTurnPlayerId);
    syncDiscardButton();

    if (snap.finalRound && snap.finalRound.triggered) ensureFinalRoundBanner();

    showToast('Game state synced.', { icon: '🔄', type: 'accent' });
    log('Reconnected — game state synced.', 'system');

    if (snap.gameOver && snap.gameOver.winnerId) {
      client.onGameWon({
        playerId: snap.gameOver.winnerId,
        blockadeCounts: snap.gameOver.blockadeCounts || {},
        finishers: snap.gameOver.finishers || [],
        firstFinisherId: snap.gameOver.firstFinisherId || null,
      });
    }
  });

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
      /* Phone market = in-flow sticky sheet at the top of the game column:
         it pushes the hand down instead of overlapping it (a fixed overlay
         would cover the hand's name/value strips on small screens, and the
         page isn't always scrollable so a scroll-nudge can't fix that).
         Desktop keeps the centered fixed overlay. */
      body.view-phone #card-market { position: sticky !important; top: 0 !important;
        left: auto !important; right: auto !important; bottom: auto !important;
        inset: auto !important; margin: 0 !important; width: auto !important;
        height: auto !important; max-height: 42dvh !important;
        flex: none !important;
        display: flex; flex-direction: column; overflow: hidden;
        border-radius: 0 0 12px 12px !important;
        border-top: none !important;
        border-bottom: 2px solid var(--gold-dim) !important;
        z-index: 30 !important;
        -webkit-overflow-scrolling: touch; }
      /* Header is normal in-flow content (not sticky/overlay) so it never
         covers the rows. Only #shop-slots scrolls; header + chips stay visible. */
      body.view-phone #market-header { position: static; flex: none;
        background: linear-gradient(180deg, #0d1e30 0%, #091525 100%);
        padding-top: 0.7rem; }
      body.view-phone #transmitter-banner, body.view-phone #pool-chips, body.view-phone #purchase-locked-banner { flex: none; }
      body.view-phone #shop-slots { flex: 1 1 auto; min-height: 0; overflow-y: auto;
        -webkit-overflow-scrolling: touch; }
      body.view-phone #purchase-total { font-size: 1.05rem; font-weight: 800;
        white-space: nowrap; }
      body.view-phone #cancel-purchase-btn { min-height: 44px; padding: 0.5rem 1rem; }
      body.view-phone #shop-slots { flex-direction: column; }
      body.view-phone .market-reserve-section { border-left: none;
        border-top: 1px solid var(--border); padding-left: 0; }
      /* Compact rows replace card art on phone. */
      body.view-phone .market-row-list { display: flex; flex-direction: column;
        gap: 0.35rem; }
      body.view-phone .market-row-item { display: flex; flex-direction: column;
        align-items: stretch; gap: 0.2rem; min-height: 44px; padding: 0.35rem 0.55rem;
        border: 1px solid var(--border-mid, rgba(201,162,39,0.32));
        border-left-width: 4px;
        background: rgba(22,39,61,0.9); color: #e8e0d0; border-radius: 8px; }
      /* Line 1: same slots for every card (name · [moves] · left · cost · Buy).
         Line 2 (specials only): ℹ️ + effect one-liner grouped on the left,
         clear of the Buy button above. */
      /* Terrain colour reference: left border per card terrain (matches the
         header-strip bars on hand/full cards). Hues are the HexRenderer
         TERRAIN inner-face fills, not neon — one consistent mapping
         everywhere. Wild gets a transparent edge:
         it matches ANY terrain, so any single colour would imply the wrong
         tile — grey read as rubble-grey. */
      body.view-phone .market-row-item.terrain-jungle { border-left-color: #347a20; }
      body.view-phone .market-row-item.terrain-water { border-left-color: #2068b0; }
      body.view-phone .market-row-item.terrain-village { border-left-color: #c08828; }
      body.view-phone .market-row-item.terrain-wild { border-left-color: transparent; }
      body.view-phone .market-row-item.terrain-empty { border-left-color: #9050e0; }
      body.view-phone .market-row-main { display: flex; align-items: center;
        gap: 0.5rem; width: 100%; }
      body.view-phone .market-row-sub { display: flex; align-items: center;
        gap: 0.5rem; width: 100%; padding-left: 0; }
      body.view-phone .market-row-sub .market-row-effect { flex: 1 1 auto; min-width: 0; }
      /* Movement value: what the card does for green/blue/yellow. */
      body.view-phone .market-row-moves { font-weight: 800; font-size: 0.9rem;
        white-space: nowrap; flex-shrink: 0; }
      body.view-phone .market-row-item.can-afford {
        box-shadow: 0 0 0 2px #3adf3a, 0 2px 10px rgba(58,223,58,0.2); }
      body.view-phone .market-row-item.cant-afford { opacity: 0.7; }
      body.view-phone .market-row-name { font-weight: 700; font-size: 0.85rem;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      body.view-phone .market-row-effect { font-size: 0.7rem; color: #9aabbf; }
      /* Push amount-left/cost/Buy to the right so line 1 lines up whether or
         not the card has a moves value or a line-2 effect. */
      body.view-phone .market-row-left { font-size: 0.68rem; color: #9aabbf;
        white-space: nowrap; margin-left: auto; flex-shrink: 0; }
      body.view-phone .market-row-cost { font-size: 0.8rem; font-weight: 800;
        color: #ffd700; white-space: nowrap; flex-shrink: 0; }
      /* .card-info-btn is absolute-positioned for full cards (main.css) —
         rows need it back in normal flow, or it floats above its row.
         On line 2 it stays compact so the extra-info row doesn't bloat. */
      body.view-phone .market-row-main .market-row-buy { margin-left: 0; }
      body.view-phone .reserve-pick-row .market-row-main .market-row-buy { margin-left: auto; }
      body.view-phone .market-row-sub .market-row-info { position: static; min-width: 32px; min-height: 32px;
        display: inline-grid; place-items: center; font-size: 1rem;
        cursor: pointer; flex-shrink: 0; }
      body.view-phone .market-row-buy { min-height: 44px; padding: 0.5rem 0.9rem;
        border: 1px solid var(--gold-mid, #c9a227); background: #2a4a2a;
        color: #fff; border-radius: 6px; font-size: 0.85rem; font-weight: 700;
        cursor: pointer; flex-shrink: 0; }
      body.view-phone .market-row-buy:disabled { opacity: 0.35; cursor: not-allowed; }
      /* Pool audit chips under the header. */
      body.view-phone #pool-chips { display: flex; flex-wrap: wrap; gap: 0.3rem;
        padding: 0.35rem 0; }
      body.view-phone #pool-chips.hidden { display: none; }
      body.view-phone .pool-chip { display: inline-flex; align-items: center;
        gap: 0.4rem; min-height: 44px; padding: 0.4rem 0.6rem;
        border: 1px solid var(--gold-mid, #c9a227); border-radius: 999px;
        background: rgba(201,162,39,0.15); color: #ffe066; font-size: 0.75rem;
        font-weight: 600; cursor: pointer; }
      body.view-phone .pool-chip-x { font-weight: 800; }
      /* Pool-value badges on hand cards (market mode only). */
      body.view-phone #hand-cards .card-btn { position: relative; }
      body.view-phone .pool-value-badge { position: absolute; top: 2px; right: 2px;
        z-index: 3; min-width: 44px; min-height: 28px; display: inline-grid;
        place-items: center; padding: 0 0.4rem; border-radius: 999px;
        background: #000; color: #ffd700; border: 2px solid #ffd700;
        font-size: 0.8rem; font-weight: 800; pointer-events: none; }
      body.view-phone #reserve-picker-box { max-height: 86dvh; overflow-y: auto;
        -webkit-overflow-scrolling: touch; }
      body.view-phone #reserve-cards { flex-direction: column; }
      body.view-phone #reserve-cards .market-row-item { width: 100%; }
      body.view-phone .card-info-modal-close { min-height: 44px; }
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
    showToast('Transmitter: pick ANY card FREE — Market + Reserve below.', { icon: '📡', type: 'accent' });
  };
  client.onPurchaseClosed = (data = {}) => {
    // Only the buyer closes; opponent/TV overlays (if any) are untouched.
    if (data.playerId && data.playerId !== client.playerId) return;
    cardUI.closeMarket();
  };
  client.onPromptRemove = ({ count, playerId, playedInstanceId }) => showRemovePromptWithModal(count, playerId, playedInstanceId);

  client.onGameWon = ({ playerId, blockadeCounts = {}, finishers = [], firstFinisherId = null }) => {
    const winner = allPlayers.find(p => p.id === playerId);
    const winnerName = winner?.name || 'Someone';
    const isMe = client.playerId === playerId;

    // Blockade tiebreaker display (rulebook p5: most tokens wins when several
    // players reach El Dorado in the final round).
    const totalBroken = Object.values(blockadeCounts).reduce((s, n) => s + n, 0);
    let blockadeMsg = '';
    if (totalBroken > 0) {
      const lines = allPlayers
        .map(p => `  ${p.name}: ${blockadeCounts[p.id] || 0} blockade token(s)`)
        .join('\n');
      blockadeMsg = `\n\nBlockade tokens (tiebreaker):\n${lines}`;
    }

    const finisherIds = (finishers && finishers.length > 0)
      ? finishers
      : (firstFinisherId ? [firstFinisherId] : [playerId]);
    const firstId = firstFinisherId || finisherIds[0];
    const first = allPlayers.find(p => p.id === firstId);
    const firstName = first?.name || winnerName;
    const tied = finisherIds.length > 1;

    let headline;
    if (!tied) {
      headline = isMe
        ? '🏆 You win! El Dorado is yours!'
        : `${winnerName} wins the race to El Dorado. Game over.`;
    } else if (playerId === firstId) {
      // First to arrive also holds the tiebreak (most — or tied-most — tokens).
      headline = isMe
        ? '🏆 You reached El Dorado first and hold the tiebreak — you win!'
        : `${winnerName} reached El Dorado first and holds the blockade tiebreak. Game over.`;
    } else {
      // An outright tiebreak overtake: say who was first and by what count,
      // so "Shawn wins but Maggie had more tokens" can never confuse again.
      const winnerCount = blockadeCounts[playerId] ?? 0;
      const firstCount = blockadeCounts[firstId] ?? 0;
      headline = isMe
        ? `🏆 You win on the blockade tiebreak (${winnerCount} vs ${firstName} ${firstCount})! Both reached El Dorado.`
        : `${winnerName} wins on the blockade tiebreak (${winnerCount} vs ${firstName} ${firstCount})! Both reached El Dorado. Game over.`;
    }

    const msg = headline + blockadeMsg;

    showModal(msg, false, true);
    log(isMe ? `🏆 ${headline}` : `${winnerName} wins!`, 'win');
    if (tied) log(`Both reached El Dorado — blockade tiebreak decides it.`, 'win');
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
      hasPurchasedThisTurn = true;
      cardUI.setPurchaseLocked(true);
      showToast(`Purchased ${pretty}!`, { icon: '💰', type: 'accent' });
      log(`You purchased ${pretty}.`, 'purchase');
    } else {
      // Phones hide the log, so purchases need a toast — otherwise nobody
      // notices the market changed behind the scenes.
      showToast(`${buyerName} bought ${pretty}.`, { icon: '💰', type: 'info' });
      log(`${buyerName} purchased ${pretty}.`, 'purchase');
    }
  });

  // A reserve card entering the market is otherwise invisible to everyone but
  // the buyer (market_updated just re-renders). Raw socket.on, main.js only.
  socket.on('reserve_replenished', ({ playerId, soldOutKey, chosenKey } = {}) => {
    const p = allPlayers.find(p => p.id === playerId);
    const name = p?.name || 'Someone';
    const pretty = (k) => (k || 'card').replace(/_/g, ' ');
    const isMe = playerId === client.playerId;
    const msg = isMe
      ? `You stocked ${pretty(chosenKey)} (replacing sold-out ${pretty(soldOutKey)}).`
      : `${name} stocked ${pretty(chosenKey)} (replacing sold-out ${pretty(soldOutKey)}).`;
    showToast(isMe ? `Stocked ${pretty(chosenKey)}!` : msg, {
      icon: '📦', type: isMe ? 'accent' : 'info',
    });
    log(msg, 'purchase');
  });

  client.onActionError = ({ message }) => {
    // Removal taps decrement the banner optimistically. If the server
    // rejects a tap (stale card, or the played card itself), undo one step
    // instead of nuking the whole removal session — the server count is
    // unchanged.
    if (pendingRemovalsTotal > 0
      && (message === 'card not in hand'
        || message === 'cannot remove the played card itself')
      && pendingRemovals < pendingRemovalsTotal) {
      pendingRemovals = Math.min(pendingRemovalsTotal, pendingRemovals + 1);
      updateRemovePromptText();
      syncDiscardButton();
      if (message === 'cannot remove the played card itself') {
        log(`🔬 The played card itself can't be removed — pick another card or Done.`, 'system');
        showToast(`Played card can't be removed — pick another, or Done.`, { icon: '🔬', type: 'info', duration: 3000 });
      } else {
        log(`⚠ ${message}`, 'warn');
        showToast(message, { icon: '⚠️', type: 'warn' });
      }
      return;
    }
    // Cancel is rejected mid-removal ("finish or skip card removal first").
    // The server count is unchanged — keep the banner so later taps still
    // route to removal instead of desyncing into silent removals.
    if (pendingRemovalsTotal > 0
      && (message === 'finish or skip card removal first'
        || message === 'nothing to finish'
        || message === 'nothing to cancel')) {
      updateRemovePromptText();
      syncDiscardButton();
      log(`🔬 Still removing — tap hand cards or Done to keep the rest.`, 'system');
      showToast('Finish removing first — tap Done to keep the rest.', { icon: '🔬', type: 'info', duration: 3000 });
      return;
    }
    // Any other error mid-removal also leaves the server count unchanged
    // (only finish_remove, the final removal, or end-turn clears it — none
    // of which surface as action_error). Never drop the banner here; that
    // desync is exactly the "later taps silently remove" bug.
    if (pendingRemovalsTotal > 0) {
      updateRemovePromptText();
      syncDiscardButton();
      log(`⚠ ${message}`, 'warn');
      showToast(message, { icon: '⚠️', type: 'warn' });
      return;
    }
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    currentBreakableBlockades = [];
    moveMovesRemaining = null;
    moveMovementTotal = 0;
    renderer.clearHighlights();
    renderer.setBreakableBlockades([], []);
    clearMoveList();
    clearRemovePrompt();
    exitRubblePaymentMode();
    syncDiscardButton();
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

    // Scientist / Travel Log removal mode — every hand tap is a permanent
    // removal (server-side selectingCardsToRemove), not a movement play.
    // Skip move preview so no stale highlights/list appear; decrement the
    // banner optimistically (server corrects via card_disposed/error).
    // "Up to N" skips go through the banner's Done button (finish_remove).
    if (pendingRemovals > 0) {
      // The played card sits on the table, not in hand — it can't be its own
      // removal target. Block locally (no decrement, no emit) so the banner
      // count stays correct; the server rejects it too as defence in depth.
      if (pendingRemovalPlayedId && instanceId === pendingRemovalPlayedId) {
        const playedName = card.cardName || card.key || 'that card';
        showToast(`${playedName} is already played — pick another card, or Done.`, { icon: '🔬', type: 'info', duration: 3000 });
        log(`🔬 ${playedName} is already played and can't be removed as its own target — pick another card or Done.`, 'system');
        return;
      }
      pendingRemovals = Math.max(0, pendingRemovals - 1);
      updateRemovePromptText();
      client.playCard(instanceId);
      return;
    }

    // Final removal sent, waiting for the server's card_disposed to clear the
    // banner ("Finishing…"). Swallow hand taps until then — a fresh play here
    // would have its valid-moves panel suppressed by the removal guard anyway.
    if (pendingRemovalsTotal > 0) {
      showToast('Finishing removal…', { icon: '🔬', type: 'info', duration: 1500 });
      return;
    }

    cardUI.updateSelectedCardForMovement(instanceId);

    if (selectedCard && selectedCard.instanceId === instanceId) {
      selectedCard = null;
      selectedValidMoves = [];
      currentBreakableBlockades = [];
      moveMovesRemaining = null;
      moveMovementTotal = 0;
      renderer.clearHighlights();
      renderer.setBreakableBlockades([], []);
      clearMoveList();
      exitRubblePaymentMode();
      cardUI.updateSelectedCardForMovement(null);
      syncDiscardButton();
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

    syncDiscardButton();
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
    if (phoneTurnPill) {
      phoneTurnPill.textContent = isMe ? '▶ Your turn — play a card' : `Waiting for ${p?.name || '?'}…`;
      phoneTurnPill.classList.toggle('is-my-turn', isMe);
    }
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
    syncDiscardButton();
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

  // Block 8: first 7d hands-off-TV pickup — TV modals auto-dismiss (nobody
  // is at the laptop to click OK mid-game). Game-won (sticky) stays up as
  // the end screen. Phones are unaffected.
  function showModal(message, showCancel = false, sticky = false) {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-cancel-btn').style.display = showCancel ? '' : 'none';
    overlay.classList.remove('hidden');
    document.getElementById('modal-confirm-btn').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-cancel-btn').onclick = () => overlay.classList.add('hidden');
    if (tvModalTimer) { clearTimeout(tvModalTimer); tvModalTimer = null; }
    if (VIEW === 'tv' && !sticky) {
      tvModalTimer = setTimeout(() => overlay.classList.add('hidden'), 6000);
    }
  }

  // ── Block 8: boot auto-rejoin after a refresh ────────────────────────────
  // Same ?view= only. Socket.IO buffers the emit until connected. onJoined
  // skips the waiting room while we wait for game_snapshot (with a fallback
  // for pre-game seats, which get no snapshot).
  // Block 9: a ?room= deep link prefills the code box but never auto-joins
  // (name still typed once). A link to a *different* room wins over a stale
  // session — don't auto-join the old room underneath the scanned one.
  (function tryAutoRejoin() {
    if (DEEP_LINK_ROOM) roomCodeInput.value = DEEP_LINK_ROOM;
    const sess = readSession();
    if (!sess || !sess.roomId || sess.view !== VIEW) return;
    if (!sess.playerName && VIEW !== 'tv') return;
    if (DEEP_LINK_ROOM && String(sess.roomId).toUpperCase() !== DEEP_LINK_ROOM) {
      // Scanned room wins for the code box (already set above); keep the
      // last-used name so the user only needs to tap Join. No extra label —
      // the boxes themselves show what will be tried.
      if (sess.playerName) nameInput.value = sess.playerName;
      pendingIdentity = null;
      rejoinPending = false;
      rejoinRoomId = null;
      setLobbyInfo('');
      return;
    }
    nameInput.value = sess.playerName || nameInput.value;
    roomCodeInput.value = sess.roomId;
    pendingIdentity = sess.playerName || getLobbyName();
    rejoinPending = true;
    rejoinRoomId = String(sess.roomId).toUpperCase();
    setLobbyInfo('Reconnecting…');
    client.joinRoom(pendingIdentity, sess.roomId, VIEW === 'tv');
  })();

  // ── Debug mode ─────────────────────────────────────────────────────────────
  // The panel is permanent + in-flow (see CSS): created on boot when ?debug
  // is present so it survives refresh/reconnect (game_snapshot path), not
  // just the first game_started. appendDebugPanel() is idempotent — safe to
  // call from all three sites.
  const DEBUG_COLLAPSE_KEY = 'eldorado.debug-collapsed';
  if (DEBUG) {
    const _origOnGameStarted = client.onGameStarted;
    client.onGameStarted = (data) => {
      _origOnGameStarted(data);
      appendDebugPanel();
    };
    appendDebugPanel();
  }

  function appendDebugPanel() {
    if (document.getElementById('debug-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.innerHTML = `
      <div class="debug-header">
        <span class="debug-title">🛠 DEBUG</span>
        <button id="debug-toggle-btn" title="Minimize debug panel">—</button>
      </div>
      <div class="debug-body">
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
        </div>
      </div>`;
    // Prepend (not append) so the sticky-top phone bar docks above the hand
    // instead of after the modals. Fixed-position desktop is unaffected
    // (out of flow either way).
    const gameScreen = document.getElementById('game-screen');
    gameScreen.prepend(panel);

    const toggleBtn = document.getElementById('debug-toggle-btn');
    const applyCollapsed = (collapsed) => {
      panel.classList.toggle('collapsed', collapsed);
      toggleBtn.textContent = collapsed ? '+' : '—';
      toggleBtn.title = collapsed ? 'Expand debug panel' : 'Minimize debug panel';
      try { sessionStorage.setItem(DEBUG_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
    };
    toggleBtn.addEventListener('click', () => {
      applyCollapsed(!panel.classList.contains('collapsed'));
    });
    // Restore last state; default collapsed on phones (small screen), open
    // elsewhere so desktop testers see it immediately.
    let startCollapsed = VIEW === 'phone';
    try {
      const saved = sessionStorage.getItem(DEBUG_COLLAPSE_KEY);
      if (saved === '1') startCollapsed = true;
      else if (saved === '0') startCollapsed = false;
    } catch (e) {}
    applyCollapsed(startCollapsed);

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

    // Shift-click a tile to teleport there. Wrap once: appendDebugPanel() is
    // idempotent so this normally runs a single time, but the flag keeps a
    // future re-entry from double-wrapping and swallowing clicks.
    if (!renderer._debugTileClickWrapped) {
      renderer._debugTileClickWrapped = true;
      const _origTileClick = renderer.onTileClick;
      renderer.onTileClick = (tileId, event) => {
        if (event?.shiftKey) { client.debugTeleport(tileId); return; }
        _origTileClick?.(tileId);
      };
    }
  }
});