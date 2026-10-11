// shared/blockadeData.js
//
// A blockade sits across an entire SEAM between two board sections.
// The first player to cross ANY edge in the seam pays the toll (one card
// matching the blockade's terrain type, cost 1) and removes the blockade
// for everyone. After that, all edges in the seam are freely passable.
//
// Terrain types are randomised at game start — one per seam.
// A blockade costs exactly the same as crossing a normal tile of that
// terrain type: one card matching the terrain (or, for rubble blockades,
// one card of any type — same as a base rubble tile). Breaking it does
// NOT cost anything extra beyond the one card played.
//
// Edge pairs: [tileA_id, tileB_id] — order doesn't matter, both directions
// are checked. All pairs were derived programmatically from mapData.json by
// finding adjacent tiles on opposite sides of each section boundary.

// TODO: There are 5 seams but the physical blockade set's actual terrain
// breakdown is unknown/unchecked. Placeholder below just duplicates
// 'rubble' to pad 4 types out to 5 entries — swap this out once the box
// contents are confirmed (e.g. if there are 2 of one color instead).
const BLOCKADE_TERRAIN_POOL = ['jungle', 'water', 'village', 'rubble', 'rubble'];

// Static seam definitions — terrain is assigned at runtime.
const BLOCKADE_SEAMS = [
  {
    id: 'BLK_BC',
    label: 'B↔C',
    // r=-3 (section B) adjacent to r=-4 (section C)
    edges: [
      ['0_-3',  '0_-4'],
      ['0_-3',  '1_-4'],

      ['1_-3',  '1_-4'],
      ['1_-3',  '2_-4'],

      ['2_-3',  '2_-4'],
      ['2_-3',  '3_-4'],
      
      ['3_-3',  '3_-4'],
    ],
  },
  {
    id: 'BLK_CG',
    label: 'C↔G',
    // Diagonal seam spanning q=3–q=7 (section C to section G).
    // Last edge touches mountain 7_-11 (impassable — never crossable, but
    // the seam must still be broken to use the other edges).
    edges: [
      ['3_-10', '4_-11'],

      ['4_-10', '4_-11'],
      ['4_-10', '5_-11'],

      ['5_-10', '5_-11'],
      ['5_-10', '6_-11'],

      ['6_-10', '6_-11'],
      ['6_-10', '7_-11'],
    ],
  },
  {
    id: 'BLK_GK',
    label: 'G↔K',
    // Diagonal seam spanning q=7–q=11 (section G to section K).
    // First edge touches mountain 7_-11 (impassable — never crossable, but
    // the seam must still be broken to use the other edges).
    edges: [
      ['10_-14', '11_-14'],
      ['10_-14', '10_-13'],

      ['9_-13', '10_-13'],
      ['9_-13', '9_-12'],

      ['8_-12', '9_-12'],
      ['8_-12', '8_-11'],

      ['7_-11', '8_-11'],
    ],
  },
  {
    id: 'BLK_KJ',
    label: 'K↔J',
    // Diagonal seam spanning q=11–q=15 (section K to section J).
    edges: [
      ['14_-11', '15_-11'],
      ['14_-11', '14_-10'],

      ['13_-10', '14_-10'],
      ['13_-10', '13_-9'],
      
      ['12_-9', '13_-9'],
      ['12_-9', '12_-8'],

      ['11_-8', '12_-8']
    ],
  },
  {
    id: 'BLK_JN',
    label: 'J↔N',
    // q=18 (section J) adjacent to q=19 (section N)
    edges: [
      ['18_-8',  '19_-8'],
      ['18_-8',  '19_-9'],

      ['18_-9',  '19_-9'],
      ['18_-9',  '19_-10'],

      ['18_-10', '19_-10'],
      ['18_-10', '19_-11'],

      ['18_-11', '19_-11'],
    ],
  },
];

// Build a lookup: "tileA|tileB" (sorted) → blockade object
// Stores the full blockade (including terrainType) for fast O(1) checks
// in HexBoard.isValidMove.
function buildEdgeLookup(activeBlockades) {
  const lookup = new Map();
  for (const b of activeBlockades) {
    for (const [a, c] of b.edges) {
      const key = [a, c].sort().join('|');
      lookup.set(key, b); // store full object so terrain is accessible
    }
  }
  return lookup;
}

function edgeKey(idA, idB) {
  return [idA, idB].sort().join('|');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BLOCKADE_SEAMS, BLOCKADE_TERRAIN_POOL, buildEdgeLookup, edgeKey };
} else {
  window.ElDoradoBlockades = { BLOCKADE_SEAMS, BLOCKADE_TERRAIN_POOL, buildEdgeLookup, edgeKey };
}
