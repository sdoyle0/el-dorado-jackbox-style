// client/src/game/MiniMap.js
// #8 experiment: pawn-centred mini-map movement picker for boardless phones.
//
// The phone today shows numbered chips (1..N) that must be matched to numbered
// badges on the TV — eyes go TV → phone → TV for every option. This renderer
// draws a small SVG excerpt around the acting pawn (current tile + legal
// destinations + context rings) reusing the TV's terrain colours, so taps hit
// tiles directly with no number-matching. Phone-only, display + tap routing;
// the server still validates every move_pawn / move_to_rubble event.
//
// Design notes:
// - Flat-top hex math matches HexRenderer exactly (cx = 75*q, cy = 43.3*q +
//   86.6*r) so the excerpt rhymes with the TV board.
// - Excerpt = 2 rings around the pawn + 1 ring around each valid destination
//   (orientation context for multi-step planning). Typically ~20-30 tiles.
// - Number badges reuse the payload order (N = position in validMoves, 1-based)
//   so the map, the chip list below it, and the TV badges all agree.
// - No dependencies. Works with plain tile objects {id,q,r,terrainType,
//   movementCost,isFinishing}; pawns are [{tileId,color}] for context dots.

(function (global) {
  'use strict';

  var HEX_R = 50;
  var W_STEP = 75;
  var H_HALF = 43.3;
  var H_STEP = 86.6;

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Same base fills as HexRenderer.TERRAIN (flat face colour only — the phone
  // excerpt is small, so bevels/gradients would be noise at this scale).
  var FILL = {
    jungle: '#2a6b1a',
    water: '#1a5a9a',
    village: '#b07820',
    mountain: '#2a2420',
    camp: '#7a3a28',
    rubble: '#5a5244',
    start: '#781ba3',
    el_dorado: '#1a6a48',
  };

  var STROKE = {
    jungle: '#1a4a10',
    water: '#0e3a6a',
    village: '#7a5210',
    mountain: '#1a1410',
    camp: '#5a2818',
    rubble: '#3e3830',
    start: '#781ba3',
    el_dorado: '#0e4a30',
  };

  var AXIAL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

  function centerOf(tile) {
    return { cx: W_STEP * tile.q, cy: H_HALF * tile.q + H_STEP * tile.r };
  }

  function hexPoints(cx, cy, radius) {
    var r = radius == null ? HEX_R : radius;
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i);
      pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function mk(tag) {
    return document.createElementNS(SVG_NS, tag);
  }

  function MiniMap(svgEl) {
    if (!svgEl) throw new Error('MiniMap needs an <svg> element');
    this.svg = svgEl;
    this.onSelect = null; // (tileId) => void — wired by main.js to attemptMoveToTile
  }

  // opts: {
  //   tiles: array of tile objects (must include q,r),
  //   centerTileId: pawn tile id (excerpt centres here),
  //   validMoves: ordered array of tile ids (payload order = badge numbers),
  //   pawns: [{ tileId, color }] (opponents in view get dots),
  //   myColor: css color for the acting pawn,
  //   pendingTileId: rubble-toll target (red outline), or null,
  //   dimContext: bool (default true — fade non-destination context tiles)
  // }
  // Returns the number of tiles drawn (0 when there is nothing to show).
  MiniMap.prototype.render = function (opts) {
    var o = opts || {};
    var tiles = Array.isArray(o.tiles) ? o.tiles : [];
    var validMoves = Array.isArray(o.validMoves) ? o.validMoves : [];
    var centerId = o.centerTileId || null;

    // Clear previous excerpt.
    while (this.svg.firstChild) this.svg.firstChild.remove();
    if (!tiles.length || !centerId) return 0;

    var byId = new Map();
    var byCoord = new Map();
    tiles.forEach(function (t) {
      if (!t || t.id == null) return;
      byId.set(String(t.id), t);
      if (typeof t.q === 'number' && typeof t.r === 'number') {
        byCoord.set(t.q + ',' + t.r, t);
      }
    });

    var center = byId.get(String(centerId));
    if (!center) return 0;

    function neighborsOf(tile) {
      var out = [];
      for (var i = 0; i < AXIAL_DIRS.length; i++) {
        var t = byCoord.get((tile.q + AXIAL_DIRS[i][0]) + ',' + (tile.r + AXIAL_DIRS[i][1]));
        if (t) out.push(t);
      }
      return out;
    }

    // ── Excerpt set: 2 rings around pawn + 1 ring around each destination ──
    var include = new Map(); // id -> { tile, ring }
    function add(tile, ring) {
      if (!tile) return;
      var k = String(tile.id);
      var prev = include.get(k);
      if (!prev || ring < prev.ring) include.set(k, { tile: tile, ring: ring });
    }
    add(center, 0);
    var ring1 = neighborsOf(center);
    ring1.forEach(function (t) { add(t, 1); });
    ring1.forEach(function (t) {
      neighborsOf(t).forEach(function (u) { add(u, 2); });
    });
    var validSet = new Set(validMoves.map(String));
    validMoves.forEach(function (id) {
      var t = byId.get(String(id));
      if (!t) return;
      add(t, 1);
      neighborsOf(t).forEach(function (u) { add(u, 2); });
    });

    var entries = Array.from(include.values());
    if (!entries.length) return 0;

    // ── ViewBox: tight crop on included tiles so hexes stay thumb-sized ──
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    entries.forEach(function (e) {
      var c = centerOf(e.tile);
      if (c.cx - HEX_R < minX) minX = c.cx - HEX_R;
      if (c.cy - HEX_R < minY) minY = c.cy - HEX_R;
      if (c.cx + HEX_R > maxX) maxX = c.cx + HEX_R;
      if (c.cy + HEX_R > maxY) maxY = c.cy + HEX_R;
    });
    var pad = 34;
    this.svg.setAttribute('viewBox',
      (minX - pad) + ' ' + (minY - pad) + ' ' +
      ((maxX - minX) + pad * 2) + ' ' + ((maxY - minY) + pad * 2));
    this.svg.setAttribute('role', 'group');
    this.svg.setAttribute('aria-label', 'Mini map around your pawn. Tap a highlighted tile to move.');

    var numberById = new Map();
    validMoves.forEach(function (id, i) { numberById.set(String(id), i + 1); });

    var pawnByTile = new Map();
    (Array.isArray(o.pawns) ? o.pawns : []).forEach(function (p) {
      if (p && p.tileId != null) pawnByTile.set(String(p.tileId), p.color || '#fff');
    });

    var dimContext = o.dimContext !== false;
    var pendingId = o.pendingTileId != null ? String(o.pendingTileId) : null;
    var myColor = o.myColor || '#ffffff';
    var self = this;

    // Paint context tiles first, destinations last (so yellow rings sit above).
    entries.sort(function (a, b) {
      var av = validSet.has(String(a.tile.id)) ? 1 : 0;
      var bv = validSet.has(String(b.tile.id)) ? 1 : 0;
      return av - bv;
    });

    entries.forEach(function (e) {
      var tile = e.tile;
      var key = String(tile.id);
      var c = centerOf(tile);
      var isCenter = key === String(centerId);
      var isValid = validSet.has(key);
      var isPending = pendingId != null && key === pendingId;

      var g = mk('g');
      g.setAttribute('data-minimap-tile', key);

      var poly = mk('polygon');
      poly.setAttribute('points', hexPoints(c.cx, c.cy));
      poly.setAttribute('fill', FILL[tile.terrainType] || '#444');
      var dimmed = dimContext && !isCenter && !isValid;
      poly.setAttribute('opacity', dimmed ? '0.55' : '1');

      if (isPending) {
        poly.setAttribute('stroke', '#e74c3c');
        poly.setAttribute('stroke-width', '6');
      } else if (isValid) {
        poly.setAttribute('stroke', '#ffee00');
        poly.setAttribute('stroke-width', '6');
      } else if (isCenter) {
        poly.setAttribute('stroke', '#ffffff');
        poly.setAttribute('stroke-width', '5');
      } else {
        poly.setAttribute('stroke', STROKE[tile.terrainType] || '#222');
        poly.setAttribute('stroke-width', '2');
      }
      poly.setAttribute('stroke-linejoin', 'round');
      g.appendChild(poly);

      // Cost pill for ×2+ tiles (always centred — no icons share the hex).
      if (tile.movementCost > 1 && tile.terrainType !== 'mountain') {
        var pill = mk('rect');
        pill.setAttribute('x', c.cx - 24);
        pill.setAttribute('y', c.cy - 13);
        pill.setAttribute('width', 48);
        pill.setAttribute('height', 26);
        pill.setAttribute('rx', 13);
        pill.setAttribute('fill', 'rgba(0,0,0,0.62)');
        pill.setAttribute('pointer-events', 'none');
        g.appendChild(pill);
        var cost = mk('text');
        cost.setAttribute('x', c.cx);
        cost.setAttribute('y', c.cy + 1);
        cost.setAttribute('text-anchor', 'middle');
        cost.setAttribute('dominant-baseline', 'middle');
        cost.setAttribute('font-size', '20');
        cost.setAttribute('font-weight', 'bold');
        cost.setAttribute('fill', '#ffd700');
        cost.setAttribute('pointer-events', 'none');
        cost.textContent = '×' + tile.movementCost;
        g.appendChild(cost);
      }

      // Camp / finishing markers (warnings, not decoration).
      if (tile.terrainType === 'camp') {
        var camp = mk('text');
        camp.setAttribute('x', c.cx);
        camp.setAttribute('y', tile.movementCost > 1 ? c.cy - 26 : c.cy + 2);
        camp.setAttribute('text-anchor', 'middle');
        camp.setAttribute('dominant-baseline', 'middle');
        camp.setAttribute('font-size', '24');
        camp.setAttribute('pointer-events', 'none');
        camp.textContent = '⛺';
        g.appendChild(camp);
      }
      if (tile.isFinishing) {
        var flag = mk('text');
        flag.setAttribute('x', c.cx + 24);
        flag.setAttribute('y', c.cy - 24);
        flag.setAttribute('text-anchor', 'middle');
        flag.setAttribute('dominant-baseline', 'middle');
        flag.setAttribute('font-size', '18');
        flag.setAttribute('pointer-events', 'none');
        flag.textContent = '🏁';
        g.appendChild(flag);
      }

      // Number badge for legal destinations (matches TV + chip list order).
      if (isValid) {
        var badge = mk('g');
        badge.setAttribute('pointer-events', 'none');
        badge.setAttribute('transform', 'translate(' + c.cx + ',' + (c.cy - 34) + ')');
        var bg = mk('circle');
        bg.setAttribute('r', '21');
        bg.setAttribute('fill', 'rgba(0,0,0,0.92)');
        bg.setAttribute('stroke', '#ffffff');
        bg.setAttribute('stroke-width', '3');
        badge.appendChild(bg);
        var label = mk('text');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('font-size', '28');
        label.setAttribute('font-weight', '800');
        label.setAttribute('fill', '#ffffff');
        label.textContent = String(numberById.get(key) || '');
        badge.appendChild(label);
        g.appendChild(badge);
      }

      // Pawn dots for anyone standing in the excerpt (orientation).
      var pawnColor = pawnByTile.get(key);
      if (pawnColor || isCenter) {
        var dot = mk('circle');
        dot.setAttribute('cx', c.cx);
        dot.setAttribute('cy', isValid ? c.cy + 22 : c.cy);
        dot.setAttribute('r', isCenter ? '15' : '11');
        dot.setAttribute('fill', isCenter ? myColor : pawnColor);
        dot.setAttribute('stroke', '#fff');
        dot.setAttribute('stroke-width', isCenter ? '3.5' : '2.5');
        dot.setAttribute('pointer-events', 'none');
        g.appendChild(dot);
      }

      // Valid tiles are the tap targets — whole hex, plus a11y name.
      if (isValid) {
        g.style.cursor = 'pointer';
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', 'Move option ' + (numberById.get(key) || '') +
          ': ' + (tile.terrainType || 'unknown') + ' cost ' + (tile.movementCost || 1));
        (function (tileId) {
          g.addEventListener('click', function () { self.onSelect && self.onSelect(tileId); });
          g.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              self.onSelect && self.onSelect(tileId);
            }
          });
        })(tile.id);
      } else {
        g.setAttribute('aria-hidden', 'true');
      }

      self.svg.appendChild(g);
    });

    return entries.length;
  };

  MiniMap.prototype.clear = function () {
    while (this.svg.firstChild) this.svg.firstChild.remove();
  };

  // Pure helper (no DOM) for tests: which tile ids would be included?
  // tilesByCoord: Map "q,r" -> tile; centerId lookup via byId Map.
  MiniMap.excerptIds = function (allTiles, centerTileId, validMoves) {
    var byId = new Map();
    var byCoord = new Map();
    (allTiles || []).forEach(function (t) {
      byId.set(String(t.id), t);
      byCoord.set(t.q + ',' + t.r, t);
    });
    var center = byId.get(String(centerTileId));
    if (!center) return [];
    function nbs(tile) {
      return AXIAL_DIRS
        .map(function (d) { return byCoord.get((tile.q + d[0]) + ',' + (tile.r + d[1])); })
        .filter(Boolean);
    }
    var set = new Set([String(center.id)]);
    nbs(center).forEach(function (t) {
      set.add(String(t.id));
      nbs(t).forEach(function (u) { set.add(String(u.id)); });
    });
    (validMoves || []).forEach(function (id) {
      var t = byId.get(String(id));
      if (!t) return;
      set.add(String(t.id));
      nbs(t).forEach(function (u) { set.add(String(u.id)); });
    });
    return Array.from(set);
  };

  global.ElDoradoMiniMap = global.ElDoradoMiniMap || {};
  global.ElDoradoMiniMap.MiniMap = MiniMap;

})(typeof window !== 'undefined' ? window : globalThis);
