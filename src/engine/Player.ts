import type { Vec2, InventorySlot, ItemStack, PlayerStats } from './types';

export class Player {
  pos: Vec2;           // tile position
  pixelPos: Vec2;      // sub-tile pixel position (smooth movement)
  facing: Vec2 = { x: 0, y: 1 };
  stats: PlayerStats;
  inventory: InventorySlot[];
  maxInventorySlots: number;
  speed: number = 120; // pixels per second in EVA
  inStation: boolean = false;

  // Tap-to-move target (tile coordinates). When set, player auto-walks toward it.
  moveTarget: Vec2 | null = null;
  // Pathfinding sub-step: we move axis-at-a-time toward the target tile.
  private readonly ARRIVE_DIST = 10; // pixels — close enough to arrive

  constructor(x: number, y: number) {
    this.pos = { x, y };
    this.pixelPos = { x: x * 32, y: y * 32 };
    this.stats = {
      oxygen: 1800,    // 30 minutes in "game seconds"
      maxOxygen: 1800,
      power: 100,
      maxPower: 100,
      health: 100,
      maxHealth: 100,
      hullIntegrity: 100,
      maxHull: 100,
    };
    this.inventory = [];
    this.maxInventorySlots = 20;
    for (let i = 0; i < this.maxInventorySlots; i++) {
      this.inventory.push({ item: null });
    }

    // Give starting items
    this.addItem('iron_bar', 3);
    this.addItem('ration', 2);
    this.addItem('air_tank', 1);
  }

  setMoveTarget(tx: number, ty: number): void {
    this.moveTarget = { x: tx, y: ty };
  }

  clearMoveTarget(): void {
    this.moveTarget = null;
  }

  update(input: { moveX: number; moveY: number }, dt: number, walkable: (x: number, y: number) => boolean): void {
    let dx = input.moveX;
    let dy = input.moveY;
    const manualInput = Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15;

    // If the user provides manual joystick/keyboard input, cancel tap-to-move.
    if (manualInput) {
      this.moveTarget = null;
    }

    // Tap-to-move: auto-walk toward the target tile.
    if (!manualInput && this.moveTarget) {
      const targetPxX = this.moveTarget.x * 32 + 16;
      const targetPxY = this.moveTarget.y * 32 + 16;
      const ddx = targetPxX - this.pixelPos.x;
      const ddy = targetPxY - this.pixelPos.y;
      const distToTarget = Math.sqrt(ddx * ddx + ddy * ddy);

      if (distToTarget <= this.ARRIVE_DIST) {
        // Arrived
        this.moveTarget = null;
      } else {
        // Greedy axis-separated movement: move in the larger axis first.
        if (Math.abs(ddx) > Math.abs(ddy)) {
          dx = Math.sign(ddx);
          dy = 0;
        } else {
          dx = 0;
          dy = Math.sign(ddy);
        }
        // If blocked on the chosen axis, try the other axis (simple obstacle avoidance).
        const tryTx = Math.floor((this.pixelPos.x + dx * 16 + 16) / 32);
        const tryTy = Math.floor((this.pixelPos.y + dy * 16 + 16) / 32);
        if (!walkable(tryTx, tryTy)) {
          // Try the perpendicular axis
          if (dx !== 0) { dx = 0; dy = Math.sign(ddy) || 0; }
          else { dy = 0; dx = Math.sign(ddx) || 0; }
          const altTx = Math.floor((this.pixelPos.x + dx * 16 + 16) / 32);
          const altTy = Math.floor((this.pixelPos.y + dy * 16 + 16) / 32);
          if (!walkable(altTx, altTy)) {
            // Fully blocked — stop.
            this.moveTarget = null;
            dx = 0; dy = 0;
          }
        }
      }
    }

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.15) {
      const speed = this.speed * dt;
      const nx = dx / len;
      const ny = dy / len;
      const newPx = this.pixelPos.x + nx * speed;
      const newPy = this.pixelPos.y + ny * speed;

      // Check walkability at new position
      const newTx = Math.floor((newPx + 16) / 32);
      const newTy = Math.floor((newPy + 16) / 32);

      if (walkable(newTx, this.pos.y) || walkable(Math.floor((newPx + 16) / 32), this.pos.y)) {
        this.pixelPos.x = newPx;
      }
      if (walkable(this.pos.x, newTy) || walkable(Math.floor((newPy + 16) / 32) === this.pos.y ? this.pos.x : Math.floor((newPx + 16) / 32), newTy)) {
        this.pixelPos.y = newPy;
      }

      // Update tile pos from pixel pos
      this.pos.x = Math.floor((this.pixelPos.x + 16) / 32);
      this.pos.y = Math.floor((this.pixelPos.y + 16) / 32);

      // Update facing
      this.facing = { x: nx, y: ny };
    }
  }

  getFacingTile(): Vec2 {
    return {
      x: this.pos.x + (this.facing.x > 0.3 ? 1 : this.facing.x < -0.3 ? -1 : 0),
      y: this.pos.y + (this.facing.y > 0.3 ? 1 : this.facing.y < -0.3 ? -1 : 0),
    };
  }

  addItem(itemId: string, quantity: number): boolean {
    // Stack into existing slots
    for (const slot of this.inventory) {
      if (slot.item && slot.item.itemId === itemId) {
        slot.item.quantity += quantity;
        return true;
      }
    }
    // Find empty slot
    for (const slot of this.inventory) {
      if (!slot.item) {
        slot.item = { itemId, quantity };
        return true;
      }
    }
    return false; // inventory full
  }

  removeItem(itemId: string, quantity: number): boolean {
    let total = this.countItem(itemId);
    if (total < quantity) return false;
    for (const slot of this.inventory) {
      if (slot.item && slot.item.itemId === itemId) {
        const take = Math.min(slot.item.quantity, quantity);
        slot.item.quantity -= take;
        quantity -= take;
        if (slot.item.quantity <= 0) slot.item = null;
        if (quantity <= 0) return true;
      }
    }
    return false;
  }

  countItem(itemId: string): number {
    let total = 0;
    for (const slot of this.inventory) {
      if (slot.item && slot.item.itemId === itemId) {
        total += slot.item.quantity;
      }
    }
    return total;
  }

  hasItem(itemId: string, quantity: number = 1): boolean {
    return this.countItem(itemId) >= quantity;
  }

  getInventoryItems(): { slotIndex: number; itemId: string; quantity: number }[] {
    const items: { slotIndex: number; itemId: string; quantity: number }[] = [];
    for (let i = 0; i < this.inventory.length; i++) {
      const slot = this.inventory[i];
      if (slot.item) {
        items.push({ slotIndex: i, itemId: slot.item.itemId, quantity: slot.item.quantity });
      }
    }
    return items;
  }
}