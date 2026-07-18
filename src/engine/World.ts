import type { Tile, Vec2, OreType, PlacedModule, ModuleType } from './types';
import { MODULES, ORE_DROPS } from './items';

const TILE_SIZE = 32;
const WORLD_W = 80;
const WORLD_H = 60;

// Asteroid field parameters
const ASTEROID_COUNT = 120;
const CRYSTAL_COUNT = 15;
const DEBRIS_COUNT = 20;

export class World {
  tiles: Tile[][];
  width: number;
  height: number;
  modules: PlacedModule[] = [];
  moduleIdCounter = 0;

  // Station position — where the escape pod starts
  startX = 40;
  startY = 30;

  constructor() {
    this.width = WORLD_W;
    this.height = WORLD_H;
    this.tiles = this.generateSector();
  }

  private generateSector(): Tile[][] {
    const tiles: Tile[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < this.width; x++) {
        row.push({
          type: 'void',
          occupied: false,
          hullIntegrity: 100,
          pressurized: false,
        });
      }
      tiles.push(row);
    }

    // Generate asteroid clusters
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      const cx = Math.floor(Math.random() * this.width);
      const cy = Math.floor(Math.random() * this.height);
      const size = 1 + Math.floor(Math.random() * 3);
      const oreType = this.randomOreType();
      for (let dy = -size; dy <= size; dy++) {
        for (let dx = -size; dx <= size; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > size) continue;
          if (tiles[y][x].type === 'void' && Math.random() > 0.3) {
            tiles[y][x] = {
              type: 'asteroid',
              occupied: true,
              oreType,
              oreAmount: 3 + Math.floor(Math.random() * 5),
              hullIntegrity: 100,
              pressurized: false,
            };
          }
        }
      }
    }

    // Crystal deposits (rarer)
    for (let i = 0; i < CRYSTAL_COUNT; i++) {
      const cx = Math.floor(Math.random() * this.width);
      const cy = Math.floor(Math.random() * this.height);
      if (tiles[cy][cx].type === 'void') {
        tiles[cy][cx] = {
          type: 'crystal',
          occupied: true,
          oreType: 'crystal',
          oreAmount: 2 + Math.floor(Math.random() * 3),
          hullIntegrity: 100,
          pressurized: false,
        };
      }
    }

    // Debris fields (from the Meridian wreck)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const cx = Math.floor(Math.random() * this.width);
      const cy = Math.floor(Math.random() * this.height);
      // Keep debris away from spawn
      const distFromSpawn = Math.sqrt((cx - this.startX) ** 2 + (cy - this.startY) ** 2);
      if (distFromSpawn < 10) continue;
      tiles[cy][cx] = {
        type: 'debris',
        occupied: true,
        hullIntegrity: 100,
        pressurized: false,
      };
    }

    // Scatter decorative stars
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(Math.random() * this.width);
      const y = Math.floor(Math.random() * this.height);
      if (tiles[y][x].type === 'void' && Math.random() > 0.85) {
        tiles[y][x].decorationId = 'star';
      }
    }

    return tiles;
  }

  private randomOreType(): OreType {
    const r = Math.random();
    if (r < 0.35) return 'iron';
    if (r < 0.55) return 'silicon';
    if (r < 0.72) return 'carbon';
    if (r < 0.85) return 'gold';
    if (r < 0.93) return 'uranium';
    return 'alien_alloy';
  }

  getTile(x: number, y: number): Tile | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y][x];
  }

  isWalkable(x: number, y: number): boolean {
    const t = this.getTile(x, y);
    if (!t) return false;
    if (t.occupied) return false;
    // Void and station_floor are walkable
    return t.type === 'void' || t.type === 'station_floor' || t.type === 'airlock';
  }

  isInStation(x: number, y: number): boolean {
    const t = this.getTile(x, y);
    return t !== null && (t.type === 'station_floor' || t.type === 'airlock') && t.pressurized;
  }

  // Check if a tile is inside a pressurized area
  isPressurized(x: number, y: number): boolean {
    const t = this.getTile(x, y);
    return t !== null && t.pressurized;
  }

  // Mine an asteroid tile — returns drops or null
  mineTile(x: number, y: number): { itemId: string; quantity: number }[] | null {
    const t = this.getTile(x, y);
    if (!t) return null;
    if (t.type !== 'asteroid' && t.type !== 'crystal' && t.type !== 'debris') return null;

    const drops: { itemId: string; quantity: number }[] = [];

    if (t.type === 'debris') {
      // Debris gives random materials
      drops.push({ itemId: 'iron', quantity: 1 + Math.floor(Math.random() * 3) });
      if (Math.random() > 0.5) drops.push({ itemId: 'silicon', quantity: 1 });
      if (Math.random() > 0.9) drops.push({ itemId: 'tech_chip', quantity: 1 });
      // Debris is consumed in one hit
      this.tiles[y][x] = { type: 'void', occupied: false, hullIntegrity: 100, pressurized: false };
      return drops;
    }

    const oreType = t.oreType;
    if (!oreType) return null;

    const dropTable = ORE_DROPS[oreType];
    if (dropTable) {
      for (const entry of dropTable) {
        if (Math.random() <= entry.chance) {
          const qty = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
          if (qty > 0) drops.push({ itemId: entry.itemId, quantity: qty });
        }
      }
    }

    // Reduce ore amount, destroy tile when depleted
    t.oreAmount = (t.oreAmount ?? 1) - 1;
    if (t.oreAmount <= 0) {
      this.tiles[y][x] = { type: 'void', occupied: false, hullIntegrity: 100, pressurized: false };
    }

    return drops;
  }

  // Station building
  canPlaceModule(x: number, y: number, type: ModuleType): boolean {
    const def = MODULES[type];
    if (!def) return false;
    for (let dy = 0; dy < def.height; dy++) {
      for (let dx = 0; dx < def.width; dx++) {
        const t = this.getTile(x + dx, y + dy);
        if (!t) return false;
        if (t.occupied) return false;
        // Can build on void or station_floor (adjacency)
        if (t.type !== 'void' && t.type !== 'station_floor') return false;
      }
    }
    return true;
  }

  placeModule(x: number, y: number, type: ModuleType): PlacedModule | null {
    if (!this.canPlaceModule(x, y, type)) return null;
    const def = MODULES[type];
    const id = `module_${this.moduleIdCounter++}`;
    const module: PlacedModule = {
      id, type, x, y, hullIntegrity: 100,
    };
    this.modules.push(module);

    // Set tiles to station type
    for (let dy = 0; dy < def.height; dy++) {
      for (let dx = 0; dx < def.width; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        const tile = this.getTile(tx, ty);
        if (!tile) continue;

        if (type === 'solar_panel' || type === 'reactor' || type === 'shield' || type === 'scanner' || type === 'drone_bay') {
          tile.type = type === 'solar_panel' ? 'solar' : type === 'reactor' ? 'reactor' : type === 'shield' ? 'shield' : 'void';
          tile.occupied = type !== 'solar';
          tile.pressurized = false;
        } else {
          tile.type = 'station_floor';
          tile.occupied = false;
          tile.pressurized = def.pressurized;
        }
        tile.hullIntegrity = 100;
        tile.moduleId = id;
      }
    }

    return module;
  }

  // Calculate total station power generation
  getPowerGeneration(): number {
    let total = 0;
    for (const mod of this.modules) {
      const def = MODULES[mod.type];
      if (def?.providesPower) total += def.providesPower;
    }
    return total;
  }

  // Calculate total O2 generation
  getO2Generation(): number {
    let total = 0;
    for (const mod of this.modules) {
      const def = MODULES[mod.type];
      if (def?.providesO2) total += def.providesO2;
    }
    return total;
  }

  // Get all pressurized tiles
  getPressurizedCount(): number {
    let count = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.tiles[y][x].pressurized) count++;
      }
    }
    return count;
  }

  // Check if player is near a station module
  isNearStation(x: number, y: number): boolean {
    for (const mod of this.modules) {
      const def = MODULES[mod.type];
      if (!def) continue;
      if (x >= mod.x - 1 && x <= mod.x + def.width &&
          y >= mod.y - 1 && y <= mod.y + def.height) {
        return true;
      }
    }
    return false;
  }
}

export { TILE_SIZE, WORLD_W, WORLD_H };