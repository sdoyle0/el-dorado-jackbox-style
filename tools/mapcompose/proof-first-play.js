// tools/mapcompose/proof-first-play.js
const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const mapCompose = require(path.join(REPO_ROOT, 'shared', 'mapCompose'));
const layout = require(path.join(REPO_ROOT, 'shared', 'layouts', 'first-play'));
const piecesData = require(path.join(REPO_ROOT, 'shared', 'pieces.json'));

console.log(`Validating layout "${layout.name}" (${layout.placements.length} placements)…`);
const composed = mapCompose.composeLayout(layout, piecesData);
const errors = mapCompose.validateWithPieces(layout, composed, piecesData);

if (errors.length > 0) {
  console.error('Validation FAILED:', errors);
  process.exit(1);
} else {
  console.log('Validation PASSED!');
  console.log(`Total tiles: ${composed.tiles.length}`);
  console.log(`Derived seams: ${composed.seams.map(s => s.id).join(', ')}`);
  process.exit(0);
}
