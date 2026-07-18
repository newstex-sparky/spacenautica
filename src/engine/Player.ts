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

  update(input: { moveX: number; moveY: number }, dt: number, walkable: (x: number, y: number) => boolean): void {
    const dx = input.moveX;
    const dy = input.moveY;
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