import * as THREE from 'three';
import { Phase } from '../core/Types';
import type { GameContext, GameSystem } from '../core/Types';
import { Flashlight } from './Flashlight';
import { buildHand } from './HandModel';
import type { HandRig } from './HandModel';
import { PlayerFx } from './PlayerFx';
import type { PlayerSystem } from './PlayerSystem';
import { Spring1, Spring3, TOOL_ORDER, VIEWMODEL_LAYER, expDamp } from './PlayerTypes';
import type { ToolId } from './PlayerTypes';
import { VmAssetPool, buildTool, isFlashlight } from './ToolModels';
import type { ToolAnimState, ToolInstance } from './ToolModels';
import { disposeViewModelShared } from './ViewModelMaterial';
import type { VmMaterial } from './ViewModelMaterial';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _localVel = new THREE.Vector3();
const _swayTarget = new THREE.Vector3();
const _rotTarget = new THREE.Vector3();
const _q = new THREE.Quaternion();

interface WaterLike extends GameSystem {
  sharedUniforms: Record<string, THREE.IUniform>;
  causticsTexture: THREE.Texture | null;
}
interface RigLike extends GameSystem {
  addToolRecoil(pitch: number, yaw: number): void;
  addTrauma(amount: number): void;
}

/** Bare-hand rest poses, used when no tool is equipped. */
const IDLE_RIGHT = {
  pos: new THREE.Vector3(0.215, -0.245, -0.4),
  rot: new THREE.Euler(-0.3, -0.34, 0.34),
};
const IDLE_LEFT = {
  pos: new THREE.Vector3(-0.235, -0.26, -0.395),
  rot: new THREE.Euler(-0.26, 0.4, -0.42),
};
/** Where the support hand idles while a one-handed tool is held. */
const SUPPORT_IDLE = {
  pos: new THREE.Vector3(-0.245, -0.3, -0.36),
  rot: new THREE.Euler(-0.15, 0.5, -0.5),
};

/**
 * First-person hands and tools.
 *
 * Owns a `holder` group parented to the camera. The holder carries all the
 * procedural motion — mouse sway with spring damping, velocity lag, breathing,
 * equip/holster arcs, per-tool use animations and impact kicks — while each tool
 * animates its own moving parts. Hands are re-parented onto the held tool so the
 * grip stays welded to the handle.
 *
 * Depth is remapped in the view-model shader rather than by a second render
 * pass, so there is exactly one scene traversal and the hands still receive the
 * scene's real lighting, the shared underwater extinction and caustics.
 */
export class ViewModelSystem implements GameSystem {
  readonly name = 'player.viewmodel';
  readonly phase = Phase.Camera;

  protected group = new THREE.Group();
  private pool!: VmAssetPool;
  private handRight: HandRig | null = null;
  private handLeft: HandRig | null = null;
  private player!: PlayerSystem;
  private water: WaterLike | null = null;
  private rig: RigLike | null = null;
  private fx: PlayerFx | null = null;
  private flashlight: Flashlight | null = null;

  private tools = new Map<ToolId, ToolInstance>();
  private current: ToolInstance | null = null;
  private currentId: ToolId = 'none';
  private pendingId: ToolId | null = null;

  private equip = new Spring1(120, 19);
  private equipTarget = 1;
  private sway = new Spring3(90, 15);
  private swayRot = new Spring3(110, 16);
  private recoilPos = new Spring1(260, 20);
  private recoilRot = new Spring1(220, 17);
  private flinch = new Spring1(90, 12);
  private gripSpring = new Spring1(140, 18);

  private useT = -1;
  private useStruck = false;
  private charge = 0;
  private lampOn = false;
  private wetness = 0;
  private lastCross = 0;
  private toolTime = 0;
  private anim: ToolAnimState = {
    time: 0,
    equip: 0,
    use: 0,
    useActive: false,
    charge: 0,
    depth: 0,
    lightOn: false,
  };

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  init(ctx: GameContext): void {
    this.player = ctx.get<PlayerSystem>('player');
    this.water = ctx.tryGet<WaterLike>('world.water') ?? null;
    const waterUniforms =
      this.water && typeof this.water.sharedUniforms === 'object' ? this.water.sharedUniforms : undefined;

    this.group.name = 'viewmodel';
    this.group.renderOrder = 10;
    this.group.matrixAutoUpdate = true;
    ctx.camera.add(this.group);
    // The camera has to opt into the view-model layer; post passes that must not
    // see the hands (DOF near field, GTAO) can mask it out.
    ctx.camera.layers.enable(VIEWMODEL_LAYER);

    this.pool = new VmAssetPool(waterUniforms);
    const mats = {
      suit: this.pool.mat('suit'),
      glove: this.pool.mat('glove'),
      metal: this.pool.mat('metal'),
      emissive: this.pool.mat('emissive', { emissive: 0x39d8ff, emissiveIntensity: 1.8 }),
    };
    this.handRight = buildHand(1, mats);
    this.handLeft = buildHand(-1, mats);
    this.pool.trackAll(this.handRight.geometries);
    this.pool.trackAll(this.handLeft.geometries);
    this.group.add(this.handRight.root, this.handLeft.root);
    this.applyIdleHandPose();

    const shadows = ctx.settings.at('high');
    this.flashlight = new Flashlight(waterUniforms, shadows, ctx.settings.graphics.shadowMapSize);

    this.fx = new PlayerFx(waterUniforms);
    this.fx.addTo(ctx.scene);

    ctx.bus.on('player:damage', (p) => {
      this.flinch.kick(Math.min(1.6, 0.4 + p.amount / 24));
    });
    ctx.bus.on('ui:screen', (p) => {
      // Holster while a full-screen UI is open.
      if (p.screen === 'inventory' || p.screen === 'pda') this.equipTarget = p.open ? 0 : 1;
    });

    this.lastCross = this.player.surfaceCrossings;
  }

  dispose(): void {
    this.flashlight?.dispose();
    this.fx?.dispose();
    for (const t of this.tools.values()) t.root.removeFromParent();
    this.tools.clear();
    this.group.removeFromParent();
    this.pool?.dispose();
    disposeViewModelShared();
  }

  /* ---------------------------------------------------------------- *
   * Public API for the gameplay systems
   * ---------------------------------------------------------------- */

  /** Request a tool. The swap runs through a holster/equip animation. */
  equipTool(id: ToolId): void {
    if (id === this.currentId && this.pendingId === null) return;
    this.pendingId = id;
  }

  get heldTool(): ToolId {
    return this.currentId;
  }

  get flashlightOn(): boolean {
    return this.lampOn;
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt: number, ctx: GameContext): void {
    const p = this.player;
    if (!this.rig) this.rig = ctx.tryGet<RigLike>('player.camera') ?? null;
    this.toolTime += dt;

    this.readInput(ctx);
    this.stepEquip(dt, ctx);
    this.stepUse(dt, ctx);

    /* ---------------- sway from mouse + movement ------------------ */
    const look = ctx.input;
    // Sway target: the rig trails the look delta, then springs back.
    const swayGain = 1.6;
    _swayTarget.set(
      THREE.MathUtils.clamp(look.lookX * swayGain, -0.06, 0.06),
      THREE.MathUtils.clamp(-look.lookY * swayGain, -0.06, 0.06),
      0,
    );
    // Velocity lag: transform world velocity into camera space.
    _localVel.copy(p.velocity);
    _q.copy(ctx.camera.quaternion).invert();
    _localVel.applyQuaternion(_q).multiplyScalar(-0.012);
    _localVel.clampLength(0, 0.06);
    _swayTarget.add(_localVel);
    this.sway.step(dt, _swayTarget);

    _rotTarget.set(
      THREE.MathUtils.clamp(-look.lookY * 2.4, -0.14, 0.14),
      THREE.MathUtils.clamp(look.lookX * 2.4, -0.14, 0.14),
      THREE.MathUtils.clamp(look.lookX * 1.6, -0.1, 0.1),
    );
    this.swayRot.step(dt, _rotTarget);

    /* ---------------- breathing + idle drift ---------------------- */
    const breath = Math.sin(p.breathPhase);
    const breath2 = Math.sin(p.breathPhase * 2 + 0.7);
    const idle = 1 - Math.min(1, Math.hypot(p.velocity.x, p.velocity.z) / 3);
    const bAmp = 0.006 + p.breathRate * 0.01;
    const t = this.toolTime;
    // Two incommensurate drifts so the rig never settles into a loop.
    const driftX = (Math.sin(t * 0.53) + Math.sin(t * 0.31 + 1.3) * 0.6) * 0.0045;
    const driftY = (Math.sin(t * 0.41 + 2.1) + Math.sin(t * 0.67) * 0.5) * 0.004;

    /* ---------------- equip / holster arc ------------------------- */
    const e = this.equip.step(dt, this.equipTarget);
    const hidden = 1 - THREE.MathUtils.clamp(e, 0, 1);

    /* ---------------- recoil -------------------------------------- */
    const rp = this.recoilPos.step(dt, 0);
    const rr = this.recoilRot.step(dt, 0);
    const fl = this.flinch.step(dt, 0);

    /* ---------------- compose the holder -------------------------- */
    const g = this.group;
    const s = this.sway.value;
    const sr = this.swayRot.value;
    g.position.set(
      s.x + driftX + fl * 0.02,
      s.y + driftY + breath * bAmp * idle - hidden * 0.34 - fl * 0.03,
      s.z + rp + breath2 * bAmp * 0.4 * idle + hidden * 0.1 + fl * 0.05,
    );
    g.rotation.set(
      sr.x + rr + breath2 * 0.006 * idle + hidden * 0.95 + fl * 0.12,
      sr.y + driftX * 1.5,
      sr.z + hidden * 0.35 - fl * 0.1,
    );

    /* ---------------- hands --------------------------------------- */
    const tool = this.current;
    const gripBase = tool ? tool.gripAmount : 0.14;
    const useGrip = tool && this.useT >= 0 ? 0.12 : 0;
    const grip = this.gripSpring.step(dt, gripBase + useGrip + fl * 0.25);
    this.handRight?.setGrip(THREE.MathUtils.clamp(grip, 0, 1), t);
    // The support hand only closes when it is actually holding something.
    const leftGrip = tool?.twoHanded ? gripBase : 0.16 + fl * 0.2;
    this.handLeft?.setGrip(THREE.MathUtils.clamp(leftGrip, 0, 1), t * 0.93 + 1.7);
    // Drop the idle support hand at low quality — it is 11 draw calls of nothing.
    if (this.handLeft) {
      this.handLeft.root.visible = tool?.twoHanded === true || ctx.settings.at('medium');
    }

    /* ---------------- tool animation ------------------------------ */
    this.anim.time = t;
    this.anim.equip = THREE.MathUtils.clamp(e, 0, 1);
    this.anim.use = this.useT < 0 ? 0 : this.useT;
    this.anim.useActive = this.useT >= 0 && this.useT < 0.9;
    this.anim.charge = this.charge;
    this.anim.depth = p.depth;
    this.anim.lightOn = this.lampOn;
    tool?.update(this.anim, dt);
    if (tool) this.applyUsePose(tool, dt);

    /* ---------------- flashlight ---------------------------------- */
    if (this.flashlight) {
      if (isFlashlight(tool)) this.flashlight.attach(tool.lampMount);
      else if (this.lampOn) this.flashlight.attach(this.group);
      else this.flashlight.detach();
      this.flashlight.setOn(this.lampOn && this.equip.value > 0.25);
      this.flashlight.update(dt, ctx, p.submerged, p.depth);
    }

    /* ---------------- water-facing uniforms ----------------------- */
    this.refreshWaterUniforms(dt, ctx);

    /* ---------------- particles ----------------------------------- */
    if (this.fx) {
      _eye.copy(ctx.camera.position);
      ctx.camera.getWorldDirection(_dir);
      // Bubbles leave the regulator just below and in front of the mask.
      _eye.addScaledVector(_dir, 0.16).y -= 0.12;
      this.fx.update(dt, ctx, _eye, p.breathPhase, p.submerged);
      if (p.surfaceCrossings !== this.lastCross) {
        this.lastCross = p.surfaceCrossings;
        const strength = THREE.MathUtils.clamp(0.3 + p.lastCrossSpeed * 0.2, 0.3, 1.6);
        _v.copy(ctx.camera.position);
        _v.y = p.surfaceY;
        this.fx.emitSpray(_v, p.lastCrossDown ? -0.5 : 1.6, Math.floor(40 + strength * 90));
        if (!p.lastCrossDown) {
          this.wetness = 1;
          // A wet mask flicks a burst of bubbles as the regulator clears.
          this.fx.emitBubbles(_eye, _dir, 8, 0.6);
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  private readInput(ctx: GameContext): void {
    const input = ctx.input;
    const hot = input.hotbar;
    if (hot >= 1 && hot <= TOOL_ORDER.length) this.equipTool(TOOL_ORDER[hot - 1]);
    if (input.pressed('scanner')) {
      this.equipTool(this.currentId === 'scanner' ? 'none' : 'scanner');
    }
    if (input.pressed('build')) {
      this.equipTool(this.currentId === 'builder' ? 'none' : 'builder');
    }
    if (input.pressed('flashlight')) {
      if (this.currentId !== 'flashlight' && !this.lampOn) {
        this.equipTool('flashlight');
        this.lampOn = true;
      } else {
        this.lampOn = !this.lampOn;
      }
      ctx.bus.emit('audio:cue', { id: 'tool.flashlight.click', gain: 0.5 });
    }
    // Wheel cycles the hotbar.
    if (input.wheel !== 0) {
      const i = TOOL_ORDER.indexOf(this.pendingId ?? this.currentId);
      const n = TOOL_ORDER.length;
      this.equipTool(TOOL_ORDER[(((i + Math.sign(input.wheel)) % n) + n) % n]);
    }
  }

  /* ---------------------------------------------------------------- *
   * Equip / holster
   * ---------------------------------------------------------------- */

  private stepEquip(_dt: number, ctx: GameContext): void {
    if (this.pendingId !== null) {
      if (this.equip.value > 0.06 && this.currentId !== 'none') {
        this.equipTarget = 0;
        return;
      }
      const id = this.pendingId;
      this.pendingId = null;
      this.swapTool(id, ctx);
      this.equipTarget = 1;
      this.equip.reset(0);
      ctx.bus.emit('audio:cue', { id: id === 'none' ? 'tool.holster' : 'tool.equip', gain: 0.45 });
    }
  }

  private swapTool(id: ToolId, ctx: GameContext): void {
    if (this.current) {
      this.current.root.visible = false;
      this.current.root.removeFromParent();
    }
    this.currentId = id;
    this.useT = -1;
    this.charge = 0;

    let tool = this.tools.get(id) ?? null;
    if (!tool && id !== 'none') {
      // Built on first use so boot stays fast.
      tool = buildTool(id, this.pool);
      if (tool) this.tools.set(id, tool);
    }
    this.current = tool;

    if (tool) {
      tool.root.visible = true;
      tool.root.position.copy(tool.holdPos);
      tool.root.rotation.copy(tool.holdRot);
      this.group.add(tool.root);
      // Weld the hands to the grips.
      if (this.handRight) {
        tool.root.add(this.handRight.root);
        this.handRight.root.position.copy(tool.right.pos);
        this.handRight.root.rotation.copy(tool.right.rot);
      }
      if (this.handLeft) {
        if (tool.left) {
          tool.root.add(this.handLeft.root);
          this.handLeft.root.position.copy(tool.left.pos);
          this.handLeft.root.rotation.copy(tool.left.rot);
        } else {
          this.group.add(this.handLeft.root);
          this.handLeft.root.position.copy(SUPPORT_IDLE.pos);
          this.handLeft.root.rotation.copy(SUPPORT_IDLE.rot);
        }
      }
      if (isFlashlight(tool)) this.flashlight?.attach(tool.lampMount);
    } else {
      this.applyIdleHandPose();
      if (this.lampOn) this.flashlight?.attach(this.group);
    }
    void ctx;
  }

  private applyIdleHandPose(): void {
    if (this.handRight) {
      this.group.add(this.handRight.root);
      this.handRight.root.position.copy(IDLE_RIGHT.pos);
      this.handRight.root.rotation.copy(IDLE_RIGHT.rot);
    }
    if (this.handLeft) {
      this.group.add(this.handLeft.root);
      this.handLeft.root.position.copy(IDLE_LEFT.pos);
      this.handLeft.root.rotation.copy(IDLE_LEFT.rot);
    }
  }

  /* ---------------------------------------------------------------- *
   * Use actions
   * ---------------------------------------------------------------- */

  private stepUse(dt: number, ctx: GameContext): void {
    const tool = this.current;
    const input = ctx.input;
    const ready = this.equip.value > 0.6 && this.pendingId === null;

    // Charge-up on secondary for the tools that have one.
    const charging = ready && tool?.id === 'propulsion' && input.down('secondary');
    this.charge = THREE.MathUtils.clamp(this.charge + (charging ? dt * 1.6 : -dt * 3), 0, 1);

    if (!tool) {
      this.useT = -1;
      return;
    }

    const held = input.down('primary');
    if (this.useT < 0) {
      if (ready && (input.pressed('primary') || (tool.continuous && held))) {
        this.useT = 0;
        this.useStruck = false;
        ctx.bus.emit('audio:cue', { id: `tool.${tool.id}.use`, gain: 0.55 });
      }
      return;
    }

    const prev = this.useT;
    this.useT += dt / Math.max(0.05, tool.useDuration);

    // Mid-swing strike test: this is what makes the knife feel like it connects.
    if (!this.useStruck && prev < 0.42 && this.useT >= 0.42) {
      this.useStruck = true;
      this.strike(tool, ctx);
    }

    if (this.useT >= 1) {
      if (tool.continuous && held) {
        this.useT = 0;
        this.useStruck = false;
      } else {
        this.useT = -1;
      }
    }
  }

  /** Reach test at the impact frame of a use animation. */
  private strike(tool: ToolInstance, ctx: GameContext): void {
    const p = this.player;
    const reach = tool.id === 'knife' ? 2.1 : tool.id === 'lasercutter' ? 1.6 : 3.2;
    p.viewDirection(_dir);
    const hit = p.collider.raymarch(p.position, _dir, reach, ctx.world, 12);
    const [rz, ry, rpitch, rroll] = tool.recoil;
    const scale = hit > 0 ? 1.6 : 1;
    this.recoilPos.kick(rz * 42 * scale);
    this.recoilRot.kick(rpitch * 26 * scale);
    this.swayRot.kick(0, ry * 12, rroll * 18 * scale);
    this.rig?.addToolRecoil(rpitch * 4 * scale, rroll * 2);
    if (hit > 0) {
      this.rig?.addTrauma(0.06 + rpitch * 0.4);
      ctx.bus.emit('audio:cue', { id: `tool.${tool.id}.impact`, gain: 0.6 });
    }
  }

  /**
   * Per-tool use poses. Code-driven curves — no animation data. Each family has
   * a distinct rhythm: the knife whips, the cannon punches back, the cutter
   * pushes in and vibrates, the scanner holds steady and rises.
   */
  private applyUsePose(tool: ToolInstance, dt: number): void {
    const root = tool.root;
    const u = this.useT;
    let px = 0;
    let py = 0;
    let pz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;

    if (u >= 0) {
      switch (tool.id) {
        case 'knife': {
          // Wind up right and back, then slash down-left, then recover.
          const wind = THREE.MathUtils.smoothstep(u, 0, 0.34);
          const cut = THREE.MathUtils.smoothstep(u, 0.34, 0.62);
          const back = THREE.MathUtils.smoothstep(u, 0.62, 1);
          const a = wind - cut;
          px = a * 0.1 - cut * 0.16 * (1 - back);
          py = a * 0.05 - cut * 0.1 * (1 - back);
          pz = a * 0.06;
          ry = a * 0.55 - cut * 0.9 * (1 - back);
          rz = -a * 0.5 + cut * 1.15 * (1 - back);
          rx = a * 0.25 - cut * 0.35 * (1 - back);
          break;
        }
        case 'propulsion': {
          // Hard punch back along the barrel, then a slow settle.
          const punch = Math.exp(-u * 9) * Math.sin(u * 22);
          pz = punch * 0.055;
          py = punch * 0.02;
          rx = -punch * 0.22;
          rz = punch * 0.06;
          break;
        }
        case 'lasercutter': {
          // Push into the cut and buzz.
          const push = THREE.MathUtils.smoothstep(u, 0, 0.25) * (1 - THREE.MathUtils.smoothstep(u, 0.7, 1));
          pz = -push * 0.045;
          px = Math.sin(this.toolTime * 61) * 0.0022 * push;
          py = Math.cos(this.toolTime * 53) * 0.0022 * push;
          rx = -push * 0.05;
          break;
        }
        case 'builder': {
          const hold = THREE.MathUtils.smoothstep(u, 0, 0.3);
          pz = -hold * 0.05;
          py = hold * 0.03;
          rx = -hold * 0.14;
          break;
        }
        case 'scanner': {
          const hold = THREE.MathUtils.smoothstep(u, 0, 0.35);
          py = hold * 0.05;
          pz = -hold * 0.035;
          rx = -hold * 0.2;
          // A slow left-right sweep as the beam rasters the target.
          ry = Math.sin(u * Math.PI * 2) * 0.06 * hold;
          break;
        }
        default: {
          const click = Math.exp(-u * 12) * Math.sin(u * 30);
          py = click * 0.012;
          rx = -click * 0.06;
          break;
        }
      }
    }

    // Ease toward the pose so releasing the trigger never snaps.
    const k = Math.min(1, dt * 22);
    root.position.x += (tool.holdPos.x + px - root.position.x) * k;
    root.position.y += (tool.holdPos.y + py - root.position.y) * k;
    root.position.z += (tool.holdPos.z + pz - root.position.z) * k;
    root.rotation.x += (tool.holdRot.x + rx - root.rotation.x) * k;
    root.rotation.y += (tool.holdRot.y + ry - root.rotation.y) * k;
    root.rotation.z += (tool.holdRot.z + rz - root.rotation.z) * k;
  }

  /* ---------------------------------------------------------------- *
   * Water / caustics uniforms
   * ---------------------------------------------------------------- */

  private refreshWaterUniforms(dt: number, ctx: GameContext): void {
    // Surfacing leaves the suit wet; it dries over a few seconds.
    this.wetness = expDamp(this.wetness, this.player.submerged ? 1 : 0.15, 0.45, dt);
    const caustics = this.water?.causticsTexture ?? null;
    const causticMix = caustics ? 1 : 0;
    const strength =
      (this.player.submerged ? 1 : 0.15) *
      Math.exp(-this.player.depth / 180) *
      (ctx.settings.at('medium') ? 1 : 0.5);
    for (const m of this.pool.all) {
      const u = (m as VmMaterial).vmUniforms;
      if (!u) continue;
      u.uVmWetness.value = this.wetness;
      u.uVmCaustics.value = 0.75 * strength;
      u.uVmCausticsTexMix.value = causticMix;
      if (caustics) u.uVmCausticsTex.value = caustics;
    }
  }
}
