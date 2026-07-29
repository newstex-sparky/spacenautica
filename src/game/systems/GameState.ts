/**
 * GAME STATE — the RPG hub.
 *
 * Owns the inventory, crafting queue, tech tree, scanner, quest log and
 * databank, wires them all to the event bus, and handles save/load with
 * versioned migration plus autosave.
 *
 * ============================ PUBLIC API ============================
 * Everything the HUD needs is on this class. Read freely; mutate only through
 * the documented methods so events fire.
 *
 *   state.inventory                 Inventory (2D grid, quick slots, equipment)
 *   state.crafting                  Crafting  (queue + known recipes)
 *   state.tech                      TechTree  (unlocked, frontier, depth gates)
 *   state.scanner                   Scanner   (progress, fragments)
 *   state.quests                    QuestLog  (active, completed, objectives)
 *   state.databank                  Databank  (unlocked lore entries)
 *   state.equipment                 aggregated worn-gear stats (read-only)
 *   state.stats                     run statistics
 *   state.playtime                  seconds
 *
 *   Items:      itemDef(id), allItems(), iconFor(id)
 *   Inventory:  addItem(id,n), removeItem(id,n), countOf(id), hasItems(reqs),
 *               useItem(uid), consumeItem(uid), dropItem(uid)
 *   Containers: registerContainer(c), unregisterContainer(id), container(id),
 *               allContainers(), transfer(uid, from, to)
 *   Crafting:   stationsInReach(), craftStatus(station), beginCraft(recipeId),
 *               cancelCraft(jobId), rawCostOf(recipeId), craftProgress(station)
 *   Tech:       techNodes(), techFrontier(), techDepthBlocked(), unlockTech(id)
 *   Scanner:    scanTarget (writable), scanProgress(id), scanFragments(id),
 *               scanHold(id, dt)
 *   Quests:     questViews(), currentObjective(), completeObjective(q,o)
 *   Databank:   databankList(cat?), readEntry(id), unreadCount
 *   Save:       save(slot?), load(slot?), hasSave(slot?), deleteSave(slot),
 *               saveSlots(), autosaveInterval
 * ====================================================================
 *
 * Events emitted: inventory:changed, craft:completed, scan:completed,
 * databank:unlocked, tech:unlocked, quest:updated, depth:band, ui:notify,
 * ui:voice, save:written, save:loaded, audio:cue.
 *
 * NOTE for the HUD: depth-gate announcements ("now researchable") are rate
 * limited and collapse into one summary line when several gates fall at once, so
 * a fast descent cannot wall the toast column. Nothing is announced for the
 * depth the player *starts* a run at — spawn, load and teleport all re-baseline
 * silently — so the first frames of a run never carry blueprint toasts.
 */

import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import { Container, Inventory } from './Inventory';
import type { EquipmentStats, Ingredient, PlacedItem, SerialisedContainer } from './Inventory';
import { Crafting } from './Crafting';
import type { CraftStatus } from './Crafting';
import { RECIPES, expandToRaw } from './Recipes';
import type { RecipeDef, StationType } from './Recipes';
import { TechTree, TECH_LIST } from './Tech';
import type { TechNode } from './Tech';
import { Scanner } from './Scanner';
import { Databank } from './Databank';
import type { DatabankCategory, DatabankEntry } from './Databank';
import { QuestLog } from './Quests';
import type { ObjectiveDef, QuestDef, QuestView } from './Quests';
import { ITEM_LIST, itemDef as lookupItem, itemDefOr } from './Items';
import type { IconParams, ItemDef } from './Items';
import { listSaves, migrate, SAVE_VERSION, saveKey } from './SaveGame';
import type { SaveData, SaveSlotInfo } from './SaveGame';
import type { BuildSystem } from './BuildSystem';

/* Re-exported so older imports of `./systems/GameState` keep working. */
export { Container, Inventory } from './Inventory';
export type { ItemStack, PlacedItem } from './Inventory';
export { Crafting } from './Crafting';
export { TechTree } from './Tech';
export { Scanner } from './Scanner';
export { Databank } from './Databank';
export { QuestLog } from './Quests';

/** The parts of `PlayerSystem` this module reads or writes. */
interface PlayerLike extends GameSystem {
  position: THREE.Vector3;
  depth: number;
  vitals: { oxygen: number; maxOxygen: number; health: number; food: number; water: number };
  damage(amount: number, source: string): void;
}

interface SkyLike extends GameSystem {
  timeOfDay?: number;
  dayLength?: number;
}

interface TerrainLike extends GameSystem {
  seed?: number;
}

/** Depth bands used for music and colour grading. */
const DEPTH_BANDS: Array<{ band: string; from: number }> = [
  { band: 'surface', from: 0 },
  { band: 'shallow', from: 12 },
  { band: 'mid', from: 80 },
  { band: 'deep', from: 200 },
  { band: 'abyss', from: 450 },
  { band: 'void', from: 900 },
];

const _v0 = new THREE.Vector3();

/** Seconds between "now researchable" toasts, so gate crossings never wall the screen. */
const TECH_ANNOUNCE_GAP = 3;
/** More than this many pending at once collapses into a single summary line. */
const TECH_ANNOUNCE_BURST = 2;

/**
 * Position-jump discriminator. Nothing the player can pilot exceeds ~11 m/s, so
 * a step beyond this budget is a teleport — a load, a death respawn, or a
 * scripted camera move — not locomotion. Generous, because a single frame can be
 * very long on a slow renderer.
 */
const TELEPORT_SPEED = 30;
/** Absolute floor, so a one-frame physics pop is never read as a teleport. */
const TELEPORT_MARGIN = 5;

export class GameState implements GameSystem {
  readonly name = 'game.state';
  readonly phase = Phase.Gameplay;

  readonly inventory = new Inventory(6, 8);
  readonly crafting = new Crafting();
  readonly tech = new TechTree();
  readonly scanner = new Scanner();
  readonly quests = new QuestLog();
  readonly databank = new Databank();

  /** Every container the game knows about, keyed by id (`player`, `build:12`…). */
  readonly containers = new Map<string, Container>();

  /** Aggregated worn-equipment stats. Recomputed once a second. */
  readonly equipment: EquipmentStats = {
    oxygenBonus: 0, depthRating: 200, swimSpeed: 1, oxygenEfficiency: 1, armour: 0,
  };

  readonly stats = { crafted: 0, scans: 0, placed: 0, deaths: 0, distance: 0 };

  /**
   * Scan target currently under the reticle. Whichever system owns the reticle
   * (fauna, props, viewmodel) writes a `ScanTargetDef` id here and clears it to
   * null when nothing is aimed at. GameState drives the hold-to-fill from input.
   */
  scanTarget: string | null = null;

  /** Station the player may currently print at. Null = no station in reach. */
  activeStation: StationType | null = 'fabricator';

  playtime = 0;
  /** Seconds between autosaves. 0 disables. */
  autosaveInterval = 180;

  private ctx: GameContext | null = null;
  private build: BuildSystem | null = null;
  private lastBiome = '';
  private lastBand = '';
  private slowAccum = 0;
  private autosaveAccum = 0;
  private lastPos = new THREE.Vector3();
  private notifiedCrush = 0;
  private worldSeed = 0;
  private lastNotedDepth = -1;
  private trackedPosition = false;
  /** False until the first depth sample of the run has set the baseline. */
  private depthPrimed = false;
  /** Names of nodes that just became researchable, released a few seconds apart. */
  private techAnnounceQueue: string[] = [];
  private techAnnounceCooldown = 0;

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.registerContainer(this.inventory);

    /* ---- inventory -> bus + quests ---- */
    this.inventory.onItemChanged = (id, delta, total) => {
      ctx.bus.emit('inventory:changed', { id, delta, total });
      if (delta > 0) this.quests.noteItem(id, total);
    };

    /* ---- tech -> recipes, bus, quests ---- */
    this.tech.onUnlock = ({ node }) => {
      this.crafting.syncFromTech(this.tech);
      ctx.bus.emit('tech:unlocked', { id: node.id });
      ctx.bus.emit('ui:notify', { text: `Blueprint acquired: ${node.name}`, kind: 'success', ttl: 5 });
      ctx.bus.emit('audio:cue', { id: 'tech.unlock' });
      this.quests.noteTech(node.id);
    };

    /* ---- crafting -> bus + quests ---- */
    this.crafting.onCompleted = (recipeId, output) => {
      this.stats.crafted++;
      ctx.bus.emit('craft:completed', { id: output.id, count: output.count });
      ctx.bus.emit('audio:cue', { id: 'fabricator.done' });
      this.quests.noteCraft(recipeId, output.id);
      const def = itemDefOr(output.id);
      ctx.bus.emit('ui:notify', { text: `Fabricated ${def.name}`, kind: 'info', ttl: 3 });
    };
    this.crafting.onOverflow = (o) => {
      ctx.bus.emit('ui:notify', {
        text: `${itemDefOr(o.id).name} could not be stored — held in the fabricator.`,
        kind: 'warn', ttl: 5,
      });
    };

    /* ---- scanner -> databank, tech, bus, quests ---- */
    this.scanner.onScan = ({ target, found, required, finished }) => {
      this.stats.scans++;
      ctx.bus.emit('scan:completed', { id: target.id, category: target.category });
      ctx.bus.emit('audio:cue', { id: 'scanner.complete' });
      if (target.databank) this.databank.unlock(target.databank);
      if (finished) {
        this.quests.noteScan(target.id, target.category);
        if (target.unlocks) this.tech.unlock(target.unlocks, true);
        ctx.bus.emit('ui:notify', { text: `Scan complete: ${target.name}`, kind: 'success', ttl: 4 });
      } else {
        ctx.bus.emit('ui:notify', {
          text: `${target.name}: ${found} of ${required} fragments analysed.`,
          kind: 'info', ttl: 4,
        });
      }
    };
    this.scanner.onYield = (items) => {
      for (const it of items) this.inventory.add(it.id, it.count);
    };

    /* ---- databank -> bus ---- */
    this.databank.onUnlock = (entry) => {
      ctx.bus.emit('databank:unlocked', { id: entry.id });
      ctx.bus.emit('ui:notify', { text: `Databank updated: ${entry.title}`, kind: 'info', ttl: 4 });
      this.quests.noteDatabank(entry.id);
    };

    /* ---- quests -> bus ---- */
    this.quests.onGrantDatabank = (id) => this.databank.unlock(id);
    this.quests.onGrantTech = (id) => this.tech.unlock(id, true);
    this.quests.onUpdate = (u) => {
      ctx.bus.emit('quest:updated', {
        id: u.quest.id,
        state: u.state,
        objective: u.objective?.id,
      });
      if (u.state === 'started') {
        ctx.bus.emit('ui:notify', { text: `New objective: ${u.quest.title}`, kind: 'info', ttl: 6 });
        let delay = 0;
        for (const line of u.quest.briefing) {
          // The HUD queues voice lines; ttl staggers them without a timer here.
          ctx.bus.emit('ui:voice', { text: line, speaker: 'PDA', ttl: 7 + delay });
          delay += 7;
        }
      } else if (u.state === 'objective') {
        ctx.bus.emit('ui:notify', { text: `Objective complete: ${u.text}`, kind: 'success', ttl: 4 });
      } else {
        ctx.bus.emit('ui:voice', { text: u.text, speaker: 'PDA', ttl: 9 });
        this.save('auto');
      }
    };

    /* ---- external events ---- */
    ctx.bus.on('biome:entered', (e) => this.noteBiome(e.id));
    ctx.bus.on('player:died', () => {
      this.stats.deaths++;
    });

    this.crafting.syncFromTech(this.tech);
    this.quests.bootstrap();

    const terrain = ctx.tryGet<TerrainLike>('world.terrain');
    this.worldSeed = terrain?.seed ?? 0;

    // BuildSystem inits after us; resolve it lazily on first update.
  }

  /* ---------------------------------------------------------------- *
   * Frame update
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    this.ctx = ctx;
    if (!this.build) this.build = ctx.tryGet<BuildSystem>('game.build') ?? null;
    this.playtime += dt;

    this.crafting.update(dt);
    this.quests.update(dt);

    /* ---- scanning: hold the trigger with a target in the reticle ---- */
    if (this.scanTarget && ctx.input.down('scanner') && this.hasScanner()) {
      this.scanner.hold(this.scanTarget, dt);
    }
    this.scanner.update(dt);

    const player = ctx.tryGet<PlayerLike>('player');
    if (player) {
      /*
       * Distance and depth are both differential, so a discontinuity has to be
       * detected before either is integrated. A teleport must not be credited as
       * distance swum, and must not be reported as having "descended" past every
       * depth gate it skipped over.
       */
      const moved = this.trackedPosition ? this.lastPos.distanceTo(player.position) : 0;
      if (moved > TELEPORT_MARGIN + TELEPORT_SPEED * dt) {
        this.depthPrimed = false;
        this.techAnnounceQueue.length = 0;
      } else {
        this.stats.distance += moved;
      }
      this.trackedPosition = true;
      this.lastPos.copy(player.position);

      this.trackDepth(player, ctx);
      this.noteBiome(ctx.world.biomeAt(player.position.x, player.position.z).id);
    }
    this.drainTechAnnouncements(dt, ctx);

    /* ---- 1 Hz work: decay, equipment, station discovery ---- */
    this.slowAccum += dt;
    if (this.slowAccum >= 1) {
      const step = this.slowAccum;
      this.slowAccum = 0;
      this.tickSlow(step, ctx, player);
    }

    /* ---- autosave ---- */
    if (this.autosaveInterval > 0) {
      this.autosaveAccum += dt;
      if (this.autosaveAccum >= this.autosaveInterval) {
        this.autosaveAccum = 0;
        this.save('auto');
      }
    }
  }

  private tickSlow(step: number, ctx: GameContext, player: PlayerLike | undefined): void {
    // Perishables.
    for (const c of this.containers.values()) {
      const spoiled = c.tickDecay(step);
      if (spoiled.length && c === this.inventory) {
        ctx.bus.emit('ui:notify', { text: `${itemDefOr(spoiled[0]).name} has spoiled.`, kind: 'warn', ttl: 4 });
      }
    }

    // Worn equipment.
    this.inventory.prune();
    this.inventory.stats(this.equipment);
    if (player) {
      const target = 45 + this.equipment.oxygenBonus;
      if (player.vitals.maxOxygen !== target) {
        const ratio = player.vitals.maxOxygen > 0 ? player.vitals.oxygen / player.vitals.maxOxygen : 1;
        player.vitals.maxOxygen = target;
        player.vitals.oxygen = Math.min(target, ratio * target);
      }
      // Crush depth: past the suit's rating the hull of your body starts losing.
      const over = player.depth - this.equipment.depthRating;
      if (over > 0) {
        player.damage(Math.min(12, 1 + over * 0.06) * step, 'pressure');
        if (ctx.time - this.notifiedCrush > 6) {
          this.notifiedCrush = ctx.time;
          ctx.bus.emit('ui:notify', {
            text: `HULL PRESSURE CRITICAL — suit rated to ${this.equipment.depthRating} m`,
            kind: 'danger', ttl: 5,
          });
        }
      }
    }

    // Which fabricator can the player reach?
    if (this.build && player) {
      const near = this.build.stationsNear(player.position, 3.2);
      this.activeStation = (near[0]?.station as StationType | undefined) ?? 'fabricator';
    }
  }

  private trackDepth(player: PlayerLike, ctx: GameContext): void {
    const depth = player.depth;
    if (!Number.isFinite(depth)) return;

    if (!this.depthPrimed) {
      /*
       * First depth sample of the run — a fresh spawn, a loaded save, or a
       * camera the capture harness dropped straight onto the sea floor. Seed
       * the baseline silently: announcing here would fire every depth gate at
       * or above the spawn point in a single frame with no player action
       * (three toasts at 217 m, which is exactly what round 1 captured).
       * Quest depth objectives still evaluate, because "you are at 300 m" is a
       * real state change rather than a notification about progress.
       */
      this.depthPrimed = true;
      this.tech.primeDepth(depth);
      this.lastNotedDepth = depth;
      this.quests.noteDepth(depth);
      this.emitBand(depth, ctx);
      return;
    }

    const newly = this.tech.noteDepth(depth);
    if (newly.length) {
      this.lastNotedDepth = depth;
      this.quests.noteDepth(depth);
      for (const n of newly) this.techAnnounceQueue.push(n.name);
    } else if (depth > this.lastNotedDepth + 0.75) {
      // Only re-evaluate depth triggers when the record actually moves.
      this.lastNotedDepth = depth;
      this.quests.noteDepth(depth);
    }

    this.emitBand(depth, ctx);
  }

  private emitBand(depth: number, ctx: GameContext): void {
    let band = DEPTH_BANDS[0].band;
    for (const b of DEPTH_BANDS) if (depth >= b.from) band = b.band;
    if (band !== this.lastBand) {
      this.lastBand = band;
      ctx.bus.emit('depth:band', { band, depth });
    }
  }

  /**
   * Releases queued "now researchable" lines one at a time. A fast descent can
   * cross several gates in a second; dumping one toast each buries the HUD, so
   * a burst collapses into a single summary instead.
   */
  private drainTechAnnouncements(dt: number, ctx: GameContext): void {
    if (!this.techAnnounceQueue.length) return;
    this.techAnnounceCooldown -= dt;
    if (this.techAnnounceCooldown > 0) return;
    this.techAnnounceCooldown = TECH_ANNOUNCE_GAP;

    if (this.techAnnounceQueue.length > TECH_ANNOUNCE_BURST) {
      const n = this.techAnnounceQueue.length;
      this.techAnnounceQueue.length = 0;
      ctx.bus.emit('ui:notify', {
        text: `Depth clearance: ${n} new blueprints are researchable. See the PDA.`,
        kind: 'info', ttl: 6,
      });
      return;
    }

    const name = this.techAnnounceQueue.shift();
    if (name) {
      ctx.bus.emit('ui:notify', {
        text: `Now researchable: ${name} — recover the fragments to acquire it.`,
        kind: 'info', ttl: 5,
      });
    }
  }

  private noteBiome(id: string): void {
    if (!id || id === this.lastBiome) return;
    this.lastBiome = id;
    this.quests.noteBiome(id);
  }

  private hasScanner(): boolean {
    return this.inventory.countOf('scanner') > 0 || this.ctx?.settings.gameplay.mode === 'creative';
  }

  /* ---------------------------------------------------------------- *
   * Items
   * ---------------------------------------------------------------- */

  itemDef(id: string): ItemDef | undefined {
    return lookupItem(id);
  }

  allItems(): readonly ItemDef[] {
    return ITEM_LIST;
  }

  /** Icon-generation parameters for the UI's procedural icon renderer. */
  iconFor(id: string): IconParams {
    return itemDefOr(id).icon;
  }

  /** World pickup entry point. Returns how many units were accepted. */
  addItem(id: string, count = 1): number {
    const taken = this.inventory.add(id, count);
    if (taken > 0) {
      const def = itemDefOr(id);
      this.ctx?.bus.emit('audio:cue', { id: 'item.pickup' });
      if (def.category === 'tool') {
        const stack = this.inventory.items.find((i) => i.id === id);
        if (stack) this.inventory.autoBind(stack.uid);
      }
    } else {
      this.ctx?.bus.emit('ui:notify', { text: 'Inventory full.', kind: 'warn', ttl: 3 });
    }
    return taken;
  }

  removeItem(id: string, count = 1): boolean {
    return this.inventory.remove(id, count);
  }

  countOf(id: string): number {
    let n = 0;
    for (const c of this.containers.values()) n += c.countOf(id);
    return n;
  }

  hasItems(reqs: readonly Ingredient[]): boolean {
    return this.inventory.has(reqs);
  }

  /**
   * Uses an item: eats/drinks consumables, applies medkits, reads data boxes,
   * equips wearables. Returns true when something happened.
   */
  useItem(uid: number): boolean {
    const it = this.inventory.byUid(uid);
    if (!it) return false;
    const def = itemDefOr(it.id);
    const ctx = this.ctx;

    if (def.category === 'blueprint' && def.unlocks) {
      this.tech.unlock(def.unlocks, true);
      if (def.databank) this.databank.unlock(def.databank);
      this.inventory.removeUid(uid, 1);
      return true;
    }
    if (def.slot && def.slot !== 'hand') {
      return this.inventory.isEquipped(uid) ? this.inventory.unequip(def.slot) : this.inventory.equip(uid);
    }
    if (def.food !== undefined || def.water !== undefined || def.heal !== undefined || def.oxygen !== undefined) {
      return this.consumeItem(uid);
    }
    if (ctx) ctx.bus.emit('ui:notify', { text: `${def.name} has no use from here.`, kind: 'info', ttl: 3 });
    return false;
  }

  /** Eats/drinks/applies one unit and pushes the effect into player vitals. */
  consumeItem(uid: number): boolean {
    const it = this.inventory.byUid(uid);
    if (!it) return false;
    const def = itemDefOr(it.id);
    const player = this.ctx?.tryGet<PlayerLike>('player');
    if (!player) return false;
    if (def.food === undefined && def.water === undefined && def.heal === undefined && def.oxygen === undefined) {
      return false;
    }
    const v = player.vitals;
    if (def.food) v.food = THREE.MathUtils.clamp(v.food + def.food, 0, 100);
    if (def.water) v.water = THREE.MathUtils.clamp(v.water + def.water, 0, 100);
    if (def.heal) v.health = THREE.MathUtils.clamp(v.health + def.heal, 0, 100);
    if (def.oxygen) v.oxygen = Math.min(v.maxOxygen, v.oxygen + def.oxygen);
    this.inventory.removeUid(uid, 1);
    this.ctx?.bus.emit('audio:cue', { id: def.water ? 'consume.drink' : 'consume.eat' });
    return true;
  }

  /** Drops a stack out of the inventory. Returns the item id and count dropped. */
  dropItem(uid: number, count = Infinity): { id: string; count: number } | null {
    const it = this.inventory.byUid(uid);
    if (!it) return null;
    const id = it.id;
    const moved = this.inventory.removeUid(uid, count);
    if (moved <= 0) return null;
    return { id, count: moved };
  }

  /* ---------------------------------------------------------------- *
   * Containers
   * ---------------------------------------------------------------- */

  registerContainer(c: Container): void {
    this.containers.set(c.id, c);
    this.crafting.registerContainer(c);
  }

  unregisterContainer(id: string): void {
    this.containers.delete(id);
    this.crafting.unregisterContainer(id);
  }

  container(id: string): Container | undefined {
    return this.containers.get(id);
  }

  allContainers(): Container[] {
    return [...this.containers.values()];
  }

  /** Grid-aware transfer between any two registered containers. */
  transfer(uid: number, from: Container, to: Container, count = Infinity, x?: number, y?: number): number {
    return from.transfer(uid, to, count, x, y);
  }

  /* ---------------------------------------------------------------- *
   * Crafting
   * ---------------------------------------------------------------- */

  /** Stations in reach: built ones plus the lifepod's own fabricator. */
  stationsInReach(): StationType[] {
    const out = new Set<StationType>(['fabricator']);
    const player = this.ctx?.tryGet<PlayerLike>('player');
    if (this.build && player) {
      for (const s of this.build.stationsNear(player.position, 3.2)) out.add(s.station as StationType);
    }
    return [...out];
  }

  craftStatus(station: StationType = this.activeStation ?? 'fabricator'): CraftStatus[] {
    return this.crafting.statusFor(station, this.inventory);
  }

  beginCraft(recipeId: string): boolean {
    const r = RECIPES.get(recipeId);
    if (!r) return false;
    if (!this.stationsInReach().includes(r.station)) {
      this.ctx?.bus.emit('ui:notify', { text: `Requires a ${r.station.replace(/_/g, ' ')}.`, kind: 'warn', ttl: 4 });
      return false;
    }
    const job = this.crafting.start(recipeId, this.inventory);
    if (!job) {
      this.ctx?.bus.emit('ui:notify', { text: 'Missing materials.', kind: 'warn', ttl: 3 });
      return false;
    }
    this.ctx?.bus.emit('audio:cue', { id: 'fabricator.start' });
    return true;
  }

  cancelCraft(jobId: number): boolean {
    return this.crafting.cancel(jobId, this.inventory);
  }

  /** 0..1 progress at a station, or -1 when idle. */
  craftProgress(station: StationType): number {
    return this.crafting.stationProgress(station);
  }

  recipe(id: string): RecipeDef | undefined {
    return RECIPES.get(id);
  }

  /** Fully expanded raw-resource cost, for the PDA's shopping list. */
  rawCostOf(recipeId: string): Map<string, number> {
    return expandToRaw(recipeId);
  }

  /* ---------------------------------------------------------------- *
   * Tech / scanner / quests / databank
   * ---------------------------------------------------------------- */

  techNodes(): readonly TechNode[] {
    return TECH_LIST;
  }

  techFrontier(): TechNode[] {
    return this.tech.frontier();
  }

  techDepthBlocked(): TechNode[] {
    return this.tech.depthBlocked();
  }

  unlockTech(id: string, force = true): boolean {
    return this.tech.unlock(id, force);
  }

  scanProgress(id: string): number {
    return this.scanner.progressOf(id);
  }

  scanFragments(id: string): { found: number; required: number } {
    return { found: this.scanner.fragmentsOf(id), required: this.scanner.requiredFor(id) };
  }

  /** Manual scan drive, for systems that own their own trigger handling. */
  scanHold(targetId: string, dt: number): void {
    this.scanner.hold(targetId, dt);
  }

  questViews(): QuestView[] {
    return this.quests.views();
  }

  currentObjective(): { quest: QuestDef; objective: ObjectiveDef } | null {
    return this.quests.currentObjective();
  }

  /** Completes a scripted `manual` objective. */
  completeObjective(questId: string, objectiveId: string): boolean {
    return this.quests.force(questId, objectiveId);
  }

  databankList(category?: DatabankCategory): DatabankEntry[] {
    return this.databank.list(category);
  }

  readEntry(id: string): DatabankEntry | undefined {
    this.databank.markRead(id);
    return this.databank.has(id) ? this.databankList().find((e) => e.id === id) : undefined;
  }

  get unreadCount(): number {
    return this.databank.unreadCount;
  }

  /** Called by BuildSystem after a successful placement. */
  notePlaced(pieceId: string): void {
    this.stats.placed++;
    this.quests.noteBuild(pieceId);
  }

  /* ---------------------------------------------------------------- *
   * Save / load
   * ---------------------------------------------------------------- */

  saveSlots(): SaveSlotInfo[] {
    return listSaves();
  }

  hasSave(slot = 'auto'): boolean {
    try {
      return localStorage.getItem(saveKey(slot)) !== null;
    } catch {
      return false;
    }
  }

  deleteSave(slot: string): void {
    try {
      localStorage.removeItem(saveKey(slot));
    } catch {
      /* storage unavailable */
    }
  }

  save(slot = 'auto'): void {
    const ctx = this.ctx;
    const player = ctx?.tryGet<PlayerLike>('player');
    const sky = ctx?.tryGet<SkyLike>('world.sky');
    const build = this.build ?? ctx?.tryGet<BuildSystem>('game.build') ?? null;

    const external: SerialisedContainer[] = [];
    for (const c of this.containers.values()) {
      if (c === this.inventory) continue;
      external.push(c.serialise());
    }

    const data: SaveData = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      playtime: this.playtime,
      world: {
        seed: this.worldSeed,
        timeOfDay: sky?.timeOfDay ?? 9,
        dayLength: sky?.dayLength ?? 1200,
      },
      player: {
        position: player ? [player.position.x, player.position.y, player.position.z] : [0, -12, 0],
        yaw: (player as unknown as { yaw?: number })?.yaw ?? 0,
        pitch: (player as unknown as { pitch?: number })?.pitch ?? 0,
        vitals: player
          ? { ...player.vitals }
          : { oxygen: 45, maxOxygen: 45, health: 100, food: 100, water: 100 },
      },
      inventory: this.inventory.serialise(),
      containers: external,
      crafting: this.crafting.serialise() as unknown as SaveData['crafting'],
      tech: this.tech.serialise(),
      scanner: this.scanner.serialise(),
      quests: this.quests.serialise(),
      databank: this.databank.serialise(),
      build: build?.serialise(),
      stats: { ...this.stats },
    };

    try {
      localStorage.setItem(saveKey(slot), JSON.stringify(data));
      ctx?.bus.emit('save:written', { slot });
      if (slot !== 'auto') ctx?.bus.emit('ui:notify', { text: `Saved to "${slot}".`, kind: 'success', ttl: 3 });
    } catch {
      ctx?.bus.emit('ui:notify', { text: 'Save failed — storage unavailable.', kind: 'danger', ttl: 5 });
    }
  }

  load(slot = 'auto'): boolean {
    const ctx = this.ctx;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(saveKey(slot));
    } catch {
      return false;
    }
    if (!raw) return false;

    let data: SaveData | null = null;
    try {
      data = migrate(JSON.parse(raw));
    } catch {
      data = null;
    }
    if (!data) {
      ctx?.bus.emit('ui:notify', { text: 'Save file is unreadable.', kind: 'danger', ttl: 5 });
      return false;
    }

    this.playtime = data.playtime ?? 0;
    Object.assign(this.stats, data.stats ?? {});

    // Containers first, so the build system can re-home its own storage.
    for (const id of [...this.containers.keys()]) if (id !== 'player') this.unregisterContainer(id);
    this.inventory.deserialise(data.inventory);
    for (const c of data.containers ?? []) {
      const existing = this.containers.get(c.id);
      if (existing) existing.deserialise(c);
      else {
        const fresh = new Container(c.id, c.label, c.width, c.height);
        fresh.deserialise(c);
        this.registerContainer(fresh);
      }
    }

    this.tech.deserialise(data.tech);
    this.crafting.syncFromTech(this.tech);
    this.crafting.deserialise(data.crafting as unknown as { queue?: never[]; overflow?: never[] });
    this.scanner.deserialise(data.scanner);
    this.databank.deserialise(data.databank);
    this.quests.deserialise((data.quests ?? {}) as Parameters<QuestLog['deserialise']>[0]);
    this.quests.bootstrap();

    // World + player.
    if (ctx) {
      const sky = ctx.tryGet<SkyLike>('world.sky');
      if (sky && data.world) {
        if (typeof sky.timeOfDay === 'number') sky.timeOfDay = data.world.timeOfDay;
        if (typeof sky.dayLength === 'number' && data.world.dayLength) sky.dayLength = data.world.dayLength;
      }
      const terrain = ctx.tryGet<TerrainLike>('world.terrain');
      if (terrain?.seed !== undefined && data.world && data.world.seed && terrain.seed !== data.world.seed) {
        ctx.bus.emit('ui:notify', {
          text: 'Save was made in a different world seed — terrain will not match.',
          kind: 'warn', ttl: 8,
        });
      }
      const player = ctx.tryGet<PlayerLike>('player');
      if (player && data.player) {
        _v0.set(data.player.position[0], data.player.position[1], data.player.position[2]);
        const teleport = (player as unknown as { teleport?: (p: THREE.Vector3) => void }).teleport;
        if (teleport) teleport.call(player, _v0);
        else player.position.copy(_v0);
        Object.assign(player.vitals, data.player.vitals);
      }
      const build = this.build ?? ctx.tryGet<BuildSystem>('game.build') ?? null;
      this.build = build;
      build?.deserialise(data.build, ctx);
      ctx.bus.emit('save:loaded', { slot });
      ctx.bus.emit('ui:notify', { text: `Loaded "${slot}".`, kind: 'success', ttl: 3 });
    }

    /*
     * The player has just been teleported to the saved position. Re-prime both
     * trackers so the next frame treats that position as a baseline: otherwise
     * `deepestDepth` would re-announce every gate above the saved depth, and
     * `stats.distance` would absorb the whole pre-load-to-post-load jump as
     * distance swum.
     */
    this.depthPrimed = false;
    this.trackedPosition = false;
    this.techAnnounceQueue.length = 0;
    this.techAnnounceCooldown = 0;

    this.inventory.stats(this.equipment);
    return true;
  }

  /** Wipes runtime state back to a fresh run (new game). */
  resetRun(): void {
    this.inventory.clear();
    for (const id of [...this.containers.keys()]) if (id !== 'player') this.unregisterContainer(id);
    this.tech.reset();
    this.scanner.reset();
    this.databank.reset();
    this.quests.reset();
    this.crafting.syncFromTech(this.tech);
    this.quests.bootstrap();
    this.playtime = 0;
    this.depthPrimed = false;
    this.trackedPosition = false;
    this.techAnnounceQueue.length = 0;
    this.techAnnounceCooldown = 0;
    this.lastNotedDepth = -1;
    this.lastBand = '';
    this.lastBiome = '';
    this.stats.crafted = 0;
    this.stats.scans = 0;
    this.stats.placed = 0;
    this.stats.deaths = 0;
    this.stats.distance = 0;
  }

  dispose(): void {
    this.containers.clear();
    this.ctx = null;
    this.build = null;
  }
}

/** Convenience for the HUD: a stable, sorted view of one container's contents. */
export function containerView(c: Container): PlacedItem[] {
  return [...c.items].sort((a, b) => a.y - b.y || a.x - b.x);
}
