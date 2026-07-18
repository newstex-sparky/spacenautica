import type { GameEngine } from '../engine/GameEngine';
import { ITEMS, MODULES, RECIPES, getItemName } from '../engine/items';
import { TECH_TREE } from '../engine/techTree';

interface Props {
  engine: GameEngine;
}

export function InventoryModal({ engine }: Props) {
  const items = engine.player.getInventoryItems();

  return (
    <div className="modal-overlay" onClick={() => engine.closeScreen()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Inventory</h2>
        <div className="inventory-grid">
          {engine.player.inventory.map((slot, i) => (
            <div key={i} className={`inv-slot ${slot.item ? 'filled' : 'empty'}`}>
              {slot.item && (
                <>
                  <span className="inv-emoji">{ITEMS[slot.item.itemId]?.emoji ?? '❓'}</span>
                  <span className="inv-count">{slot.item.quantity}</span>
                  <span className="inv-name">{getItemName(slot.item.itemId)}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <button onClick={() => engine.closeScreen()}>Close (B)</button>
      </div>
    </div>
  );
}

export function BuildModal({ engine }: Props) {
  // Get all module defs
  const allModules = Object.values(MODULES);

  return (
    <div className="modal-overlay" onClick={() => engine.closeScreen()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Build Station Modules</h2>
        <p className="modal-hint">Select a module, then move to where you want to place it and press Action.</p>
        <div className="build-list">
          {allModules.map((mod: any) => {
            const unlocked = mod.unlocked || engine.unlockedTech.has(
              mod.techTier === 0 ? 'eva_basic' : ''
            );
            const canAfford = mod.materials.every((m: any) => engine.player.hasItem(m.itemId, m.quantity));
            return (
              <div key={mod.id} className={`build-item ${!unlocked ? 'locked' : ''} ${!canAfford ? 'cant-afford' : ''}`}>
                <span className="build-emoji">{mod.emoji}</span>
                <div className="build-info">
                  <div className="build-name">{mod.name}</div>
                  <div className="build-desc">{mod.description}</div>
                  <div className="build-cost">
                    {mod.materials.map((m: any, i: number) => (
                      <span key={i} className={engine.player.hasItem(m.itemId, m.quantity) ? 'has' : 'need'}>
                        {m.quantity}x {getItemName(m.itemId)}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  disabled={!unlocked || !canAfford}
                  onClick={() => {
                    engine.setBuildMode(mod.id);
                    engine.closeScreen();
                  }}
                >
                  {unlocked ? 'Place' : '🔒'}
                </button>
              </div>
            );
          })}
        </div>
        <button onClick={() => engine.closeScreen()}>Close (B)</button>
      </div>
    </div>
  );
}

export function CraftModal({ engine }: Props) {
  const recipes = RECIPES;

  return (
    <div className="modal-overlay" onClick={() => engine.closeScreen()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Fabricator</h2>
        <p className="modal-hint">Craft tools and materials from refined resources.</p>
        <div className="craft-list">
          {recipes.map((recipe: any) => {
            const canCraft = engine.canCraft(recipe.id);
            return (
              <div key={recipe.id} className={`craft-item ${!canCraft ? 'cant' : ''}`}>
                <div className="craft-info">
                  <div className="craft-name">{recipe.name}</div>
                  <div className="craft-desc">{recipe.description}</div>
                  <div className="craft-cost">
                    {recipe.inputs.map((inp: any, i: number) => (
                      <span key={i} className={engine.player.hasItem(inp.itemId, inp.quantity) ? 'has' : 'need'}>
                        {inp.quantity}x {getItemName(inp.itemId)}
                      </span>
                    ))}
                    → <span className="output">{recipe.output.quantity}x {getItemName(recipe.output.itemId)}</span>
                  </div>
                </div>
                <button
                  disabled={!canCraft}
                  onClick={() => engine.craft(recipe.id)}
                >
                  Craft
                </button>
              </div>
            );
          })}
        </div>
        <button onClick={() => engine.closeScreen()}>Close (B)</button>
      </div>
    </div>
  );
}

export function TechTreeModal({ engine }: Props) {
  const techTree = TECH_TREE;

  const tiers = [0, 1, 2, 3, 4, 5];

  return (
    <div className="modal-overlay" onClick={() => engine.closeScreen()}>
      <div className="modal tech-modal" onClick={e => e.stopPropagation()}>
        <h2>Tech Tree</h2>
        <div className="tech-chips">Tech Chips: {engine.techChips}</div>
        <div className="tech-tree">
          {tiers.map(tier => {
            const nodes = techTree.filter((t: any) => t.tier === tier);
            if (nodes.length === 0) return null;
            return (
              <div key={tier} className="tech-tier">
                <h3>Tier {tier}</h3>
                <div className="tech-nodes">
                  {nodes.map((node: any) => {
                    const unlocked = engine.unlockedTech.has(node.id);
                    const available = engine.getAvailableTech().some((t: any) => t.id === node.id);
                    const canUnlock = available && engine.techChips >= node.cost;
                    return (
                      <div key={node.id} className={`tech-node ${unlocked ? 'unlocked' : ''} ${available ? 'available' : 'locked'}`}>
                        <div className="tech-node-name">{node.name}</div>
                        <div className="tech-node-desc">{node.description}</div>
                        <div className="tech-node-cost">{node.cost} chips</div>
                        {unlocked ? (
                          <span className="tech-status">✅ Researched</span>
                        ) : (
                          <button
                            disabled={!canUnlock}
                            onClick={() => engine.unlockTech(node.id)}
                          >
                            {available ? 'Research' : '🔒 Locked'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={() => engine.closeScreen()}>Close (B)</button>
      </div>
    </div>
  );
}

export function MapModal({ engine }: Props) {
  const w = engine.world.width;
  const h = engine.world.height;
  const cellSize = 4;

  return (
    <div className="modal-overlay" onClick={() => engine.closeScreen()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Sector Map</h2>
        <div className="map-container">
          <canvas
            width={w * cellSize}
            height={h * cellSize}
            ref={(canvas) => {
              if (!canvas) return;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  const t = engine.world.getTile(x, y);
                  if (!t) continue;
                  let color = '#000';
                  if (t.type === 'asteroid') color = '#3a3a3a';
                  else if (t.type === 'crystal') color = '#44ffff';
                  else if (t.type === 'debris') color = '#3a2520';
                  else if (t.type === 'station_floor') color = '#4488cc';
                  else if (t.type === 'solar') color = '#4488ff';
                  else if (t.type === 'reactor') color = '#44ff44';
                  else if (t.decorationId === 'star') color = '#222222';
                  ctx.fillStyle = color;
                  ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                }
              }
              // Player position
              ctx.fillStyle = '#ffff00';
              ctx.fillRect(
                engine.player.pos.x * cellSize - 2,
                engine.player.pos.y * cellSize - 2,
                cellSize + 4,
                cellSize + 4,
              );
            }}
          />
        </div>
        <div className="map-legend">
          <span><span className="dot" style={{ background: '#ffff00' }} />You</span>
          <span><span className="dot" style={{ background: '#3a3a3a' }} />Asteroid</span>
          <span><span className="dot" style={{ background: '#44ffff' }} />Crystal</span>
          <span><span className="dot" style={{ background: '#3a2520' }} />Debris</span>
          <span><span className="dot" style={{ background: '#4488cc' }} />Station</span>
        </div>
        <button onClick={() => engine.closeScreen()}>Close (B)</button>
      </div>
    </div>
  );
}