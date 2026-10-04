// client/src/game/HexRenderer.js
// Flat-top hex pixel formula (matches BlockBase.gd exactly):
//   cx = 75 * q
//   cy = 43.3 * q + 86.6 * r

const HEX_R = 50;
const W_STEP = 75;
const H_STEP = 86.6;
const H_HALF = 43.3;

// Terrain configuration
// fill      = base hex fill colour
// hilite    = lighter shade for top-left bevel edge
// shadow    = darker shade for bottom-right bevel edge
// innerFill = slightly lighter face for raised coin look
// stroke    = outer border colour between tiles
const TERRAIN = {
  jungle: { fill: '#2a6b1a', hilite: '#4a9b2a', shadow: '#0e3a0a', innerFill: '#347a20', stroke: '#1a4a10', icon: '🌿' },
  water: { fill: '#1a5a9a', hilite: '#3a8ace', shadow: '#08305a', innerFill: '#2068b0', stroke: '#0e3a6a', icon: '🌊' },
  village: { fill: '#b07820', hilite: '#d4a040', shadow: '#6a4808', innerFill: '#c08828', stroke: '#7a5210', icon: '🏘️' },
  mountain: { fill: '#2a2420', hilite: '#4a3c34', shadow: '#100e0c', innerFill: '#342c26', stroke: '#1a1410', icon: '⛰', textColor: '#9abcd4' },
  camp: { fill: '#7a3a28', hilite: '#a85a40', shadow: '#3a1810', innerFill: '#8a4430', stroke: '#5a2818', icon: '⛺' },
  rubble: { fill: '#5a5244', hilite: '#7a6e5e', shadow: '#2e2a22', innerFill: '#68604e', stroke: '#3e3830', icon: '🪨' },
  start: { fill: '#781ba3', hilite: '#781ba3', shadow: '#781ba3', innerFill: '#781ba3', stroke: '#781ba3', icon: '🏳' },
  el_dorado: { fill: '#1a6a48', hilite: '#2a9a6a', shadow: '#083a28', innerFill: '#228058', stroke: '#0e4a30', icon: '🏆' },
};

// Pawn colors
const PAWN_PALETTE = [
  { fill: '#e74c3c', stroke: '#8b1a0e', glow: 'rgba(231,76,60,0.6)' },
  { fill: '#3498db', stroke: '#1a5a8a', glow: 'rgba(52,152,219,0.6)' },
  { fill: '#2ecc71', stroke: '#1a7a40', glow: 'rgba(46,204,113,0.6)' },
  { fill: '#f39c12', stroke: '#8a5a06', glow: 'rgba(243,156,18,0.6)' },
];

const BLOCKADE_STYLE = {
  jungle: { color: '#4cff4c', glow: 'rgba(76,255,76,0.4)', pulse: 'rgba(76,255,76,0.7)' },
  water: { color: '#4ab8f0', glow: 'rgba(74,184,240,0.4)', pulse: 'rgba(74,184,240,0.7)' },
  village: { color: '#ffd700', glow: 'rgba(255,215,0,0.4)', pulse: 'rgba(255,215,0,0.7)' },
  rubble: { color: '#898681', glow: 'rgba(200,160,96,0.4)', pulse: 'rgba(200,160,96,0.7)' },
};

class HexRenderer {
  constructor(svgEl) {
    this.svg = svgEl;
    this.tileEls = new Map();
    this.pawnEls = new Map();
    this.onTileClick = null;
    this.scale = 1;
    this._defs = null;
    this._animFrames = new Set();

    // ── Zoom/pan state ────────────────────────────────────────────────────
    // These are used by zoomToTiles() and kept in sync with the
    // #board-scroll-inner wrapper that main.js also manipulates.
    // We store them here so zoomToTiles() can read the current scale.
    this._zoom = 1;
    this._scrollInner = null; // set lazily on first use
    this._scrollContainer = null;

    this._initDefs();
  }

  // ── Lazy wrapper refs ─────────────────────────────────────────────────────
  // We can't grab these in the constructor because main.js builds the
  // renderer before the DOM is fully wired. Grab them on first need.
  _getScrollInner() {
    if (!this._scrollInner) {
      this._scrollInner = document.getElementById('board-scroll-inner');
      this._scrollContainer = document.getElementById('board-container');
    }
    return this._scrollInner;
  }

  _initDefs() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    defs.innerHTML = `
      <!-- ── Per-tile face light (top-left bright spot) ── -->
      <radialGradient id="hex-face-light" cx="35%" cy="30%" r="70%">
        <stop offset="0%"   stop-color="rgba(255,255,255,0.22)"/>
        <stop offset="55%"  stop-color="rgba(255,255,255,0.04)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.28)"/>
      </radialGradient>

      <!-- ── El Dorado tile gradients ── -->
      <radialGradient id="eldorado-radial" cx="50%" cy="45%" r="60%">
        <stop offset="0%"   stop-color="#36a070"/>
        <stop offset="55%"  stop-color="#1e7050"/>
        <stop offset="100%" stop-color="#0c4030"/>
      </radialGradient>
      <radialGradient id="eldorado-glow-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="rgba(255,215,0,0.30)"/>
        <stop offset="100%" stop-color="rgba(255,215,0,0)"/>
      </radialGradient>
    `;

    this.svg.appendChild(defs);
    this._defs = defs;
  }

  render(tiles) {
    // Keep defs, clear everything else
    const toRemove = [];
    for (const child of this.svg.children) {
      if (child.tagName !== 'defs') toRemove.push(child);
    }
    toRemove.forEach(el => el.remove());

    this.tileEls.clear();
    this.pawnEls.clear();

    if (!tiles || tiles.length === 0) return;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const t of tiles) {
      const { cx, cy } = this._center(t.q, t.r);
      if (cx - HEX_R < minX) minX = cx - HEX_R;
      if (cy - HEX_R < minY) minY = cy - HEX_R;
      if (cx + HEX_R > maxX) maxX = cx + HEX_R;
      if (cy + HEX_R > maxY) maxY = cy + HEX_R;
    }

    const pad = 80;
    const vx = minX - pad;
    const vy = minY - pad;
    const vw = maxX - minX + pad * 2;
    const vh = maxY - minY + pad * 2;

    this.svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);

    const ORDER = { start: 0, jungle: 1, water: 1, village: 1, mountain: 1, rubble: 2, camp: 2, el_dorado: 3 };
    const sorted = [...tiles].sort((a, b) => (ORDER[a.terrainType] ?? 1) - (ORDER[b.terrainType] ?? 1));

    for (const tile of sorted) this._renderTile(tile);
  }

  _center(q, r) {
    return { cx: W_STEP * q, cy: H_HALF * q + H_STEP * r };
  }

  _hexPoints(cx, cy, radius = HEX_R) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      pts.push(`${(cx + radius * Math.cos(a)).toFixed(1)},${(cy + radius * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  _hexVertices(cx, cy, radius = HEX_R) {
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      verts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }
    return verts;
  }

  _renderTile(tile) {
    const { cx, cy } = this._center(tile.q, tile.r);
    const style = TERRAIN[tile.terrainType] || { fill: '#444', hilite: '#666', shadow: '#222', innerFill: '#555', stroke: '#333', icon: '?' };
    const isElDorado = tile.terrainType === 'el_dorado';
    const isFinishing = tile.isFinishing;
    const isMountain = tile.terrainType === 'mountain';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-tile-id', tile.id);
    if (!isMountain) g.style.cursor = 'pointer';

    const ns = 'http://www.w3.org/2000/svg';
    const mk = (tag) => document.createElementNS(ns, tag);

    // ── El Dorado glow backdrop ──────────────────────────────────────────────
    if (isElDorado) {
      const glowCircle = mk('circle');
      glowCircle.setAttribute('cx', cx);
      glowCircle.setAttribute('cy', cy);
      glowCircle.setAttribute('r', HEX_R * 1.5);
      glowCircle.setAttribute('fill', 'url(#eldorado-glow-grad)');
      glowCircle.setAttribute('pointer-events', 'none');
      g.appendChild(glowCircle);
    }

    // ── Shadow bevel: offset hex behind main tile — creates raised-tile look ──
    const shadowPoly = mk('polygon');
    shadowPoly.setAttribute('points', this._hexPoints(cx + 1.5, cy + 2, HEX_R + 0.5));
    shadowPoly.setAttribute('fill', style.shadow);
    shadowPoly.setAttribute('opacity', '0.7');
    shadowPoly.setAttribute('pointer-events', 'none');
    g.appendChild(shadowPoly);

    // ── Main hex face ─────────────────────────────────────────────────────────
    const poly = mk('polygon');
    poly.setAttribute('points', this._hexPoints(cx, cy));
    poly.setAttribute('fill', isElDorado ? 'url(#eldorado-radial)' : style.fill);
    poly.setAttribute('stroke', style.stroke);
    poly.setAttribute('stroke-width', '1.5');
    poly.style.transition = 'filter 0.15s, stroke 0.15s, stroke-width 0.15s';
    g.appendChild(poly);

    // ── Inner face: slightly lighter + slightly smaller for coin-like depth ───
    if (!isMountain) {
      const innerPoly = mk('polygon');
      innerPoly.setAttribute('points', this._hexPoints(cx, cy, HEX_R - 3));
      innerPoly.setAttribute('fill', style.innerFill || style.fill);
      innerPoly.setAttribute('stroke', 'none');
      innerPoly.setAttribute('pointer-events', 'none');
      g.appendChild(innerPoly);
    }

    // ── Bevel highlight: bright polyline on top-left facing edges ─────────────
    // Flat-top vertices: 0=right, 1=lower-right, 2=lower-left,
    //                    3=left,  4=upper-left,  5=upper-right
    {
      const v = this._hexVertices(cx, cy, HEX_R - 1);
      const litPath = mk('polyline');
      litPath.setAttribute('points',
        `${v[3].x.toFixed(1)},${v[3].y.toFixed(1)} ` +
        `${v[4].x.toFixed(1)},${v[4].y.toFixed(1)} ` +
        `${v[5].x.toFixed(1)},${v[5].y.toFixed(1)} ` +
        `${v[0].x.toFixed(1)},${v[0].y.toFixed(1)}`
      );
      litPath.setAttribute('fill', 'none');
      litPath.setAttribute('stroke', style.hilite);
      litPath.setAttribute('stroke-width', '2');
      litPath.setAttribute('stroke-linecap', 'round');
      litPath.setAttribute('stroke-linejoin', 'round');
      litPath.setAttribute('opacity', '0.65');
      litPath.setAttribute('pointer-events', 'none');
      g.appendChild(litPath);

      const shadowLine = mk('polyline');
      shadowLine.setAttribute('points',
        `${v[0].x.toFixed(1)},${v[0].y.toFixed(1)} ` +
        `${v[1].x.toFixed(1)},${v[1].y.toFixed(1)} ` +
        `${v[2].x.toFixed(1)},${v[2].y.toFixed(1)} ` +
        `${v[3].x.toFixed(1)},${v[3].y.toFixed(1)}`
      );
      shadowLine.setAttribute('fill', 'none');
      shadowLine.setAttribute('stroke', style.shadow);
      shadowLine.setAttribute('stroke-width', '2');
      shadowLine.setAttribute('stroke-linecap', 'round');
      shadowLine.setAttribute('stroke-linejoin', 'round');
      shadowLine.setAttribute('opacity', '0.5');
      shadowLine.setAttribute('pointer-events', 'none');
      g.appendChild(shadowLine);
    }

    // ── Radial light overlay ──────────────────────────────────────────────────
    if (!isMountain) {
      const overlay = mk('polygon');
      overlay.setAttribute('points', this._hexPoints(cx, cy, HEX_R - 3));
      overlay.setAttribute('fill', 'url(#hex-face-light)');
      overlay.setAttribute('pointer-events', 'none');
      g.appendChild(overlay);
    }

    // ── El Dorado inner gold rings ────────────────────────────────────────────
    if (isElDorado) {
      const ring1 = mk('polygon');
      ring1.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.80));
      ring1.setAttribute('fill', 'none');
      ring1.setAttribute('stroke', 'rgba(255,215,0,0.65)');
      ring1.setAttribute('stroke-width', '2');
      ring1.setAttribute('pointer-events', 'none');
      g.appendChild(ring1);

      const ring2 = mk('polygon');
      ring2.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.58));
      ring2.setAttribute('fill', 'none');
      ring2.setAttribute('stroke', 'rgba(255,215,0,0.4)');
      ring2.setAttribute('stroke-width', '1.5');
      ring2.setAttribute('pointer-events', 'none');
      g.appendChild(ring2);
    }

    // ── Finishing tiles: dashed gold border ───────────────────────────────────
    if (isFinishing) {
      const finishRing = mk('polygon');
      finishRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.84));
      finishRing.setAttribute('fill', 'none');
      finishRing.setAttribute('stroke', '#ffd700');
      finishRing.setAttribute('stroke-width', '2');
      finishRing.setAttribute('stroke-dasharray', '8 5');
      finishRing.setAttribute('pointer-events', 'none');
      finishRing.style.opacity = '0.8';
      g.appendChild(finishRing);
    }

    // ── Terrain icon ──────────────────────────────────────────────────────────
    const iconSize = isElDorado ? 34 : (isMountain ? 26 : 28);
    const iconY = (tile.movementCost > 1 && !isMountain) ? cy - 8 : cy + 2;

    const icon = mk('text');
    icon.setAttribute('x', cx);
    icon.setAttribute('y', iconY);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'middle');
    icon.setAttribute('font-size', iconSize);
    icon.setAttribute('pointer-events', 'none');
    if (style.textColor) icon.setAttribute('fill', style.textColor);
    icon.textContent = style.icon;
    g.appendChild(icon);

    // ── Movement cost badge ───────────────────────────────────────────────────
    if (tile.movementCost > 1 && !isMountain) {
      const badgeBg = mk('rect');
      badgeBg.setAttribute('x', cx - 14);
      badgeBg.setAttribute('y', cy + 15);
      badgeBg.setAttribute('width', 28);
      badgeBg.setAttribute('height', 15);
      badgeBg.setAttribute('rx', '7');
      badgeBg.setAttribute('fill', 'rgba(0,0,0,0.60)');
      badgeBg.setAttribute('pointer-events', 'none');
      g.appendChild(badgeBg);

      const badge = mk('text');
      badge.setAttribute('x', cx);
      badge.setAttribute('y', cy + 23);
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('dominant-baseline', 'middle');
      badge.setAttribute('font-size', '12');
      badge.setAttribute('fill', '#ffd700');
      badge.setAttribute('font-weight', 'bold');
      badge.setAttribute('font-family', 'Inter, sans-serif');
      badge.setAttribute('pointer-events', 'none');
      badge.textContent = `×${tile.movementCost}`;
      g.appendChild(badge);
    }

    // ── Finishing flag icon ───────────────────────────────────────────────────
    if (isFinishing) {
      const flag = mk('text');
      flag.setAttribute('x', cx + 22);
      flag.setAttribute('y', cy - 22);
      flag.setAttribute('text-anchor', 'middle');
      flag.setAttribute('dominant-baseline', 'middle');
      flag.setAttribute('font-size', '14');
      flag.setAttribute('pointer-events', 'none');
      flag.textContent = '🏁';
      g.appendChild(flag);
    }

    // ── El Dorado animated shimmer ring ───────────────────────────────────────
    if (isElDorado) {
      const shimmerRing = mk('polygon');
      shimmerRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.93));
      shimmerRing.setAttribute('fill', 'none');
      shimmerRing.setAttribute('stroke', '#ffd700');
      shimmerRing.setAttribute('stroke-width', '2');
      shimmerRing.setAttribute('pointer-events', 'none');
      shimmerRing.setAttribute('opacity', '0');
      const animEl = mk('animate');
      animEl.setAttribute('attributeName', 'opacity');
      animEl.setAttribute('values', '0;0.85;0');
      animEl.setAttribute('dur', '2.5s');
      animEl.setAttribute('repeatCount', 'indefinite');
      animEl.setAttribute('begin', `${Math.random() * 2}s`);
      shimmerRing.appendChild(animEl);
      g.appendChild(shimmerRing);
    }

    g.addEventListener('click', () => this.onTileClick?.(tile.id));
    this.svg.appendChild(g);
    this.tileEls.set(tile.id, { g, poly, tile });
  }

  // ── Valid move highlighting ───────────────────────────────────────────────

  setValidMoves(tileIds) {
    const validSet = new Set(tileIds);

    for (const [id, { poly, tile }] of this.tileEls) {
      const isValid = validSet.has(id);
      const style = TERRAIN[tile.terrainType] || {};

      if (isValid) {
        poly.setAttribute('stroke', '#ffee00');
        poly.setAttribute('stroke-width', '3.5');
        poly.style.filter = 'brightness(1.4)';
        poly.style.animation = 'hex-pulse 1.4s ease-in-out infinite';

        let glowRing = this.tileEls.get(id)._glowRing;
        if (!glowRing) {
          const { cx, cy } = this._center(tile.q, tile.r);
          glowRing = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          glowRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R + 5));
          glowRing.setAttribute('fill', 'none');
          glowRing.setAttribute('stroke', 'rgba(255,238,0,0.45)');
          glowRing.setAttribute('stroke-width', '8');
          glowRing.setAttribute('pointer-events', 'none');
          glowRing.style.animation = 'glow-pulse 1.4s ease-in-out infinite';
          this.tileEls.get(id)._glowRing = glowRing;
          this.tileEls.get(id).g.insertBefore(glowRing, this.tileEls.get(id).g.firstChild);
        }
        glowRing.style.display = '';
      } else {
        poly.setAttribute('stroke', style.stroke || '#222');
        poly.setAttribute('stroke-width', tile.terrainType === 'el_dorado' ? '2.5' : '1.5');
        poly.style.filter = '';
        poly.style.animation = '';

        const entry = this.tileEls.get(id);
        if (entry._glowRing) entry._glowRing.style.display = 'none';
      }
    }
  }

  clearHighlights() {
    this.setValidMoves([]);
  }

  // ── Pawn rendering ───────────────────────────────────────────────────────

  setPawnPosition(playerId, tileId, colorIndex = 0) {
    const existing = this.svg.querySelector(`[data-pawn="${CSS.escape(playerId)}"]`);
    if (existing) existing.remove();

    const entry = this.tileEls.get(tileId);
    if (!entry) return;

    const { cx, cy } = this._center(entry.tile.q, entry.tile.r);
    const palette = PAWN_PALETTE[colorIndex] || PAWN_PALETTE[0];
    const ns = 'http://www.w3.org/2000/svg';
    const mk = (tag) => document.createElementNS(ns, tag);

    const g = mk('g');
    g.setAttribute('data-pawn', playerId);
    g.setAttribute('pointer-events', 'none');

    const halo = mk('circle');
    halo.setAttribute('cx', cx);
    halo.setAttribute('cy', cy + 2);
    halo.setAttribute('r', '20');
    halo.setAttribute('fill', palette.glow);
    halo.setAttribute('opacity', '0.4');
    g.appendChild(halo);

    const body = mk('circle');
    body.setAttribute('cx', cx);
    body.setAttribute('cy', cy);
    body.setAttribute('r', '15');
    body.setAttribute('fill', palette.fill);
    body.setAttribute('stroke', palette.stroke);
    body.setAttribute('stroke-width', '2.5');
    g.appendChild(body);

    const highlight = mk('circle');
    highlight.setAttribute('cx', cx - 4);
    highlight.setAttribute('cy', cy - 4);
    highlight.setAttribute('r', '5');
    highlight.setAttribute('fill', 'rgba(255,255,255,0.28)');
    g.appendChild(highlight);

    const ring = mk('circle');
    ring.setAttribute('cx', cx);
    ring.setAttribute('cy', cy);
    ring.setAttribute('r', '17');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'rgba(255,255,255,0.2)');
    ring.setAttribute('stroke-width', '1');
    g.appendChild(ring);

    this.svg.appendChild(g);
    this.pawnEls.set(playerId, g);
  }

  // ── Flash a tile briefly ─────────────────────────────────────────────────

  flashTile(tileId, color = '#e74c3c') {
    const entry = this.tileEls.get(tileId);
    if (!entry) return;
    const { poly } = entry;
    const originalFilter = poly.style.filter;
    poly.style.filter = `brightness(2) sepia(1) hue-rotate(${color === '#e74c3c' ? '0' : '120'}deg)`;
    setTimeout(() => { poly.style.filter = originalFilter; }, 350);
  }

  // ── Scale / zoom ─────────────────────────────────────────────────────────
  // NOTE: The board uses a scroll-container architecture:
  //   #board-container (overflow: auto, scrollable viewport)
  //     └── #board-scroll-inner (CSS transform: scale, logical content size)
  //           └── #hex-board SVG (100% fill, viewBox set by render())
  //
  // setScale() and zoomToTiles() both operate on the scroll-inner wrapper,
  // keeping them consistent with the zoom buttons in main.js.

  // Sync our internal _zoom state when main.js changes the zoom externally.
  // Call this from main.js's updateBoardZoom() after setting the transform.
  notifyZoomChanged(zoom) {
    this._zoom = zoom;
  }

  // Pan and zoom the board to frame the given tile IDs.
  // Uses scrollIntoView on the actual SVG <g> elements — no coordinate math.
  //
  // For a single tile, scrolls that tile to centre of viewport.
  // For multiple tiles, picks the tile closest to the group centroid.
  //
  // animate: uses smooth scroll behaviour
  zoomToTiles(tileIds, { animate = true, maxZoom = 2.0 } = {}) {
    if (!tileIds || tileIds.length === 0) return;

    const inner = this._getScrollInner();
    if (!inner) return;

    const entries = tileIds
      .map(id => this.tileEls.get(id))
      .filter(Boolean);

    if (entries.length === 0) return;

    // ── 1. Set zoom ───────────────────────────────────────────────────────
    if (!inner.dataset.naturalWidth) {
      inner.dataset.naturalWidth = Math.round(inner.offsetWidth / this._zoom);
      inner.dataset.naturalHeight = Math.round(inner.offsetHeight / this._zoom);
    }
    const naturalW = Number(inner.dataset.naturalWidth);
    const naturalH = Number(inner.dataset.naturalHeight);

    let targetZoom;
    if (entries.length === 1) {
      targetZoom = maxZoom;
    } else {
      const centers = entries.map(({ tile }) => this._center(tile.q, tile.r));
      const svgW = Math.max(...centers.map(c => c.cx)) - Math.min(...centers.map(c => c.cx)) + HEX_R * 4;
      const svgH = Math.max(...centers.map(c => c.cy)) - Math.min(...centers.map(c => c.cy)) + HEX_R * 4;
      const vb = this.svg.viewBox.baseVal;
      if (!vb || vb.width === 0) return;
      const pxPerUnitX = naturalW / vb.width;
      const pxPerUnitY = naturalH / vb.height;
      const container = this._scrollContainer;
      const vpW = container ? container.clientWidth : naturalW;
      const vpH = container ? container.clientHeight : naturalH;
      const fitX = (vpW * 0.75) / (svgW * pxPerUnitX);
      const fitY = (vpH * 0.75) / (svgH * pxPerUnitY);
      targetZoom = Math.min(fitX, fitY, maxZoom);
    }
    const clampedZoom = Math.max(0.5, Math.min(2.5, targetZoom));

    inner.style.transformOrigin = 'top left';
    inner.style.transform = `scale(${clampedZoom})`;
    inner.style.width = (naturalW * clampedZoom) + 'px';
    inner.style.height = (naturalH * clampedZoom) + 'px';
    this._zoom = clampedZoom;

    // ── 2. Pick the tile closest to the group centroid ────────────────────
    const centers = entries.map(({ tile }) => this._center(tile.q, tile.r));
    const centroidX = centers.reduce((s, c) => s + c.cx, 0) / centers.length;
    const centroidY = centers.reduce((s, c) => s + c.cy, 0) / centers.length;
    const closest = entries.reduce((best, entry, i) => {
      const d = Math.hypot(centers[i].cx - centroidX, centers[i].cy - centroidY);
      return d < best.d ? { entry, d } : best;
    }, { entry: entries[0], d: Infinity }).entry;

    // Force reflow so the browser knows the new zoomed dimensions before
    // scrollIntoView reads layout.
    void inner.offsetWidth;

    requestAnimationFrame(() => {
      closest.g.scrollIntoView({
        behavior: animate ? 'smooth' : 'instant',
        block: 'center',
        inline: 'center',
      });
    });
  }

  // Convenience: zoom to a single tile
  zoomToTile(tileId, options) {
    return this.zoomToTiles([tileId], options);
  }


  // Render all active blockades. Each seam gets ONE solid barricade plank —
  // a wide rounded rectangle rotated to sit across the shared seam boundary,
  // styled to look like a physical barrier gate with a coloured stripe.
  // Called once on game_started and again after each blockade_broken.
  renderBlockades(blockades) {
    for (const el of [...this.svg.querySelectorAll('[data-blockade]')]) el.remove();
    if (!blockades || blockades.length === 0) return;

    const ns = 'http://www.w3.org/2000/svg';

    for (const blockade of blockades) {
      this._renderBlockadePlank(blockade, false);
    }
  }

  // Build the geometry for one blockade plank and append it to the SVG.
  // isBreakable: if true, renders the pulsing "breakable" highlight variant.
  _renderBlockadePlank(blockade, isBreakable) {
    const ns = 'http://www.w3.org/2000/svg';
    const style = BLOCKADE_STYLE[blockade.terrainType] || BLOCKADE_STYLE.jungle;

    // Collect midpoints of every edge in this seam to find the overall
    // seam centroid and span.
    const edgeMidpoints = [];
    for (const [idA, idB] of blockade.edges) {
      const entA = this.tileEls.get(idA);
      const entB = this.tileEls.get(idB);
      if (!entA || !entB) continue;
      const cA = this._center(entA.tile.q, entA.tile.r);
      const cB = this._center(entB.tile.q, entB.tile.r);
      edgeMidpoints.push({ x: (cA.cx + cB.cx) / 2, y: (cA.cy + cB.cy) / 2 });
    }
    if (edgeMidpoints.length === 0) return;

    // Seam centroid
    const cx = edgeMidpoints.reduce((s, p) => s + p.x, 0) / edgeMidpoints.length;
    const cy = edgeMidpoints.reduce((s, p) => s + p.y, 0) / edgeMidpoints.length;

    // Direction of the seam: vector from first to last edge midpoint.
    // This gives us the angle we need to rotate the plank.
    const first = edgeMidpoints[0];
    const last = edgeMidpoints[edgeMidpoints.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const seamLen = Math.hypot(dx, dy) || 1;

    // Span: total length from first to last edge midpoint + half-hex padding
    const halfPad = HEX_R * 0.65;
    const plankLen = seamLen + halfPad * 2;

    // Plank thickness — thick enough to be obvious, not so thick it covers tiles.
    // Breakable plank is noticeably chunkier than the static/idle one.
    const plankThick = isBreakable ? 26 : 16;

    // Rotation angle in degrees
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    const rot = `rotate(${angleDeg.toFixed(2)}, ${cx.toFixed(1)}, ${cy.toFixed(1)})`;

    // ── Breakable: big pulsing halo behind everything, like a valid-move glow ring ──
    if (isBreakable) {
      const haloLen = plankLen + 24;
      const haloThick = plankThick + 30;
      const halo = document.createElementNS(ns, 'rect');
      halo.setAttribute('x', (cx - haloLen / 2).toFixed(1));
      halo.setAttribute('y', (cy - haloThick / 2).toFixed(1));
      halo.setAttribute('width', haloLen.toFixed(1));
      halo.setAttribute('height', haloThick.toFixed(1));
      halo.setAttribute('rx', (haloThick / 2).toFixed(1));
      halo.setAttribute('fill', style.pulse);
      halo.setAttribute('pointer-events', 'none');
      halo.setAttribute('transform', rot);
      halo.setAttribute('data-blockade', blockade.id);
      halo.setAttribute('data-blockade-breakable', blockade.id);
      halo.style.animation = 'blockade-halo-pulse 1.1s ease-in-out infinite';
      this.svg.appendChild(halo);
    }

    // ── Outer glow ────────────────────────────────────────────────────────
    const glowPad = isBreakable ? 10 : 6;
    const glow = document.createElementNS(ns, 'rect');
    glow.setAttribute('x', (cx - plankLen / 2).toFixed(1));
    glow.setAttribute('y', (cy - (plankThick / 2 + glowPad)).toFixed(1));
    glow.setAttribute('width', plankLen.toFixed(1));
    glow.setAttribute('height', (plankThick + glowPad * 2).toFixed(1));
    glow.setAttribute('rx', ((plankThick / 2 + glowPad)).toFixed(1));
    glow.setAttribute('fill', isBreakable ? style.pulse : style.glow);
    glow.setAttribute('pointer-events', 'none');
    glow.setAttribute('transform', rot);
    glow.setAttribute('data-blockade', blockade.id);
    if (isBreakable) {
      glow.setAttribute('data-blockade-breakable', blockade.id);
      glow.style.animation = 'blockade-pulse 1.1s ease-in-out infinite';
    }
    this.svg.appendChild(glow);

    // ── Dark body (wood/metal base) ───────────────────────────────────────
    const body = document.createElementNS(ns, 'rect');
    body.setAttribute('x', (cx - plankLen / 2).toFixed(1));
    body.setAttribute('y', (cy - plankThick / 2).toFixed(1));
    body.setAttribute('width', plankLen.toFixed(1));
    body.setAttribute('height', plankThick.toFixed(1));
    body.setAttribute('rx', (plankThick / 2).toFixed(1));
    body.setAttribute('fill', '#1a1008');
    body.setAttribute('stroke', isBreakable ? '#ffee00' : '#3a2010');
    body.setAttribute('stroke-width', isBreakable ? '2' : '1');
    body.setAttribute('pointer-events', 'none');
    body.setAttribute('transform', rot);
    body.setAttribute('data-blockade', blockade.id);
    if (isBreakable) {
      body.setAttribute('data-blockade-breakable', blockade.id);
      body.style.animation = 'blockade-stroke-pulse 1.1s ease-in-out infinite';
    }
    this.svg.appendChild(body);

    // ── Coloured centre stripe ────────────────────────────────────────────
    const stripeThick = plankThick * 0.45;
    const stripe = document.createElementNS(ns, 'rect');
    stripe.setAttribute('x', (cx - plankLen / 2 + 6).toFixed(1));
    stripe.setAttribute('y', (cy - stripeThick / 2).toFixed(1));
    stripe.setAttribute('width', (plankLen - 12).toFixed(1));
    stripe.setAttribute('height', stripeThick.toFixed(1));
    stripe.setAttribute('rx', (stripeThick / 2).toFixed(1));
    stripe.setAttribute('fill', style.color);
    stripe.setAttribute('opacity', isBreakable ? '1' : '0.85');
    stripe.setAttribute('pointer-events', 'none');
    stripe.setAttribute('transform', rot);
    stripe.setAttribute('data-blockade', blockade.id);
    if (isBreakable) {
      stripe.setAttribute('data-blockade-breakable', blockade.id);
      stripe.style.filter = 'brightness(1.5) saturate(1.3)';
    }
    this.svg.appendChild(stripe);

    // ── End-cap bolts (two small circles, one at each end) ────────────────
    const boltR = plankThick * 0.28;
    const boltInset = plankLen / 2 - boltR - 4;
    // Bolts sit on the centreline of the plank — we offset them along the
    // plank's own axis, so they rotate with it via the same transform.
    for (const sign of [-1, 1]) {
      const bx = cx + sign * boltInset;
      const bolt = document.createElementNS(ns, 'circle');
      bolt.setAttribute('cx', bx.toFixed(1));
      bolt.setAttribute('cy', cy.toFixed(1));
      bolt.setAttribute('r', boltR.toFixed(1));
      bolt.setAttribute('fill', '#2a1a08');
      bolt.setAttribute('stroke', isBreakable ? '#ffee00' : '#c8a060');
      bolt.setAttribute('stroke-width', '1.5');
      bolt.setAttribute('pointer-events', 'none');
      bolt.setAttribute('transform', rot);
      bolt.setAttribute('data-blockade', blockade.id);
      if (isBreakable) bolt.setAttribute('data-blockade-breakable', blockade.id);
      this.svg.appendChild(bolt);
    }

    // ── 🚧 Icon centred on the plank ─────────────────────────────────────
    const iconEl = document.createElementNS(ns, 'text');
    iconEl.setAttribute('x', cx.toFixed(1));
    iconEl.setAttribute('y', cy.toFixed(1));
    iconEl.setAttribute('text-anchor', 'middle');
    iconEl.setAttribute('dominant-baseline', 'middle');
    iconEl.setAttribute('font-size', '14');
    iconEl.setAttribute('pointer-events', 'none');
    iconEl.setAttribute('data-blockade', blockade.id);
    if (isBreakable) iconEl.setAttribute('data-blockade-breakable', blockade.id);
    iconEl.textContent = '🚧';
    this.svg.appendChild(iconEl);

    // ── Invisible wide hit area (only added for breakable variant) ────────
    if (isBreakable) {
      const hitThick = plankThick + 28;
      const hit = document.createElementNS(ns, 'rect');
      hit.setAttribute('x', (cx - plankLen / 2 - 14).toFixed(1));
      hit.setAttribute('y', (cy - hitThick / 2).toFixed(1));
      hit.setAttribute('width', (plankLen + 28).toFixed(1));
      hit.setAttribute('height', hitThick.toFixed(1));
      hit.setAttribute('rx', (hitThick / 2).toFixed(1));
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('stroke', 'none');
      hit.setAttribute('pointer-events', 'fill');
      hit.setAttribute('transform', `rotate(${angleDeg.toFixed(2)}, ${cx.toFixed(1)}, ${cy.toFixed(1)})`);
      hit.setAttribute('data-blockade-hit', blockade.id);
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', () => this.onBlockadeClick?.(blockade.id));
      this.svg.appendChild(hit);
    }
  }

  // Remove a specific blockade's SVG elements (called after blockade_broken).
  removeBlockade(blockadeId) {
    for (const el of [...this.svg.querySelectorAll(`[data-blockade="${CSS.escape(blockadeId)}"]`)]) {
      el.remove();
    }
  }

  // Highlight breakable blockades as clickable — called alongside setValidMoves.
  // breakableIds: array of blockade IDs the current card can break.
  // allBlockades: the full activeBlockades array (needed for edge geometry).
  setBreakableBlockades(breakableIds, allBlockades) {
    // Clear any previous breakable highlights
    for (const el of [...this.svg.querySelectorAll('[data-blockade-breakable]')]) el.remove();
    for (const el of [...this.svg.querySelectorAll('[data-blockade-hit]')]) el.remove();

    if (!breakableIds || breakableIds.length === 0) return;
    if (!allBlockades || allBlockades.length === 0) return;

    for (const blockadeId of breakableIds) {
      const blockade = allBlockades.find(b => b.id === blockadeId);
      if (!blockade) continue;
      // Render the pulsing breakable variant on top of the static plank
      this._renderBlockadePlank(blockade, true);
    }
  }
}