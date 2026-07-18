import type {
  GameScreen, Notification, EngineCallbacks, ItemStack, Vec2,
  ModuleType, PlacedModule, GameTime, Season, InputState,
} from './types';
import { World, TILE_SIZE } from './World';
import { Player } from './Player';
import {
  ITEMS, RECIPES, MODULES, MODULE_LIST, getItemName, getItemBuyValue, getItemSellValue,
} from './items';
import { TECH_TREE, getStartingTech, canUnlockTech, getUnlockableTech } from './techTree';

let notifId = 0;

export class GameEngine {
  world: World;
  player: Player;
  callbacks: EngineCallbacks;
  screen: GameScreen | null = null;
  notifications: Notification[] = [];
  gameTime: GameTime;
  lastFrameTime = 0;
  running = false;
  rafId: number | null = null;
  input: InputState;
  gameOver: boolean = false;
  gameOverReason: string = '';

  // Tech tree
  unlockedTech: Set<string>;
  techChips: number = 0;

  // Build mode
  buildMode: ModuleType | null = null;

  // Mining state
  miningTarget: Vec2 | null = null;
  miningProgress = 0;
  miningTimer = 0;

  // Selected hotbar slot
  hotbarIndex: number = 0;
  hotbar: string[] = ['mining_laser', 'repair_tool', 'scanner', 'ration', 'air_tank'];

  // O2 consumption rate (game seconds per real second, accelerated)
  private readonly O2_RATE = 1; // 1 game-second O2 per real-second at idle
  private readonly O2_RATE_EVA = 1.5; // faster consumption in EVA
  private readonly O2_RATE_BOOST = 3; // boost drains fast

  // Day/night cycle (star rotation)
  private readonly CYCLE_LENGTH = 120; // 2 minutes = full day cycle

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
    this.world = new World();
    this.player = new Player(this.world.startX, this.world.startY);
    this.input = {
      moveX: 0, moveY: 0, aimX: 0, aimY: 0,
      action: false, cancel: false, inventory: false, build: false,
      craft: false, techtree: false, map: false,
      hotbarLeft: false, hotbarRight: false, boost: false, fire: false,
    };
    this.unlockedTech = new Set(getStartingTech());
    this.gameTime = {
      cycle: 1,
      minutes: 360,
      timeString: 'Cycle 1, 06:00',
      season: 'quiet',
    };

    // Place starting escape pod (a small habitat)
    this.placeStartingPod();
  }

  private placeStartingPod(): void {
    // Place a 2x2 habitat at the spawn area as the escape pod
    const x = this.world.startX;
    const y = this.world.startY;
    // Clear any asteroids near spawn
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const t = this.world.getTile(x + dx, y + dy);
        if (t && (t.type === 'asteroid' || t.type === 'crystal' || t.type === 'debris')) {
          this.world.tiles[y + dy][x + dx] = {
            type: 'void', occupied: false, hullIntegrity: 100, pressurized: false,
          };
        }
      }
    }
    // Place the pod
    this.world.placeModule(x - 1, y - 1, 'habitat');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.gameLoop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private gameLoop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    this.update(dt);
    this.rafId = requestAnimationFrame(this.gameLoop);
  };

  update(dt: number): void {
    if (this.gameOver) return;

    this.handleInput(dt);
    this.updateSurvival(dt);
    this.updateTime(dt);
    this.updateMining(dt);
    this.updateStationSystems(dt);
  }

  private handleInput(dt: number): void {
    // Movement
    const moveInput = { moveX: this.input.moveX, moveY: this.input.moveY };
    this.player.update(moveInput, dt, (x, y) => this.world.isWalkable(x, y));

    // Check if player entered/exit station
    const wasInStation = this.player.inStation;
    this.player.inStation = this.world.isPressurized(this.player.pos.x, this.player.pos.y);

    // Action button
    if (this.input.action) {
      this.input.action = false; // consume
      this.performAction();
    }

    // Cancel
    if (this.input.cancel) {
      this.input.cancel = false;
      this.buildMode = null;
      if (this.screen) this.closeScreen();
    }

    // Menu toggles
    if (this.input.inventory) { this.input.inventory = false; this.toggleScreen('inventory'); }
    if (this.input.build) { this.input.build = false; this.toggleScreen('build'); }
    if (this.input.craft) { this.input.craft = false; this.toggleScreen('craft'); }
    if (this.input.techtree) { this.input.techtree = false; this.toggleScreen('techtree'); }
    if (this.input.map) { this.input.map = false; this.toggleScreen('map'); }

    // Hotbar cycling
    if (this.input.hotbarLeft) { this.input.hotbarLeft = false; this.cycleHotbar(-1); }
    if (this.input.hotbarRight) { this.input.hotbarRight = false; this.cycleHotbar(1); }
  }

  private updateSurvival(dt: number): void {
    // O2 consumption
    let o2Rate = this.player.inStation ? -0.5 : this.O2_RATE_EVA; // refills in station
    if (this.input.boost) o2Rate = this.O2_RATE_BOOST;

    // If in station with O2 generator, refill
    if (this.player.inStation) {
      const o2Gen = this.world.getO2Generation();
      if (o2Gen > 0) {
        o2Rate = -o2Gen * 2; // fast refill
      } else if (this.player.stats.oxygen < this.player.stats.maxOxygen) {
        o2Rate = -0.5; // slow passive refill in pressurized area
      } else {
        o2Rate = 0;
      }
    }

    this.player.stats.oxygen = Math.max(0, Math.min(
      this.player.stats.maxOxygen,
      this.player.stats.oxygen - o2Rate * dt,
    ));

    // Check O2 death
    if (this.player.stats.oxygen <= 0) {
      this.triggerGameOver('You ran out of oxygen. The void claims another soul.');
      return;
    }

    // Power consumption (jetpack boost)
    if (this.input.boost && !this.player.inStation) {
      this.player.stats.power = Math.max(0, this.player.stats.power - 20 * dt);
    } else if (this.player.inStation) {
      this.player.stats.power = Math.min(
        this.player.stats.maxPower,
        this.player.stats.power + 10 * dt,
      );
    }

    // Low O2 warning
    if (this.player.stats.oxygen < 60 && this.player.stats.oxygen > 0) {
      const pct = this.player.stats.oxygen / this.player.stats.maxOxygen;
      if (pct < 0.05 && Math.random() < 0.02) {
        this.notify('⚠️ OXYGEN CRITICAL!', 'error');
      }
    }
  }

  private updateTime(dt: number): void {
    this.gameTime.minutes += dt * (1440 / this.CYCLE_LENGTH); // 2 min = full cycle
    if (this.gameTime.minutes >= 1440) {
      this.gameTime.minutes -= 1440;
      this.gameTime.cycle++;
    }
    const h = Math.floor(this.gameTime.minutes / 60);
    const m = Math.floor(this.gameTime.minutes % 60);
    this.gameTime.timeString = `Cycle ${this.gameTime.cycle}, ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private updateMining(dt: number): void {
    if (!this.input.fire) {
      this.miningTarget = null;
      this.miningProgress = 0;
      return;
    }

    // Mining laser active
    const facing = this.player.getFacingTile();
    const tile = this.world.getTile(facing.x, facing.y);
    if (!tile) return;
    if (tile.type !== 'asteroid' && tile.type !== 'crystal' && tile.type !== 'debris') {
      this.miningTarget = null;
      this.miningProgress = 0;
      return;
    }

    // Check if player has mining laser
    if (!this.player.hasItem('mining_laser') && !this.player.hasItem('jetpack_mk2')) {
      // Can still mine debris by hand but slowly
      if (tile.type !== 'debris') {
        if (Math.random() < 0.01) this.notify('Need a Mining Laser to mine asteroids!', 'warning');
        return;
      }
    }

    this.miningTarget = facing;
    this.miningTimer += dt;

    // Mining speed: 1.5 seconds per ore unit with laser, 3 seconds without
    const hasLaser = this.player.hasItem('mining_laser');
    const mineTime = hasLaser ? 1.5 : 3.0;
    this.miningProgress = Math.min(1, this.miningTimer / mineTime);

    if (this.miningProgress >= 1) {
      this.miningTimer = 0;
      this.miningProgress = 0;
      const drops = this.world.mineTile(facing.x, facing.y);
      if (drops) {
        for (const drop of drops) {
          if (this.player.addItem(drop.itemId, drop.quantity)) {
            const name = getItemName(drop.itemId);
            this.notify(`+${drop.quantity} ${name}`, 'success');
          } else {
            this.notify('Inventory full!', 'error');
          }
        }
        // Consume power for mining
        if (hasLaser) {
          this.player.stats.power = Math.max(0, this.player.stats.power - 5);
        }
      }
    }
  }

  private updateStationSystems(dt: number): void {
    // Hull integrity slowly degrades if no shield
    // Future: debris impacts, radiation, etc.
  }

  // ============ Actions ============

  performAction(): void {
    if (this.buildMode) {
      this.placeBuilding();
      return;
    }

    const facing = this.player.getFacingTile();
    const tile = this.world.getTile(facing.x, facing.y);
    if (!tile) return;

    // Interact with station modules
    switch (tile.type) {
      case 'airlock':
        // Toggle airlock (enter/exit)
        this.notify('Airlock used — O2 stabilized.', 'info');
        break;
      case 'fabricator':
        this.openScreen('craft');
        break;
      case 'storage':
        this.openScreen('inventory');
        break;
      case 'station_floor':
        // Maybe interact with placed items?
        break;
      case 'debris':
        // Can salvage debris by hand
        const drops = this.world.mineTile(facing.x, facing.y);
        if (drops) {
          for (const drop of drops) {
            if (this.player.addItem(drop.itemId, drop.quantity)) {
              this.notify(`+${drop.quantity} ${getItemName(drop.itemId)}`, 'success');
            }
          }
        }
        break;
      case 'asteroid':
      case 'crystal':
        // Quick-mine if fire is also pressed (handled in updateMining)
        this.notify('Hold FIRE to mine.', 'info');
        break;
      default:
        break;
    }
  }

  private placeBuilding(): void {
    if (!this.buildMode) return;
    const facing = this.player.getFacingTile();
    const def = MODULES[this.buildMode];
    if (!def) return;

    // Check materials
    for (const mat of def.materials) {
      if (!this.player.hasItem(mat.itemId, mat.quantity)) {
        this.notify(`Need ${mat.quantity} ${getItemName(mat.itemId)}`, 'error');
        return;
      }
    }

    // Check unlock
    if (!def.unlocked && !this.isModuleUnlocked(this.buildMode)) {
      this.notify('Module not unlocked! Research it first.', 'error');
      return;
    }

    if (this.world.canPlaceModule(facing.x, facing.y, this.buildMode)) {
      // Deduct materials
      for (const mat of def.materials) {
        this.player.removeItem(mat.itemId, mat.quantity);
      }
      const mod = this.world.placeModule(facing.x, facing.y, this.buildMode);
      if (mod) {
        this.notify(`Built ${def.name}!`, 'success');
        this.callbacks.onStateChange();
      }
    } else {
      this.notify('Cannot place module here.', 'error');
    }
  }

  private isModuleUnlocked(type: ModuleType): boolean {
    const def = MODULES[type];
    if (!def) return false;
    if (def.unlocked) return true;
    // Check tech tree
    for (const tech of TECH_TREE) {
      if (tech.unlocks.includes(type) && this.unlockedTech.has(tech.id)) {
        return true;
      }
    }
    return false;
  }

  // ============ Crafting ============

  canCraft(recipeId: string): boolean {
    const recipe = RECIPES.find(r => r.id === recipeId);
    if (!recipe) return false;
    for (const inp of recipe.inputs) {
      if (!this.player.hasItem(inp.itemId, inp.quantity)) return false;
    }
    return true;
  }

  craft(recipeId: string): void {
    const recipe = RECIPES.find(r => r.id === recipeId);
    if (!recipe) return;
    if (!this.canCraft(recipeId)) {
      this.notify('Missing materials!', 'error');
      return;
    }
    // Remove inputs
    for (const inp of recipe.inputs) {
      this.player.removeItem(inp.itemId, inp.quantity);
    }
    // Add output
    this.player.addItem(recipe.output.itemId, recipe.output.quantity);
    this.notify(`Crafted ${recipe.name}!`, 'success');
    this.callbacks.onStateChange();
  }

  // ============ Tech Tree ============

  unlockTech(techId: string): void {
    if (!canUnlockTech(techId, this.unlockedTech, this.techChips)) {
      this.notify('Cannot unlock this tech yet.', 'error');
      return;
    }
    const node = TECH_TREE.find(t => t.id === techId);
    if (!node) return;
    this.techChips -= node.cost;
    this.unlockedTech.add(techId);
    // Unlock modules
    for (const moduleId of node.unlocks) {
      const mod = MODULES[moduleId];
      if (mod) mod.unlocked = true;
    }
    this.notify(`Researched: ${node.name}!`, 'success');
    this.callbacks.onStateChange();
  }

  getAvailableTech() {
    return getUnlockableTech(this.unlockedTech);
  }

  // ============ Build Mode ============

  setBuildMode(type: ModuleType | null): void {
    this.buildMode = type;
    if (type) {
      this.closeScreen();
    }
  }

  // ============ Hotbar ============

  cycleHotbar(dir: number): void {
    this.hotbarIndex = (this.hotbarIndex + dir + this.hotbar.length) % this.hotbar.length;
    this.callbacks.onStateChange();
  }

  getSelectedItem(): string {
    return this.hotbar[this.hotbarIndex];
  }

  // ============ Screen Management ============

  openScreen(screen: GameScreen): void {
    this.screen = screen;
    this.callbacks.onScreenChange(screen);
    this.callbacks.onStateChange();
  }

  closeScreen(): void {
    this.screen = null;
    this.callbacks.onScreenChange(null);
    this.callbacks.onStateChange();
  }

  toggleScreen(screen: GameScreen): void {
    if (this.screen === screen) {
      this.closeScreen();
    } else {
      this.openScreen(screen);
    }
  }

  // ============ Notifications ============

  notify(text: string, type: Notification['type'] = 'info'): void {
    const n: Notification = {
      id: notifId++,
      text,
      type,
      timeout: 3000,
    };
    this.notifications.push(n);
    this.callbacks.onNotification(n);
    // Auto-remove after timeout
    setTimeout(() => {
      this.notifications = this.notifications.filter(n2 => n2.id !== n.id);
      this.callbacks.onStateChange();
    }, n.timeout);
  }

  // ============ Game Over ============

  private triggerGameOver(reason: string): void {
    this.gameOver = true;
    this.gameOverReason = reason;
    this.stop();
    this.callbacks.onGameOver(reason);
  }

  restart(): void {
    this.gameOver = false;
    this.gameOverReason = '';
    this.world = new World();
    this.player = new Player(this.world.startX, this.world.startY);
    this.unlockedTech = new Set(getStartingTech());
    this.techChips = 0;
    this.buildMode = null;
    this.screen = null;
    this.placeStartingPod();
    this.start();
    this.callbacks.onStateChange();
  }

  // ============ Buy/Sell (future NPC merchant) ============

  buyItem(itemId: string, quantity: number = 1): void {
    const price = getItemBuyValue(itemId) * quantity;
    // Future: use credits
    // For now, items are crafted not bought
    this.notify('Trading not yet available. Craft items at the Fabricator.', 'info');
  }

  sellItem(itemId: string, quantity: number): void {
    // Future: sell for credits
    if (this.player.removeItem(itemId, quantity)) {
      this.notify(`Sold ${quantity} ${getItemName(itemId)}`, 'success');
    }
  }
}