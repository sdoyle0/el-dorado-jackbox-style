// shared/mapCompose.js
//
// Composes a map layout (placements of physical pieces) into the flat tile
// list the engine already speaks (same shape as shared/mapData.json) plus
// derived seam edge-lists (same shape as BLOCKADE_SEAMS in blockadeData.js).
//
// Pure data transformation — no engine imports, no I/O. Node and browser:
//   const { composeLayout } = require('../../shared/mapCompose');
//   window.ElDoradoMapCompose   (browser global)
//
// Input layout:  shared/layouts/<id>.js  (see hills-of-gold.js)
// Input pieces:  shared/pieces.json      ({ pieces: { B: { hexes: [...] } } })
//
// Hex rotation follows the axial 60° clockwise step used by the hex grid in
// client/src/game/HexRenderer.js (flat-top, cx = 75q, cy = 43.3q + 86.6r):
//   rot60(dq, dr) = (-dr, dq + dr)
// so rot=1 sends local (1,0) to (0,1), (0,1) to (-1,1), and so on.

const AXIAL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

function edgeKey(a, b) {
  return [a, b].sort().join('|');
}

function rot60(dq, dr) {
  return { dq: -dr, dr: dq + dr };
}

function rotate(dq, dr, rot) {
  let n = ((rot % 6) + 6) % 6;
  let q = dq;
  let r = dr;
  while (n-- > 0) {
    const next = rot60(q, r);
    q = next.dq;
    r = next.dr;
  }
  return { dq: q, dr: r };
}

function parseAnchor(at) {
  const m = /^(-?\d+)_(-?\d+)$/.exec(String(at));
  if (!m) throw new Error(`bad anchor "q_r": ${at}`);
  return { q: parseInt(m[1], 10), r: parseInt(m[2], 10) };
}

// placements → { tiles, seams, placementOf }
//   tiles:       flat tile list, mapData.json shape
//   seams:       derived inter-piece edge lists, BLOCKADE_SEAMS shape
//   placementOf: tile id → side letter (for validators / blockade subsetting)
function composeLayout(layout, piecesData) {
  const pieces = piecesData.pieces || piecesData;
  if (!layout || !Array.isArray(layout.placements)) {
    throw new Error('layout must have a placements array');
  }

  const tiles = [];
  const placementOf = new Map();
  const sidesByPair = new Map(); // physical pair → sides used in this layout

  for (const p of layout.placements) {
    const piece = pieces[p.side];
    if (!piece) throw new Error(`unknown piece side "${p.side}"`);
    if (!piece.hexes || piece.hexes.length === 0) {
      throw new Error(`piece "${p.side}" has no hexes`);
    }
    if (piece.pair) {
      if (!sidesByPair.has(piece.pair)) sidesByPair.set(piece.pair, new Set());
      const used = sidesByPair.get(piece.pair);
      if (used.size > 0 && !used.has(p.side)) {
        throw new Error(
          `layout uses both faces of physical piece "${piece.pair}": ` +
          `${[...used].join(',')} and ${p.side}`
      );
      }
      used.add(p.side);
    }

    const anchor = parseAnchor(p.at);
    for (const h of piece.hexes) {
      const rotated = rotate(h.dq, h.dr, p.rot || 0);
      const q = anchor.q + rotated.dq;
      const r = anchor.r + rotated.dr;
      const id = `${q}_${r}`;
      if (placementOf.has(id)) {
        throw new Error(
          `tile overlap at ${id}: sides ${placementOf.get(id)} and ${p.side}`
        );
      }
      const tile = {
        id,
        q,
        r,
        terrainType: h.terrainType,
        movementCost: h.movementCost,
      };
      if (h.playerNumber != null) tile.playerNumber = h.playerNumber;
      if (h.isFinishing != null) tile.isFinishing = h.isFinishing;
      tiles.push(tile);
      placementOf.set(id, p.side);
    }
  }

  return { tiles, seams: deriveSeams(placementOf), placementOf };
}

// Every world edge joining two hexes of DIFFERENT placements becomes a seam
// (blockade-eligible join). Same-piece edges are internal and never seams.
// The ending piece never carries a blockade, but its seam is still derived
// so validators can see the full piece topology — layouts subset blockades.
function deriveSeams(placementOf) {
  const groups = new Map(); // "A|B" (sorted side pair) → edge list
  for (const [id, side] of placementOf) {
    const [q, r] = id.split('_').map(Number);
    for (const [dq, dr] of AXIAL_DIRS) {
      const nid = `${q + dq}_${r + dr}`;
      const nside = placementOf.get(nid);
      if (nside === undefined || nside === side) continue;
      const key = [side, nside].sort().join('|');
      if (!groups.has(key)) groups.set(key, []);
      const edges = groups.get(key);
      const ekey = edgeKey(id, nid);
      if (!edges.some((e) => edgeKey(e[0], e[1]) === ekey)) {
        edges.push([id, nid]);
      }
    }
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([pair, edges]) => ({
      id: `SEAM_${pair.replace('|', '')}`,
      sides: pair.split('|'),
      edges,
    }));
}

// ── Validators (fail loud) ────────────────────────────────────────────────

// Reachability from any start hex to a playable finishing hex, walking only
// passable (movementCost > 0) hexes. Podium spaces use el_dorado terrain and
// are deliberately excluded: they only hold pawns after a player finishes.
function validateConnectivity(tiles) {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const starts = tiles.filter((t) => t.playerNumber != null);
  const goals = new Set(tiles.filter((t) => t.isFinishing).map((t) => t.id));
  if (starts.length === 0) return 'no start hexes (playerNumber)';
  if (goals.size === 0) return 'no playable finishing hexes (isFinishing)';

  const seen = new Set(starts.map((t) => t.id));
  const queue = starts.map((t) => t.id);
  while (queue.length > 0) {
    const id = queue.shift();
    if (goals.has(id)) return null;
    const [q, r] = id.split('_').map(Number);
    for (const [dq, dr] of AXIAL_DIRS) {
      const nid = `${q + dq}_${r + dr}`;
      const n = byId.get(nid);
      if (!n || seen.has(nid) || n.movementCost <= 0) continue;
      seen.add(nid);
      queue.push(nid);
    }
  }
  return 'no passable path from start to a finishing space';
}

function validateStartMarkers(tiles) {
  const nums = tiles
    .filter((t) => t.playerNumber != null)
    .map((t) => t.playerNumber)
    .sort((a, b) => a - b);
  const want = [1, 2, 3, 4];
  if (nums.length !== 4 || nums.some((n, i) => n !== want[i])) {
    return `start hexes must carry playerNumber 1,2,3,4 exactly once (got ${JSON.stringify(nums)})`;
  }
  const nonStart = tiles.filter(
    (t) => t.terrainType === 'start' && t.playerNumber == null
  );
  if (nonStart.length > 0) {
    return `${nonStart.length} hex(es) typed "start" without playerNumber`;
  }
  return null;
}

function validateUniqueIds(tiles) {
  const seen = new Set();
  for (const t of tiles) {
    if (seen.has(t.id)) return `duplicate tile id ${t.id}`;
    seen.add(t.id);
  }
  return null;
}

// Run every structural check; returns a list of failure strings (empty = ok).
function validate(layout, composed) {
  const errors = [];
  const { tiles, placementOf } = composed;
  const push = (e) => e && errors.push(e);

  push(validateUniqueIds(tiles));
  push(validateStartMarkers(tiles));
  push(validateConnectivity(tiles));

  // Every placement's side must resolve and every tile must map back to one.
  for (const p of layout.placements) {
    if (![...placementOf.values()].includes(p.side)) {
      errors.push(`placement side ${p.side} produced no tiles`);
    }
  }

  // Terrain tallies per placement must match the piece definition
  // (rotation preserves terrain, so this catches data corruption).
  const pieces = layout._pieces ? layout._pieces.pieces : null;
  if (pieces) {
    const got = {};
    for (const t of tiles) {
      const side = placementOf.get(t.id);
      if (!got[side]) got[side] = {};
      got[side][t.terrainType] = (got[side][t.terrainType] || 0) + 1;
    }
    for (const p of layout.placements) {
      const want = {};
      for (const h of pieces[p.side].hexes) {
        want[h.terrainType] = (want[h.terrainType] || 0) + 1;
      }
      const g = got[p.side] || {};
      const keys = new Set([...Object.keys(want), ...Object.keys(g)]);
      for (const k of keys) {
        if ((want[k] || 0) !== (g[k] || 0)) {
          errors.push(
            `side ${p.side} terrain ${k}: composed ${g[k] || 0}, piece ${want[k] || 0}`
          );
        }
      }
    }
  }

  return errors;
}

// Convenience: validate including per-side terrain tallies.
function validateWithPieces(layout, composed, piecesData) {
  const pieces = piecesData.pieces || piecesData;
  return validate({ ...layout, _pieces: { pieces } }, composed);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AXIAL_DIRS,
    edgeKey,
    rot60,
    rotate,
    parseAnchor,
    composeLayout,
    deriveSeams,
    validate,
    validateWithPieces,
    validateConnectivity,
    validateStartMarkers,
    validateUniqueIds,
  };
} else {
  window.ElDoradoMapCompose = {
    AXIAL_DIRS,
    edgeKey,
    rot60,
    rotate,
    parseAnchor,
    composeLayout,
    deriveSeams,
    validate,
    validateWithPieces,
    validateConnectivity,
    validateStartMarkers,
    validateUniqueIds,
  };
}
