/**
 * Shared, append-only registry of procedural texture ids.
 * Add new ids at the end. Never reorder or rename — other modules key off these.
 */
export const TEXTURE_IDS = [
  // --- sea floor ---
  'sand_fine',
  'sand_rippled',
  'gravel',
  'rock_basalt',
  'rock_limestone',
  'rock_sandstone',
  'mud_silt',
  'clay_red',
  'shale_dark',
  'crystal_face',
  // --- organics ---
  'coral_brain',
  'coral_tube',
  'coral_fan',
  'kelp_blade',
  'algae_mat',
  'seagrass',
  'sponge',
  'bioluminescent',
  // --- manmade ---
  'hull_painted',
  'hull_rusted',
  'metal_brushed',
  'metal_scuffed',
  'glass_scratched',
  'rubber_seal',
  'circuit_panel',
  'fabric_suit',
  'plastic_orange',
  'decal_warning',
  // --- creature skin ---
  'skin_scales',
  'skin_smooth',
  'skin_leathery',
  'skin_spotted',
  'skin_striped',
  // --- utility ---
  'detail_grunge',
  'detail_noise',
  'foam_mask',
  'caustic_tile',
  'wet_ripple',
  // High-frequency detail-normal sources. Meant to be tiled at ~0.3 m and
  // blended over a base layer with `mx_blendNormalRNM`, not used as a material
  // on their own. `detail_grain` is sand/silt grain; `detail_grain_coarse` is
  // the same field at gravel/rubble scale.
  'detail_grain',
  'detail_grain_coarse',
] as const;

export type TextureId = (typeof TEXTURE_IDS)[number];
