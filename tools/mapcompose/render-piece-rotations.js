// tools/mapcompose/render-piece-rotations.js
const fs = require('fs');
const path = require('path');
const { composeLayout, AXIAL_DIRS } = require('../../shared/mapCompose');
const piecesData = require('../../shared/pieces.json');
const pieces = piecesData.pieces || piecesData;

// Render a single piece at all 6 rotations for visual comparison
function renderPiece(side) {
  const piece = pieces[side];
  console.log(`\n=== Piece ${side} (${piece.hexes.length} hexes) ===`);

  for (let rot = 0; rot < 6; rot++) {
    const layout = {
      id: `piece-${side}-${rot}`,
      name: `Piece ${side} rot ${rot}`,
      difficulty: 'easy',
      placements: [{ side, rot, at: '0_0' }],
    };

    try {
      const composed = composeLayout(layout, piecesData);
      const jsonPath = path.join(
        __dirname,
        '..',
        'mapviz',
        'out',
        `piece-${side}-rot${rot}.json`
      );
      fs.writeFileSync(
        jsonPath,
        JSON.stringify({ tiles: composed.tiles }, null, 2)
      );
    } catch (e) {
      console.log(`  rot ${rot}: ERROR ${e.message}`);
    }
  }
}

['B', 'C', 'N', 'I', 'K', 'ending'].forEach(renderPiece);
console.log('\nDone. Render each with: node tools/mapviz/render.js --map tools/mapviz/out/piece-<side>-rot<rot>.json --png');
