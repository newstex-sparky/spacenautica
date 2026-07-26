// Generated from Kenny CC0 reference images (M3 Issues #42-#45)

// Asteroid models (#42)
export { createOreAsteroid, createIceAsteroid } from './generated';

// Station module models (#43)
export { createSmelterModule, createRefineryModule, createHabitatModule, createRelayModule } from './generated';

// Tool and item models (#44)
export { createRepairTool, createMiningDrillMk2, createMiningDrill, createScanner } from './generated';
export { createRawOreItem, createWaterIceItem, createIronIngotItem, createTitaniumIngotItem, createO2CanisterItem, createH2CanisterItem, createTechChipItem } from './generated';

// Re-export procedural generators from Factory.ts for backward compatibility
export { createProceduralAsteroid, createStationModule, createTool, createContainer } from './Factory';
export { createFloorTexture, createAsteroidTexture, createIceTexture } from './Factory';