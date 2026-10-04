// shared/constants.js — mirrors Globals.gd

const TerrainType = {
  JUNGLE:   'jungle',
  WATER:    'water',
  VILLAGE:  'village',   // yellow tiles — entered by yellow (village) cards
  MOUNTAIN: 'mountain',  // impassable
  CAMP:     'camp',      // ends movement; card is one-time-use
  RUBBLE:   'rubble',    // costs extra cards from hand
  WILD:     'wild',      // card type only — matches any terrain
  EMPTY:    'empty',     // purple card terrain — no movement, special effect only
  START:    'start',     // player start tile (playerNumber field = which player)
  EL_DORADO:'el_dorado', // win condition
};

const CardEffect = {
  NONE:         'none',
  TRANSMITTER:  'transmitter',  // free purchase worth 20 gold
  CARTOGRAPHER: 'cartographer', // draw 2 cards
  COMPASS:      'compass',      // draw 3 cards
  SCIENTIST:    'scientist',    // draw 1, remove 1 from hand
  TRAVEL_LOG:   'travel_log',   // draw 2, remove 2 from hand
  NATIVE:       'native',       // move to any adjacent passable tile
};

const GameState = {
  AWAITING_CARD: 'awaiting_card',
  AWAITING_MOVE: 'awaiting_move',
  TURN_END:      'turn_end',
  GAME_OVER:     'game_over',
};

// Card keys — match Globals.CARD_KEYS in GDScript
const CARD_KEYS = {
  // Green (Jungle)
  EXPLORER:          'explorer',
  SCOUT:             'scout',
  TRAILBLAZER:       'trailblazer',
  PIONEER:           'pioneer',
  GIANT_MACHETE:     'giant_machete',
  // Blue (Water)
  SAILOR:            'sailor',
  CAPTAIN:           'captain',
  // Yellow (Village / purchasing)
  TRAVELER:          'traveler',
  PHOTOGRAPHER:      'photographer',
  JOURNALIST:        'journalist',
  TREASURE_CHEST:    'treasure_chest',
  MILLIONAIRE:       'millionaire',
  // Black (Wild)
  JACK_OF_ALL_TRADES:'jack_of_all_trades',
  ADVENTURER:        'adventurer',
  PROP_PLANE:        'prop_plane',
  // Purple (Special effects)
  TRANSMITTER:       'transmitter',
  CARTOGRAPHER:      'cartographer',
  COMPASS:           'compass',
  SCIENTIST:         'scientist',
  TRAVEL_LOG:        'travel_log',
  NATIVE:            'native',
};

const TRANSMITTER_PURCHASE_POWER = 20;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TerrainType, CardEffect, GameState, CARD_KEYS, TRANSMITTER_PURCHASE_POWER };
} else {
  window.ElDoradoConstants = { TerrainType, CardEffect, GameState, CARD_KEYS, TRANSMITTER_PURCHASE_POWER };
}
