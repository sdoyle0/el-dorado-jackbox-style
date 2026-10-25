// tools/mapcompose/proof.js
//
// Session 2 replay proof (MAP_LAYOUTS_PLAN.md): composing the Hills of Gold
// layout must reproduce shared/mapData.json EXACTLY (ids, q/r, terrain,
// costs, playerNumber, isFinishing) and its derived seams must equal the
// five hand-derived edge-lists in shared/blockadeData.js (as edge sets —
// raw array order in blockadeData was a hand walk and is not meaningful).
//
// Exit 0 = proof holds. Exit 1 = mismatch (details on stdout).

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const mapCompose = require(path.join(REPO_ROOT, 'shared', 'mapCompose'));
const layout = require(path.join(REPO_ROOT, 'shared', 'layouts', 'hills-of-gold'));
const piecesData = require(path.join(REPO_ROOT, 'shared', 'pieces.json'));
const mapData = require(path.join(REPO_ROOT, 'shared', 'mapData.json'));
const { BLOCKADE_SEAMS } = require(path.join(REPO_ROOT, 'shared', 'blockadeData'));

const { composeLayout, validateWithPieces, edgeKey } = mapCompose;

let failures = 0;
function check(ok, label, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log(`Composing layout "${layout.name}" (${layout.placements.length} placements)…`);
const composed = composeLayout(layout, piecesData);

// ── 1. Validators ─────────────────────────────────────────────────────────
console.log('\n1) Structural validators');
const errs = validateWithPieces(layout, composed, piecesData);
check(errs.length === 0, 'validate(layout, composed)', errs.join('; ') || 'all checks pass');

// ── 2. Tiles vs mapData.json ──────────────────────────────────────────────
console.log('\n2) Composed tiles vs shared/mapData.json');
const sortKey = (t) => t.q * 1000 + t.r;
const a = [...composed.tiles].sort((x, y) => sortKey(x) - sortKey(y));
const b = [...mapData.tiles].sort((x, y) => sortKey(x) - sortKey(y));
check(a.length === b.length, 'tile count', `${a.length} vs ${b.length}`);

const FIELDS = ['id', 'q', 'r', 'terrainType', 'movementCost', 'playerNumber', 'isFinishing'];
const mismatches = [];
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  for (const f of FIELDS) {
    if (a[i][f] !== b[i][f]) {
      mismatches.push(
        `tile ${b[i].id} field ${f}: composed ${JSON.stringify(a[i][f])} vs mapData ${JSON.stringify(b[i][f])}`
      );
    }
  }
}
check(mismatches.length === 0, 'every tile field (id/q/r/terrain/cost/playerNumber/isFinishing)',
  mismatches.slice(0, 10).join('; ') || `${a.length} tiles identical`);
if (mismatches.length > 10) console.log(`        …and ${mismatches.length - 10} more`);

// ── 3. Derived seams vs BLOCKADE_SEAMS ────────────────────────────────────
console.log('\n3) Derived seams vs shared/blockadeData.js BLOCKADE_SEAMS');
const derived = composed.seams.filter((s) => !s.sides.includes('ending'));
const endingSeam = composed.seams.find((s) => s.sides.includes('ending'));

check(derived.length === BLOCKADE_SEAMS.length, 'seam count (excluding ending)',
  `${derived.length} derived vs ${BLOCKADE_SEAMS.length} in blockadeData`);

for (const seam of BLOCKADE_SEAMS) {
  const want = new Set(seam.edges.map(([x, y]) => edgeKey(x, y)));
  const got = derived.find((s) =>
    s.sides.join('') === seam.id.replace(/^BLK_/, '') ||
    s.sides.slice().reverse().join('') === seam.id.replace(/^BLK_/, '')
  );
  if (!got) {
    check(false, `${seam.id} present in derived seams`, 'missing');
    continue;
  }
  const gotSet = new Set(got.edges.map(([x, y]) => edgeKey(x, y)));
  const onlyWant = [...want].filter((k) => !gotSet.has(k));
  const onlyGot = [...gotSet].filter((k) => !want.has(k));
  check(
    onlyWant.length === 0 && onlyGot.length === 0 && want.size === gotSet.size,
    `${seam.id} (${want.size} edges)`,
    onlyWant.length || onlyGot.length
      ? `only in blockadeData: [${onlyWant}]; only in derived: [${onlyGot}]`
      : 'edge sets identical'
  );
}

check(
  !!endingSeam && endingSeam.edges.length > 0,
  'ending seam derived but blockade-free',
  endingSeam
    ? `ending touches ${endingSeam.sides.join('/')} via ${endingSeam.edges.length} edge(s): ${JSON.stringify(endingSeam.edges)}`
    : 'no ending seam found'
);

// ── 4. Summary ────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
if (failures === 0) {
  console.log(`PROOF PASSED — composed "${layout.name}" == mapData.json, seams == BLOCKADE_SEAMS`);
  process.exit(0);
} else {
  console.log(`PROOF FAILED — ${failures} check(s) did not hold`);
  process.exit(1);
}
