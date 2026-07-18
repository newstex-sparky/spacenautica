import { useRef, useEffect } from 'react';
import type { GameEngine } from '../engine/GameEngine';
import { TILE_SIZE, WORLD_W, WORLD_H } from '../engine/World';

interface Props {
  engine: GameEngine;
}

export function GameCanvas({ engine }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId: number;

    const render = () => {
      const eng = engineRef.current;
      const w = canvas.width;
      const h = canvas.height;

      // Resize canvas to fill
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }

      // Deep space background — dark gradient
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h));
      bgGrad.addColorStop(0, '#0a0a1a');
      bgGrad.addColorStop(0.5, '#050510');
      bgGrad.addColorStop(1, '#000000');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Draw distant stars (parallax background)
      const starOffset = (eng.gameTime.minutes / 1440) * 50;
      for (let i = 0; i < 80; i++) {
        const sx = (i * 137.5 - starOffset) % w;
        const sy = (i * 89.3) % h;
        const brightness = 0.3 + 0.7 * Math.sin(eng.gameTime.minutes * 0.01 + i);
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness * 0.3})`;
        ctx.fillRect(sx, sy, 2, 2);
      }

      // Camera offset — centered on player
      const camX = eng.player.pixelPos.x - w / 2 + TILE_SIZE / 2;
      const camY = eng.player.pixelPos.y - h / 2 + TILE_SIZE / 2;

      // Calculate visible tile range
      const startTx = Math.max(0, Math.floor(camX / TILE_SIZE));
      const startTy = Math.max(0, Math.floor(camY / TILE_SIZE));
      const endTx = Math.min(WORLD_W, Math.ceil((camX + w) / TILE_SIZE) + 1);
      const endTy = Math.min(WORLD_H, Math.ceil((camY + h) / TILE_SIZE) + 1);

      // Draw tiles
      for (let ty = startTy; ty < endTy; ty++) {
        for (let tx = startTx; tx < endTx; tx++) {
          const tile = eng.world.getTile(tx, ty);
          if (!tile) continue;
          const px = tx * TILE_SIZE - camX;
          const py = ty * TILE_SIZE - camY;

          drawTile(ctx, tile.type, px, py, TILE_SIZE, tile, eng, tx, ty);
        }
      }

      // Draw placed modules (buildings on top)
      for (const mod of eng.world.modules) {
        drawModule(ctx, mod, camX, camY, eng);
      }

      // Draw mining laser beam
      if (eng.miningTarget && eng.input.fire) {
        const facing = eng.player.getFacingTile();
        const tx = facing.x * TILE_SIZE - camX + TILE_SIZE / 2;
        const ty = facing.y * TILE_SIZE - camY + TILE_SIZE / 2;
        const px = eng.player.pixelPos.x - camX + TILE_SIZE / 2;
        const py = eng.player.pixelPos.y - camY + TILE_SIZE / 2;

        // Laser beam
        ctx.strokeStyle = '#ff4400';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(Date.now() * 0.02);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Impact sparks
        ctx.fillStyle = '#ffaa00';
        for (let i = 0; i < 5; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * 8;
          ctx.fillRect(tx + Math.cos(angle) * dist, ty + Math.sin(angle) * dist, 2, 2);
        }

        // Mining progress circle
        if (eng.miningProgress > 0) {
          ctx.strokeStyle = '#ff8800';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(tx, ty, 12, -Math.PI / 2, -Math.PI / 2 + eng.miningProgress * Math.PI * 2);
          ctx.stroke();
        }
      }

      // Draw build placement preview
      if (eng.buildMode) {
        const facing = eng.player.getFacingTile();
        const canPlace = eng.world.canPlaceModule(facing.x, facing.y, eng.buildMode);
        const color = canPlace ? '#44ff44' : '#ff4444';
        // Simple preview — draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(
          facing.x * TILE_SIZE - camX,
          facing.y * TILE_SIZE - camY,
          TILE_SIZE * 2,
          TILE_SIZE * 2,
        );
        ctx.globalAlpha = 1;
      }

      // Draw player
      drawPlayer(ctx, eng, camX, camY);

      rafId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
    />
  );
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  type: string,
  px: number, py: number, sz: number,
  tile: any,
  eng: GameEngine,
  tx: number, ty: number,
) {
  switch (type) {
    case 'void': {
      // Deep space — just darkness, maybe a decorative star
      if (tile.decorationId === 'star') {
        const brightness = 0.4 + 0.3 * Math.sin(eng.gameTime.minutes * 0.02 + tx * 7 + ty * 13);
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
        ctx.fillRect(px + sz / 2 - 1, py + sz / 2 - 1, 2, 2);
      }
      break;
    }

    case 'asteroid': {
      // Gray-brown rocky surface
      const hash = (tx * 7 + ty * 13) % 5;
      const baseColor = tile.oreType === 'uranium' ? '#2a3a2a' :
        tile.oreType === 'gold' ? '#4a4a3a' :
        tile.oreType === 'alien_alloy' ? '#3a2a3a' :
        '#3a3a3a';
      ctx.fillStyle = baseColor;
      ctx.fillRect(px, py, sz, sz);

      // Rock texture — darker specks
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      for (let i = 0; i < 4; i++) {
        const ox = ((tx * 7 + ty * 3 + i * 11) % sz);
        const oy = ((tx * 5 + ty * 7 + i * 13) % sz);
        ctx.fillRect(px + ox, py + oy, 3, 3);
      }

      // Ore specks (colored by type)
      if (tile.oreType) {
        const oreColor = tile.oreType === 'iron' ? '#aa88aa' :
          tile.oreType === 'gold' ? '#ffdd00' :
          tile.oreType === 'crystal' ? '#44ffff' :
          tile.oreType === 'silicon' ? '#cc9966' :
          tile.oreType === 'carbon' ? '#444444' :
          tile.oreType === 'uranium' ? '#44ff44' :
          '#ff66ff';
        ctx.fillStyle = oreColor;
        for (let i = 0; i < 3; i++) {
          const ox = ((tx * 11 + ty * 5 + i * 7) % (sz - 6)) + 3;
          const oy = ((tx * 3 + ty * 11 + i * 17) % (sz - 6)) + 3;
          ctx.fillRect(px + ox, py + oy, 2, 2);
        }
      }
      break;
    }

    case 'crystal': {
      // Glowing crystal deposit
      ctx.fillStyle = '#1a1a2a';
      ctx.fillRect(px, py, sz, sz);
      const glow = 0.5 + 0.3 * Math.sin(Date.now() * 0.003 + tx + ty);
      ctx.fillStyle = `rgba(68, 255, 255, ${glow})`;
      ctx.beginPath();
      ctx.moveTo(px + sz / 2, py + 4);
      ctx.lineTo(px + sz - 4, py + sz / 2);
      ctx.lineTo(px + sz / 2, py + sz - 4);
      ctx.lineTo(px + 4, py + sz / 2);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'debris': {
      // Wreckage — dark metal with orange rust
      ctx.fillStyle = '#2a2520';
      ctx.fillRect(px, py, sz, sz);
      ctx.fillStyle = '#3a3530';
      ctx.fillRect(px + 2, py + 2, sz - 4, sz - 4);
      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 4);
      ctx.lineTo(px + sz - 4, py + sz - 4);
      ctx.moveTo(px + sz - 4, py + 4);
      ctx.lineTo(px + 4, py + sz - 4);
      ctx.stroke();
      break;
    }

    case 'station_floor': {
      // Pressurized floor — dark blue with grid
      ctx.fillStyle = tile.pressurized ? '#1a2233' : '#2a2030';
      ctx.fillRect(px, py, sz, sz);

      // Floor grid lines
      ctx.strokeStyle = tile.pressurized ? '#2a3a55' : '#3a3045';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, sz - 1, sz - 1);

      // Subtle interior lighting
      if (tile.pressurized) {
        ctx.fillStyle = 'rgba(80, 120, 200, 0.05)';
        ctx.fillRect(px + 4, py + 4, sz - 8, sz - 8);
      }
      break;
    }

    case 'airlock': {
      ctx.fillStyle = '#3a4a5a';
      ctx.fillRect(px, py, sz, sz);
      ctx.strokeStyle = '#6699aa';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, sz - 4, sz - 4);
      // Door indicator
      ctx.fillStyle = '#44ddff';
      ctx.fillRect(px + sz / 2 - 2, py + 4, 4, sz - 8);
      break;
    }

    case 'solar': {
      ctx.fillStyle = '#1122aa';
      ctx.fillRect(px, py, sz, sz);
      // Solar panel grid
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        ctx.strokeRect(px + 2 + i * (sz / 4 - 1), py + 2, sz / 4 - 2, sz - 4);
      }
      break;
    }

    case 'reactor': {
      ctx.fillStyle = '#226644';
      ctx.fillRect(px, py, sz, sz);
      const glow = 0.5 + 0.3 * Math.sin(Date.now() * 0.005);
      ctx.fillStyle = `rgba(68, 255, 68, ${glow})`;
      ctx.beginPath();
      ctx.arc(px + sz / 2, py + sz / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'shield': {
      ctx.fillStyle = '#334488';
      ctx.fillRect(px, py, sz, sz);
      const glow = 0.3 + 0.2 * Math.sin(Date.now() * 0.004);
      ctx.strokeStyle = `rgba(100, 170, 255, ${glow})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 4, py + 4, sz - 8, sz - 8);
      break;
    }

    default:
      break;
  }
}

function drawModule(
  ctx: CanvasRenderingContext2D,
  mod: any,
  camX: number, camY: number,
  eng: GameEngine,
) {
  // Modules are drawn via their tiles, but we add a border and label
  const px = mod.x * TILE_SIZE - camX;
  const py = mod.y * TILE_SIZE - camY;
  const def = eng.world.modules.length > 0 ? null : null; // just to reference eng

  // Module border
  ctx.strokeStyle = 'rgba(100, 150, 200, 0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, TILE_SIZE * 2, TILE_SIZE * 2);
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  eng: GameEngine,
  camX: number, camY: number,
) {
  const px = eng.player.pixelPos.x - camX + TILE_SIZE / 2;
  const py = eng.player.pixelPos.y - camY + TILE_SIZE / 2;

  // EVA suit — astronaut
  // Body
  ctx.fillStyle = eng.player.inStation ? '#4488cc' : '#ddaa44';
  ctx.beginPath();
  ctx.arc(px, py, 10, 0, Math.PI * 2);
  ctx.fill();

  // Helmet visor
  ctx.fillStyle = '#222244';
  ctx.beginPath();
  ctx.arc(px, py - 2, 6, 0, Math.PI * 2);
  ctx.fill();

  // Visor reflection
  ctx.fillStyle = '#88ccff';
  ctx.fillRect(px - 3, py - 4, 4, 2);

  // Facing direction indicator
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + eng.player.facing.x * 14, py + eng.player.facing.y * 14);
  ctx.stroke();

  // O2 warning glow
  const o2Pct = eng.player.stats.oxygen / eng.player.stats.maxOxygen;
  if (o2Pct < 0.2) {
    const alpha = 0.3 + 0.3 * Math.sin(Date.now() * 0.01);
    ctx.strokeStyle = `rgba(255, 0, 0, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
}