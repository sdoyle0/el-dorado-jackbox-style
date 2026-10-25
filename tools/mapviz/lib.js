// tools/mapviz/lib.js
//
// Geometry + seam-cut recovery helpers shared by the mapviz tools.
// Tooling only — nothing under shared/ or server/ imports this, so the
// engine is untouched (MAP_LAYOUTS_PLAN session 1).
//
// Coordinate system matches client/src/game/HexRenderer.js:
//   flat-top hexes, cx = 75 * q, cy = 43.3 * q + 86.6 * r, HEX_R = 50.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MAP_DATA_PATH = path.join(REPO_ROOT, 'shared', 'mapData.json');
const BLOCKADE_DATA_PATH = path.join(REPO_ROOT, 'shared', 'blockadeData.js');
const PIECES_PATH = path.join(REPO_ROOT, 'shared', 'pieces.json');

const AXIAL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
const HEX_R = 50;
const W_STEP = 75;
const H_STEP = 86.6;
const H_HALF = 43.3;

// Physical cardboard pieces (one face per pair per layout — plan validator).
// The ending assembly combines one playable Water/Jungle face with the three
// non-playable el_dorado podium spaces.
const PAIRS = {
  A: 'AB', B: 'AB',
  C: 'CD', D: 'CD',
  E: 'EF', F: 'EF',
  G: 'GH', H: 'GH',
  I: 'IJ', J: 'IJ',
  K: 'KL', L: 'KL',
  M: 'MN', N: 'MN',
  O: 'OP', P: 'OP',
  Q: 'QR', R: 'QR',
  ending: 'ending',
};

// helpers-site terrain names → our terrainType values (caves out of scope:
// "Mountain" and "Mountain w/ Cave" both collapse to 'mountain').
const CATALOGUE_TERRAIN_MAP = {
  jungle: 'jungle',
  water: 'water',
  village: 'village', // helpers call it "Sand"
  camp: 'camp',       // helpers call it "Base Camp"
  rubble: 'rubble',
  mountain: 'mountain',
  mountainCave: 'mountain',
};

function center(q, r) {
  return { x: W_STEP * q, y: H_HALF * q + H_STEP * r };
}

function hexPoints(cx, cy, radius = HEX_R) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

function edgeKey(a, b) {
  return [a, b].sort().join('|');
}

function loadMapData() {
  delete require.cache[MAP_DATA_PATH];
  return require(MAP_DATA_PATH);
}

function loadSeams() {
  delete require.cache[BLOCKADE_DATA_PATH];
  return require(BLOCKADE_DATA_PATH).BLOCKADE_SEAMS;
}

function seamEdgeKeys(seams) {
  const keys = new Set();
  for (const seam of seams) {
    for (const [a, b] of seam.edges) keys.add(edgeKey(a, b));
  }
  return keys;
}

// ── Seam cut ──────────────────────────────────────────────────────────────
// Union-find over every hex adjacency EXCEPT the seam edges (plus optional
// extra cuts) → connected components = physical pieces.

function cutComponents(tiles, blockedKeys) {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const parent = new Map(tiles.map((t) => [t.id, t.id]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const nxt = parent.get(cur);
      parent.set(cur, root);
      cur = nxt;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const t of tiles) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const n = byId.get(`${t.q + dq}_${t.r + dr}`);
      if (!n) continue;
      if (blockedKeys.has(edgeKey(t.id, n.id))) continue;
      union(t.id, n.id);
    }
  }

  const groups = new Map();
  for (const t of tiles) {
    const root = find(t.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  return [...groups.values()];
}

// The three playable finishing spaces and three non-playable podium spaces
// form the six-hex ending assembly. The finishing spaces are attached to the
// last terrain piece in mapData, but are not part of that 37-hex face.
function splitEnding(groups) {
  const out = [];
  for (const group of groups) {
    const ending = group.filter((t) =>
      t.isFinishing || t.terrainType === 'el_dorado'
    );
    const terrain = group.filter((t) =>
      !t.isFinishing && t.terrainType !== 'el_dorado'
    );
    if (ending.length === 0) {
      out.push(group);
      continue;
    }
    out.push(ending);
    if (terrain.length > 0) out.push(terrain);
  }
  return out;
}

// Resolve which component is which side letter using the seam-id chain
// (BLK_BC → B–C, BLK_CG → C–G, …), seeded from the component that carries
// the playerNumber start hexes — the chain head letter (the one that never
// appears second, i.e. 'B' here) belongs to the start piece.
function labelPieces(groups, seams) {
  const groupOf = new Map(); // tile id → group index
  groups.forEach((g, i) => g.forEach((t) => groupOf.set(t.id, i)));

  const pairs = seams.map((s) => s.id.replace(/^BLK_/, '').split(''));
  const seconds = new Set(pairs.map((p) => p[1]));
  const chainHead = pairs.find((p) => !seconds.has(p[0]))?.[0] ?? pairs[0][0];

  const labelled = new Map(); // group index → side letter
  const startGroup = groups.findIndex((g) => g.some((t) => t.playerNumber != null));

  if (startGroup >= 0) {
    labelled.set(startGroup, chainHead);
    let curGroup = startGroup;
    let curLetter = chainHead;
    for (const seam of seams) {
      const [x, y] = seam.id.replace(/^BLK_/, '').split('');
      if (x !== curLetter && y !== curLetter) break;
      const farLetter = x === curLetter ? y : x;
      const touched = new Set();
      for (const [a, b] of seam.edges) {
        touched.add(groupOf.get(a));
        touched.add(groupOf.get(b));
      }
      const nextGroup = [...touched].find((g) => g !== curGroup);
      if (nextGroup === undefined) break;
      if (!labelled.has(nextGroup)) labelled.set(nextGroup, farLetter);
      curGroup = nextGroup;
      curLetter = farLetter;
    }
  }

  const endingGroup = groups.findIndex((g) => g.some((t) => t.terrainType === 'el_dorado'));

  return groups.map((g, i) => {
    let name = labelled.get(i);
    if (!name && i === endingGroup) name = 'ending';
    if (!name) name = `unknown_${i}`;
    const kind = g.some((t) => t.playerNumber != null)
      ? 'start'
      : g.some((t) => t.terrainType === 'el_dorado')
        ? 'ending'
        : 'terrain';
    return { name, kind, tiles: g };
  });
}

// ── Piece derivation ──────────────────────────────────────────────────────

// Top-left anchor in pixel space (y then x) — deterministic, stable under
// the rotations the composer will apply later.
function anchorOf(tiles) {
  let best = null;
  let bestKey = Infinity;
  for (const t of tiles) {
    const c = center(t.q, t.r);
    const key = c.y * 10000 + c.x;
    if (key < bestKey) {
      bestKey = key;
      best = t;
    }
  }
  return { q: best.q, r: best.r };
}

function toLocal(tiles, anchor) {
  return tiles
    .map((t) => {
      const hex = {
        dq: t.q - anchor.q,
        dr: t.r - anchor.r,
        terrainType: t.terrainType,
        movementCost: t.movementCost,
      };
      if (t.playerNumber != null) hex.playerNumber = t.playerNumber;
      if (t.isFinishing != null) hex.isFinishing = t.isFinishing;
      return hex;
    })
    .sort((a, b) => a.dr - b.dr || a.dq - b.dq);
}

function tally(tiles) {
  const out = {};
  for (const t of tiles) out[t.terrainType] = (out[t.terrainType] || 0) + 1;
  return out;
}

function recoverPieces(mapData = loadMapData(), seams = loadSeams()) {
  const blocked = seamEdgeKeys(seams);
  const groups = splitEnding(cutComponents(mapData.tiles, blocked));
  const named = labelPieces(groups, seams);
  return named.map(({ name, kind, tiles }) => {
    const anchor = anchorOf(tiles);
    return {
      name,
      kind,
      pair: PAIRS[name] || null,
      anchor,
      tiles,
      hexes: toLocal(tiles, anchor),
      tally: tally(tiles),
    };
  });
}

// ── Edge geometry (seam / piece-boundary lines) ───────────────────────────

// The two shared polygon vertices of neighbouring hexes (used to draw the
// seam line exactly across the shared edge).
function sharedEdgePoints(t1, t2) {
  const c1 = center(t1.q, t1.r);
  const verts = hexPoints(c1.x, c1.y);
  const c2 = center(t2.q, t2.r);
  return verts
    .map((v) => ({ v, d: (v[0] - c2.x) ** 2 + (v[1] - c2.y) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .sort((a, b) => Math.atan2(a.v[1] - c1.y, a.v[0] - c1.x) - Math.atan2(b.v[1] - c1.y, b.v[0] - c1.x))
    .map((x) => x.v);
}

module.exports = {
  REPO_ROOT,
  MAP_DATA_PATH,
  BLOCKADE_DATA_PATH,
  PIECES_PATH,
  AXIAL_DIRS,
  HEX_R,
  W_STEP,
  H_STEP,
  H_HALF,
  PAIRS,
  CATALOGUE_TERRAIN_MAP,
  center,
  hexPoints,
  edgeKey,
  loadMapData,
  loadSeams,
  seamEdgeKeys,
  cutComponents,
  splitEnding,
  labelPieces,
  anchorOf,
  toLocal,
  tally,
  recoverPieces,
  sharedEdgePoints,
};
