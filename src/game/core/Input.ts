/**
 * Input sampling: keyboard, mouse (pointer-lock), wheel and gamepad, unified
 * into a per-frame immutable-ish snapshot. Systems read `InputState`; only the
 * engine calls `endFrame()`.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'ascend'
  | 'descend'
  | 'sprint'
  | 'interact'
  | 'primary'
  | 'secondary'
  | 'inventory'
  | 'pda'
  | 'scanner'
  | 'build'
  | 'flashlight'
  | 'crouch'
  | 'exitVehicle'
  | 'screenshot'
  | 'pause';

const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  ascend: ['Space'],
  descend: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft'],
  interact: ['KeyE'],
  primary: ['Mouse0'],
  secondary: ['Mouse2'],
  inventory: ['KeyI', 'Tab'],
  pda: ['KeyP'],
  scanner: ['KeyQ'],
  build: ['KeyB'],
  flashlight: ['KeyF'],
  crouch: ['KeyC'],
  exitVehicle: ['KeyE'],
  screenshot: ['F2'],
  pause: ['Escape'],
};

export interface InputState {
  /** Held this frame. */
  down(action: Action): boolean;
  /** Went down this frame only. */
  pressed(action: Action): boolean;
  /** Went up this frame only. */
  released(action: Action): boolean;
  /** Raw key held. */
  key(code: string): boolean;
  /** Accumulated mouse delta for this frame, already sensitivity-scaled. */
  readonly lookX: number;
  readonly lookY: number;
  /** Wheel delta accumulated this frame (normalised to ~±1 per notch). */
  readonly wheel: number;
  /** -1..1 movement axes resolved from keys + gamepad left stick. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Vertical thrust axis, -1..1 (descend..ascend). */
  readonly moveY: number;
  /** True while the pointer is locked to the canvas. */
  readonly locked: boolean;
  /** Number in 1..9 pressed this frame, or 0. */
  readonly hotbar: number;
}

export class Input implements InputState {
  lookX = 0;
  lookY = 0;
  wheel = 0;
  moveX = 0;
  moveZ = 0;
  moveY = 0;
  locked = false;
  hotbar = 0;

  sensitivity = 1;
  invertY = false;
  /** When true (a modal UI is open), movement/look axes read as zero. */
  uiCapture = false;

  private keys = new Set<string>();
  private downThisFrame = new Set<string>();
  private upThisFrame = new Set<string>();
  private bindings = { ...DEFAULT_BINDINGS };
  private element: HTMLElement | null = null;
  private disposers: Array<() => void> = [];

  attach(element: HTMLElement): void {
    this.element = element;
    const add = <K extends keyof WindowEventMap>(
      target: EventTarget,
      type: K,
      fn: (ev: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    add(window, 'keydown', (e) => {
      // Let the browser keep its own chrome shortcuts.
      if (e.metaKey || e.ctrlKey) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.downThisFrame.add(e.code);
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.hotbar = n;
      }
    });
    add(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      this.upThisFrame.add(e.code);
    });
    add(window, 'blur', () => {
      // Avoid stuck keys when the tab loses focus.
      for (const k of this.keys) this.upThisFrame.add(k);
      this.keys.clear();
    });
    add(window, 'mousedown', (e) => {
      const code = `Mouse${e.button}`;
      this.keys.add(code);
      this.downThisFrame.add(code);
    });
    add(window, 'mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.keys.delete(code);
      this.upThisFrame.add(code);
    });
    add(window, 'contextmenu', (e) => e.preventDefault());
    add(window, 'mousemove', (e) => {
      if (!this.locked || this.uiCapture) return;
      this.lookX += e.movementX * 0.0022 * this.sensitivity;
      this.lookY += e.movementY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    });
    add(window, 'wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    add(document, 'pointerlockchange' as keyof WindowEventMap, () => {
      this.locked = document.pointerLockElement === this.element;
    });
  }

  requestLock(): void {
    this.element?.requestPointerLock?.();
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  key(code: string): boolean {
    return this.keys.has(code);
  }

  down(action: Action): boolean {
    if (this.uiCapture && action !== 'pause' && action !== 'inventory' && action !== 'pda') return false;
    return this.bindings[action].some((c) => this.keys.has(c));
  }

  pressed(action: Action): boolean {
    return this.bindings[action].some((c) => this.downThisFrame.has(c));
  }

  released(action: Action): boolean {
    return this.bindings[action].some((c) => this.upThisFrame.has(c));
  }

  rebind(action: Action, codes: string[]): void {
    this.bindings[action] = codes;
  }

  getBindings(): Readonly<Record<Action, string[]>> {
    return this.bindings;
  }

  /** Engine-only: resolve axes from the current key/gamepad state. */
  beginFrame(): void {
    let x = 0;
    let z = 0;
    let y = 0;
    if (this.down('forward')) z -= 1;
    if (this.down('back')) z += 1;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    if (this.down('ascend')) y += 1;
    if (this.down('descend')) y -= 1;

    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const dead = (v: number) => (Math.abs(v) < 0.16 ? 0 : v);
      x += dead(pad.axes[0] ?? 0);
      z += dead(pad.axes[1] ?? 0);
      if (!this.uiCapture) {
        this.lookX += dead(pad.axes[2] ?? 0) * 0.045 * this.sensitivity;
        this.lookY += dead(pad.axes[3] ?? 0) * 0.045 * this.sensitivity * (this.invertY ? -1 : 1);
      }
      y += (pad.buttons[0]?.pressed ? 1 : 0) - (pad.buttons[1]?.pressed ? 1 : 0);
      break;
    }

    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    if (this.uiCapture) {
      x = 0;
      z = 0;
      y = 0;
    }
    this.moveX = x;
    this.moveZ = z;
    this.moveY = Math.max(-1, Math.min(1, y));
  }

  /** Engine-only: clear per-frame accumulators. */
  endFrame(): void {
    this.downThisFrame.clear();
    this.upThisFrame.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    this.hotbar = 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
