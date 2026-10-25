// shared/layouts/first-play.js
//
// First Play (easy) — setup sheet page 1 introductory map.
// Path: B(bottom-left) → C(up-right) → N(up-right) → I(down-right) → K(up-right) → ending(top-right)

module.exports = {
  "id": "first-play",
  "name": "First Play",
  "difficulty": "easy",
  "placements": [
    {
      "side": "B",
      "rot": 0,
      "at": "-16_18"
    },
    {
      "side": "C",
      "rot": 4,
      "at": "-15_17"
    },
    {
      "side": "N",
      "rot": 3,
      "at": "-5_13"
    },
    {
      "side": "I",
      "rot": 0,
      "at": "2_4"
    },
    {
      "side": "K",
      "rot": 4,
      "at": "2_3"
    },
    {
      "side": "ending",
      "rot": 4,
      "at": "4_-3"
    },
  ]
};
