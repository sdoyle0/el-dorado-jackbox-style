// tools/mapcompose/render-current-layout.js
const fs = require('fs');
const path = require('path');
const { composeLayout } = require('../../shared/mapCompose');
const layout = require('../../shared/layouts/first-play');
const piecesData = require('../../shared/pieces.json');

const composed = composeLayout(layout, piecesData);
const outPath = path.join(__dirname, '..', 'mapviz', 'out', 'first-play-current.json');
fs.writeFileSync(outPath, JSON.stringify({ tiles: composed.tiles }, null, 2));
console.log('Wrote', outPath);
console.log('Tiles:', composed.tiles.length);
