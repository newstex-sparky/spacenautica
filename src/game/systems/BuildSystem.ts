/**
 * BASE BUILDING.
 *
 * Ghost placement with terrain-slope and collision validation, connector
 * snapping, a structural-integrity budget that breaches compartments when you
 * overspend it, a power network with real producers and consumers, and interior
 * flood/drain state. All geometry is procedural (`BuildGeometry.ts`); all
 * materials are procedural (`BuildMaterials.ts`).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem, QualityTier } from '../core/Types';
import { BUILD_PIECES, BUILD_PIECE_LIST } from './BuildPieces';
import type { BuildPieceDef, SnapKind } from './BuildPieces';
import { BuildMaterials } from './BuildMaterials';
import { buildPieceGeometry, disposePieceGeometry } from './BuildGeometry';
import type { PieceGeometry } from './BuildGeometry';
import { Container } from './Inventory';
import type { GameState } from './GameState';

/* ---------------- module-scope scratch (no per-frame allocation) ---------------- */
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _box0 = new THREE.Box3();
const _box1 = new THREE.Box3();
const _hit = new THREE.Vector3();
const _aim = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface WorldConnector {
  pieceUid: number;
  kind: SnapKind;
  /** World position. */
  pos: THREE.Vector3;
  /** World outward direction. */
  dir: THREE.Vector3;
  /** uid of the piece docked here, or 0. */
  occupiedBy: number;
}

export interface PlacedPiece {
  uid: number;
  defId: string;
  seed: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** 0..1 structural health. Below 0.35 it groans; at 0 it breaches. */
  health: number;
  breached: boolean;
  /** 0..1 interior water level. */
  flooded: number;
  /** Assigned by the connectivity pass. */
  baseId: number;
  group: THREE.Group;
  geometry: PieceGeometry;
  connectors: WorldConnector[];
  /** Local-space bounds from the generated geometry. */
  bounds: THREE.Box3;
  containerId?: string;
}

export interface BaseInfo {
  id: number;
  pieces: number[];
  /** Structural capacity minus load minus depth penalty. Negative = failing. */
  integrity: number;
  capacity: number;
  load: number;
  /** Watts. */
  production: number;
  consumption: number;
  /** Stored energy, kJ. */
  energy: number;
  maxEnergy: number;
  powered: boolean;
  /** 0..1 average interior flooding. */
  flooded: number;
  breaches: number;
  /** Metres below sea level of the deepest piece. */
  depth: number;
}

export interface GhostState {
  defId: string | null;
  valid: boolean;
  reason: string;
  snapped: boolean;
  position: THREE.Vector3;
}

interface SerialisedPiece {
  defId: string;
  seed: number;
  p: [number, number, number];
  q: [number, number, number, number];
  health: number;
  breached: boolean;
  flooded: number;
  container?: ReturnType<Container['serialise']>;
}

export interface SerialisedBuild {
  pieces: SerialisedPiece[];
}

/** How often the structural/power/flood simulation ticks, in seconds. */
const SIM_STEP = 0.25;

export class BuildSystem implements GameSystem {
  readonly name = 'game.build';
  readonly phase = Phase.Gameplay;

  /** All placed structures. Read-only for other systems. */
  readonly pieces: PlacedPiece[] = [];
  /** Connected structure groups, recomputed on every placement/removal. */
  readonly bases: BaseInfo[] = [];
  /** Storage containers owned by built pieces, keyed by container id. */
  readonly containers = new Map<string, Container>();

  /** True while the habitat builder is deployed. */
  buildMode = false;
  /** Currently selected piece id, or null. */
  ghostDefId: string | null = null;
  /** User yaw applied on top of the snap alignment, radians. */
  ghostYaw = 0;
  /** Whether the current ghost may be placed, and why not. */
  ghostValid = false;
  ghostReason = '';

  private group = new THREE.Group();
  private ghostGroup = new THREE.Group();
  private ghostMesh: THREE.Mesh | null = null;
  private ghostGeometry: PieceGeometry | null = null;
  private ghostMerged: THREE.BufferGeometry | null = null;
  private ghostBuiltFor: string | null = null;
  private ghostPos = new THREE.Vector3();
  private ghostQuat = new THREE.Quaternion();
  private ghostSnap: WorldConnector | null = null;

  private mats: BuildMaterials | null = null;
  private tier: QualityTier = 'high';
  private nextUid = 1;
  private nextBaseId = 1;
  private simAccum = 0;
  private state: GameState | null = null;
  private bus: GameContext['bus'] | null = null;
  /** Palette of piece ids currently unlocked, refreshed lazily. */
  private palette: string[] = [];
  private paletteIndex = 0;
  private paletteRevision = -1;

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.tier = ctx.settings.graphics.tier;
    this.bus = ctx.bus;
    this.group.name = 'buildings';
    this.ghostGroup.name = 'build.ghost';
    this.ghostGroup.visible = false;
    ctx.scene.add(this.group);
    ctx.scene.add(this.ghostGroup);
    this.mats = new BuildMaterials(ctx);
    this.state = ctx.tryGet<GameState>('game.state') ?? null;

    ctx.bus.on('ui:screen', (e) => {
      // Any modal screen closes build mode so clicks are unambiguous.
      if (e.open && e.screen !== 'build') this.setBuildMode(false);
    });
  }

  dispose(): void {
    for (const p of this.pieces) {
      disposePieceGeometry(p.geometry);
      p.group.removeFromParent();
    }
    this.pieces.length = 0;
    this.containers.clear();
    if (this.ghostGeometry) disposePieceGeometry(this.ghostGeometry);
    this.ghostMerged?.dispose();
    this.ghostGroup.removeFromParent();
    this.group.removeFromParent();
    this.mats?.dispose();
    this.mats = null;
  }

  /* ---------------------------------------------------------------- *
   * Public API (HUD + player systems read these)
   * ---------------------------------------------------------------- */

  /** Piece ids the player has unlocked and may place. */
  availablePieces(): string[] {
    const tech = this.state?.tech;
    if (!tech) return BUILD_PIECE_LIST.map((p) => p.id);
    const known = tech.knownBuildPieces();
    return BUILD_PIECE_LIST.filter((p) => !p.requiresTech || known.has(p.id) || tech.isUnlocked(p.requiresTech))
      .map((p) => p.id);
  }

  setBuildMode(on: boolean): void {
    if (this.buildMode === on) return;
    this.buildMode = on;
    this.ghostGroup.visible = on;
    if (!on) {
      this.ghostSnap = null;
      this.ghostValid = false;
    } else {
      this.refreshPalette();
      if (!this.ghostDefId) this.ghostDefId = this.palette[0] ?? null;
    }
    this.bus?.emit('ui:screen', { screen: 'build', open: on });
  }

  selectPiece(id: string): boolean {
    if (!BUILD_PIECES.has(id)) return false;
    this.ghostDefId = id;
    const i = this.palette.indexOf(id);
    if (i >= 0) this.paletteIndex = i;
    return true;
  }

  cyclePiece(delta: number): void {
    this.refreshPalette();
    if (this.palette.length === 0) return;
    this.paletteIndex = (this.paletteIndex + delta + this.palette.length * 2) % this.palette.length;
    this.ghostDefId = this.palette[this.paletteIndex];
  }

  rotateGhost(delta: number): void {
    this.ghostYaw = (this.ghostYaw + delta) % (Math.PI * 2);
  }

  /** Snapshot of the ghost for the HUD. */
  ghostState(): GhostState {
    return {
      defId: this.ghostDefId,
      valid: this.ghostValid,
      reason: this.ghostReason,
      snapped: this.ghostSnap !== null,
      position: this.ghostPos,
    };
  }

  /** The base a world point is inside, plus its flood level. */
  interiorAt(pos: THREE.Vector3): { piece: PlacedPiece; base: BaseInfo | undefined; flooded: number } | null {
    for (const p of this.pieces) {
      const def = BUILD_PIECES.get(p.defId);
      if (!def?.volume) continue;
      _v0.copy(pos).sub(p.position).applyQuaternion(_q0.copy(p.quaternion).invert());
      _box0.copy(p.bounds).expandByScalar(-0.25);
      if (_box0.containsPoint(_v0)) {
        const base = this.bases.find((b) => b.id === p.baseId);
        return { piece: p, base, flooded: p.flooded };
      }
    }
    return null;
  }

  /** True when the point is inside a pressurised, unflooded compartment. */
  isBreathable(pos: THREE.Vector3): boolean {
    const inside = this.interiorAt(pos);
    return !!inside && inside.flooded < 0.55 && !inside.piece.breached;
  }

  /** Fabricator/workbench stations within `radius` of a point. */
  stationsNear(pos: THREE.Vector3, radius = 3.5): Array<{ station: string; piece: PlacedPiece }> {
    const out: Array<{ station: string; piece: PlacedPiece }> = [];
    const r2 = radius * radius;
    for (const p of this.pieces) {
      const def = BUILD_PIECES.get(p.defId);
      if (!def?.station) continue;
      if (p.position.distanceToSquared(pos) > r2) continue;
      out.push({ station: def.station, piece: p });
    }
    return out;
  }

  /** Storage containers within reach, for the HUD's "nearby storage" panel. */
  containersNear(pos: THREE.Vector3, radius = 3.5): Container[] {
    const out: Container[] = [];
    const r2 = radius * radius;
    for (const p of this.pieces) {
      if (!p.containerId) continue;
      if (p.position.distanceToSquared(pos) > r2) continue;
      const c = this.containers.get(p.containerId);
      if (c) out.push(c);
    }
    return out;
  }

  baseOf(uid: number): BaseInfo | undefined {
    const p = this.pieces.find((x) => x.uid === uid);
    return p ? this.bases.find((b) => b.id === p.baseId) : undefined;
  }

  /** Repair tool entry point: heals a piece and re-seals a breach. */
  repair(uid: number, amount: number): boolean {
    const p = this.pieces.find((x) => x.uid === uid);
    if (!p) return false;
    p.health = Math.min(1, p.health + amount);
    if (p.breached && p.health > 0.55) {
      p.breached = false;
      this.bus?.emit('ui:notify', { text: `${BUILD_PIECES.get(p.defId)?.name ?? 'Compartment'} sealed.`, kind: 'success' });
    }
    return true;
  }

  /** Nearest piece to a point, for the repair tool / deconstruct reticle. */
  pieceNear(pos: THREE.Vector3, radius = 4): PlacedPiece | null {
    let best: PlacedPiece | null = null;
    let bestD = radius * radius;
    for (const p of this.pieces) {
      const d = p.position.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- *
   * Frame update
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    this.mats?.update(ctx);

    if (ctx.input.pressed('build')) this.setBuildMode(!this.buildMode);

    if (this.buildMode) {
      if (ctx.input.wheel !== 0) this.cyclePiece(ctx.input.wheel > 0 ? 1 : -1);
      if (ctx.input.pressed('secondary')) this.rotateGhost(Math.PI / 4);
      this.updateGhost(ctx);
      if (ctx.input.pressed('primary') && this.ghostValid) this.placeGhost(ctx);
    } else if (this.ghostGroup.visible) {
      this.ghostGroup.visible = false;
    }

    this.simAccum += dt;
    while (this.simAccum >= SIM_STEP) {
      this.simAccum -= SIM_STEP;
      this.simulate(SIM_STEP, ctx);
    }
  }

  /* ---------------------------------------------------------------- *
   * Ghost placement
   * ---------------------------------------------------------------- */

  private refreshPalette(): void {
    const rev = this.state?.tech.unlocked.size ?? 0;
    if (rev === this.paletteRevision && this.palette.length) return;
    this.paletteRevision = rev;
    this.palette = this.availablePieces();
    if (this.paletteIndex >= this.palette.length) this.paletteIndex = 0;
  }

  private ensureGhostGeometry(def: BuildPieceDef): void {
    if (this.ghostBuiltFor === def.id && this.ghostMesh) return;
    if (this.ghostGeometry) disposePieceGeometry(this.ghostGeometry);
    this.ghostMerged?.dispose();
    if (this.ghostMesh) {
      this.ghostMesh.removeFromParent();
      this.ghostMesh = null;
    }
    // A fixed seed keeps the preview stable while the player aims.
    this.ghostGeometry = buildPieceGeometry(def, 12345, this.tier);
    const list: THREE.BufferGeometry[] = [];
    if (this.ghostGeometry.hull) list.push(this.ghostGeometry.hull.clone());
    if (this.ghostGeometry.trim) list.push(this.ghostGeometry.trim.clone());
    const merged = list.length > 1 ? mergeGeometries(list, false) : list[0] ?? null;
    if (list.length > 1) for (const g of list) g.dispose();
    this.ghostMerged = merged ?? null;
    if (this.ghostMerged && this.mats) {
      this.ghostMesh = new THREE.Mesh(this.ghostMerged, this.mats.ghost);
      this.ghostMesh.frustumCulled = false;
      this.ghostGroup.add(this.ghostMesh);
    }
    this.ghostBuiltFor = def.id;
  }

  private updateGhost(ctx: GameContext): void {
    const def = this.ghostDefId ? BUILD_PIECES.get(this.ghostDefId) : undefined;
    if (!def) {
      this.ghostGroup.visible = false;
      this.ghostValid = false;
      this.ghostReason = 'No pattern selected.';
      return;
    }
    this.ensureGhostGeometry(def);
    this.ghostGroup.visible = true;

    // --- aim ray ---
    ctx.camera.getWorldDirection(_v0);
    const origin = ctx.camera.position;
    const reach = 9;
    const hitDist = this.rayTerrain(ctx, origin, _v0, reach);
    const aim = _aim;
    if (hitDist >= 0) aim.copy(_hit);
    else aim.copy(origin).addScaledVector(_v0, 5.5);

    // --- snapping ---
    const snap = this.findSnap(def, aim);
    this.ghostSnap = snap;

    const bounds = this.ghostGeometry?.bounds ?? new THREE.Box3();
    if (snap) {
      this.composeSnapped(def, snap, bounds);
    } else {
      // Free placement on the sea floor.
      this.ghostQuat.setFromAxisAngle(UP, this.ghostYaw);
      const floor = ctx.world.heightAt(aim.x, aim.z);
      this.ghostPos.set(aim.x, floor - bounds.min.y, aim.z);
    }

    this.ghostGroup.position.copy(this.ghostPos);
    this.ghostGroup.quaternion.copy(this.ghostQuat);

    const check = this.validate(def, this.ghostPos, this.ghostQuat, bounds, snap, ctx);
    this.ghostValid = check.valid;
    this.ghostReason = check.reason;
    this.mats?.setGhostValid(check.valid);
  }

  /** Aligns the ghost so its docking connector mates with `snap`. */
  private composeSnapped(def: BuildPieceDef, snap: WorldConnector, bounds: THREE.Box3): void {
    const local = this.dockingConnector(def, snap.kind);

    if (snap.kind === 'ground' || snap.kind === 'floor') {
      // Sits on top of a surface: keep it upright, user controls yaw.
      this.ghostQuat.setFromAxisAngle(UP, this.ghostYaw);
      this.ghostPos.copy(snap.pos);
      this.ghostPos.y += -bounds.min.y;
      return;
    }

    // Align the piece's outward socket direction against the target's.
    _v2.set(local.dir[0], local.dir[1], local.dir[2]).normalize();
    _v3.copy(snap.dir).multiplyScalar(-1).normalize();
    _q0.setFromUnitVectors(_v2, _v3);
    // Roll about the joint axis so the player can spin a hatch or window.
    _q1.setFromAxisAngle(_v3, this.ghostYaw);
    this.ghostQuat.copy(_q1).multiply(_q0);

    _v2.set(local.pos[0], local.pos[1], local.pos[2]).applyQuaternion(this.ghostQuat);
    this.ghostPos.copy(snap.pos).sub(_v2);
  }

  /** Chooses which of the piece's own sockets docks into a target socket. */
  private dockingConnector(def: BuildPieceDef, targetKind: SnapKind): { pos: [number, number, number]; dir: [number, number, number] } {
    const exact = def.connectors.find((c) => c.kind === targetKind);
    if (exact) return exact;
    const corridor = def.connectors.find((c) => c.kind === 'corridor' || c.kind === 'hatch');
    if (corridor) return corridor;
    if (def.connectors.length) return def.connectors[0];
    // Wall-mounted pieces (windows, lockers): dock their -Z face.
    return { pos: [0, 0, -def.extents[2]], dir: [0, 0, -1] };
  }

  private findSnap(def: BuildPieceDef, aim: THREE.Vector3): WorldConnector | null {
    if (def.snapTo.length === 0) return null;
    let best: WorldConnector | null = null;
    let bestD = 4.5;
    for (const p of this.pieces) {
      for (const c of p.connectors) {
        if (c.occupiedBy !== 0) continue;
        if (!def.snapTo.includes(c.kind)) continue;
        const d = c.pos.distanceTo(aim);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  /**
   * Cheap heightfield march. Writes the contact point into the module scratch
   * `_hit` and returns its distance, or -1 when the ray misses the floor.
   * Allocation-free.
   */
  private rayTerrain(ctx: GameContext, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    const step = 0.35;
    for (let t = step; t <= maxDist; t += step) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      if (y <= ctx.world.heightAt(x, z)) {
        // One bisection pass for a tighter contact point.
        const tm = t - step * 0.5;
        const my = origin.y + dir.y * tm;
        const useM = my > ctx.world.heightAt(origin.x + dir.x * tm, origin.z + dir.z * tm);
        const ft = useM ? t : tm;
        _hit.set(origin.x + dir.x * ft, origin.y + dir.y * ft, origin.z + dir.z * ft);
        return ft;
      }
    }
    return -1;
  }

  private validate(
    def: BuildPieceDef,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    bounds: THREE.Box3,
    snap: WorldConnector | null,
    ctx: GameContext,
  ): { valid: boolean; reason: string } {
    // --- tech ---
    if (def.requiresTech && this.state && !this.state.tech.isUnlocked(def.requiresTech)) {
      return { valid: false, reason: 'Pattern not yet recovered.' };
    }

    // --- resources ---
    if (this.state && ctx.settings.gameplay.mode !== 'creative') {
      const missing = this.state.inventory.missing(def.cost);
      if (missing.length) {
        const first = missing[0];
        return { valid: false, reason: `Need ${first.count} more ${first.id.replace(/_/g, ' ')}.` };
      }
    }

    // --- attachment rules ---
    if (!def.ground && !snap && this.pieces.length > 0) {
      return { valid: false, reason: 'Must connect to an existing structure.' };
    }
    if (def.interior && !snap) {
      return { valid: false, reason: 'Must be mounted inside a habitat.' };
    }
    if (!def.ground && !def.interior && !snap && this.pieces.length === 0) {
      // The very first corridor is allowed to rest on the floor.
      const floor = ctx.world.heightAt(pos.x, pos.z);
      if (pos.y + bounds.min.y > floor + 0.6) return { valid: false, reason: 'Needs a foundation or a connection.' };
    }

    // --- terrain slope for ground pieces ---
    if (def.ground) {
      ctx.world.normalAt(pos.x, pos.z, _v2);
      const slope = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_v2.dot(UP), -1, 1)));
      if (slope > (def.maxSlope ?? 25)) {
        return { valid: false, reason: `Ground too steep (${slope.toFixed(0)}°).` };
      }
    }

    // --- world AABB ---
    _m0.compose(pos, quat, _v3.set(1, 1, 1));
    _box0.copy(bounds).applyMatrix4(_m0);

    // --- terrain intersection for non-ground pieces ---
    if (!def.ground && !def.interior) {
      const samples: Array<[number, number]> = [
        [_box0.min.x, _box0.min.z], [_box0.max.x, _box0.min.z],
        [_box0.min.x, _box0.max.z], [_box0.max.x, _box0.max.z],
        [(_box0.min.x + _box0.max.x) * 0.5, (_box0.min.z + _box0.max.z) * 0.5],
      ];
      for (const [sx, sz] of samples) {
        if (ctx.world.heightAt(sx, sz) > _box0.min.y + 0.55) {
          return { valid: false, reason: 'Obstructed by terrain.' };
        }
      }
    }

    // --- collision with existing pieces ---
    const tolerance = 0.3;
    _box0.expandByScalar(-tolerance);
    for (const p of this.pieces) {
      if (snap && p.uid === snap.pieceUid) continue;
      // Neighbours of the snap host share a joint, so skip anything docked to it.
      if (snap && p.connectors.some((c) => c.occupiedBy === snap.pieceUid)) continue;
      _m0.compose(p.position, p.quaternion, _v3.set(1, 1, 1));
      _box1.copy(p.bounds).applyMatrix4(_m0).expandByScalar(-tolerance);
      if (_box0.intersectsBox(_box1)) {
        return { valid: false, reason: 'Collides with an existing structure.' };
      }
    }

    // --- structural warning (still placeable, but flagged) ---
    if (snap) {
      const base = this.bases.find((b) => b.id === (this.pieces.find((p) => p.uid === snap.pieceUid)?.baseId ?? -1));
      if (base && base.integrity + def.integrity < 0) {
        return { valid: true, reason: 'Warning: hull integrity will be critical.' };
      }
    }
    return { valid: true, reason: '' };
  }

  /* ---------------------------------------------------------------- *
   * Placement / removal
   * ---------------------------------------------------------------- */

  private placeGhost(ctx: GameContext): void {
    const def = this.ghostDefId ? BUILD_PIECES.get(this.ghostDefId) : undefined;
    if (!def) return;
    if (this.state && ctx.settings.gameplay.mode !== 'creative') {
      if (!this.state.inventory.consume(def.cost)) {
        this.bus?.emit('ui:notify', { text: 'Insufficient materials.', kind: 'warn' });
        return;
      }
    }
    const piece = this.spawn(def, this.ghostPos, this.ghostQuat, (Math.random() * 1e6) | 0, ctx);
    this.linkConnectors(piece);
    this.rebuildBases(ctx);
    this.bus?.emit('build:placed', {
      id: def.id,
      position: [piece.position.x, piece.position.y, piece.position.z],
    });
    this.bus?.emit('audio:cue', { id: 'build.place', position: [piece.position.x, piece.position.y, piece.position.z] });
    this.state?.notePlaced(def.id);
  }

  /** Creates the meshes and registers the piece. Shared by placement and load. */
  private spawn(
    def: BuildPieceDef, pos: THREE.Vector3, quat: THREE.Quaternion, seed: number, ctx: GameContext,
  ): PlacedPiece {
    const geometry = buildPieceGeometry(def, seed, this.tier);
    const group = new THREE.Group();
    group.name = `build.${def.id}.${this.nextUid}`;
    group.position.copy(pos);
    group.quaternion.copy(quat);

    const m = this.mats;
    if (m) {
      const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadows: boolean): void => {
        if (!geo) return;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        group.add(mesh);
      };
      const shadows = ctx.settings.at('medium');
      add(geometry.hull, m.hull, shadows);
      add(geometry.trim, m.trim, shadows);
      add(geometry.interior, m.interior, false);
      add(geometry.rubber, m.rubber, shadows);
      add(geometry.glass, m.glass, false);
      add(geometry.glow, m.glow, false);
    }
    this.group.add(group);

    const piece: PlacedPiece = {
      uid: this.nextUid++,
      defId: def.id,
      seed,
      position: pos.clone(),
      quaternion: quat.clone(),
      health: 1,
      breached: false,
      flooded: 0,
      baseId: 0,
      group,
      geometry,
      bounds: geometry.bounds.clone(),
      connectors: def.connectors.map((c) => ({
        pieceUid: 0,
        kind: c.kind,
        pos: new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]).applyQuaternion(quat).add(pos),
        dir: new THREE.Vector3(c.dir[0], c.dir[1], c.dir[2]).applyQuaternion(quat).normalize(),
        occupiedBy: 0,
      })),
    };
    for (const c of piece.connectors) c.pieceUid = piece.uid;

    if (def.storage) {
      const id = `build:${piece.uid}`;
      const container = new Container(id, def.name, def.storage.width, def.storage.height);
      this.containers.set(id, container);
      piece.containerId = id;
      this.state?.registerContainer(container);
    }

    this.pieces.push(piece);
    return piece;
  }

  /** Marks coincident, opposed sockets as mated. */
  private linkConnectors(piece: PlacedPiece): void {
    for (const c of piece.connectors) {
      if (c.occupiedBy !== 0) continue;
      for (const other of this.pieces) {
        if (other.uid === piece.uid) continue;
        for (const oc of other.connectors) {
          if (oc.occupiedBy !== 0) continue;
          if (c.pos.distanceTo(oc.pos) > 0.55) continue;
          if (c.dir.dot(oc.dir) > -0.5) continue;
          c.occupiedBy = other.uid;
          oc.occupiedBy = piece.uid;
          break;
        }
        if (c.occupiedBy !== 0) break;
      }
    }
  }

  /** Deconstructs a piece and refunds its cost. */
  remove(uid: number): boolean {
    const i = this.pieces.findIndex((p) => p.uid === uid);
    if (i < 0) return false;
    const piece = this.pieces[i];
    const def = BUILD_PIECES.get(piece.defId);
    this.pieces.splice(i, 1);
    for (const other of this.pieces) {
      for (const c of other.connectors) if (c.occupiedBy === uid) c.occupiedBy = 0;
    }
    if (piece.containerId) {
      const c = this.containers.get(piece.containerId);
      if (c && this.state) c.transferAll(this.state.inventory);
      this.containers.delete(piece.containerId);
      this.state?.unregisterContainer(piece.containerId);
    }
    piece.group.removeFromParent();
    piece.group.clear();
    disposePieceGeometry(piece.geometry);
    if (def && this.state) for (const ing of def.cost) this.state.inventory.add(ing.id, ing.count);
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Simulation: connectivity -> integrity -> power -> flooding
   * ---------------------------------------------------------------- */

  private rebuildBases(ctx: GameContext): void {
    // Union-find over mated connectors.
    const parent = new Map<number, number>();
    const find = (a: number): number => {
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r) ?? r;
      return r;
    };
    for (const p of this.pieces) parent.set(p.uid, p.uid);
    for (const p of this.pieces) {
      for (const c of p.connectors) {
        if (c.occupiedBy === 0) continue;
        const ra = find(p.uid);
        const rb = find(c.occupiedBy);
        if (ra !== rb) parent.set(ra, rb);
      }
    }

    const groups = new Map<number, number[]>();
    for (const p of this.pieces) {
      const root = find(p.uid);
      let list = groups.get(root);
      if (!list) {
        list = [];
        groups.set(root, list);
      }
      list.push(p.uid);
    }

    // Preserve energy across rebuilds by matching on the root piece.
    const previous = new Map<number, BaseInfo>();
    for (const b of this.bases) for (const uid of b.pieces) previous.set(uid, b);

    this.bases.length = 0;
    const usedIds = new Set<number>();
    for (const [root, uids] of groups) {
      const prior = previous.get(root);
      // A split base keeps the old id for one half only; the rest get fresh ids.
      const reuse = prior && !usedIds.has(prior.id) ? prior.id : this.nextBaseId++;
      usedIds.add(reuse);
      const info: BaseInfo = {
        id: reuse,
        pieces: uids,
        integrity: 0, capacity: 0, load: 0,
        production: 0, consumption: 0,
        energy: prior?.energy ?? 0, maxEnergy: 0,
        powered: false, flooded: 0, breaches: 0, depth: 0,
      };
      this.bases.push(info);
      for (const uid of uids) {
        const p = this.pieces.find((x) => x.uid === uid);
        if (p) p.baseId = info.id;
      }
    }
    this.recomputeBaseStats(ctx);
  }

  private recomputeBaseStats(ctx: GameContext): void {
    for (const base of this.bases) {
      base.capacity = 0;
      base.load = 0;
      base.maxEnergy = 0;
      base.depth = 0;
      let volume = 0;
      let flood = 0;
      base.breaches = 0;
      for (const uid of base.pieces) {
        const p = this.pieces.find((x) => x.uid === uid);
        if (!p) continue;
        const def = BUILD_PIECES.get(p.defId);
        if (!def) continue;
        if (def.integrity > 0) base.capacity += def.integrity;
        else base.load += -def.integrity;
        base.maxEnergy += def.capacity ?? 0;
        base.depth = Math.max(base.depth, -p.position.y);
        if (def.volume) {
          volume += def.volume;
          flood += p.flooded * def.volume;
        }
        if (p.breached) base.breaches++;
      }
      // Pressure penalty: every 120 m costs a point of capacity.
      const depthPenalty = base.depth / 120;
      base.integrity = 10 + base.capacity - base.load - depthPenalty;
      base.flooded = volume > 0 ? flood / volume : 0;
      base.maxEnergy = Math.max(base.maxEnergy, 25);
    }
    void ctx;
  }

  private simulate(dt: number, ctx: GameContext): void {
    if (this.pieces.length === 0) return;
    this.recomputeBaseStats(ctx);

    const sun = this.sunFactor(ctx);
    let anyPowered = false;
    let poweredFraction = 0;

    for (const base of this.bases) {
      /* ---- power production ---- */
      let production = 0;
      let consumption = 0;
      for (const uid of base.pieces) {
        const p = this.pieces.find((x) => x.uid === uid);
        if (!p) continue;
        const def = BUILD_PIECES.get(p.defId);
        if (!def) continue;
        const depth = Math.max(0, -p.position.y);

        if (def.id === 'solar_panel') {
          // Exponential light loss with depth, modulated by the sky.
          production += (def.power ?? 0) * sun * Math.exp(-depth / 42) * (p.breached ? 0.2 : 1);
        } else if (def.id === 'thermal_plant') {
          const biome = ctx.world.biomeAt(p.position.x, p.position.z).id;
          const hot = biome === 'lava_zone' ? 1.15 : biome === 'lost_river' ? 0.8 : biome === 'blood_kelp' ? 0.45 : 0.2;
          production += (def.power ?? 0) * THREE.MathUtils.clamp(hot + depth / 1600, 0.05, 1.2);
        } else if (def.id === 'bioreactor') {
          production += this.burnFuel(p, def, dt, 'organic', 55) ? (def.power ?? 0) : 0;
        } else if (def.id === 'nuclear_reactor') {
          production += this.burnFuel(p, def, dt, 'radioactive', 900) ? (def.power ?? 0) : 0;
        } else if (def.power) {
          production += def.power;
        }

        if (def.draw) consumption += def.draw * (p.breached ? 0.2 : 1);
      }
      base.production = production;
      base.consumption = consumption;

      /* ---- energy integration (kJ) ---- */
      const net = (production - consumption) * dt * 0.001 * 60; // watts -> kJ/min scale
      base.energy = THREE.MathUtils.clamp(base.energy + net, 0, base.maxEnergy);
      base.powered = base.energy > 0.05 || production >= consumption;
      if (base.powered) {
        anyPowered = true;
        poweredFraction = Math.max(poweredFraction, base.maxEnergy > 0 ? base.energy / base.maxEnergy : 1);
      }

      /* ---- structural failure ---- */
      if (base.integrity < 0) {
        const stress = Math.min(1, -base.integrity / 8) * dt * 0.14;
        // Damage the most loaded compartment (the largest interior volume).
        let worst: PlacedPiece | null = null;
        let worstVol = -1;
        for (const uid of base.pieces) {
          const p = this.pieces.find((x) => x.uid === uid);
          const def = p ? BUILD_PIECES.get(p.defId) : undefined;
          if (!p || !def?.volume || p.breached) continue;
          const v = def.volume * (1.2 - p.health);
          if (v > worstVol) {
            worstVol = v;
            worst = p;
          }
        }
        if (worst) {
          worst.health -= stress;
          if (worst.health <= 0) {
            worst.health = 0;
            worst.breached = true;
            const name = BUILD_PIECES.get(worst.defId)?.name ?? 'Compartment';
            this.bus?.emit('ui:notify', { text: `HULL BREACH — ${name}`, kind: 'danger', ttl: 6 });
            this.bus?.emit('audio:cue', {
              id: 'base.breach',
              position: [worst.position.x, worst.position.y, worst.position.z],
            });
          } else if (worst.health < 0.4) {
            this.bus?.emit('audio:cue', { id: 'base.groan', gain: 0.6 });
          }
        }
      }

      /* ---- flood / drain ---- */
      for (const uid of base.pieces) {
        const p = this.pieces.find((x) => x.uid === uid);
        const def = p ? BUILD_PIECES.get(p.defId) : undefined;
        if (!p || !def?.volume) continue;
        if (p.breached || base.breaches > 0) {
          // Water finds every compartment on the same pressure loop.
          const rate = (p.breached ? 0.09 : 0.035) * (1 + base.depth / 400);
          p.flooded = Math.min(1, p.flooded + rate * dt);
        } else if (base.powered && p.flooded > 0) {
          p.flooded = Math.max(0, p.flooded - 0.06 * dt);
        }
      }
    }

    this.mats?.setPowered(anyPowered, poweredFraction);
  }

  /** Consumes one fuel item every `seconds`. Returns true while fuelled. */
  private burnFuel(p: PlacedPiece, def: BuildPieceDef, dt: number, tag: string, seconds: number): boolean {
    if (!p.containerId) return false;
    const c = this.containers.get(p.containerId);
    if (!c) return false;
    const state = (p as unknown as { fuelClock?: number });
    state.fuelClock = (state.fuelClock ?? 0) + dt;
    if (state.fuelClock < seconds) {
      return c.items.length > 0;
    }
    state.fuelClock = 0;
    // Burn the first item carrying the required tag.
    for (const it of [...c.items]) {
      const idef = this.state?.itemDef(it.id);
      if (!idef || !idef.tags.includes(tag)) continue;
      c.removeUid(it.uid, 1);
      return true;
    }
    void def;
    return false;
  }

  private sunFactor(ctx: GameContext): number {
    const sky = ctx.tryGet<GameSystem & { sunIntensity?: number; stormFactor?: number }>('world.sky');
    if (!sky) return 0.85;
    const i = sky.sunIntensity ?? 1;
    const storm = sky.stormFactor ?? 0;
    return THREE.MathUtils.clamp(i * (1 - storm * 0.6), 0, 1.4);
  }

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */

  serialise(): SerialisedBuild {
    return {
      pieces: this.pieces.map((p) => ({
        defId: p.defId,
        seed: p.seed,
        p: [p.position.x, p.position.y, p.position.z] as [number, number, number],
        q: [p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w] as [number, number, number, number],
        health: p.health,
        breached: p.breached,
        flooded: p.flooded,
        container: p.containerId ? this.containers.get(p.containerId)?.serialise() : undefined,
      })),
    };
  }

  deserialise(data: SerialisedBuild | undefined, ctx: GameContext): void {
    for (const p of [...this.pieces]) this.removeSilently(p.uid);
    if (!data?.pieces) return;
    for (const raw of data.pieces) {
      const def = BUILD_PIECES.get(raw.defId);
      if (!def) continue;
      _v0.set(raw.p[0], raw.p[1], raw.p[2]);
      _q0.set(raw.q[0], raw.q[1], raw.q[2], raw.q[3]);
      const piece = this.spawn(def, _v0, _q0, raw.seed, ctx);
      piece.health = raw.health ?? 1;
      piece.breached = !!raw.breached;
      piece.flooded = raw.flooded ?? 0;
      if (raw.container && piece.containerId) {
        this.containers.get(piece.containerId)?.deserialise(raw.container);
      }
    }
    for (const p of this.pieces) this.linkConnectors(p);
    this.rebuildBases(ctx);
  }

  /** Removal without a material refund, used by load. */
  private removeSilently(uid: number): void {
    const i = this.pieces.findIndex((p) => p.uid === uid);
    if (i < 0) return;
    const piece = this.pieces[i];
    this.pieces.splice(i, 1);
    if (piece.containerId) {
      this.containers.delete(piece.containerId);
      this.state?.unregisterContainer(piece.containerId);
    }
    piece.group.removeFromParent();
    disposePieceGeometry(piece.geometry);
  }
}
