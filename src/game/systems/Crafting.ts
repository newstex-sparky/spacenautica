/**
 * CRAFTING — station-bound fabricator queue.
 *
 * Ingredients are consumed the moment a job starts (so you cannot queue three
 * knives off one billet), the job then runs for `recipe.time` seconds, and the
 * output is delivered into a target container. If the output does not fit, it is
 * held in `overflow` and re-offered every tick rather than being destroyed.
 */

import type { Container, Ingredient } from './Inventory';
import type { RecipeDef, StationType } from './Recipes';
import { RECIPES, RECIPE_LIST } from './Recipes';
import type { TechTree } from './Tech';

export interface CraftJob {
  jobId: number;
  recipeId: string;
  station: StationType;
  /** Seconds elapsed. */
  elapsed: number;
  /** Total seconds required. */
  time: number;
  /** Container that receives the output. */
  targetId: string;
}

export interface CraftStatus {
  recipe: RecipeDef;
  /** Tech-unlocked. */
  known: boolean;
  /** Ingredients present. */
  hasIngredients: boolean;
  /** What is short, for the red text in the fabricator UI. */
  missing: Ingredient[];
  /** Everything checks out. */
  ok: boolean;
}

let nextJobId = 1;

export class Crafting {
  /** Recipe ids the player can print. Mirrors the tech tree. */
  readonly known = new Set<string>();
  readonly queue: CraftJob[] = [];
  /** Outputs that had nowhere to go. Retried whenever space frees up. */
  readonly overflow: Ingredient[] = [];
  /** Hard cap so a stuck station cannot grow unbounded. */
  maxQueue = 8;

  onCompleted: ((recipeId: string, output: Ingredient, delivered: number) => void) | null = null;
  onStarted: ((recipeId: string, time: number) => void) | null = null;
  /** Emitted when a job finished but the output could not be stored. */
  onOverflow: ((output: Ingredient) => void) | null = null;

  private containers = new Map<string, Container>();

  /** GameState registers every container the queue may deliver into. */
  registerContainer(c: Container): void {
    this.containers.set(c.id, c);
  }

  unregisterContainer(id: string): void {
    this.containers.delete(id);
  }

  /** Pulls the current recipe set from the tech tree. Call after any unlock. */
  syncFromTech(tech: TechTree): void {
    this.known.clear();
    for (const id of tech.knownRecipes()) this.known.add(id);
  }

  isKnown(recipeId: string): boolean {
    return this.known.has(recipeId);
  }

  /** Everything printable at a station right now, known or not, with reasons. */
  statusFor(station: StationType, from: Container): CraftStatus[] {
    const out: CraftStatus[] = [];
    for (const r of RECIPE_LIST) {
      if (r.station !== station) continue;
      const known = this.known.has(r.id);
      const missing = from.missing(r.ingredients);
      out.push({ recipe: r, known, hasIngredients: missing.length === 0, missing, ok: known && missing.length === 0 });
    }
    out.sort((a, b) => a.recipe.category.localeCompare(b.recipe.category) || a.recipe.tier - b.recipe.tier);
    return out;
  }

  canCraft(recipeId: string, from: Container): boolean {
    const r = RECIPES.get(recipeId);
    if (!r || !this.known.has(recipeId)) return false;
    if (this.queue.length >= this.maxQueue) return false;
    return from.has(r.ingredients);
  }

  /**
   * Starts a job. Consumes ingredients immediately from `from` and queues the
   * delivery into `to` (defaults to `from`). Returns the job, or null.
   */
  start(recipeId: string, from: Container, to: Container = from): CraftJob | null {
    const r = RECIPES.get(recipeId);
    if (!r) return null;
    if (!this.canCraft(recipeId, from)) return null;
    if (!from.consume(r.ingredients)) return null;
    this.registerContainer(to);
    const job: CraftJob = {
      jobId: nextJobId++,
      recipeId,
      station: r.station,
      elapsed: 0,
      time: Math.max(0.05, r.time),
      targetId: to.id,
    };
    this.queue.push(job);
    this.onStarted?.(recipeId, job.time);
    return job;
  }

  /** Cancels a job and refunds its ingredients into `to`. */
  cancel(jobId: number, refundTo?: Container): boolean {
    const i = this.queue.findIndex((j) => j.jobId === jobId);
    if (i < 0) return false;
    const job = this.queue[i];
    this.queue.splice(i, 1);
    const r = RECIPES.get(job.recipeId);
    const target = refundTo ?? this.containers.get(job.targetId);
    if (r && target) for (const ing of r.ingredients) target.add(ing.id, ing.count);
    return true;
  }

  /** 0..1 progress of the front job for a recipe, or -1 when not queued. */
  progressOf(recipeId: string): number {
    const job = this.queue.find((j) => j.recipeId === recipeId);
    return job ? job.elapsed / job.time : -1;
  }

  /** 0..1 progress of the front job at a station, or -1. */
  stationProgress(station: StationType): number {
    const job = this.queue.find((j) => j.station === station);
    return job ? job.elapsed / job.time : -1;
  }

  update(dt: number): void {
    // Only the front job per station runs, so two fabricators are independent
    // but one fabricator prints in order.
    const busy = new Set<StationType>();
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i];
      if (busy.has(job.station)) continue;
      busy.add(job.station);
      job.elapsed += dt;
      if (job.elapsed < job.time) continue;

      const r = RECIPES.get(job.recipeId);
      this.queue.splice(i--, 1);
      if (!r) continue;
      const target = this.containers.get(job.targetId);
      const delivered = target ? target.add(r.output.id, r.output.count) : 0;
      const short = r.output.count - delivered;
      if (short > 0) {
        this.overflow.push({ id: r.output.id, count: short });
        this.onOverflow?.({ id: r.output.id, count: short });
      }
      this.onCompleted?.(job.recipeId, { ...r.output }, delivered);
    }

    if (this.overflow.length) this.drainOverflow();
  }

  /** Re-offers held outputs. Cheap: only runs while overflow is non-empty. */
  private drainOverflow(): void {
    for (let i = 0; i < this.overflow.length; i++) {
      const o = this.overflow[i];
      for (const c of this.containers.values()) {
        const moved = c.add(o.id, o.count);
        o.count -= moved;
        if (o.count <= 0) break;
      }
      if (o.count <= 0) this.overflow.splice(i--, 1);
    }
  }

  serialise(): { queue: CraftJob[]; overflow: Ingredient[] } {
    return { queue: this.queue.map((j) => ({ ...j })), overflow: this.overflow.map((o) => ({ ...o })) };
  }

  deserialise(data: { queue?: CraftJob[]; overflow?: Ingredient[] }): void {
    this.queue.length = 0;
    for (const j of data.queue ?? []) {
      if (!RECIPES.has(j.recipeId)) continue;
      this.queue.push({ ...j, jobId: nextJobId++ });
    }
    this.overflow.length = 0;
    for (const o of data.overflow ?? []) this.overflow.push({ ...o });
  }
}
