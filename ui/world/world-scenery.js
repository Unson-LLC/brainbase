/*
 * Scenery shared by the world and the inside of a district: textures, value noise, facades, and the
 * plate and roof shapes.  None of it carries data; it only gives both scales the same look.
 */

import { THREE } from './world-vendor.js';

export function hashUnit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function canvasTexture(doc, width, height, draw) {
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Smooth value noise in [0, 1]; used only to shade scenery (ground, sea, mountains) without repeating textures. */
export function valueNoise(x, z, seed = 'n') {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const at = (i, j) => hashUnit(`${seed}${i},${j}`);
  const near = at(xi, zi) + (at(xi + 1, zi) - at(xi, zi)) * sx;
  const far = at(xi, zi + 1) + (at(xi + 1, zi + 1) - at(xi, zi + 1)) * sx;
  return near + (far - near) * sz;
}

/** Colours a geometry per vertex from its position (x, y, z before any rotation). */
export function paintVertices(geometry, colorAt) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    colorAt(color, position.getX(i), position.getY(i), position.getZ(i));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/*
 * Facades: one tile of a wall, drawn for a style and a wall colour.  Windows are on the walls only (roofs
 * get a plain material).  Which panes are lit is fixed per pane, so the glow map matches the colour map;
 * whether a building has lit windows at all still means "moved in the last 30 days".
 */
export const FACADE_UNITS = Object.freeze({ glass: [2.0, 2.3], office: [3.0, 2.0], brick: [1.3, 1.35], civic: [0.85, 1.5], research: [0.9, 1.2], house: [0, 0] });

/** Tile size in pixels: glass and office tiles hold several floors so lit panes do not repeat as a pattern. */
export const FACADE_SIZES = Object.freeze({ glass: 256, office: 256 });

export function drawFacade(ctx, w, h, style, wall, lit, glowOnly) {
  const wallColor = `#${new THREE.Color(wall).getHexString()}`;
  const dark = `#${new THREE.Color(wall).multiplyScalar(0.72).getHexString()}`;
  const light = `#${new THREE.Color(wall).lerp(new THREE.Color(0xffffff), 0.35).getHexString()}`;
  ctx.fillStyle = glowOnly ? '#000000' : wallColor;
  ctx.fillRect(0, 0, w, h);
  const pane = (x, y, pw, ph, index) => {
    const on = lit && hashUnit(`${style}pane${index}x`) < 0.55;
    if (glowOnly) {
      ctx.fillStyle = on ? '#ffffff' : '#000000';
      ctx.fillRect(x, y, pw, ph);
      return;
    }
    if (on) {
      ctx.fillStyle = '#ffd98c';
      ctx.fillRect(x, y, pw, ph);
      ctx.fillStyle = 'rgba(255,244,214,0.55)';
      ctx.fillRect(x, y, pw, ph * 0.3);
    } else {
      const glass = ctx.createLinearGradient(x, y, x + pw, y + ph);
      glass.addColorStop(0, '#9fb3c4');
      glass.addColorStop(0.5, '#56687a');
      glass.addColorStop(1, '#3f4f60');
      ctx.fillStyle = glass;
      ctx.fillRect(x, y, pw, ph);
    }
  };
  if (style === 'glass') {
    // A curtain wall: four floors of four panes, thin mullions, a floor band under each floor.
    const cw = w / 4;
    const rh = h / 4;
    for (let r = 0; r < 4; r += 1) {
      if (!glowOnly) {
        ctx.fillStyle = dark;
        ctx.fillRect(0, r * rh + rh - 7, w, 7);
      }
      for (let c = 0; c < 4; c += 1) pane(c * cw + 4, r * rh + 5, cw - 8, rh - 15, r * 4 + c);
    }
    if (!glowOnly) {
      ctx.fillStyle = light;
      for (let c = 0; c <= 4; c += 1) ctx.fillRect(c * cw - 2, 0, 4, h);
    }
  } else if (style === 'office') {
    // Ribbon windows: two floors, each a long band split by mullions over a concrete spandrel.
    const rh = h / 2;
    for (let r = 0; r < 2; r += 1) {
      if (!glowOnly) {
        ctx.fillStyle = light;
        ctx.fillRect(0, r * rh, w, 22);
        ctx.fillStyle = dark;
        ctx.fillRect(0, r * rh + rh - 10, w, 6);
      }
      for (let c = 0; c < 8; c += 1) pane(4 + c * (w / 8), r * rh + 34, w / 8 - 6, rh - 54, r * 8 + c);
    }
  } else if (style === 'brick') {
    if (!glowOnly) {
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 2;
      for (let y = 16; y < h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
    for (let c = 0; c < 2; c += 1) {
      const x = 18 + c * 58;
      if (!glowOnly) {
        ctx.fillStyle = '#f5f1e8';
        ctx.fillRect(x - 5, 22, 44, 82);
      }
      pane(x, 26, 34, 74, c);
      if (!glowOnly) {
        ctx.fillStyle = '#f5f1e8';
        ctx.fillRect(x + 15, 26, 4, 74);
        ctx.fillRect(x, 58, 34, 4);
      }
    }
  } else if (style === 'civic') {
    // Pilasters and tall windows.
    if (!glowOnly) {
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, 18, h);
      ctx.fillRect(w - 18, 0, 18, h);
    }
    pane(30, 14, 68, 96, 0);
    if (!glowOnly) {
      ctx.fillStyle = light;
      ctx.fillRect(62, 14, 4, 96);
    }
  } else if (style === 'research') {
    for (let c = 0; c < 2; c += 1) pane(20 + c * 60, 18, 28, 90, c);
  } else if (style === 'house') {
    // A plastered wall with two framed windows (doors are separate meshes).
    for (let c = 0; c < 2; c += 1) {
      const x = 22 + c * 52;
      if (!glowOnly) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 4, 36, 40, 50);
      }
      pane(x, 40, 32, 42, c);
      if (!glowOnly) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 14, 40, 4, 42);
        ctx.fillStyle = dark;
        ctx.fillRect(x - 6, 86, 44, 5);
      }
    }
  }
}

export function roundedPlate(width, depth, height, radius) {
  const shape = new THREE.Shape();
  const w = width / 2;
  const d = depth / 2;
  shape.moveTo(-w + radius, -d);
  shape.lineTo(w - radius, -d);
  shape.quadraticCurveTo(w, -d, w, -d + radius);
  shape.lineTo(w, d - radius);
  shape.quadraticCurveTo(w, d, w - radius, d);
  shape.lineTo(-w + radius, d);
  shape.quadraticCurveTo(-w, d, -w, d - radius);
  shape.lineTo(-w, -d + radius);
  shape.quadraticCurveTo(-w, -d, -w + radius, -d);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function gableRoof(width, depth, rise) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2 - 0.1, 0);
  shape.lineTo(width / 2 + 0.1, 0);
  shape.lineTo(0, rise);
  shape.lineTo(-width / 2 - 0.1, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth + 0.2, bevelEnabled: false });
  geometry.translate(0, 0, -(depth + 0.2) / 2);
  return geometry;
}

export function muted(color, amount) {
  return new THREE.Color(color).lerp(new THREE.Color(0xb9c2bb), amount);
}
