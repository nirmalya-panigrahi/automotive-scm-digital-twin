/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

export interface CarMaterialLibrary {
  bodyPaint: THREE.MeshPhysicalMaterial;
  roofBlack: THREE.MeshPhysicalMaterial;
  trimBlack: THREE.MeshStandardMaterial;
  windowSeal: THREE.MeshStandardMaterial;
  seamDark: THREE.MeshStandardMaterial;
  grilleMetal: THREE.MeshStandardMaterial;
  bumperPowderCoat: THREE.MeshStandardMaterial;
  metallicSilver: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  tireRubber: THREE.MeshStandardMaterial;
  alloyBronze: THREE.MeshStandardMaterial;
  brakeDisc: THREE.MeshStandardMaterial;
  brakeCaliper: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  mirrorGlass: THREE.MeshPhysicalMaterial;
  headlightLed: THREE.MeshStandardMaterial;
  headlightLens: THREE.MeshPhysicalMaterial;
  headlightReflector: THREE.MeshStandardMaterial;
  taillightLed: THREE.MeshStandardMaterial;
  taillightLens: THREE.MeshPhysicalMaterial;
  taillightAmber: THREE.MeshStandardMaterial;
  taillightWhite: THREE.MeshStandardMaterial;
  badgeEmblem: THREE.MeshStandardMaterial;
  licensePlate: THREE.MeshStandardMaterial;
  chassisSteel: THREE.MeshStandardMaterial;
  springAccent: THREE.MeshStandardMaterial;
  engineBlock: THREE.MeshStandardMaterial;
  engineCover: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  batteryPack: THREE.MeshStandardMaterial;
  hvOrange: THREE.MeshStandardMaterial;
  wiringCyan: THREE.MeshStandardMaterial;
  exhaustSteel: THREE.MeshStandardMaterial;
  seatLeather: THREE.MeshStandardMaterial;
  dashTrim: THREE.MeshStandardMaterial;
  screenDisplay: THREE.MeshStandardMaterial;
  clusterDisplay: THREE.MeshStandardMaterial;
  adasSensor: THREE.MeshStandardMaterial;
  hvacCore: THREE.MeshStandardMaterial;
  floorGridTexture: THREE.CanvasTexture;
  dispose: () => void;
}

function createFloorGridTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(51, 65, 85, 0.26)';
  ctx.lineWidth = 1;
  const step = size / 8;
  for (let i = 0; i <= 8; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(34, 211, 238, 0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createTireTreadMaps(maxAnisotropy: number): {
  bumpMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const w = 512;
  const h = 256;

  // Height / bump canvas
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = w;
  bumpCanvas.height = h;
  const bCtx = bumpCanvas.getContext('2d')!;

  bCtx.fillStyle = '#383838';
  bCtx.fillRect(0, 0, w, h);

  // Circumferential grooves + staggered all-terrain shoulder/center lugs
  bCtx.fillStyle = '#e5e5e5';
  const pitch = 32;
  for (let x = 0; x < w; x += pitch) {
    // Left shoulder lug (angled)
    bCtx.beginPath();
    bCtx.moveTo(x + 2, 10);
    bCtx.lineTo(x + 20, 10);
    bCtx.lineTo(x + 25, 58);
    bCtx.lineTo(x + 7, 58);
    bCtx.closePath();
    bCtx.fill();

    // Center-left block
    bCtx.fillRect(x + 12, 72, 17, 44);
    // Center-right staggered block
    bCtx.fillRect((x + 26) % w, 140, 17, 44);

    // Right shoulder lug (angled opposite)
    bCtx.beginPath();
    bCtx.moveTo(x + 7, 198);
    bCtx.lineTo(x + 25, 198);
    bCtx.lineTo(x + 20, 246);
    bCtx.lineTo(x + 2, 246);
    bCtx.closePath();
    bCtx.fill();
  }

  // Convert bump heightfield into tangent-space normal map
  const srcData = bCtx.getImageData(0, 0, w, h).data;
  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const nCtx = normCanvas.getContext('2d')!;
  const normImg = nCtx.createImageData(w, h);
  const dst = normImg.data;
  const strength = 2.6;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const ym = Math.max(0, y - 1);
      const yp = Math.min(h - 1, y + 1);

      const hL = srcData[(y * w + xm) * 4] / 255;
      const hR = srcData[(y * w + xp) * 4] / 255;
      const hD = srcData[(ym * w + x) * 4] / 255;
      const hU = srcData[(yp * w + x) * 4] / 255;

      const dx = (hL - hR) * strength;
      const dy = (hD - hU) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((dx * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  nCtx.putImageData(normImg, 0, 0);

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;
  bumpMap.repeat.set(9, 1);
  bumpMap.anisotropy = maxAnisotropy;

  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.ClampToEdgeWrapping;
  normalMap.repeat.set(9, 1);
  normalMap.anisotropy = maxAnisotropy;

  return { bumpMap, normalMap };
}

function createPaintFlakeNormalMap(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let i = 0; i < size * size; i++) {
    // Ultra-subtle metallic micro-flake normal perturbation
    const nx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const ny = (Math.sin(i * 78.233) * 24634.6345) % 1;
    const idx = i * 4;
    d[idx] = 128 + Math.round((nx - 0.5) * 14);
    d[idx + 1] = 128 + Math.round((ny - 0.5) * 14);
    d[idx + 2] = 255;
    d[idx + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createBadgeTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  // Classic heritage dark green oval emblem with silver bezel
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w * 0.45, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#064e3b';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  ctx.fillStyle = '#eab308';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AUTODRIVE', w / 2, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createLicensePlateTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, w, h);

  // Left blue Euro/reg band
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(0, 0, 48, h);

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 54px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T 06 26 KL', w / 2 + 20, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createScreenTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, w - 24, h - 24);

  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 32; x < 300; x += 8) {
    const y = 140 + Math.sin(x * 0.04) * 28 + Math.cos(x * 0.09) * 12;
    if (x === 32) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(400, 128, 52, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(400, 128, 8, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createClusterTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 192;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);

  // Dual digital dial rings
  [128, 384].forEach((cx) => {
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, 96, 62, Math.PI * 0.75, Math.PI * 2.15);
    ctx.stroke();
  });

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('0', 128, 108);
  ctx.fillText('94%', 384, 108);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createCarMaterialLibrary(maxAnisotropy: number, isSoftwareGl: boolean): CarMaterialLibrary {
  const floorGridTexture = createFloorGridTexture(maxAnisotropy);
  const { bumpMap: tireTreadBump, normalMap: tireTreadNormal } = createTireTreadMaps(maxAnisotropy);
  const flakeNormalMap = createPaintFlakeNormalMap(maxAnisotropy);
  const badgeTex = createBadgeTexture(maxAnisotropy);
  const plateTex = createLicensePlateTexture(maxAnisotropy);
  const screenTex = createScreenTexture(maxAnisotropy);
  const clusterTex = createClusterTexture(maxAnisotropy);

  // High-gloss automotive clearcoat metallic paint
  const bodyPaint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#eab308'),
    metalness: 0.42,
    roughness: 0.21,
    clearcoat: 1.0,
    clearcoatRoughness: 0.055,
    ior: 1.52,
    reflectivity: 0.9,
    normalMap: flakeNormalMap,
    normalScale: new THREE.Vector2(0.06, 0.06),
    envMapIntensity: 1.45,
  });

  const roofBlack = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#141820'),
    metalness: 0.35,
    roughness: 0.28,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.3,
  });

  const trimBlack = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#121721'),
    metalness: 0.18,
    roughness: 0.72,
  });

  // High-roughness EPDM window rubber seals
  const windowSeal = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0c0f15'),
    metalness: 0.02,
    roughness: 0.94,
  });

  // Recessed body shutline & panel seam shadow gap
  const seamDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#07090d'),
    metalness: 0.08,
    roughness: 0.96,
  });

  // Metallic front grille mesh & fascia trim
  const grilleMetal = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2a3240'),
    metalness: 0.88,
    roughness: 0.30,
    envMapIntensity: 1.35,
  });

  const bumperPowderCoat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1e242e'),
    metalness: 0.48,
    roughness: 0.45,
    envMapIntensity: 1.1,
  });

  const metallicSilver = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cbd5e1'),
    metalness: 0.92,
    roughness: 0.22,
    envMapIntensity: 1.45,
  });

  const chrome = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f1f5f9'),
    metalness: 0.98,
    roughness: 0.08,
    envMapIntensity: 1.65,
  });

  const tireRubber = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#16181d'),
    metalness: 0.03,
    roughness: 0.90,
    bumpMap: tireTreadBump,
    bumpScale: 0.035,
    normalMap: tireTreadNormal,
    normalScale: new THREE.Vector2(0.85, 0.85),
  });

  const alloyBronze = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b08d42'),
    metalness: 0.92,
    roughness: 0.20,
    envMapIntensity: 1.55,
  });

  const brakeDisc = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cbd5e1'),
    metalness: 0.92,
    roughness: 0.22,
    envMapIntensity: 1.3,
  });

  const brakeCaliper = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#dc2626'),
    metalness: 0.55,
    roughness: 0.30,
  });

  // Transparent reflective automotive glazing
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#a5d8ff'),
    metalness: 0.08,
    roughness: 0.04,
    transparent: true,
    opacity: isSoftwareGl ? 0.36 : 0.34,
    ior: 1.52,
    reflectivity: 0.95,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.85,
    depthWrite: false,
  });

  const mirrorGlass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e2e8f0'),
    metalness: 0.98,
    roughness: 0.03,
    clearcoat: 1.0,
    envMapIntensity: 1.8,
  });

  const headlightLed = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffffff'),
    emissive: new THREE.Color('#e0f2fe'),
    emissiveIntensity: 1.35,
    roughness: 0.12,
    metalness: 0.15,
  });

  const headlightLens = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f0f9ff'),
    transparent: true,
    opacity: 0.35,
    roughness: 0.04,
    metalness: 0.05,
    clearcoat: 1.0,
    envMapIntensity: 1.6,
    depthWrite: false,
  });

  const headlightReflector = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e2e8f0'),
    metalness: 0.96,
    roughness: 0.12,
    envMapIntensity: 1.5,
  });

  const taillightLed = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ef4444'),
    emissive: new THREE.Color('#dc2626'),
    emissiveIntensity: 1.15,
    roughness: 0.2,
    metalness: 0.2,
  });

  const taillightLens = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#991b1b'),
    transparent: true,
    opacity: 0.48,
    roughness: 0.06,
    metalness: 0.05,
    clearcoat: 1.0,
    envMapIntensity: 1.5,
    depthWrite: false,
  });

  const taillightAmber = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f59e0b'),
    emissive: new THREE.Color('#d97706'),
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.25,
  });

  const taillightWhite = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f8fafc'),
    emissive: new THREE.Color('#e2e8f0'),
    emissiveIntensity: 0.45,
    roughness: 0.15,
    metalness: 0.3,
  });

  const badgeEmblem = new THREE.MeshStandardMaterial({
    map: badgeTex,
    metalness: 0.65,
    roughness: 0.24,
  });

  const licensePlate = new THREE.MeshStandardMaterial({
    map: plateTex,
    metalness: 0.15,
    roughness: 0.42,
  });

  const chassisSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#334155'),
    metalness: 0.75,
    roughness: 0.42,
  });

  const springAccent = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#475569'),
    metalness: 0.68,
    roughness: 0.30,
  });

  const engineBlock = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#64748b'),
    metalness: 0.84,
    roughness: 0.36,
  });

  const engineCover = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1e293b'),
    metalness: 0.3,
    roughness: 0.58,
  });

  const copper = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d97706'),
    metalness: 0.92,
    roughness: 0.22,
  });

  const batteryPack = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1e293b'),
    metalness: 0.62,
    roughness: 0.38,
  });

  const hvOrange = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f97316'),
    metalness: 0.2,
    roughness: 0.45,
  });

  const wiringCyan = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0284c7'),
    metalness: 0.25,
    roughness: 0.45,
  });

  const exhaustSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#94a3b8'),
    metalness: 0.90,
    roughness: 0.24,
  });

  const seatLeather = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#27272a'),
    metalness: 0.06,
    roughness: 0.72,
  });

  const dashTrim = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#18181b'),
    metalness: 0.14,
    roughness: 0.64,
  });

  const screenDisplay = new THREE.MeshStandardMaterial({
    map: screenTex,
    emissive: new THREE.Color('#0ea5e9'),
    emissiveMap: screenTex,
    emissiveIntensity: 0.6,
    roughness: 0.18,
    metalness: 0.1,
  });

  const clusterDisplay = new THREE.MeshStandardMaterial({
    map: clusterTex,
    emissive: new THREE.Color('#38bdf8'),
    emissiveMap: clusterTex,
    emissiveIntensity: 0.55,
    roughness: 0.18,
    metalness: 0.1,
  });

  const adasSensor = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0f172a'),
    metalness: 0.78,
    roughness: 0.20,
  });

  const hvacCore = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7c8ea6'),
    metalness: 0.80,
    roughness: 0.32,
  });

  const allMaterials = [
    bodyPaint,
    roofBlack,
    trimBlack,
    windowSeal,
    seamDark,
    grilleMetal,
    bumperPowderCoat,
    metallicSilver,
    chrome,
    tireRubber,
    alloyBronze,
    brakeDisc,
    brakeCaliper,
    glass,
    mirrorGlass,
    headlightLed,
    headlightLens,
    headlightReflector,
    taillightLed,
    taillightLens,
    taillightAmber,
    taillightWhite,
    badgeEmblem,
    licensePlate,
    chassisSteel,
    springAccent,
    engineBlock,
    engineCover,
    copper,
    batteryPack,
    hvOrange,
    wiringCyan,
    exhaustSteel,
    seatLeather,
    dashTrim,
    screenDisplay,
    clusterDisplay,
    adasSensor,
    hvacCore,
  ];

  const dispose = () => {
    allMaterials.forEach((m) => m.dispose());
    floorGridTexture.dispose();
    tireTreadBump.dispose();
    tireTreadNormal.dispose();
    flakeNormalMap.dispose();
    badgeTex.dispose();
    plateTex.dispose();
    screenTex.dispose();
    clusterTex.dispose();
  };

  return {
    bodyPaint,
    roofBlack,
    trimBlack,
    windowSeal,
    seamDark,
    grilleMetal,
    bumperPowderCoat,
    metallicSilver,
    chrome,
    tireRubber,
    alloyBronze,
    brakeDisc,
    brakeCaliper,
    glass,
    mirrorGlass,
    headlightLed,
    headlightLens,
    headlightReflector,
    taillightLed,
    taillightLens,
    taillightAmber,
    taillightWhite,
    badgeEmblem,
    licensePlate,
    chassisSteel,
    springAccent,
    engineBlock,
    engineCover,
    copper,
    batteryPack,
    hvOrange,
    wiringCyan,
    exhaustSteel,
    seatLeather,
    dashTrim,
    screenDisplay,
    clusterDisplay,
    adasSensor,
    hvacCore,
    floorGridTexture,
    dispose,
  };
}
