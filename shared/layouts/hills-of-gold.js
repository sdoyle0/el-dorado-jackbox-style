// shared/layouts/hills-of-gold.js
//
// Hills of Gold (easy) — the game's default map, expressed as piece
// placements. The placements are the recovered "identity" placement: each
// piece sits at its anchor (top-left hex in pixel space) exactly as printed
// in shared/mapData.json, so composing this layout must reproduce that file
// exactly (see tools/mapcompose/proof.js).
//
// Fields:
//   side        key into shared/pieces.json
//   rot         0-5, 60° clockwise steps applied to the piece's local hexes
//   at          world-space anchor hex as "q_r" (the piece's local (0,0))
//   blockades   (optional) which derived seams carry a blockade. Omitted
//               here: every seam between two terrain pieces gets one, and
//               the ending seam never does — the Hills of Gold print rule.

module.exports = {
  id: 'hills-of-gold',
  name: 'Hills of Gold',
  difficulty: 'easy',
  placements: [
    { side: 'B', rot: 0, at: '0_-3' },
    { side: 'C', rot: 0, at: '3_-10' },
    { side: 'G', rot: 0, at: '7_-17' },
    { side: 'K', rot: 0, at: '11_-14' },
    { side: 'J', rot: 0, at: '15_-11' },
    { side: 'N', rot: 0, at: '22_-14' },
    { side: 'ending', rot: 0, at: '26_-12' },
  ],
};
