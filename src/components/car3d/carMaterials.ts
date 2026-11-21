/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

export interface CarMaterialLibrary {
  bodyPaint: THREE.MeshPhysicalMaterial;
  roofBlack: THREE.MeshStandardMaterial;
  trimBlack: THREE.MeshStandardMaterial;
  metallicSilver: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  tireRubber: THREE.MeshStandardMaterial;
  alloyBronze: THREE.MeshStandardMaterial;
  brakeDisc: THREE.MeshStandardMaterial;
  brakeCaliper: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  headlightLed: THREE.MeshStandardMaterial;
  taillightLed: THREE.MeshStandardMaterial;
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
  adasSensor: THREE.MeshStandardMaterial;
  hvacCore: THREE.MeshStandardMaterial;
  floorGridTexture: THREE.CanvasTexture;
  tireTreadBump: THREE.CanvasTexture;
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

  // Subtle sub-grid
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
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

  // Primary tile border
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

function createTireTreadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#404040';
  ctx.fillRect(0, 0, w, h);

  // All-terrain knobby tread blocks
  ctx.fillStyle = '#d4d4d4';
  for (let x = 0; x < w; x += 24) {
    ctx.fillRect(x + 2, 6, 16, 26);
    ctx.fillRect(x + 10, 44, 16, 40);
    ctx.fillRect(x + 2, 96, 16, 26);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 1);
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

  // Subtle dashboard UI grid
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, w - 24, h - 24);

  // Telemetry wave
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 32; x < 300; x += 8) {
    const y = 140 + Math.sin(x * 0.04) * 28 + Math.cos(x * 0.09) * 12;
    if (x === 32) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Map/Nav ring on right
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

export function createCarMaterialLibrary(maxAnisotropy: number, isSoftwareGl: boolean): CarMaterialLibrary {
  const floorGridTexture = createFloorGridTexture(maxAnisotropy);
  const tireTreadBump = createTireTreadTexture(maxAnisotropy);
  const screenTex = createScreenTexture(maxAnisotropy);

  // Troy Yellow metallic clearcoat inspired by Land Rover Defender 110
  const bodyPaint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#eab308'),
    metalness: 0.35,
    roughness: 0.28,
    clearcoat: 0.9,
    clearcoatRoughness: 0.14,
  });

  const roofBlack = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#181c24'),
    metalness: 0.25,
    roughness: 0.55,
  });

  const trimBlack = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#111620'),
    metalness: 0.15,
    roughness: 0.78,
  });

  const metallicSilver = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#94a3b8'),
    metalness: 0.85,
    roughness: 0.28,
  });

  const chrome = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e2e8f0'),
    metalness: 0.96,
    roughness: 0.12,
  });

  const tireRubber = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#17191f'),
    metalness: 0.04,
    roughness: 0.88,
    bumpMap: tireTreadBump,
    bumpScale: 0.03,
  });

  const alloyBronze = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#a17f3a'),
    metalness: 0.82,
    roughness: 0.3,
  });

  const brakeDisc = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cbd5e1'),
    metalness: 0.9,
    roughness: 0.24,
  });

  const brakeCaliper = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#dc2626'),
    metalness: 0.45,
    roughness: 0.35,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#93c5fd'),
    metalness: 0.05,
    roughness: 0.08,
    transparent: true,
    opacity: isSoftwareGl ? 0.38 : 0.42,
    ior: 1.52,
    depthWrite: false,
  });

  const headlightLed = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f8fafc'),
    emissive: new THREE.Color('#bae6fd'),
    emissiveIntensity: 0.9,
    roughness: 0.15,
    metalness: 0.2,
  });

  const taillightLed = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ef4444'),
    emissive: new THREE.Color('#dc2626'),
    emissiveIntensity: 0.8,
    roughness: 0.2,
    metalness: 0.2,
  });

  const chassisSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#334155'),
    metalness: 0.72,
    roughness: 0.45,
  });

  const springAccent = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#475569'),
    metalness: 0.65,
    roughness: 0.32,
  });

  const engineBlock = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#64748b'),
    metalness: 0.82,
    roughness: 0.38,
  });

  const engineCover = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1e293b'),
    metalness: 0.3,
    roughness: 0.6,
  });

  const copper = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d97706'),
    metalness: 0.9,
    roughness: 0.24,
  });

  const batteryPack = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1e293b'),
    metalness: 0.6,
    roughness: 0.4,
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
    metalness: 0.88,
    roughness: 0.26,
  });

  const seatLeather = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#27272a'),
    metalness: 0.08,
    roughness: 0.72,
  });

  const dashTrim = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#18181b'),
    metalness: 0.15,
    roughness: 0.65,
  });

  const screenDisplay = new THREE.MeshStandardMaterial({
    map: screenTex,
    emissive: new THREE.Color('#0ea5e9'),
    emissiveMap: screenTex,
    emissiveIntensity: 0.55,
    roughness: 0.2,
    metalness: 0.1,
  });

  const adasSensor = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0f172a'),
    metalness: 0.75,
    roughness: 0.22,
  });

  const hvacCore = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7c8ea6'),
    metalness: 0.78,
    roughness: 0.34,
  });

  const allMaterials = [
    bodyPaint,
    roofBlack,
    trimBlack,
    metallicSilver,
    chrome,
    tireRubber,
    alloyBronze,
    brakeDisc,
    brakeCaliper,
    glass,
    headlightLed,
    taillightLed,
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
    adasSensor,
    hvacCore,
  ];

  const dispose = () => {
    allMaterials.forEach((m) => m.dispose());
    floorGridTexture.dispose();
    tireTreadBump.dispose();
    screenTex.dispose();
  };

  return {
    bodyPaint,
    roofBlack,
    trimBlack,
    metallicSilver,
    chrome,
    tireRubber,
    alloyBronze,
    brakeDisc,
    brakeCaliper,
    glass,
    headlightLed,
    taillightLed,
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
    adasSensor,
    hvacCore,
    floorGridTexture,
    tireTreadBump,
    dispose,
  };
}
