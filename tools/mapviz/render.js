#!/usr/bin/env node
// tools/mapviz/render.js — MAP_LAYOUTS_PLAN session 1 (visualizer).
//
// Renders a flat tile list (default: shared/mapData.json) to SVG with
//   - terrain colours (same palette as client/src/game/HexRenderer.js)
//   - hover tooltips: id · terrain · cost (SVG <title>)
//   - movement-cost digits
//   - red seam lines (blockade edge-lists) where the seam exists on this map
//   - piece overlay: boundary stroke + side label per seam-cut piece
//
//   node tools/mapviz/render.js                     # shared/mapData.json
//   node tools/mapviz/render.js --map other.json --out out/other.svg
//   node tools/mapviz/render.js --no-seams --no-pieces --no-costs
//   node tools/mapviz/render.js --png                # also write .png (needs Chrome)

const fs = require('fs');
const path = require('path');
const {
  REPO_ROOT, center, hexPoints, edgeKey, loadSeams, seamEdgeKeys,
  cutComponents, splitEnding, labelPieces, HEX_R,
} = require('./lib');

// Same palette as HexRenderer.js (flat fills; bevel detail is game-only).
const TERRAIN = {
  jungle: { fill: '#2a6b1a', icon: '\u{1F33F}' },
  water: { fill: '#1a5a9a', icon: '\u{1F30A}' },
  village: { fill: '#b07820', icon: '\u{1F3D8}️' },
  mountain: { fill: '#2a2420', icon: '⛰' },
  camp: { fill: '#7a3a28', icon: '⛺' },
  rubble: { fill: '#5a5244', icon: '\u{1FAA8}' },
  start: { fill: '#781ba3', icon: '\u{1F3F3}' },
  el_dorado: { fill: '#1a6a48', icon: '\u{1F3C6}' },
};

// Distinct hues for the piece overlay (B/C/G/K/J/N… order).
const PIECE_COLORS = [
  '#ff5f5f', '#ffb43a', '#ffe94a', '#4cd964', '#39c5ff', '#a76bff',
  '#ff6ad5', '#6affc3', '#ff9770', '#7d8bff',
];


function parseArgs(argv) {
  const args = {
    map: path.join(REPO_ROOT, 'shared', 'mapData.json'),
    out: null,
    seams: true,
    pieces: true,
    costs: true,
    png: false,
    title: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map') args.map = path.resolve(argv[++i]);
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--no-seams') args.seams = false;
    else if (a === '--no-pieces') args.pieces = false;
    else if (a === '--no-costs') args.costs = false;
    else if (a === '--png') args.png = true;
    else if (a === '--title') args.title = argv[++i];
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function sharedEdgeLine(t1, t2) {
  const c1 = center(t1.q, t1.r);
  const verts = hexPoints(c1.x, c1.y);
  const c2 = center(t2.q, t2.r);
  const near = verts
    .map((v) => ({ v, d: (v[0] - c2.x) ** 2 + (v[1] - c2.y) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map((x) => x.v);
  return near;
}

function centroid(tiles) {
  let x = 0;
  let y = 0;
  for (const t of tiles) {
    const c = center(t.q, t.r);
    x += c.x;
    y += c.y;
  }
  return { x: x / tiles.length, y: y / tiles.length };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSvg(mapData, opts) {
  const tiles = mapData.tiles;
  const byId = new Map(tiles.map((t) => [t.id, t]));

  // pieces (seam cut) — optional overlay
  let pieces = [];
  let pieceOf = new Map();
  if (opts.pieces) {
    const seams = loadSeams();
    const blocked = seamEdgeKeys(seams);
    pieces = labelPieces(splitEnding(cutComponents(tiles, blocked)), seams);
    pieces.forEach((p, i) => p.tiles.forEach((t) => pieceOf.set(t.id, i)));
  }

  // seams
  let seamLines = [];
  if (opts.seams) {
    const seams = loadSeams();
    const blocked = seamEdgeKeys(seams);
    for (const seam of seams) {
      for (const [a, b] of seam.edges) {
        const t1 = byId.get(a);
        const t2 = byId.get(b);
        if (!t1 || !t2 || !blocked.has(edgeKey(a, b))) continue;
        seamLines.push({ seam, pts: sharedEdgeLine(t1, t2) });
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    const c = center(t.q, t.r);
    minX = Math.min(minX, c.x - HEX_R - 4);
    maxX = Math.max(maxX, c.x + HEX_R + 4);
    minY = Math.min(minY, c.y - HEX_R - 4);
    maxY = Math.max(maxY, c.y + HEX_R + 4);
  }

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(maxX - minX)}" height="${Math.ceil(maxY - minY)}" `
    + `viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" font-family="Helvetica, Arial, sans-serif">`
  );
  parts.push(`<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#efe6cf"/>`);

  // hexes
  for (const t of tiles) {
    const c = center(t.q, t.r);
    const style = TERRAIN[t.terrainType] || { fill: '#444' };
    const pts = hexPoints(c.x, c.y)
      .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join(' ');
    parts.push('<g>');
    parts.push(
      `<title>${esc(t.id)} · ${esc(t.terrainType)} · cost ${t.movementCost}`
      + (t.playerNumber != null ? ` · start P${t.playerNumber}` : '')
      + (t.isFinishing ? ' · FINISH' : '')
      + '</title>'
    );
    parts.push(`<polygon points="${pts}" fill="${style.fill}" stroke="#1d1d1d" stroke-width="2"/>`);
    if (opts.costs) {
      const label = t.movementCost === 0 ? '✕' : String(t.movementCost);
      parts.push(
        `<text x="${c.x.toFixed(1)}" y="${(c.y + 4).toFixed(1)}" font-size="15" text-anchor="middle" `
        + `fill="rgba(255,255,255,0.72)" font-weight="bold">${label}</text>`
      );
    }
    parts.push('</g>');
  }

  // piece overlay: tinted hexes are skipped (would muddy colours) — instead
  // stroke each piece boundary + label at centroid.
  if (opts.pieces) {
    pieces.forEach((p, i) => {
      const color = PIECE_COLORS[i % PIECE_COLORS.length];
      for (const t of p.tiles) {
        const c = center(t.q, t.r);
        const verts = hexPoints(c.x, c.y);
        for (let k = 0; k < 6; k++) {
          const v1 = verts[k];
          const v2 = verts[(k + 1) % 6];
          // edge midpoint → is there a neighbouring tile across it?
          const mx = (v1[0] + v2[0]) / 2;
          const my = (v1[1] + v2[1]) / 2;
          const dx = mx - c.x;
          const dy = my - c.y;
          const len = Math.hypot(dx, dy) || 1;
          // neighbour across this edge = step ~5/6 of hex radius along normal
          const nx = c.x + (dx / len) * (HEX_R * 0.86);
          const ny = c.y + (dy / len) * (HEX_R * 0.86);
          const owner = pieceAt(pieces, nx, ny, pieceOf, byId);
          if (owner !== i) {
            parts.push(
              `<line x1="${v1[0].toFixed(1)}" y1="${v1[1].toFixed(1)}" x2="${v2[0].toFixed(1)}" y2="${v2[1].toFixed(1)}" `
              + `stroke="${color}" stroke-width="5" stroke-linecap="round"/>`
            );
          }
        }
      }
      const ct = centroid(p.tiles);
      const label = p.name;
      parts.push(
        `<text x="${ct.x.toFixed(1)}" y="${ct.y.toFixed(1)}" font-size="42" font-weight="bold" `
        + `text-anchor="middle" fill="${color}" stroke="#000" stroke-width="2" `
        + `paint-order="stroke" style="pointer-events:none">${esc(label)}</text>`
      );
    });
  }

  // seam lines (drawn last, on top)
  if (opts.seams) {
    for (const { seam, pts } of seamLines) {
      parts.push(
        `<line x1="${pts[0][0].toFixed(1)}" y1="${pts[0][1].toFixed(1)}" `
        + `x2="${pts[1][0].toFixed(1)}" y2="${pts[1][1].toFixed(1)}" `
        + `stroke="#ff2d2d" stroke-width="6" stroke-linecap="round" stroke-dasharray="10 7" `
        + `style="pointer-events:none"><title>${esc(seam.id)} (${esc(seam.label)})</title></line>`
      );
    }
  }

  if (opts.title) {
    parts.push(
      `<text x="${((minX + maxX) / 2).toFixed(1)}" y="${(minY + 34).toFixed(1)}" font-size="30" `
      + `font-weight="bold" text-anchor="middle" fill="#4a3210">${esc(opts.title)}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// Which piece owns the pixel (x, y)? Uses a nearest-hex lookup from the
// already-built piece map (avoids full geometry re-derivation).
function pieceAt(pieces, x, y, pieceOf, byId) {
  // invert pixel → axial approximately: q = x/75, r = (y - 43.3q)/86.6
  const q = Math.round(x / 75);
  const r = Math.round((y - 43.3 * q) / 86.6);
  // try the rounded hex and its neighbours (rounding can be off by one)
  const candidates = [[q, r], [q + 1, r], [q - 1, r], [q, r + 1], [q, r - 1], [q + 1, r - 1], [q - 1, r + 1]];
  for (const [cq, cr] of candidates) {
    const t = byId.get(`${cq}_${cr}`);
    if (t && pieceOf.has(t.id)) return pieceOf.get(t.id);
  }
  return -1;
}

async function toPng(svgPath, pngPath) {
  const puppeteer = require(path.join(REPO_ROOT, 'tools', 'demo-record', 'node_modules', 'puppeteer-core'));
  const execPath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    const svg = fs.readFileSync(svgPath, 'utf8');
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    const w = m ? Number(m[1]) : 1200;
    const h = m ? Number(m[2]) : 900;
    await page.setViewport({ width: Math.min(w, 4000), height: Math.min(h, 4000), deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;padding:0;background:#efe6cf}</style>${svg}`,
      { waitUntil: 'load' }
    );
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: w, height: h } });
  } finally {
    await browser.close();
  }
}

(async () => {
  const args = parseArgs(process.argv);
  const mapData = JSON.parse(fs.readFileSync(args.map, 'utf8'));
  const svg = buildSvg(mapData, args);

  const base = args.map.replace(/\.json$/, '').split('/').pop();
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = args.out || path.join(outDir, `${base}.svg`);
  fs.writeFileSync(outPath, svg);
  console.log(`wrote ${outPath}`);

  if (args.png) {
    const pngPath = outPath.replace(/\.svg$/, '.png');
    await toPng(outPath, pngPath);
    console.log(`wrote ${pngPath}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
