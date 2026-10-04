const _ElDoradoBoardDeps = (typeof module !== 'undefined' && module.exports)
  ? require('./constants')
  : window.ElDoradoConstants;

const AXIAL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

class HexTile {
  constructor({ id, q, r, terrainType, movementCost, playerNumber, isFinishing }) {
    this.id = id;
    this.q = q;
    this.r = r;
    this.terrainType = terrainType;
    this.movementCost = movementCost ?? 1;
    this.isFinishing = isFinishing ?? false;
    this.playerNumber = playerNumber ?? null;
  }
}

class HexBoard {
  constructor() {
    this.tiles = new Map();
    this.coordMap = new Map();
  }

  loadMap(mapData) {
    this.tiles.clear();
    this.coordMap.clear();
    for (const d of mapData.tiles) {
      const tile = new HexTile(d);
      this.tiles.set(tile.id, tile);
      this.coordMap.set(`${tile.q},${tile.r}`, tile);
    }
  }

  getTile(id) {
    return this.tiles.get(id) || null;
  }

  getAt(q, r) {
    return this.coordMap.get(`${q},${r}`) || null;
  }

  getPlayerStartTile(playerNumber) {
    for (const tile of this.tiles.values()) {
      if (tile.terrainType === _ElDoradoBoardDeps.TerrainType.START && tile.playerNumber === playerNumber) {
        return tile;
      }
    }
    return null;
  }

  getTileNeighbors(tile) {
    return AXIAL_DIRS
      .map(([dq, dr]) => this.getAt(tile.q + dq, tile.r + dr))
      .filter(Boolean);
  }

  // Returns valid tile IDs the player can move to.
  // Tiles on the far side of an active blockade edge are excluded — the player
  // must break the blockade first via breakBlockade() before crossing.
  getValidMoves({ currentTileId, playedCard, movesRemaining, wildCardTerrain, players, handSize, activeBlockades }) {
    const tile = this.getTile(currentTileId);
    if (!tile) return [];

    // Build a fast Set of "tileId|neighborId" edges that are currently blocked.
    // Any neighbor reachable only through a blocked edge is excluded.
    const blockedEdges = new Set();
    if (activeBlockades && activeBlockades.length > 0) {
      for (const blockade of activeBlockades) {
        for (const [a, b] of blockade.edges) {
          blockedEdges.add([a, b].sort().join('|'));
        }
      }
    }

    return this.getTileNeighbors(tile)
      .filter((neighbor) => {
        // If this specific edge (currentTile → neighbor) is blocked by a
        // blockade, the tile is not directly reachable by normal movement.
        const edgeKey = [currentTileId, neighbor.id].sort().join('|');
        if (blockedEdges.has(edgeKey)) return false;

        return this.isValidMove({
          neighbor,
          playedCard,
          movesRemaining,
          wildCardTerrain,
          players,
          handSize,
        });
      })
      .map((neighbor) => neighbor.id);
  }

  isValidMove({ neighbor, playedCard, movesRemaining, wildCardTerrain, players, handSize }) {
    const terrain = neighbor.terrainType;
    const cost = neighbor.movementCost;

    if (terrain === _ElDoradoBoardDeps.TerrainType.START) return false;
    if (terrain === _ElDoradoBoardDeps.TerrainType.MOUNTAIN) return false;
    if (terrain === _ElDoradoBoardDeps.TerrainType.EL_DORADO) return false;
    if (players.some((p) => p.currentTileId === neighbor.id)) return false;

    if (playedCard.specialEffect === _ElDoradoBoardDeps.CardEffect.NATIVE) return true;

    if (terrain === _ElDoradoBoardDeps.TerrainType.RUBBLE) {
      if (movesRemaining < playedCard.movementTotal) return false;
      return handSize >= cost;
    }

    if (terrain === _ElDoradoBoardDeps.TerrainType.CAMP) return true;

    const enoughMoves = cost <= movesRemaining;
    let cardTerrain = playedCard.movementTerrain;
    if (cardTerrain === _ElDoradoBoardDeps.TerrainType.WILD) {
      if (wildCardTerrain === null) return enoughMoves;
      cardTerrain = wildCardTerrain;
    }

    return terrain === cardTerrain && enoughMoves;
  }

  // Returns blockade IDs that the player can break from their current tile,
  // given the card they have played. A blockade is breakable if:
  //   - at least one of its edges touches the player's current tile
  //   - the card can pay 1 movement of the blockade's terrain type
  //   - movesRemaining >= 1
  getBreakableBlockades({ currentTileId, playedCard, movesRemaining, wildCardTerrain, activeBlockades }) {
    if (!activeBlockades || activeBlockades.length === 0) return [];
    if (movesRemaining < 1) return [];

    return activeBlockades.filter(blockade =>
      this._isAdjacentToBlockade(currentTileId, blockade) &&
      this._canPayBlockade(blockade, playedCard, wildCardTerrain)
    ).map(b => b.id);
  }

  _isAdjacentToBlockade(tileId, blockade) {
    return blockade.edges.some(([a, b]) => a === tileId || b === tileId);
  }

  // Can the played card pay 1 movement of this blockade's terrain type?
  _canPayBlockade(blockade, playedCard, wildCardTerrain) {
    const bTerrain = blockade.terrainType;

    // Rubble blockade: any card type pays it (same as rubble tiles — discard 1 extra card)
    if (bTerrain === _ElDoradoBoardDeps.TerrainType.RUBBLE) return true;

    if (playedCard.specialEffect === _ElDoradoBoardDeps.CardEffect.NATIVE) return true;

    let cardTerrain = playedCard.movementTerrain;
    if (cardTerrain === _ElDoradoBoardDeps.TerrainType.WILD) {
      // Wild not yet locked — can match anything
      if (wildCardTerrain === null) return true;
      cardTerrain = wildCardTerrain;
    }

    return cardTerrain === bTerrain;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HexBoard, HexTile };
} else {
  window.ElDoradoHexBoard = { HexBoard, HexTile };
}