import * as THREE from 'three';
import { Noise, mulberry32 } from '../../core/Noise';

/**
 * Weather driver. One slow noise field decides the storm level; everything else
 * (cloud coverage, deck height, extinction, wind, rain, lightning) is derived
 * from it so the sky, the sea state and the rain can never disagree.
 */
export class Weather {
  /** 0 = clear, 1 = full gale. */
  stormFactor = 0;
  /** 0..1, above-water rain. */
  rainIntensity = 0;
  /** Horizontal wind direction, normalised (world XZ). */
  readonly windDirection = new THREE.Vector2(0.94, 0.34).normalize();
  /** Wind speed, m/s at 10 m reference height. */
  windSpeed = 4;
  /** Decaying lightning flash, 0..1. */
  lightning = 0;
  /** Set to override the procedural storm level; null follows the weather. */
  stormOverride: number | null = null;

  private readonly noise: Noise;
  private readonly rnd: () => number;
  private flashTimer = 0;
  private flashBurst = 0;
  private baseAngle: number;

  constructor(seed = 91733) {
    this.noise = new Noise(seed);
    this.rnd = mulberry32(seed ^ 0x2f9a);
    this.baseAngle = Math.atan2(this.windDirection.y, this.windDirection.x);
  }

  update(dt: number, elapsed: number): void {
    // --- storm level: two slow octaves, biased so clear weather is the norm.
    const slow = this.noise.fbm2(elapsed * 0.0021, 11.3, 3);
    const front = this.noise.fbm2(elapsed * 0.0074 + 41.7, 3.9, 2);
    let s = slow * 1.15 + front * 0.35 + 0.06;
    s = Math.max(0, Math.min(1, s * 1.25));
    // Squash the low end: light overcast is common, real storms are rare.
    s = s * s * (3 - 2 * s);
    this.stormFactor = this.stormOverride ?? s;

    // --- wind: direction wanders, speed follows the storm with gusts.
    const drift = this.noise.fbm2(elapsed * 0.0035 + 7.1, 21.7, 2);
    const ang = this.baseAngle + drift * 1.9;
    this.windDirection.set(Math.cos(ang), Math.sin(ang));
    const gust = 1 + 0.28 * this.noise.noise2(elapsed * 0.31, 3.3);
    this.windSpeed = (2.4 + this.stormFactor * 19) * gust;

    // --- rain begins once the deck thickens
    const wet = Math.max(0, (this.stormFactor - 0.42) / 0.58);
    this.rainIntensity = Math.min(1, wet * wet * 1.35);

    // --- lightning: Poisson strikes with a short multi-flash burst
    this.lightning = Math.max(0, this.lightning - dt * 6.5 * (0.4 + this.lightning));
    if (this.flashBurst > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.lightning = Math.min(1, this.lightning + 0.55 + this.rnd() * 0.45);
        this.flashBurst--;
        this.flashTimer = 0.055 + this.rnd() * 0.13;
      }
    } else if (this.stormFactor > 0.58) {
      const rate = (this.stormFactor - 0.58) * 1.6;
      if (this.rnd() < rate * dt) {
        this.flashBurst = 1 + ((this.rnd() * 3) | 0);
        this.flashTimer = 0;
      }
    }
  }

  /* -------- derived cloud parameters -------- */

  get coverage(): number {
    return 0.29 + 0.56 * this.stormFactor;
  }
  /** Cloud base, km above sea level. */
  get baseKm(): number {
    return 1.55 - 0.85 * this.stormFactor;
  }
  /** Cloud top, km. */
  get topKm(): number {
    return 3.3 + 4.6 * this.stormFactor;
  }
  get density(): number {
    return 1.0 + 0.5 * this.stormFactor;
  }
  /** Extinction, 1/km. */
  get sigmaE(): number {
    return 23 + 52 * this.stormFactor;
  }
  get erode(): number {
    return 0.46 - 0.14 * this.stormFactor;
  }
  /** Extra grey horizon haze fed to the sky-view LUT. */
  get haze(): number {
    return 0.25 + 1.5 * this.stormFactor;
  }
}
