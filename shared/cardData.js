// shared/cardData.js
// Direct port of CardLibrary.gd + CardData.gd
//
// Purchasing power (from CardData.getPurchasingPower()):
//   - village terrain cards → purchasing power = movementTotal
//   - all other cards       → purchasing power = 0.5  (need 2 to = 1 gold)
//
// oneTimeUse list (from multiplayer_service._is_card_type_one_time_use):
//   GIANT_MACHETE, TREASURE_CHEST, PROP_PLANE, TRANSMITTER, COMPASS, TRAVEL_LOG

const _cardDataDeps = (typeof module !== 'undefined' && module.exports)
  ? require('./constants')
  : window.ElDoradoConstants;

// Color strings for UI rendering (from CardLibrary.gd)
const CARD_COLORS = {
  green:  '#007600',
  blue:   '#0000ff',
  yellow: '#eac200',
  purple: '#9200c8',
  black:  '#222222',
};

// All card definitions — mirrors _add_card_data() calls in CardLibrary.gd
const CARD_DEFINITIONS = [

  // ── GREEN (Jungle movement) ────────────────────────────────────────────────
  { key:'explorer',      cardName:'Explorer',       color:'green',  cost:0, oneTimeUse:false, specialEffect:'none',         movementTerrain:'jungle',  movementTotal:1 },
  { key:'scout',         cardName:'Scout',          color:'green',  cost:1, oneTimeUse:false, specialEffect:'none',         movementTerrain:'jungle',  movementTotal:2 },
  { key:'trailblazer',   cardName:'Trailblazer',    color:'green',  cost:3, oneTimeUse:false, specialEffect:'none',         movementTerrain:'jungle',  movementTotal:3 },
  { key:'pioneer',       cardName:'Pioneer',        color:'green',  cost:5, oneTimeUse:false, specialEffect:'none',         movementTerrain:'jungle',  movementTotal:5 },
  { key:'giant_machete', cardName:'Giant Machete',  color:'green',  cost:3, oneTimeUse:true,  specialEffect:'none',         movementTerrain:'jungle',  movementTotal:6 },

  // ── BLUE (Water movement) ─────────────────────────────────────────────────
  { key:'sailor',        cardName:'Sailor',         color:'blue',   cost:0, oneTimeUse:false, specialEffect:'none',         movementTerrain:'water',   movementTotal:1 },
  { key:'captain',       cardName:'Captain',        color:'blue',   cost:2, oneTimeUse:false, specialEffect:'none',         movementTerrain:'water',   movementTotal:2 },

  // ── YELLOW (Village / purchasing power) ───────────────────────────────────
  { key:'traveler',      cardName:'Traveler',       color:'yellow', cost:0, oneTimeUse:false, specialEffect:'none',         movementTerrain:'village', movementTotal:1 },
  { key:'photographer',  cardName:'Photographer',   color:'yellow', cost:2, oneTimeUse:false, specialEffect:'none',         movementTerrain:'village', movementTotal:2 },
  { key:'journalist',    cardName:'Journalist',     color:'yellow', cost:3, oneTimeUse:false, specialEffect:'none',         movementTerrain:'village', movementTotal:3 },
  { key:'treasure_chest',cardName:'Treasure Chest', color:'yellow', cost:3, oneTimeUse:true,  specialEffect:'none',         movementTerrain:'village', movementTotal:4 },
  { key:'millionaire',   cardName:'Millionaire',    color:'yellow', cost:5, oneTimeUse:false, specialEffect:'none',         movementTerrain:'village', movementTotal:4 },

  // ── BLACK (Wild movement) ─────────────────────────────────────────────────
  { key:'jack_of_all_trades',cardName:'Jack-of-all-Trades',color:'black',cost:2,oneTimeUse:false,specialEffect:'none',  movementTerrain:'wild',    movementTotal:1 },
  { key:'adventurer',    cardName:'Adventurer',     color:'black',  cost:4, oneTimeUse:false, specialEffect:'none',         movementTerrain:'wild',    movementTotal:2 },
  { key:'prop_plane',    cardName:'Prop Plane',     color:'black',  cost:4, oneTimeUse:true,  specialEffect:'none',         movementTerrain:'wild',    movementTotal:4 },

  // ── PURPLE (Special effects — no terrain movement) ─────────────────────────
  { key:'transmitter',   cardName:'Transmitter',    color:'purple', cost:4, oneTimeUse:true,  specialEffect:'transmitter',  movementTerrain:'empty',   movementTotal:0 },
  { key:'cartographer',  cardName:'Cartographer',   color:'purple', cost:4, oneTimeUse:false, specialEffect:'cartographer', movementTerrain:'empty',   movementTotal:0 },
  { key:'compass',       cardName:'Compass',        color:'purple', cost:2, oneTimeUse:true,  specialEffect:'compass',      movementTerrain:'empty',   movementTotal:0 },
  { key:'scientist',     cardName:'Scientist',      color:'purple', cost:4, oneTimeUse:false, specialEffect:'scientist',    movementTerrain:'empty',   movementTotal:0 },
  { key:'travel_log',    cardName:'Travel Log',     color:'purple', cost:3, oneTimeUse:true,  specialEffect:'travel_log',   movementTerrain:'empty',   movementTotal:0 },
  { key:'native',        cardName:'Native',         color:'purple', cost:5, oneTimeUse:false, specialEffect:'native',       movementTerrain:'empty',   movementTotal:1 },
];

// Mirrors CardData.getPurchasingPower()
function getPurchasingPower(card) {
  if (card.movementTerrain === 'village') return card.movementTotal;
  return 0.5;
}

// ── STARTER DECK ──────────────────────────────────────────────────────────────
// From multiplayer_service._get_player_starter_deck():
//   3x EXPLORER, 4x TRAVELER, 1x SAILOR  (8 cards total, draw 4 per turn)
const STARTER_DECK_TEMPLATE = [
  { key: _cardDataDeps.CARD_KEYS.EXPLORER,  count: 3 },
  { key: _cardDataDeps.CARD_KEYS.TRAVELER,  count: 4 },
  { key: _cardDataDeps.CARD_KEYS.SAILOR,    count: 1 },
];

function buildStarterDeck() {
  const cardMap = new Map(CARD_DEFINITIONS.map(c => [c.key, c]));
  const deck = [];
  for (const { key, count } of STARTER_DECK_TEMPLATE) {
    const def = cardMap.get(key);
    if (!def) { console.error('Unknown card key in starter deck:', key); continue; }
    for (let i = 0; i < count; i++) {
      deck.push({ ...def, purchasingPower: getPurchasingPower(def), instanceId: `${key}-${i}` });
    }
  }
  return deck;
}

// ── SHOP / RESERVE SETUP ──────────────────────────────────────────────────────
// From multiplayer_service._initialize_shop_cards_on_server()
const INITIAL_SHOP = [
  { key: 'scout',             count: 3 },
  { key: 'trailblazer',       count: 3 },
  { key: 'jack_of_all_trades',count: 3 },
  { key: 'photographer',      count: 3 },
  { key: 'treasure_chest',    count: 3 },
  { key: 'transmitter',       count: 3 },
];

const INITIAL_RESERVE = [
  { key: 'pioneer',       count: 3 },
  { key: 'giant_machete', count: 3 },
  { key: 'captain',       count: 3 },
  { key: 'journalist',    count: 3 },
  { key: 'millionaire',   count: 3 },
  { key: 'adventurer',    count: 3 },
  { key: 'prop_plane',    count: 3 },
  { key: 'cartographer',  count: 3 },
  { key: 'compass',       count: 3 },
  { key: 'scientist',     count: 3 },
  { key: 'travel_log',    count: 3 },
  { key: 'native',        count: 3 },
];

// Build shop/reserve as { cardKey: count } maps, matching GDScript structure
function buildShopState() {
  const cardMap = new Map(CARD_DEFINITIONS.map(c => [c.key, c]));
  const toSlots = (template) => template.map(({ key, count }) => ({
    ...cardMap.get(key),
    purchasingPower: getPurchasingPower(cardMap.get(key)),
    remaining: count,
  }));
  return { shop: toSlots(INITIAL_SHOP), reserve: toSlots(INITIAL_RESERVE) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CARD_DEFINITIONS, CARD_COLORS, buildStarterDeck, buildShopState, getPurchasingPower };
} else {
  window.ElDoradoCards = { CARD_DEFINITIONS, CARD_COLORS, buildStarterDeck, buildShopState, getPurchasingPower };
}
