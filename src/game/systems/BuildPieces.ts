/**
 * BUILD PIECE DEFINITIONS — habitat catalogue.
 *
 * Everything here is data: footprint, cost, structural load, power behaviour and
 * connection geometry. `BuildGeometry.ts` turns a def plus a seed into meshes;
 * `BuildSystem.ts` handles ghosting, validity, snapping and simulation.
 *
 * Local-space conventions: +Y is up, corridors run along local Z, and every
 * connector stores its own local position and outward direction.
 */

import type { Ingredient } from './Inventory';

export type PieceCategory =
  | 'foundation' | 'corridor' | 'room' | 'access' | 'power' | 'interior' | 'utility';

/** Connection socket classes. A piece may only dock to kinds it lists in `snapTo`. */
export type SnapKind = 'corridor' | 'room' | 'hatch' | 'wall' | 'floor' | 'ground';

export interface Connector {
  kind: SnapKind;
  /** Local position of the socket. */
  pos: [number, number, number];
  /** Local outward normal of the socket. */
  dir: [number, number, number];
}

export interface BuildPieceDef {
  id: string;
  name: string;
  category: PieceCategory;
  cost: Ingredient[];
  /** Half-extents of the collision/placement box, metres. */
  extents: [number, number, number];
  /**
   * Structural integrity contribution. Positive braces the base, negative loads
   * it. Base total must stay >= 0 or compartments start breaching.
   */
  integrity: number;
  /** Watts produced under ideal conditions. */
  power?: number;
  /** Watts drawn continuously. */
  draw?: number;
  /** Stored energy capacity in kilojoules. */
  capacity?: number;
  /** Pressurised interior volume, m^3. Drives flood/drain timing. */
  volume?: number;
  /** Must rest on the sea floor rather than dock to existing structure. */
  ground: boolean;
  /** Maximum terrain slope in degrees when ground-placed. */
  maxSlope?: number;
  /** Sockets this piece exposes to others. */
  connectors: Connector[];
  /** Socket kinds this piece can dock onto. Empty = free placement. */
  snapTo: SnapKind[];
  requiresTech?: string;
  /** Seconds the habitat builder takes to print it. */
  buildTime: number;
  /** Placed on an interior wall/floor of an existing habitat piece. */
  interior?: boolean;
  /** Storage grid this piece provides, if any. */
  storage?: { width: number; height: number };
  /** Fabricator station this piece provides, if any. */
  station?: string;
  description: string;
}

const g = (id: string, count = 1): Ingredient => ({ id, count });

/** Corridor tube radius. Everything docks to this profile. */
export const CORRIDOR_RADIUS = 1.35;
/** Corridor segment length. */
export const CORRIDOR_LENGTH = 5;
/** Multipurpose room radius. */
export const ROOM_RADIUS = 2.7;
/** Multipurpose room interior height. */
export const ROOM_HEIGHT = 4.2;

const PIECES: BuildPieceDef[] = [
  /* ---------------- foundations ---------------- */
  {
    id: 'foundation', name: 'Foundation', category: 'foundation',
    cost: [g('titanium', 2)], extents: [3, 0.35, 3],
    integrity: 3, ground: true, maxSlope: 22,
    connectors: [
      // Own deck surface — corridors, rooms and machines sit here.
      { kind: 'floor', pos: [0, 0.35, 0], dir: [0, 1, 0] },
      { kind: 'floor', pos: [1.6, 0.35, 1.6], dir: [0, 1, 0] },
      { kind: 'floor', pos: [-1.6, 0.35, -1.6], dir: [0, 1, 0] },
      // Tiling sockets: a neighbouring foundation docks its own centre here.
      { kind: 'ground', pos: [6, 0.35, 0], dir: [1, 0, 0] },
      { kind: 'ground', pos: [-6, 0.35, 0], dir: [-1, 0, 0] },
      { kind: 'ground', pos: [0, 0.35, 6], dir: [0, 0, 1] },
      { kind: 'ground', pos: [0, 0.35, -6], dir: [0, 0, -1] },
    ],
    snapTo: ['ground'],
    buildTime: 3,
    description:
      'A six-metre pressure-spreading slab with four screw piles. Adds three points ' +
      'of structural capacity and gives you level ground on a seabed that has none.',
  },
  {
    id: 'reinforced_bulkhead', name: 'Hull Reinforcement', category: 'foundation',
    cost: [g('titanium', 3), g('plasteel_ingot')], extents: [1.5, 1.5, 0.25],
    integrity: 4, ground: false, requiresTech: 'tech.plasteel',
    connectors: [], snapTo: ['wall'], buildTime: 4, interior: true,
    description:
      'A plasteel rib bonded to the inside of the hull. Four points of capacity in ' +
      'a hand span. The reason your window habit is affordable.',
  },

  /* ---------------- corridors ---------------- */
  {
    id: 'corridor_straight', name: 'Corridor (Straight)', category: 'corridor',
    cost: [g('titanium', 2)], extents: [CORRIDOR_RADIUS + 0.2, CORRIDOR_RADIUS + 0.2, CORRIDOR_LENGTH / 2],
    integrity: -1, volume: 28, ground: false,
    connectors: [
      { kind: 'corridor', pos: [0, 0, CORRIDOR_LENGTH / 2], dir: [0, 0, 1] },
      { kind: 'corridor', pos: [0, 0, -CORRIDOR_LENGTH / 2], dir: [0, 0, -1] },
      { kind: 'wall', pos: [CORRIDOR_RADIUS, 0, 0], dir: [1, 0, 0] },
      { kind: 'wall', pos: [-CORRIDOR_RADIUS, 0, 0], dir: [-1, 0, 0] },
      { kind: 'hatch', pos: [0, CORRIDOR_RADIUS, 0], dir: [0, 1, 0] },
      { kind: 'floor', pos: [0, -CORRIDOR_RADIUS + 0.47, 1.4], dir: [0, 1, 0] },
      { kind: 'floor', pos: [0, -CORRIDOR_RADIUS + 0.47, -1.4], dir: [0, 1, 0] },
    ],
    snapTo: ['corridor', 'room', 'floor'], buildTime: 4,
    description:
      'Five metres of ribbed pressure tube, flanged at both ends. The vertebra of ' +
      'every seabase ever built, and the first thing to breach when you get greedy.',
  },
  {
    id: 'corridor_bend', name: 'Corridor (Bend)', category: 'corridor',
    cost: [g('titanium', 2)], extents: [2.6, CORRIDOR_RADIUS + 0.2, 2.6],
    integrity: -1, volume: 26, ground: false,
    connectors: [
      { kind: 'corridor', pos: [0, 0, 2.5], dir: [0, 0, 1] },
      { kind: 'corridor', pos: [2.5, 0, 0], dir: [1, 0, 0] },
      { kind: 'hatch', pos: [0, CORRIDOR_RADIUS, 0], dir: [0, 1, 0] },
    ],
    snapTo: ['corridor', 'room'], buildTime: 4,
    description: 'A ninety-degree elbow with an inner radius tight enough to bark your shin on.',
  },
  {
    id: 'corridor_tee', name: 'Corridor (T Junction)', category: 'corridor',
    cost: [g('titanium', 3)], extents: [2.6, CORRIDOR_RADIUS + 0.2, 2.6],
    integrity: -1, volume: 32, ground: false, requiresTech: 'tech.habitat_rooms',
    connectors: [
      { kind: 'corridor', pos: [0, 0, 2.5], dir: [0, 0, 1] },
      { kind: 'corridor', pos: [0, 0, -2.5], dir: [0, 0, -1] },
      { kind: 'corridor', pos: [2.5, 0, 0], dir: [1, 0, 0] },
      { kind: 'hatch', pos: [0, CORRIDOR_RADIUS, 0], dir: [0, 1, 0] },
    ],
    snapTo: ['corridor', 'room'], buildTime: 5,
    description: 'Three-way junction hub with a welded collar. Where a base stops being a line and becomes a plan.',
  },
  {
    id: 'corridor_cross', name: 'Corridor (X Junction)', category: 'corridor',
    cost: [g('titanium', 4)], extents: [2.6, CORRIDOR_RADIUS + 0.2, 2.6],
    integrity: -2, volume: 36, ground: false, requiresTech: 'tech.habitat_rooms',
    connectors: [
      { kind: 'corridor', pos: [0, 0, 2.5], dir: [0, 0, 1] },
      { kind: 'corridor', pos: [0, 0, -2.5], dir: [0, 0, -1] },
      { kind: 'corridor', pos: [2.5, 0, 0], dir: [1, 0, 0] },
      { kind: 'corridor', pos: [-2.5, 0, 0], dir: [-1, 0, 0] },
      { kind: 'hatch', pos: [0, CORRIDOR_RADIUS, 0], dir: [0, 1, 0] },
    ],
    snapTo: ['corridor', 'room'], buildTime: 6,
    description: 'Four-way hub. Structurally the weakest thing you will ever build on purpose.',
  },

  /* ---------------- rooms ---------------- */
  {
    id: 'room_multipurpose', name: 'Multipurpose Room', category: 'room',
    cost: [g('titanium_ingot'), g('titanium', 2)], extents: [ROOM_RADIUS + 0.3, ROOM_HEIGHT / 2, ROOM_RADIUS + 0.3],
    integrity: -2, volume: 96, ground: false, requiresTech: 'tech.habitat_rooms',
    connectors: [
      { kind: 'corridor', pos: [ROOM_RADIUS, 0, 0], dir: [1, 0, 0] },
      { kind: 'corridor', pos: [-ROOM_RADIUS, 0, 0], dir: [-1, 0, 0] },
      { kind: 'corridor', pos: [0, 0, ROOM_RADIUS], dir: [0, 0, 1] },
      { kind: 'corridor', pos: [0, 0, -ROOM_RADIUS], dir: [0, 0, -1] },
      { kind: 'hatch', pos: [0, ROOM_HEIGHT / 2, 0], dir: [0, 1, 0] },
      { kind: 'wall', pos: [0, 0.2, ROOM_RADIUS - 0.1], dir: [0, 0, 1] },
      { kind: 'wall', pos: [ROOM_RADIUS - 0.1, 0.2, 0], dir: [1, 0, 0] },
      { kind: 'wall', pos: [-ROOM_RADIUS + 0.1, 0.2, 0], dir: [-1, 0, 0] },
      { kind: 'wall', pos: [0, 0.2, -ROOM_RADIUS + 0.1], dir: [0, 0, -1] },
      { kind: 'floor', pos: [0, -ROOM_HEIGHT / 2 + 0.24, 0], dir: [0, 1, 0] },
      { kind: 'floor', pos: [1.5, -ROOM_HEIGHT / 2 + 0.24, 0], dir: [0, 1, 0] },
      { kind: 'floor', pos: [-1.5, -ROOM_HEIGHT / 2 + 0.24, 0], dir: [0, 1, 0] },
      { kind: 'floor', pos: [0, -ROOM_HEIGHT / 2 + 0.24, 1.5], dir: [0, 1, 0] },
      { kind: 'floor', pos: [0, -ROOM_HEIGHT / 2 + 0.24, -1.5], dir: [0, 1, 0] },
    ],
    snapTo: ['corridor', 'room', 'floor'], buildTime: 8,
    description:
      'A five-and-a-half metre pressure cylinder with four flanged ports and a ' +
      'walkable deck. The first room that feels like architecture instead of plumbing.',
  },
  {
    id: 'moonpool', name: 'Moonpool', category: 'room',
    cost: [g('titanium_ingot'), g('lubricant'), g('lead', 2), g('advanced_wiring_kit')],
    extents: [4.2, 2.2, 3.2], integrity: -5, volume: 140, ground: false,
    requiresTech: 'tech.moonpool', draw: 6,
    connectors: [
      { kind: 'corridor', pos: [4.2, 0, 0], dir: [1, 0, 0] },
      { kind: 'corridor', pos: [-4.2, 0, 0], dir: [-1, 0, 0] },
      { kind: 'hatch', pos: [0, 2.2, 0], dir: [0, 1, 0] },
      { kind: 'wall', pos: [0, 0.4, 3.2], dir: [0, 0, 1] },
    ],
    snapTo: ['corridor', 'room'], buildTime: 12,
    description:
      'An open bay held dry by pressure differential and two very confident pumps. ' +
      'Walk out of the ocean into your own base without cycling a single hatch.',
  },

  /* ---------------- access ---------------- */
  {
    id: 'hatch', name: 'Hatch', category: 'access',
    cost: [g('titanium', 2), g('silicone_rubber')], extents: [1.1, 1.1, 0.45],
    integrity: -1, ground: false,
    connectors: [{ kind: 'hatch', pos: [0, 0, 0.45], dir: [0, 0, 1] }],
    snapTo: ['corridor', 'hatch'], buildTime: 3,
    description:
      'A ring, a wheel and a gasket you should inspect more often than you do. ' +
      'Cycles in four seconds and floods the lock in one.',
  },
  {
    id: 'window', name: 'Viewport', category: 'access',
    cost: [g('glass'), g('titanium')], extents: [1.1, 0.8, 0.2],
    integrity: -3, ground: false,
    connectors: [], snapTo: ['wall'], buildTime: 3,
    description:
      'Enamelled glass in a titanium frame. Costs you three points of structural ' +
      'capacity and returns something no instrument can: a view.',
  },

  /* ---------------- power ---------------- */
  {
    id: 'solar_panel', name: 'Solar Panel', category: 'power',
    cost: [g('quartz', 2), g('titanium', 2)], extents: [1.5, 1.6, 1.5],
    integrity: 0, power: 75, capacity: 75, ground: true, maxSlope: 30,
    requiresTech: 'tech.solar',
    connectors: [{ kind: 'ground', pos: [0, 0, 0], dir: [0, 1, 0] }],
    snapTo: ['floor'], buildTime: 5,
    description:
      'Seventy-five watts at the surface, four at eighty metres. Sunlight is a ' +
      'shallow-water luxury and this panel will remind you daily.',
  },
  {
    id: 'thermal_plant', name: 'Thermal Plant', category: 'power',
    cost: [g('titanium', 3), g('magnetite', 2), g('wiring_kit'), g('computer_chip')],
    extents: [1.8, 3.2, 1.8], integrity: 0, power: 150, capacity: 250,
    ground: true, maxSlope: 26, requiresTech: 'tech.thermal_plant',
    connectors: [{ kind: 'ground', pos: [0, 0, 0], dir: [0, 1, 0] }],
    snapTo: ['floor'], buildTime: 9,
    description:
      'A Stirling stack that drinks the temperature gradient. Output scales with how ' +
      'unpleasant the surroundings are, which on this planet is a reliable business model.',
  },
  {
    id: 'bioreactor', name: 'Bioreactor', category: 'power',
    cost: [g('titanium', 3), g('wiring_kit'), g('lubricant')],
    extents: [1.1, 1.6, 1.1], integrity: -1, power: 45, capacity: 500,
    ground: false, interior: true, requiresTech: 'tech.bioreactor',
    connectors: [], snapTo: ['floor'], buildTime: 7,
    storage: { width: 4, height: 4 },
    description: 'Eats organics, makes watts. The correct destination for every peeper that went off in your pack.',
  },
  {
    id: 'nuclear_reactor', name: 'Nuclear Reactor', category: 'power',
    cost: [g('plasteel_ingot'), g('lead', 3), g('advanced_wiring_kit'), g('computer_chip')],
    extents: [1.6, 2.0, 1.6], integrity: -2, power: 250, capacity: 1000,
    ground: false, interior: true, requiresTech: 'tech.nuclear',
    connectors: [], snapTo: ['floor'], buildTime: 14,
    storage: { width: 4, height: 1 },
    description:
      'Two hundred and fifty kilowatts and a waste problem. Alterra requires written ' +
      'acknowledgement that you understand the second part.',
  },

  /* ---------------- interior utility ---------------- */
  {
    id: 'locker', name: 'Wall Locker', category: 'interior',
    cost: [g('titanium', 2)], extents: [0.6, 0.9, 0.35],
    integrity: 0, ground: false, interior: true,
    connectors: [], snapTo: ['wall'], buildTime: 3,
    storage: { width: 6, height: 4 },
    description: 'Twenty-four cells of storage and a magnetic catch that holds through a hull breach.',
  },
  {
    id: 'fabricator_wall', name: 'Fabricator', category: 'interior',
    cost: [g('titanium'), g('gold'), g('table_coral_sample')], extents: [0.55, 0.8, 0.4],
    integrity: 0, draw: 12, ground: false, interior: true,
    connectors: [], snapTo: ['wall'], buildTime: 4,
    station: 'fabricator',
    description:
      'Wall-mounted matter printer. Folds out, hums, smells faintly of hot metal, ' +
      'and is the single most valuable object you own.',
  },
  {
    id: 'workbench', name: 'Modification Station', category: 'interior',
    cost: [g('titanium', 2), g('computer_chip'), g('diamond'), g('lead')],
    extents: [0.8, 1.0, 0.5], integrity: 0, draw: 18, ground: false, interior: true,
    connectors: [], snapTo: ['wall'], buildTime: 6,
    station: 'workbench',
    description: 'Upgrades and modifications the lifepod fabricator refuses to attempt. Draws eighteen watts and deserves them.',
  },
  {
    id: 'water_filtration', name: 'Water Filtration Machine', category: 'utility',
    cost: [g('titanium', 3), g('advanced_wiring_kit'), g('silicone_rubber', 2)],
    extents: [0.9, 1.7, 0.7], integrity: -1, draw: 25, ground: false, interior: true,
    requiresTech: 'tech.water_filtration',
    connectors: [], snapTo: ['floor', 'wall'], buildTime: 8,
    station: 'water_filtration', storage: { width: 4, height: 2 },
    description: 'Reverse osmosis on base power. Two bottles an hour, forever. Never think about thirst again.',
  },
  {
    id: 'growbed', name: 'Interior Growbed', category: 'utility',
    cost: [g('titanium', 2), g('glass')], extents: [1.3, 0.45, 0.9],
    integrity: 0, draw: 8, ground: false, interior: true, requiresTech: 'tech.habitat_rooms',
    connectors: [], snapTo: ['floor'], buildTime: 5,
    storage: { width: 4, height: 3 },
    description:
      'Substrate, grow lights and a drip loop. Plant a bulbo tree in here and the ' +
      'thirst problem becomes a gardening problem, which is a better problem.',
  },
];

export const BUILD_PIECES: ReadonlyMap<string, BuildPieceDef> = new Map(PIECES.map((p) => [p.id, p]));
export const BUILD_PIECE_LIST: readonly BuildPieceDef[] = PIECES;

export function pieceDef(id: string): BuildPieceDef | undefined {
  return BUILD_PIECES.get(id);
}

export function piecesByCategory(cat: PieceCategory): BuildPieceDef[] {
  return PIECES.filter((p) => p.category === cat);
}
