/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CarMaterialLibrary } from './carMaterials';

export interface CarComponentAssembly {
  id: string;
  group: THREE.Group;
  isInternal: boolean;
  focusTarget: THREE.Vector3;
  cameraOffset: THREE.Vector3;
  explodeParts: Array<{
    object: THREE.Object3D;
    basePos: THREE.Vector3;
    explodeDelta: THREE.Vector3;
  }>;
}

export interface DefenderModelHandle {
  root: THREE.Group;
  components: Map<string, CarComponentAssembly>;
  clickableMeshes: THREE.Mesh[];
  dispose: () => void;
}

function registerMeshMaterial(
  mesh: THREE.Mesh,
  baseMat: THREE.Material,
  componentId: string,
  ownedMaterials: THREE.Material[],
  clickableMeshes: THREE.Mesh[],
  castShadow = true,
  receiveShadow = true,
  ghostableOverride?: boolean
) {
  const mat = baseMat.clone();
  ownedMaterials.push(mat);
  mesh.material = mat;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.userData.componentId = componentId;
  mesh.userData.isGhostable =
    ghostableOverride !== undefined
      ? ghostableOverride
      : componentId === 'biw-1' || componentId === 'gls-1';

  const stdMat = mat as THREE.MeshStandardMaterial;
  mesh.userData.baseColorHex = stdMat.color ? stdMat.color.getHex() : 0xffffff;
  mesh.userData.baseEmissiveHex = stdMat.emissive ? stdMat.emissive.getHex() : 0x000000;
  mesh.userData.baseEmissiveIntensity = stdMat.emissiveIntensity ?? 0;
  mesh.userData.baseOpacity = mat.opacity;
  mesh.userData.baseTransparent = mat.transparent;
  mesh.userData.baseDepthWrite = mat.depthWrite;

  clickableMeshes.push(mesh);
}

/**
 * Smooth beveled rounded-rectangle extrusion with high curve & bevel resolution.
 */
function createSmoothExtrudedBox(
  w: number,
  h: number,
  d: number,
  radius: number,
  bevel = 0.025,
  curveSegments = 16,
  bevelSegments = 5
): THREE.ExtrudeGeometry {
  const r = Math.min(radius, w * 0.45, h * 0.45);
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -h / 2);
  shape.lineTo(hw, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh);
  shape.lineTo(w / 2, hh);
  shape.quadraticCurveTo(w / 2, h / 2, hw, h / 2);
  shape.lineTo(-hw, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh);
  shape.lineTo(-w / 2, -hh);
  shape.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, d - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a smooth sculpted solid panel (closed top + bottom + perimeter skirt)
 * from a parametric height surface for aerodynamic hood and roof panels.
 */
function createSculptedShellPanel(
  width: number,
  length: number,
  thickness: number,
  segX: number,
  segZ: number,
  heightFn: (nx: number, nz: number) => number
): THREE.BufferGeometry {
  const cols = segX + 1;
  const rows = segZ + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Top & bottom surface vertices
  for (let layer = 0; layer < 2; layer++) {
    const yOff = layer === 0 ? 0 : -thickness;
    for (let iz = 0; iz <= segZ; iz++) {
      const vz = iz / segZ;
      const nz = vz * 2 - 1; // -1 (rear) to +1 (front)
      const z = nz * (length / 2);
      for (let ix = 0; ix <= segX; ix++) {
        const ux = ix / segX;
        const nx = ux * 2 - 1; // -1 (left) to +1 (right)
        const x = nx * (width / 2);
        const edgeRound = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(nx), 4)), 0.35);
        const y = heightFn(nx, nz) + (layer === 0 ? 0 : yOff * edgeRound - 0.01);
        positions.push(x, y, z);
        uvs.push(ux, vz);
      }
    }
  }

  const stride = cols * rows;
  // Top triangles
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Bottom triangles (reversed winding)
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = stride + iz * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // Perimeter skirt stitching
  for (let ix = 0; ix < segX; ix++) {
    // Rear edge (iz = 0)
    const t0 = ix;
    const t1 = ix + 1;
    const b0 = stride + ix;
    const b1 = stride + ix + 1;
    indices.push(t0, t1, b0, t1, b1, b0);

    // Front edge (iz = segZ)
    const ft0 = segZ * cols + ix;
    const ft1 = ft0 + 1;
    const fb0 = stride + ft0;
    const fb1 = stride + ft1;
    indices.push(ft0, fb0, ft1, ft1, fb0, fb1);
  }
  for (let iz = 0; iz < segZ; iz++) {
    // Left edge (ix = 0)
    const lt0 = iz * cols;
    const lt1 = (iz + 1) * cols;
    const lb0 = stride + lt0;
    const lb1 = stride + lt1;
    indices.push(lt0, lb0, lt1, lt1, lb0, lb1);

    // Right edge (ix = segX)
    const rt0 = iz * cols + segX;
    const rt1 = (iz + 1) * cols + segX;
    const rb0 = stride + rt0;
    const rb1 = stride + rt1;
    indices.push(rt0, rt1, rb0, rt1, rb1, rb0);
  }

  const rawGeo = new THREE.BufferGeometry();
  rawGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  rawGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  rawGeo.setIndex(indices);
  rawGeo.computeVertexNormals();
  return rawGeo;
}

/**
 * Builds a high-poly lathed tire carcass with rounded sidewall shoulders.
 */
function createProfiledTireGeometry(outerRadius: number, width: number): THREE.LatheGeometry {
  const hw = width / 2;
  const innerR = outerRadius * 0.58;
  const shoulderR = outerRadius * 0.96;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(innerR, -hw * 0.82),
    new THREE.Vector2(innerR + 0.04, -hw * 0.98),
    new THREE.Vector2(outerRadius * 0.82, -hw),
    new THREE.Vector2(shoulderR, -hw * 0.90),
    new THREE.Vector2(outerRadius, -hw * 0.70),
    new THREE.Vector2(outerRadius, 0),
    new THREE.Vector2(outerRadius, hw * 0.70),
    new THREE.Vector2(shoulderR, hw * 0.90),
    new THREE.Vector2(outerRadius * 0.82, hw),
    new THREE.Vector2(innerR + 0.04, hw * 0.98),
    new THREE.Vector2(innerR, hw * 0.82),
  ];
  const geo = new THREE.LatheGeometry(pts, 56);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a sculpted metallic wheel rim barrel with stepped lip & central hub dish.
 */
function createAlloyBarrelGeometry(rimRadius: number, width: number): THREE.LatheGeometry {
  const hw = width * 0.44;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(rimRadius * 0.35, -hw * 0.5),
    new THREE.Vector2(rimRadius * 0.86, -hw * 0.75),
    new THREE.Vector2(rimRadius, -hw),
    new THREE.Vector2(rimRadius, hw),
    new THREE.Vector2(rimRadius * 0.88, hw * 0.92),
    new THREE.Vector2(rimRadius * 0.84, hw * 0.52),
    new THREE.Vector2(rimRadius * 0.32, hw * 0.45),
    new THREE.Vector2(0.01, hw * 0.42),
  ];
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createCoilSpringGeometry(
  radius: number,
  height: number,
  turns: number,
  wireRadius: number
): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const samples = turns * 20;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const angle = t * turns * Math.PI * 2;
    pts.push(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        (t - 0.5) * height,
        Math.sin(angle) * radius
      )
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, samples, wireRadius, 10, false);
  geo.computeVertexNormals();
  return geo;
}

export function buildDefenderModel(mats: CarMaterialLibrary): DefenderModelHandle {
  const root = new THREE.Group();
  root.name = 'DefenderDigitalTwin';

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const clickableMeshes: THREE.Mesh[] = [];
  const components = new Map<string, CarComponentAssembly>();

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeometries.push(g);
    return g;
  };

  const makeAssembly = (
    id: string,
    isInternal: boolean,
    focusTarget: THREE.Vector3,
    cameraOffset: THREE.Vector3
  ): CarComponentAssembly => {
    const group = new THREE.Group();
    group.name = `component-${id}`;
    root.add(group);
    const assembly: CarComponentAssembly = {
      id,
      group,
      isInternal,
      focusTarget,
      cameraOffset,
      explodeParts: [],
    };
    components.set(id, assembly);
    return assembly;
  };

  const addExplodePart = (
    assembly: CarComponentAssembly,
    obj: THREE.Object3D,
    delta: THREE.Vector3
  ) => {
    assembly.explodeParts.push({
      object: obj,
      basePos: obj.position.clone(),
      explodeDelta: delta,
    });
  };

  const wheelY = 0.42;
  const frontZ = 1.44;
  const rearZ = -1.42;
  const trackX = 0.90;

  // =========================================================================
  // 1. BODY IN WHITE (BIW) - 'biw-1'
  // =========================================================================
  const biw = makeAssembly(
    'biw-1',
    false,
    new THREE.Vector3(0, 1.05, 0),
    new THREE.Vector3(4.2, 2.2, 4.4)
  );

  // Smoothly contoured lower quarter body panels (tumblehome curvature + beveled edges)
  const lowerQuarterGeo = trackGeo(createSmoothExtrudedBox(0.15, 0.56, 4.26, 0.06, 0.028, 20, 6));
  [-0.86, 0.86].forEach((xPos) => {
    const sideGrp = new THREE.Group();
    sideGrp.position.set(xPos, 0.87, -0.04);

    const side = new THREE.Mesh(lowerQuarterGeo);
    side.rotation.z = xPos > 0 ? 0.05 : -0.05; // Subtle organic tumblehome angle
    registerMeshMaterial(side, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    sideGrp.add(side);

    // Lower rocker sill cladding
    const sillGeo = trackGeo(createSmoothExtrudedBox(0.16, 0.11, 2.15, 0.03, 0.015, 12, 4));
    const sill = new THREE.Mesh(sillGeo);
    sill.position.set(xPos > 0 ? 0.01 : -0.01, -0.27, 0.02);
    registerMeshMaterial(sill, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    sideGrp.add(sill);

    biw.group.add(sideGrp);
    addExplodePart(biw, sideGrp, new THREE.Vector3(xPos > 0 ? 0.35 : -0.35, 0.35, 0));
  });

  // Sculpted Aerodynamic Clamshell Hood / Bonnet (32x24 high-poly surface + shutline seams)
  const hoodGroup = new THREE.Group();
  hoodGroup.position.set(0, 1.25, 1.44);

  const sculptedHoodGeo = trackGeo(
    createSculptedShellPanel(1.66, 1.38, 0.07, 32, 24, (nx, nz) => {
      // Gentle forward slope + crowned center power dome + chamfered outer shoulders
      const slope = -nz * 0.042;
      const crown = (1 - nx * nx) * 0.042;
      const noseDrop = nz > 0.55 ? -Math.pow((nz - 0.55) / 0.45, 2) * 0.055 : 0;
      const shoulderStep = Math.abs(nx) < 0.54 ? 0.016 * Math.cos((nx / 0.54) * (Math.PI / 2)) : 0;
      return slope + crown + noseDrop + shoulderStep;
    })
  );
  const hoodMesh = new THREE.Mesh(sculptedHoodGeo);
  registerMeshMaterial(hoodMesh, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
  hoodGroup.add(hoodMesh);

  // Raised matte black center hood power-bulge accent + side intake vents
  const hoodVentGeo = trackGeo(createSmoothExtrudedBox(0.80, 0.028, 0.88, 0.05, 0.01, 16, 4));
  const hoodVent = new THREE.Mesh(hoodVentGeo);
  hoodVent.position.set(0, 0.054, -0.04);
  hoodVent.rotation.x = 0.05;
  registerMeshMaterial(hoodVent, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
  hoodGroup.add(hoodVent);

  // Hood Shutlines / Panel Seams (left, right, and front cowl gap strips)
  const hoodSeamSideGeo = trackGeo(new THREE.BoxGeometry(0.012, 0.015, 1.34));
  [-0.825, 0.825].forEach((sx) => {
    const seam = new THREE.Mesh(hoodSeamSideGeo);
    seam.position.set(sx, 0.005, 0);
    seam.rotation.x = 0.042;
    registerMeshMaterial(seam, mats.seamDark, 'biw-1', ownedMaterials, clickableMeshes, false, false);
    hoodGroup.add(seam);
  });
  const hoodFrontSeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.64, 0.014, 0.012)));
  hoodFrontSeam.position.set(0, -0.055, 0.685);
  registerMeshMaterial(hoodFrontSeam, mats.seamDark, 'biw-1', ownedMaterials, clickableMeshes, false, false);
  hoodGroup.add(hoodFrontSeam);

  biw.group.add(hoodGroup);
  addExplodePart(biw, hoodGroup, new THREE.Vector3(0, 0.95, 0.25));

  // Smooth Rounded Front Fenders (Left & Right)
  const fenderGeo = trackGeo(createSmoothExtrudedBox(0.18, 0.50, 1.42, 0.06, 0.025, 18, 5));
  [-0.85, 0.85].forEach((xPos) => {
    const fender = new THREE.Mesh(fenderGeo);
    fender.position.set(xPos, 0.99, 1.42);
    fender.rotation.z = xPos > 0 ? 0.04 : -0.04;
    registerMeshMaterial(fender, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(fender);
    addExplodePart(biw, fender, new THREE.Vector3(xPos > 0 ? 0.45 : -0.45, 0.4, 0.1));
  });

  // High-Poly Smooth Wheel Arch Flares (48 arc segments, 6 bevel segments)
  const archShape = new THREE.Shape();
  archShape.absarc(0, 0, 0.565, -0.06, Math.PI + 0.06, false);
  archShape.absarc(0, 0, 0.465, Math.PI + 0.06, -0.06, true);
  const archGeo = trackGeo(
    new THREE.ExtrudeGeometry(archShape, {
      depth: 0.13,
      bevelEnabled: true,
      bevelThickness: 0.022,
      bevelSize: 0.02,
      bevelSegments: 6,
      curveSegments: 48,
    })
  );
  archGeo.center();
  archGeo.rotateY(Math.PI / 2);
  archGeo.computeVertexNormals();

  [
    [-0.935, frontZ],
    [0.935, frontZ],
    [-0.935, rearZ],
    [0.935, rearZ],
  ].forEach(([x, z]) => {
    const arch = new THREE.Mesh(archGeo);
    arch.position.set(x, 0.64, z);
    registerMeshMaterial(arch, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(arch);
    addExplodePart(biw, arch, new THREE.Vector3(x > 0 ? 0.55 : -0.55, 0.28, 0));
  });

  // 4 Sculpted Side Doors with recessed shutline seams, recessed door handles, and mirrors with glass inserts
  const doorGeo = trackGeo(createSmoothExtrudedBox(0.10, 0.61, 0.94, 0.04, 0.02, 16, 5));
  const doorSeamVGeo = trackGeo(new THREE.BoxGeometry(0.018, 0.60, 0.012));
  const handlePocketGeo = trackGeo(createSmoothExtrudedBox(0.028, 0.065, 0.17, 0.012, 0.004, 8, 2));
  const handleGripGeo = trackGeo(createSmoothExtrudedBox(0.036, 0.026, 0.14, 0.008, 0.005, 8, 2));
  const doorFrameTopGeo = trackGeo(createSmoothExtrudedBox(0.06, 0.48, 0.075, 0.02, 0.01, 10, 3));

  [
    { x: -0.89, z: 0.36, side: -1, front: true },
    { x: 0.89, z: 0.36, side: 1, front: true },
    { x: -0.89, z: -0.66, side: -1, front: false },
    { x: 0.89, z: -0.66, side: 1, front: false },
  ].forEach((d) => {
    const doorGrp = new THREE.Group();
    doorGrp.position.set(d.x, 0.96, d.z);

    const doorPanel = new THREE.Mesh(doorGeo);
    doorPanel.rotation.z = d.side * 0.04;
    registerMeshMaterial(doorPanel, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    doorGrp.add(doorPanel);

    // Door seam grooves (front & rear vertical shutlines)
    [-0.475, 0.475].forEach((sz) => {
      const seam = new THREE.Mesh(doorSeamVGeo);
      seam.position.set(d.side * 0.052, 0, sz);
      registerMeshMaterial(seam, mats.seamDark, 'biw-1', ownedMaterials, clickableMeshes, false, false);
      doorGrp.add(seam);
    });

    // Recessed door handle pocket + flush-pull metallic/black grip bar
    const pocket = new THREE.Mesh(handlePocketGeo);
    pocket.position.set(d.side * 0.044, 0.14, -0.30);
    registerMeshMaterial(pocket, mats.seamDark, 'biw-1', ownedMaterials, clickableMeshes, false, true);
    doorGrp.add(pocket);

    const grip = new THREE.Mesh(handleGripGeo);
    grip.position.set(d.side * 0.058, 0.14, -0.30);
    registerMeshMaterial(grip, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    doorGrp.add(grip);

    // Side Mirror with Arm Stalk, Aerodynamic Shell & Reflective Glass Insert
    if (d.front) {
      const mirrorGrp = new THREE.Group();
      mirrorGrp.position.set(d.side * 0.12, 0.35, 0.35);

      const stalkGeo = trackGeo(createSmoothExtrudedBox(0.11, 0.045, 0.055, 0.012, 0.008, 8, 3));
      const stalk = new THREE.Mesh(stalkGeo);
      stalk.position.set(-d.side * 0.04, -0.02, 0);
      stalk.rotation.z = d.side * 0.25;
      registerMeshMaterial(stalk, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
      mirrorGrp.add(stalk);

      const capGeo = trackGeo(createSmoothExtrudedBox(0.17, 0.125, 0.105, 0.035, 0.018, 16, 4));
      const cap = new THREE.Mesh(capGeo);
      cap.position.set(d.side * 0.03, 0.02, 0.01);
      registerMeshMaterial(cap, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
      mirrorGrp.add(cap);

      // Actual recessed reflective mirror glass facing rear (-Z)
      const mGlassGeo = trackGeo(new THREE.PlaneGeometry(0.135, 0.092));
      const mGlass = new THREE.Mesh(mGlassGeo);
      mGlass.position.set(d.side * 0.03, 0.02, -0.044);
      mGlass.rotation.y = Math.PI;
      registerMeshMaterial(mGlass, mats.mirrorGlass, 'biw-1', ownedMaterials, clickableMeshes, false, false);
      mirrorGrp.add(mGlass);

      doorGrp.add(mirrorGrp);
    }

    const post = new THREE.Mesh(doorFrameTopGeo);
    post.position.set(0, 0.52, -0.44);
    registerMeshMaterial(post, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
    doorGrp.add(post);

    biw.group.add(doorGrp);
    addExplodePart(biw, doorGrp, new THREE.Vector3(d.side * 0.72, 0.25, d.front ? 0.12 : -0.12));
  });

  // Fuel Filler Door on Right-Rear Quarter Panel
  const fuelGrp = new THREE.Group();
  fuelGrp.position.set(0.922, 1.03, -1.62);
  const fuelSeamGeo = trackGeo(createSmoothExtrudedBox(0.014, 0.155, 0.165, 0.035, 0.004, 12, 2));
  const fuelSeam = new THREE.Mesh(fuelSeamGeo);
  registerMeshMaterial(fuelSeam, mats.seamDark, 'biw-1', ownedMaterials, clickableMeshes, false, false);
  fuelGrp.add(fuelSeam);
  const fuelFlapGeo = trackGeo(createSmoothExtrudedBox(0.018, 0.135, 0.145, 0.03, 0.005, 12, 3));
  const fuelFlap = new THREE.Mesh(fuelFlapGeo);
  fuelFlap.position.x = 0.004;
  registerMeshMaterial(fuelFlap, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
  fuelGrp.add(fuelFlap);
  biw.group.add(fuelGrp);
  addExplodePart(biw, fuelGrp, new THREE.Vector3(0.35, 0.35, 0));

  // Cabin Pillars (A, B, C, D pillars)
  const aPillarGeo = trackGeo(createSmoothExtrudedBox(0.09, 0.64, 0.11, 0.025, 0.012, 10, 3));
  [-0.78, 0.78].forEach((x) => {
    const aPillar = new THREE.Mesh(aPillarGeo);
    aPillar.position.set(x, 1.54, 0.66);
    aPillar.rotation.x = -0.36;
    registerMeshMaterial(aPillar, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(aPillar);
    addExplodePart(biw, aPillar, new THREE.Vector3(0, 0.55, 0));

    const dPillar = new THREE.Mesh(trackGeo(createSmoothExtrudedBox(0.14, 0.62, 0.36, 0.04, 0.018, 14, 4)));
    dPillar.position.set(x, 1.54, -1.94);
    registerMeshMaterial(dPillar, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(dPillar);
    addExplodePart(biw, dPillar, new THREE.Vector3(0, 0.55, 0));
  });

  // Side Gear Storage Box (right rear quarter)
  const gearBoxGeo = trackGeo(createSmoothExtrudedBox(0.18, 0.38, 0.52, 0.05, 0.018, 16, 4));
  const gearBox = new THREE.Mesh(gearBoxGeo);
  gearBox.position.set(0.98, 1.48, -1.42);
  registerMeshMaterial(gearBox, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
  biw.group.add(gearBox);
  addExplodePart(biw, gearBox, new THREE.Vector3(0.85, 0.65, -0.2));

  // Rear Tailgate + Multi-Layer Tail-Light Lenses with Reflectors + Badge + Plate
  const tailgateGroup = new THREE.Group();
  tailgateGroup.position.set(0, 1.12, -2.14);
  const tailgateGeo = trackGeo(createSmoothExtrudedBox(1.64, 0.96, 0.14, 0.06, 0.022, 18, 5));
  const tailgate = new THREE.Mesh(tailgateGeo);
  registerMeshMaterial(tailgate, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
  tailgateGroup.add(tailgate);

  // Rear Badge Emblem & Rear License Plate
  const rearBadgeGeo = trackGeo(new THREE.BoxGeometry(0.13, 0.065, 0.02));
  const rearBadge = new THREE.Mesh(rearBadgeGeo);
  rearBadge.position.set(-0.56, 0.24, -0.072);
  rearBadge.rotation.y = Math.PI;
  registerMeshMaterial(rearBadge, mats.badgeEmblem, 'biw-1', ownedMaterials, clickableMeshes, false, true);
  tailgateGroup.add(rearBadge);

  const rearPlateGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.105, 0.018));
  const rearPlate = new THREE.Mesh(rearPlateGeo);
  rearPlate.position.set(-0.48, -0.28, -0.072);
  rearPlate.rotation.y = Math.PI;
  registerMeshMaterial(rearPlate, mats.licensePlate, 'biw-1', ownedMaterials, clickableMeshes, false, true);
  tailgateGroup.add(rearPlate);

  // Detailed Recessed Tail-Light Clusters (outer smoked lens + internal LED signature + amber/white reflectors)
  const tlPocketGeo = trackGeo(createSmoothExtrudedBox(0.15, 0.36, 0.06, 0.025, 0.008, 10, 3));
  const tlLedSqGeo = trackGeo(new THREE.TorusGeometry(0.036, 0.009, 8, 16));
  const tlBarGeo = trackGeo(new THREE.BoxGeometry(0.08, 0.028, 0.02));
  const tlLensCoverGeo = trackGeo(createSmoothExtrudedBox(0.14, 0.34, 0.018, 0.02, 0.005, 10, 2));

  [-0.71, 0.71].forEach((x) => {
    const tlGrp = new THREE.Group();
    tlGrp.position.set(x, 0.04, -0.06);

    const pocket = new THREE.Mesh(tlPocketGeo);
    registerMeshMaterial(pocket, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    tlGrp.add(pocket);

    // Twin stacked internal LED reflector rings
    [0.085, -0.02].forEach((ly) => {
      const ledSq = new THREE.Mesh(tlLedSqGeo);
      ledSq.position.set(0, ly, -0.024);
      registerMeshMaterial(ledSq, mats.taillightLed, 'biw-1', ownedMaterials, clickableMeshes, false, false);
      tlGrp.add(ledSq);
    });

    // Amber turn bar & white reverse reflector
    const amber = new THREE.Mesh(tlBarGeo);
    amber.position.set(0, -0.10, -0.024);
    registerMeshMaterial(amber, mats.taillightAmber, 'biw-1', ownedMaterials, clickableMeshes, false, false);
    tlGrp.add(amber);

    const rev = new THREE.Mesh(tlBarGeo);
    rev.position.set(0, -0.138, -0.024);
    registerMeshMaterial(rev, mats.taillightWhite, 'biw-1', ownedMaterials, clickableMeshes, false, false);
    tlGrp.add(rev);

    // Outer transparent smoked lens
    const lens = new THREE.Mesh(tlLensCoverGeo);
    lens.position.set(0, 0, -0.036);
    registerMeshMaterial(lens, mats.taillightLens, 'biw-1', ownedMaterials, clickableMeshes, false, false);
    tlGrp.add(lens);

    tailgateGroup.add(tlGrp);
  });

  biw.group.add(tailgateGroup);
  addExplodePart(biw, tailgateGroup, new THREE.Vector3(0, 0.35, -0.65));

  // Smooth Sculpted Arched Roof Panel (28x24 high-poly surface)
  const sculptedRoofGeo = trackGeo(
    createSculptedShellPanel(1.62, 2.74, 0.065, 28, 24, (nx, nz) => {
      const archX = (1 - nx * nx) * 0.038;
      const archZ = (1 - nz * nz) * 0.022;
      return archX + archZ;
    })
  );
  const roofMesh = new THREE.Mesh(sculptedRoofGeo);
  roofMesh.position.set(0, 1.84, -0.78);
  registerMeshMaterial(roofMesh, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
  biw.group.add(roofMesh);
  addExplodePart(biw, roofMesh, new THREE.Vector3(0, 1.05, 0));

  // Expedition Roof Rack Assembly (casts detailed shadows onto the roof below!)
  const rackGroup = new THREE.Group();
  rackGroup.position.set(0, 1.94, -0.82);
  const rackRailGeo = trackGeo(new THREE.CylinderGeometry(0.024, 0.024, 2.52, 16));
  rackRailGeo.rotateX(Math.PI / 2);
  const rackFootGeo = trackGeo(new THREE.BoxGeometry(0.04, 0.075, 0.09));
  [-0.72, 0.72].forEach((x) => {
    const rail = new THREE.Mesh(rackRailGeo);
    rail.position.set(x, 0.045, 0);
    registerMeshMaterial(rail, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    rackGroup.add(rail);

    [-0.95, 0, 0.95].forEach((fz) => {
      const foot = new THREE.Mesh(rackFootGeo);
      foot.position.set(x, 0.0, fz);
      registerMeshMaterial(foot, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
      rackGroup.add(foot);
    });
  });
  const rackCrossGeo = trackGeo(new THREE.CylinderGeometry(0.017, 0.017, 1.44, 12));
  rackCrossGeo.rotateZ(Math.PI / 2);
  for (let i = -5; i <= 5; i++) {
    const cross = new THREE.Mesh(rackCrossGeo);
    cross.position.set(0, 0.03, i * 0.23);
    registerMeshMaterial(cross, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    rackGroup.add(cross);
  }
  biw.group.add(rackGroup);
  addExplodePart(biw, rackGroup, new THREE.Vector3(0, 1.48, 0));

  // =========================================================================
  // 2. LAMINATED WINDSHIELD, GLAZING & RUBBER SEALS - 'gls-1'
  // =========================================================================
  const gls = makeAssembly(
    'gls-1',
    false,
    new THREE.Vector3(0, 1.52, 0.45),
    new THREE.Vector3(3.4, 2.1, 3.6)
  );

  // Front Windshield + EPDM Rubber Perimeter Seal
  const wsGrp = new THREE.Group();
  wsGrp.position.set(0, 1.54, 0.68);
  wsGrp.rotation.x = -0.36;

  const windshieldGeo = trackGeo(new THREE.BoxGeometry(1.46, 0.62, 0.025));
  const windshield = new THREE.Mesh(windshieldGeo);
  registerMeshMaterial(windshield, mats.glass, 'gls-1', ownedMaterials, clickableMeshes, false, false);
  wsGrp.add(windshield);

  const wsSealTopBottomGeo = trackGeo(new THREE.BoxGeometry(1.50, 0.032, 0.038));
  const wsSealSideGeo = trackGeo(new THREE.BoxGeometry(0.032, 0.65, 0.038));
  [-0.315, 0.315].forEach((sy) => {
    const seal = new THREE.Mesh(wsSealTopBottomGeo);
    seal.position.y = sy;
    registerMeshMaterial(seal, mats.windowSeal, 'gls-1', ownedMaterials, clickableMeshes);
    wsGrp.add(seal);
  });
  [-0.735, 0.735].forEach((sx) => {
    const seal = new THREE.Mesh(wsSealSideGeo);
    seal.position.x = sx;
    registerMeshMaterial(seal, mats.windowSeal, 'gls-1', ownedMaterials, clickableMeshes);
    wsGrp.add(seal);
  });
  gls.group.add(wsGrp);
  addExplodePart(gls, wsGrp, new THREE.Vector3(0, 0.95, 0.35));

  // Side Windows + Rubber Seals
  const sideGlassGeo = trackGeo(new THREE.BoxGeometry(0.022, 0.45, 2.46));
  const sideSealTopGeo = trackGeo(new THREE.BoxGeometry(0.035, 0.028, 2.50));
  [-0.82, 0.82].forEach((x) => {
    const sgGrp = new THREE.Group();
    sgGrp.position.set(x, 1.54, -0.68);

    const sg = new THREE.Mesh(sideGlassGeo);
    registerMeshMaterial(sg, mats.glass, 'gls-1', ownedMaterials, clickableMeshes, false, false);
    sgGrp.add(sg);

    [-0.23, 0.23].forEach((sy) => {
      const seal = new THREE.Mesh(sideSealTopGeo);
      seal.position.y = sy;
      registerMeshMaterial(seal, mats.windowSeal, 'gls-1', ownedMaterials, clickableMeshes);
      sgGrp.add(seal);
    });

    gls.group.add(sgGrp);
    addExplodePart(gls, sgGrp, new THREE.Vector3(x > 0 ? 0.6 : -0.6, 0.65, 0));
  });

  // Rear Tailgate Window + Rubber Seal
  const rgGrp = new THREE.Group();
  rgGrp.position.set(0, 1.54, -2.08);
  const rearGlass = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.34, 0.43, 0.025)));
  registerMeshMaterial(rearGlass, mats.glass, 'gls-1', ownedMaterials, clickableMeshes, false, false);
  rgGrp.add(rearGlass);
  const rgSeal = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.38, 0.028, 0.035)));
  rgSeal.position.y = 0.22;
  registerMeshMaterial(rgSeal, mats.windowSeal, 'gls-1', ownedMaterials, clickableMeshes);
  rgGrp.add(rgSeal);
  gls.group.add(rgGrp);
  addExplodePart(gls, rgGrp, new THREE.Vector3(0, 0.75, -0.55));

  // =========================================================================
  // 3. FRONT BUMPER & FASCIA ASSEMBLY - 'ext-1'
  // =========================================================================
  const ext = makeAssembly(
    'ext-1',
    false,
    new THREE.Vector3(0, 0.82, 2.18),
    new THREE.Vector3(2.8, 1.4, 3.2)
  );

  // Outer Fascia Surround Frame (proud of the recessed grille & headlamps)
  const fasciaSurroundGeo = trackGeo(createSmoothExtrudedBox(1.76, 0.38, 0.14, 0.05, 0.02, 16, 4));
  const fasciaSurround = new THREE.Mesh(fasciaSurroundGeo);
  fasciaSurround.position.set(0, 1.01, 2.11);
  registerMeshMaterial(fasciaSurround, mats.bumperPowderCoat, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(fasciaSurround);

  // Recessed Grille Cavity Backing + 3D Geometric Mesh Pattern (Horizontal, Vertical & Diagonal Mesh Ribs)
  const grilleBackGeo = trackGeo(new THREE.BoxGeometry(0.92, 0.27, 0.03));
  const grilleBack = new THREE.Mesh(grilleBackGeo);
  grilleBack.position.set(0, 1.01, 2.155);
  registerMeshMaterial(grilleBack, mats.seamDark, 'ext-1', ownedMaterials, clickableMeshes, false, true);
  ext.group.add(grilleBack);

  const meshParts: THREE.BufferGeometry[] = [];
  // Horizontal grille slats (recessed at z=2.165)
  for (let row = -2; row <= 2; row++) {
    const bar = new THREE.BoxGeometry(0.88, 0.018, 0.028);
    bar.translate(0, row * 0.048, 0);
    meshParts.push(bar);
  }
  // Vertical precision honeycomb ribs
  for (let col = -8; col <= 8; col++) {
    const rib = new THREE.BoxGeometry(0.014, 0.24, 0.024);
    rib.translate(col * 0.052, 0, 0);
    meshParts.push(rib);
  }
  // Diagonal diamond lattice ribs
  for (let d = -5; d <= 5; d++) {
    const diagA = new THREE.BoxGeometry(0.011, 0.26, 0.018);
    diagA.rotateZ(0.55);
    diagA.translate(d * 0.08, 0, 0);
    meshParts.push(diagA);

    const diagB = new THREE.BoxGeometry(0.011, 0.26, 0.018);
    diagB.rotateZ(-0.55);
    diagB.translate(d * 0.08, 0, 0);
    meshParts.push(diagB);
  }
  const mergedGrilleMeshGeo = trackGeo(mergeGeometries(meshParts));
  meshParts.forEach((g) => g.dispose());
  const grilleMesh = new THREE.Mesh(mergedGrilleMeshGeo);
  grilleMesh.position.set(0, 1.01, 2.172);
  registerMeshMaterial(grilleMesh, mats.grilleMetal, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(grilleMesh);

  // Front Grille Oval Emblem Badge
  const frontBadgeGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.056, 0.018));
  const frontBadge = new THREE.Mesh(frontBadgeGeo);
  frontBadge.position.set(0.28, 0.96, 2.188);
  registerMeshMaterial(frontBadge, mats.badgeEmblem, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(frontBadge);

  // Sculpted Bumper Bar + Metallic Silver Bash/Skid Plate + Front License Plate + Tow Hooks
  const bumperGeo = trackGeo(createSmoothExtrudedBox(1.88, 0.28, 0.28, 0.07, 0.025, 20, 5));
  const bumper = new THREE.Mesh(bumperGeo);
  bumper.position.set(0, 0.68, 2.16);
  registerMeshMaterial(bumper, mats.bumperPowderCoat, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(bumper);

  const skidGeo = trackGeo(createSmoothExtrudedBox(1.06, 0.21, 0.18, 0.04, 0.016, 14, 4));
  const skid = new THREE.Mesh(skidGeo);
  skid.position.set(0, 0.61, 2.25);
  registerMeshMaterial(skid, mats.metallicSilver, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(skid);

  const frontPlate = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.44, 0.105, 0.02)));
  frontPlate.position.set(0, 0.67, 2.345);
  registerMeshMaterial(frontPlate, mats.licensePlate, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(frontPlate);

  // Recovery tow hooks
  const hookGeo = trackGeo(new THREE.TorusGeometry(0.032, 0.011, 10, 18));
  [-0.42, 0.42].forEach((hx) => {
    const hook = new THREE.Mesh(hookGeo);
    hook.position.set(hx, 0.56, 2.33);
    hook.rotation.y = Math.PI / 2;
    registerMeshMaterial(hook, mats.brakeCaliper, 'ext-1', ownedMaterials, clickableMeshes);
    ext.group.add(hook);
  });

  // Recessed Faceted Headlight Assemblies (Bezel + Faceted Chrome Reflector Bowl + Projector Lens + LED Halo + Glass Cover)
  const hlHousingGeo = trackGeo(createSmoothExtrudedBox(0.32, 0.23, 0.08, 0.03, 0.012, 12, 3));
  const hlBowlGeo = trackGeo(new THREE.CylinderGeometry(0.085, 0.045, 0.055, 12, 1, true));
  hlBowlGeo.rotateX(Math.PI / 2);
  const hlProjectorGeo = trackGeo(new THREE.SphereGeometry(0.038, 16, 14));
  const hlHaloGeo = trackGeo(new THREE.TorusGeometry(0.076, 0.012, 10, 28));
  const hlDrlBarGeo = trackGeo(new THREE.BoxGeometry(0.024, 0.13, 0.016));
  const hlCoverGeo = trackGeo(createSmoothExtrudedBox(0.29, 0.20, 0.015, 0.025, 0.005, 10, 2));

  [-0.64, 0.64].forEach((x) => {
    const hlGrp = new THREE.Group();
    hlGrp.position.set(x, 1.01, 2.14);

    const housing = new THREE.Mesh(hlHousingGeo);
    registerMeshMaterial(housing, mats.trimBlack, 'ext-1', ownedMaterials, clickableMeshes);
    hlGrp.add(housing);

    // Faceted inner chrome reflector dish (flatShading on material or faceted 12-gon cylinder)
    const reflector = new THREE.Mesh(hlBowlGeo);
    reflector.position.z = 0.022;
    registerMeshMaterial(reflector, mats.headlightReflector, 'ext-1', ownedMaterials, clickableMeshes, false, true);
    (reflector.material as THREE.MeshStandardMaterial).flatShading = true;
    hlGrp.add(reflector);

    // Central projector optic
    const projector = new THREE.Mesh(hlProjectorGeo);
    projector.position.z = 0.025;
    registerMeshMaterial(projector, mats.headlightLed, 'ext-1', ownedMaterials, clickableMeshes, false, false);
    hlGrp.add(projector);

    // Signature halo DRL
    const halo = new THREE.Mesh(hlHaloGeo);
    halo.position.z = 0.042;
    registerMeshMaterial(halo, mats.headlightLed, 'ext-1', ownedMaterials, clickableMeshes, false, false);
    hlGrp.add(halo);

    // Outer amber/white corner indicator bar
    const sideBar = new THREE.Mesh(hlDrlBarGeo);
    sideBar.position.set(x > 0 ? 0.115 : -0.115, 0, 0.038);
    registerMeshMaterial(sideBar, mats.taillightAmber, 'ext-1', ownedMaterials, clickableMeshes, false, false);
    hlGrp.add(sideBar);

    // Outer clear optical glass cover
    const cover = new THREE.Mesh(hlCoverGeo);
    cover.position.z = 0.052;
    registerMeshMaterial(cover, mats.headlightLens, 'ext-1', ownedMaterials, clickableMeshes, false, false);
    hlGrp.add(cover);

    ext.group.add(hlGrp);
  });
  addExplodePart(ext, ext.group, new THREE.Vector3(0, -0.05, 0.85));

  // =========================================================================
  // 4. SUSPENSION / CHASSIS SYSTEM - 'susp-1'
  // =========================================================================
  const susp = makeAssembly(
    'susp-1',
    true,
    new THREE.Vector3(0, 0.44, 0),
    new THREE.Vector3(3.8, 1.6, 4.0)
  );

  const railGeo = trackGeo(createSmoothExtrudedBox(0.11, 0.14, 4.08, 0.02, 0.008, 8, 2));
  [-0.44, 0.44].forEach((x) => {
    const rail = new THREE.Mesh(railGeo);
    rail.position.set(x, 0.44, 0);
    registerMeshMaterial(rail, mats.chassisSteel, 'susp-1', ownedMaterials, clickableMeshes);
    susp.group.add(rail);
  });

  const crossGeo = trackGeo(new THREE.BoxGeometry(0.92, 0.10, 0.10));
  [-1.95, -1.42, -0.25, 0.85, 1.95].forEach((z) => {
    const cross = new THREE.Mesh(crossGeo);
    cross.position.set(0, 0.44, z);
    registerMeshMaterial(cross, mats.chassisSteel, 'susp-1', ownedMaterials, clickableMeshes);
    susp.group.add(cross);
  });

  const axleGeo = trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.64, 16));
  axleGeo.rotateZ(Math.PI / 2);
  const diffHousingGeo = trackGeo(new THREE.SphereGeometry(0.13, 20, 16));
  const coilGeo = trackGeo(createCoilSpringGeometry(0.065, 0.28, 6, 0.015));
  const damperGeo = trackGeo(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 12));

  [frontZ, rearZ].forEach((z) => {
    const axle = new THREE.Mesh(axleGeo);
    axle.position.set(0, wheelY, z);
    registerMeshMaterial(axle, mats.chassisSteel, 'susp-1', ownedMaterials, clickableMeshes);
    susp.group.add(axle);

    const diff = new THREE.Mesh(diffHousingGeo);
    diff.position.set(0, wheelY, z);
    registerMeshMaterial(diff, mats.engineBlock, 'susp-1', ownedMaterials, clickableMeshes);
    susp.group.add(diff);

    [-0.58, 0.58].forEach((x) => {
      const coil = new THREE.Mesh(coilGeo);
      coil.position.set(x, 0.56, z);
      registerMeshMaterial(coil, mats.springAccent, 'susp-1', ownedMaterials, clickableMeshes);
      susp.group.add(coil);

      const damper = new THREE.Mesh(damperGeo);
      damper.position.set(x, 0.57, z);
      registerMeshMaterial(damper, mats.metallicSilver, 'susp-1', ownedMaterials, clickableMeshes);
      susp.group.add(damper);
    });
  });
  addExplodePart(susp, susp.group, new THREE.Vector3(0, -0.38, 0));

  // =========================================================================
  // 5. WHEELS, TYRES & REAR SPARE TIRE COVER - 'wheel-1'
  // =========================================================================
  const wheel = makeAssembly(
    'wheel-1',
    false,
    new THREE.Vector3(0.88, 0.45, 1.1),
    new THREE.Vector3(3.8, 1.8, 4.0)
  );

  const tireCarcassGeo = trackGeo(createProfiledTireGeometry(wheelY, 0.28));
  const alloyBarrelGeo = trackGeo(createAlloyBarrelGeometry(0.255, 0.28));
  const spokeGeo = trackGeo(createSmoothExtrudedBox(0.036, 0.22, 0.038, 0.008, 0.006, 6, 2));
  const hubCapGeo = trackGeo(new THREE.CylinderGeometry(0.068, 0.072, 0.055, 24));
  hubCapGeo.rotateZ(Math.PI / 2);
  const lugNutGeo = trackGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.035, 6));
  lugNutGeo.rotateZ(Math.PI / 2);

  // Merge 3D perimeter shoulder tread lugs into one crisp geometry for authentic silhouette teeth
  const lugParts: THREE.BufferGeometry[] = [];
  const lugCount = 32;
  for (let i = 0; i < lugCount; i++) {
    const ang = (i / lugCount) * Math.PI * 2;
    [-0.085, 0.085].forEach((xOff, sIdx) => {
      const a = ang + (sIdx === 1 ? Math.PI / lugCount : 0);
      const lug = new THREE.BoxGeometry(0.075, 0.016, 0.048);
      lug.rotateX(a);
      lug.translate(xOff, Math.sin(a) * (wheelY - 0.002), Math.cos(a) * (wheelY - 0.002));
      lugParts.push(lug);
    });
  }
  const treadLugsGeo = trackGeo(mergeGeometries(lugParts));
  lugParts.forEach((g) => g.dispose());

  const buildDetailedWheel = (side: number) => {
    const wGrp = new THREE.Group();

    const tire = new THREE.Mesh(tireCarcassGeo);
    registerMeshMaterial(tire, mats.tireRubber, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(tire);

    const lugs = new THREE.Mesh(treadLugsGeo);
    registerMeshMaterial(lugs, mats.tireRubber, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(lugs);

    const rim = new THREE.Mesh(alloyBarrelGeo);
    registerMeshMaterial(rim, mats.alloyBronze, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(rim);

    // 5-Twin-Spoke Alloy Pattern (10 sculpted spokes)
    for (let s = 0; s < 5; s++) {
      const baseAngle = (s * Math.PI * 2) / 5;
      [-0.14, 0.14].forEach((offsetAngle) => {
        const a = baseAngle + offsetAngle;
        const spoke = new THREE.Mesh(spokeGeo);
        spoke.position.set(
          side * 0.115,
          Math.sin(a) * 0.145,
          Math.cos(a) * 0.145
        );
        spoke.rotation.x = -a;
        registerMeshMaterial(spoke, mats.alloyBronze, 'wheel-1', ownedMaterials, clickableMeshes);
        wGrp.add(spoke);
      });
    }

    // Center Hub Cap + Chrome Ring + 5 Chrome Lug Nuts
    const cap = new THREE.Mesh(hubCapGeo);
    cap.position.x = side * 0.125;
    registerMeshMaterial(cap, mats.trimBlack, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(cap);

    const capRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.056, 0.008, 10, 24)));
    capRing.position.x = side * 0.153;
    capRing.rotation.y = Math.PI / 2;
    registerMeshMaterial(capRing, mats.chrome, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(capRing);

    for (let l = 0; l < 5; l++) {
      const la = (l * Math.PI * 2) / 5;
      const lug = new THREE.Mesh(lugNutGeo);
      lug.position.set(side * 0.132, Math.sin(la) * 0.044, Math.cos(la) * 0.044);
      registerMeshMaterial(lug, mats.chrome, 'wheel-1', ownedMaterials, clickableMeshes);
      wGrp.add(lug);
    }

    return wGrp;
  };

  [
    { x: -trackX, z: frontZ, side: -1 },
    { x: trackX, z: frontZ, side: 1 },
    { x: -trackX, z: rearZ, side: -1 },
    { x: trackX, z: rearZ, side: 1 },
  ].forEach((w) => {
    const wGrp = buildDetailedWheel(w.side);
    wGrp.position.set(w.x, wheelY, w.z);
    wheel.group.add(wGrp);
    addExplodePart(wheel, wGrp, new THREE.Vector3(w.side * 0.72, -0.22, 0));
  });

  // Rear-Mounted Spare Tire + Sculpted Cover with Lock & Handle Detail
  const spareGrp = new THREE.Group();
  spareGrp.position.set(0.14, 1.15, -2.30);

  // Rear spare tire peeking slightly behind hard shell cover
  const spareTire = new THREE.Mesh(tireCarcassGeo);
  spareTire.rotation.y = Math.PI / 2;
  spareTire.scale.set(0.92, 0.92, 0.92);
  registerMeshMaterial(spareTire, mats.tireRubber, 'wheel-1', ownedMaterials, clickableMeshes);
  spareGrp.add(spareTire);

  // Molded Hard Spare Tire Cover Shell (outer rim ring + painted center disc)
  const coverOuterGeo = trackGeo(new THREE.CylinderGeometry(0.405, 0.405, 0.24, 48));
  coverOuterGeo.rotateX(Math.PI / 2);
  const coverOuter = new THREE.Mesh(coverOuterGeo);
  coverOuter.position.z = -0.025;
  registerMeshMaterial(coverOuter, mats.roofBlack, 'wheel-1', ownedMaterials, clickableMeshes);
  spareGrp.add(coverOuter);

  const coverFaceGeo = trackGeo(new THREE.CylinderGeometry(0.35, 0.37, 0.06, 48));
  coverFaceGeo.rotateX(Math.PI / 2);
  const coverFace = new THREE.Mesh(coverFaceGeo);
  coverFace.position.z = -0.14;
  registerMeshMaterial(coverFace, mats.bodyPaint, 'wheel-1', ownedMaterials, clickableMeshes);
  spareGrp.add(coverFace);

  // Cover Center Emblem
  const coverEmblem = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.07, 0.015)));
  coverEmblem.position.set(0, 0.04, -0.172);
  coverEmblem.rotation.y = Math.PI;
  registerMeshMaterial(coverEmblem, mats.badgeEmblem, 'wheel-1', ownedMaterials, clickableMeshes);
  spareGrp.add(coverEmblem);

  // Spare Tire Cover Latch Handle & Chrome Lock Cylinder
  const latchRecessGeo = trackGeo(createSmoothExtrudedBox(0.15, 0.065, 0.025, 0.015, 0.005, 10, 2));
  const latchRecess = new THREE.Mesh(latchRecessGeo);
  latchRecess.position.set(0, -0.22, -0.165);
  registerMeshMaterial(latchRecess, mats.seamDark, 'wheel-1', ownedMaterials, clickableMeshes);
  spareGrp.add(latchRecess);

  const latchHandleGeo = trackGeo(createSmoothExtrudedBox(0.11, 0.032, 0.032, 0.008, 0.006, 8, 2));
  const latchHandle = new THREE.Mesh(latchHandleGeo);
  latchHandle.position.set(-0.015, -0.22, -0.178);
  registerMeshMaterial(latchHandle, mats.trimBlack, 'wheel-1', ownedMaterials, clickableMeshes);
  spareGrp.add(latchHandle);

  const lockBezelGeo = trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.022, 16));
  lockBezelGeo.rotateX(Math.PI / 2);
  const lockBezel = new THREE.Mesh(lockBezelGeo);
  lockBezel.position.set(0.055, -0.22, -0.175);
  registerMeshMaterial(lockBezel, mats.chrome, 'wheel-1', ownedMaterials, clickableMeshes);
  spareGrp.add(lockBezel);

  wheel.group.add(spareGrp);
  addExplodePart(wheel, spareGrp, new THREE.Vector3(0, 0.25, -0.95));

  // =========================================================================
  // 6. BRAKING SYSTEM (COMPLETE) - 'brk-1'
  // =========================================================================
  const brk = makeAssembly(
    'brk-1',
    true,
    new THREE.Vector3(0.75, 0.45, 1.35),
    new THREE.Vector3(2.4, 1.1, 2.5)
  );

  const rotorGeo = trackGeo(new THREE.CylinderGeometry(0.21, 0.21, 0.035, 32));
  rotorGeo.rotateZ(Math.PI / 2);
  const caliperGeo = trackGeo(createSmoothExtrudedBox(0.08, 0.14, 0.12, 0.025, 0.012, 10, 3));

  [
    { x: -0.78, z: frontZ, side: -1 },
    { x: 0.78, z: frontZ, side: 1 },
    { x: -0.78, z: rearZ, side: -1 },
    { x: 0.78, z: rearZ, side: 1 },
  ].forEach((b) => {
    const bGrp = new THREE.Group();
    bGrp.position.set(b.x, wheelY, b.z);

    const rotor = new THREE.Mesh(rotorGeo);
    registerMeshMaterial(rotor, mats.brakeDisc, 'brk-1', ownedMaterials, clickableMeshes);
    bGrp.add(rotor);

    const caliper = new THREE.Mesh(caliperGeo);
    caliper.position.set(b.side * 0.01, 0.09, -0.13);
    registerMeshMaterial(caliper, mats.brakeCaliper, 'brk-1', ownedMaterials, clickableMeshes);
    bGrp.add(caliper);

    brk.group.add(bGrp);
    addExplodePart(brk, bGrp, new THREE.Vector3(b.side * 0.42, -0.22, 0));
  });

  // =========================================================================
  // 7. EV BATTERY PACK - 'bat-1'
  // =========================================================================
  const bat = makeAssembly(
    'bat-1',
    true,
    new THREE.Vector3(0, 0.46, 0),
    new THREE.Vector3(3.2, 1.7, 3.2)
  );

  const batTrayGeo = trackGeo(createSmoothExtrudedBox(0.76, 0.12, 1.84, 0.03, 0.012, 10, 3));
  const batTray = new THREE.Mesh(batTrayGeo);
  batTray.position.set(0, 0.46, -0.05);
  registerMeshMaterial(batTray, mats.batteryPack, 'bat-1', ownedMaterials, clickableMeshes);
  bat.group.add(batTray);

  const cellGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.04, 0.24));
  for (let row = 0; row < 5; row++) {
    [-0.19, 0.19].forEach((cx) => {
      const cell = new THREE.Mesh(cellGeo);
      cell.position.set(cx, 0.53, -0.68 + row * 0.31);
      registerMeshMaterial(cell, mats.hvOrange, 'bat-1', ownedMaterials, clickableMeshes);
      bat.group.add(cell);
    });
  }
  const busbar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.03, 1.66)));
  busbar.position.set(0, 0.54, -0.05);
  registerMeshMaterial(busbar, mats.copper, 'bat-1', ownedMaterials, clickableMeshes);
  bat.group.add(busbar);
  addExplodePart(bat, bat.group, new THREE.Vector3(0, -0.58, 0));

  // =========================================================================
  // 8. ELECTRIC DRIVE UNIT (EDU) - 'edu-1'
  // =========================================================================
  const edu = makeAssembly(
    'edu-1',
    true,
    new THREE.Vector3(0, 0.54, -1.25),
    new THREE.Vector3(2.4, 1.3, 2.6)
  );

  const motorBodyGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 0.46, 24));
  motorBodyGeo.rotateZ(Math.PI / 2);
  const motorBody = new THREE.Mesh(motorBodyGeo);
  motorBody.position.set(0, 0.54, -1.26);
  registerMeshMaterial(motorBody, mats.metallicSilver, 'edu-1', ownedMaterials, clickableMeshes);
  edu.group.add(motorBody);

  const statorRingGeo = trackGeo(new THREE.TorusGeometry(0.145, 0.025, 12, 28));
  statorRingGeo.rotateY(Math.PI / 2);
  [-0.22, 0.22].forEach((x) => {
    const ring = new THREE.Mesh(statorRingGeo);
    ring.position.set(x, 0.54, -1.26);
    registerMeshMaterial(ring, mats.copper, 'edu-1', ownedMaterials, clickableMeshes);
    edu.group.add(ring);
  });

  const inverterGeo = trackGeo(createSmoothExtrudedBox(0.34, 0.10, 0.28, 0.02, 0.01, 10, 3));
  const inverter = new THREE.Mesh(inverterGeo);
  inverter.position.set(0, 0.72, -1.24);
  registerMeshMaterial(inverter, mats.engineCover, 'edu-1', ownedMaterials, clickableMeshes);
  edu.group.add(inverter);
  addExplodePart(edu, edu.group, new THREE.Vector3(0, -0.35, -0.35));

  // =========================================================================
  // 9. CYLINDER BLOCK (ICE) - 'eng-1'
  // =========================================================================
  const eng = makeAssembly(
    'eng-1',
    true,
    new THREE.Vector3(0, 0.85, 1.48),
    new THREE.Vector3(2.4, 1.3, 2.4)
  );

  const blockGeo = trackGeo(createSmoothExtrudedBox(0.46, 0.36, 0.64, 0.04, 0.015, 12, 3));
  const block = new THREE.Mesh(blockGeo);
  block.position.set(0, 0.82, 1.46);
  registerMeshMaterial(block, mats.engineBlock, 'eng-1', ownedMaterials, clickableMeshes);
  eng.group.add(block);

  const valveCoverGeo = trackGeo(createSmoothExtrudedBox(0.38, 0.12, 0.58, 0.03, 0.012, 10, 3));
  const valveCover = new THREE.Mesh(valveCoverGeo);
  valveCover.position.set(0, 1.04, 1.46);
  registerMeshMaterial(valveCover, mats.engineCover, 'eng-1', ownedMaterials, clickableMeshes);
  eng.group.add(valveCover);

  const pulleyGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 20));
  pulleyGeo.rotateX(Math.PI / 2);
  [
    [0, 0.78],
    [-0.14, 0.90],
    [0.14, 0.90],
  ].forEach(([px, py]) => {
    const pulley = new THREE.Mesh(pulleyGeo);
    pulley.position.set(px, py, 1.80);
    registerMeshMaterial(pulley, mats.chrome, 'eng-1', ownedMaterials, clickableMeshes);
    eng.group.add(pulley);
  });
  addExplodePart(eng, eng.group, new THREE.Vector3(0, 0.42, 0.25));

  // =========================================================================
  // 10. AUTO-TRANSMISSION ASSEMBLY - 'trans-1'
  // =========================================================================
  const trans = makeAssembly(
    'trans-1',
    true,
    new THREE.Vector3(0, 0.62, 0.78),
    new THREE.Vector3(2.4, 1.2, 2.4)
  );

  const bellGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.22, 0.48, 20));
  bellGeo.rotateX(Math.PI / 2);
  const bell = new THREE.Mesh(bellGeo);
  bell.position.set(0, 0.64, 0.88);
  registerMeshMaterial(bell, mats.metallicSilver, 'trans-1', ownedMaterials, clickableMeshes);
  trans.group.add(bell);

  const transferCaseGeo = trackGeo(createSmoothExtrudedBox(0.28, 0.22, 0.34, 0.03, 0.01, 10, 3));
  const transferCase = new THREE.Mesh(transferCaseGeo);
  transferCase.position.set(0, 0.58, 0.46);
  registerMeshMaterial(transferCase, mats.engineBlock, 'trans-1', ownedMaterials, clickableMeshes);
  trans.group.add(transferCase);

  const shaftGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 1.65, 12));
  shaftGeo.rotateX(Math.PI / 2);
  const shaft = new THREE.Mesh(shaftGeo);
  shaft.position.set(0, 0.52, -0.48);
  registerMeshMaterial(shaft, mats.chassisSteel, 'trans-1', ownedMaterials, clickableMeshes);
  trans.group.add(shaft);
  addExplodePart(trans, trans.group, new THREE.Vector3(0, -0.26, 0.05));

  // =========================================================================
  // 11. EXHAUST SYSTEM - 'exh-1'
  // =========================================================================
  const exh = makeAssembly(
    'exh-1',
    true,
    new THREE.Vector3(-0.22, 0.44, -0.5),
    new THREE.Vector3(3.2, 1.4, 3.6)
  );

  const exhCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.24, 0.78, 1.35),
    new THREE.Vector3(-0.26, 0.40, 0.72),
    new THREE.Vector3(-0.22, 0.36, -0.20),
    new THREE.Vector3(-0.24, 0.36, -1.55),
    new THREE.Vector3(-0.34, 0.42, -2.18),
  ]);
  const exhPipeGeo = trackGeo(new THREE.TubeGeometry(exhCurve, 48, 0.032, 12, false));
  const exhPipe = new THREE.Mesh(exhPipeGeo);
  registerMeshMaterial(exhPipe, mats.exhaustSteel, 'exh-1', ownedMaterials, clickableMeshes);
  exh.group.add(exhPipe);

  const catGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 18));
  catGeo.rotateX(Math.PI / 2);
  const cat = new THREE.Mesh(catGeo);
  cat.position.set(-0.24, 0.38, 0.32);
  registerMeshMaterial(cat, mats.exhaustSteel, 'exh-1', ownedMaterials, clickableMeshes);
  exh.group.add(cat);

  const mufflerGeo = trackGeo(createSmoothExtrudedBox(0.26, 0.14, 0.44, 0.03, 0.012, 10, 3));
  const muffler = new THREE.Mesh(mufflerGeo);
  muffler.position.set(-0.28, 0.40, -1.78);
  registerMeshMaterial(muffler, mats.exhaustSteel, 'exh-1', ownedMaterials, clickableMeshes);
  exh.group.add(muffler);
  addExplodePart(exh, exh.group, new THREE.Vector3(-0.25, -0.64, -0.15));

  // =========================================================================
  // 12. VEHICLE WIRING HARNESS - 'wir-1'
  // =========================================================================
  const wir = makeAssembly(
    'wir-1',
    true,
    new THREE.Vector3(0, 0.85, 0.35),
    new THREE.Vector3(3.0, 1.9, 3.2)
  );

  const harnessPaths = [
    [
      new THREE.Vector3(0, 0.86, 1.75),
      new THREE.Vector3(-0.36, 0.88, 1.05),
      new THREE.Vector3(-0.56, 0.66, 0.25),
      new THREE.Vector3(-0.56, 0.66, -1.25),
      new THREE.Vector3(-0.62, 0.92, -1.95),
    ],
    [
      new THREE.Vector3(0.32, 0.88, 1.72),
      new THREE.Vector3(0.38, 0.94, 0.85),
      new THREE.Vector3(0.56, 0.66, 0.15),
      new THREE.Vector3(0.56, 0.66, -1.30),
    ],
    [
      new THREE.Vector3(-0.56, 0.88, 0.82),
      new THREE.Vector3(0, 0.96, 0.82),
      new THREE.Vector3(0.56, 0.88, 0.82),
    ],
  ];

  harnessPaths.forEach((pts, idx) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeGeo = trackGeo(new THREE.TubeGeometry(curve, 32, 0.02, 10, false));
    const loom = new THREE.Mesh(tubeGeo);
    registerMeshMaterial(loom, idx === 2 ? mats.wiringCyan : mats.copper, 'wir-1', ownedMaterials, clickableMeshes);
    wir.group.add(loom);
  });
  addExplodePart(wir, wir.group, new THREE.Vector3(0, 0.15, 0));

  // =========================================================================
  // 13. DRIVER SEAT SYSTEM - 'seat-1'
  // =========================================================================
  const seat = makeAssembly(
    'seat-1',
    true,
    new THREE.Vector3(0, 1.02, -0.05),
    new THREE.Vector3(2.8, 1.7, 2.8)
  );

  const buildBucketSeat = (x: number, z: number) => {
    const sGrp = new THREE.Group();
    sGrp.position.set(x, 0.72, z);

    const baseGeo = trackGeo(createSmoothExtrudedBox(0.46, 0.12, 0.48, 0.05, 0.02, 12, 4));
    const base = new THREE.Mesh(baseGeo);
    registerMeshMaterial(base, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
    sGrp.add(base);

    const backGeo = trackGeo(createSmoothExtrudedBox(0.44, 0.56, 0.12, 0.05, 0.02, 12, 4));
    const back = new THREE.Mesh(backGeo);
    back.position.set(0, 0.30, -0.20);
    back.rotation.x = -0.18;
    registerMeshMaterial(back, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
    sGrp.add(back);

    const headGeo = trackGeo(createSmoothExtrudedBox(0.22, 0.18, 0.09, 0.04, 0.015, 10, 3));
    const head = new THREE.Mesh(headGeo);
    head.position.set(0, 0.66, -0.25);
    registerMeshMaterial(head, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
    sGrp.add(head);

    return sGrp;
  };

  seat.group.add(buildBucketSeat(-0.42, 0.18));
  seat.group.add(buildBucketSeat(0.42, 0.18));

  const rearBenchBase = new THREE.Mesh(trackGeo(createSmoothExtrudedBox(1.32, 0.13, 0.46, 0.05, 0.02, 12, 4)));
  rearBenchBase.position.set(0, 0.72, -0.78);
  registerMeshMaterial(rearBenchBase, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
  seat.group.add(rearBenchBase);

  const rearBenchBack = new THREE.Mesh(trackGeo(createSmoothExtrudedBox(1.32, 0.52, 0.12, 0.05, 0.02, 12, 4)));
  rearBenchBack.position.set(0, 1.00, -0.98);
  rearBenchBack.rotation.x = -0.14;
  registerMeshMaterial(rearBenchBack, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
  seat.group.add(rearBenchBack);

  addExplodePart(seat, seat.group, new THREE.Vector3(0, 0.42, 0));

  // =========================================================================
  // 14. INFOTAINMENT & COCKPIT INTERIOR (IVI) - 'ivi-1'
  // =========================================================================
  const ivi = makeAssembly(
    'ivi-1',
    true,
    new THREE.Vector3(0, 1.12, 0.74),
    new THREE.Vector3(2.2, 1.4, 2.2)
  );

  // Upper Dashboard Cowl & Magnesium Cross-Car Beam (clearly visible through windshield)
  const dashGeo = trackGeo(createSmoothExtrudedBox(1.46, 0.25, 0.38, 0.06, 0.02, 14, 4));
  const dash = new THREE.Mesh(dashGeo);
  dash.position.set(0, 1.01, 0.76);
  registerMeshMaterial(dash, mats.dashTrim, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(dash);

  // Driver Instrument Binnacle Hood + Digital Gauge Cluster
  const binnacleGeo = trackGeo(createSmoothExtrudedBox(0.38, 0.14, 0.16, 0.03, 0.012, 10, 3));
  const binnacle = new THREE.Mesh(binnacleGeo);
  binnacle.position.set(-0.42, 1.16, 0.72);
  registerMeshMaterial(binnacle, mats.dashTrim, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(binnacle);

  const clusterFace = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.32, 0.10)));
  clusterFace.position.set(-0.42, 1.15, 0.635);
  clusterFace.rotation.y = Math.PI;
  registerMeshMaterial(clusterFace, mats.clusterDisplay, 'ivi-1', ownedMaterials, clickableMeshes, false, false);
  ivi.group.add(clusterFace);

  // Center Console Tunnel + Gear Shifter
  const consoleGeo = trackGeo(createSmoothExtrudedBox(0.24, 0.22, 0.78, 0.04, 0.015, 10, 3));
  const centerConsole = new THREE.Mesh(consoleGeo);
  centerConsole.position.set(0, 0.78, 0.28);
  registerMeshMaterial(centerConsole, mats.dashTrim, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(centerConsole);

  const shifter = new THREE.Mesh(trackGeo(createSmoothExtrudedBox(0.045, 0.09, 0.055, 0.01, 0.005, 8, 2)));
  shifter.position.set(0, 0.92, 0.42);
  registerMeshMaterial(shifter, mats.metallicSilver, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(shifter);

  // Central Infotainment Touchscreen Panel
  const screenHousingGeo = trackGeo(createSmoothExtrudedBox(0.36, 0.20, 0.04, 0.02, 0.008, 10, 3));
  const screenHousing = new THREE.Mesh(screenHousingGeo);
  screenHousing.position.set(0, 1.16, 0.63);
  screenHousing.rotation.x = -0.15;
  registerMeshMaterial(screenHousing, mats.trimBlack, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(screenHousing);

  const screenFace = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.32, 0.16)));
  screenFace.position.set(0, 1.16, 0.608);
  screenFace.rotation.y = Math.PI;
  screenFace.rotation.x = 0.15;
  registerMeshMaterial(screenFace, mats.screenDisplay, 'ivi-1', ownedMaterials, clickableMeshes, false, false);
  ivi.group.add(screenFace);

  // 3-Spoke Steering Wheel with Center Hub & Column
  const swGroup = new THREE.Group();
  swGroup.position.set(-0.42, 1.11, 0.53);
  swGroup.rotation.x = 0.36;

  const swRing = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.165, 0.021, 14, 32)));
  registerMeshMaterial(swRing, mats.trimBlack, 'ivi-1', ownedMaterials, clickableMeshes);
  swGroup.add(swRing);

  const swHub = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 20)));
  swHub.rotation.x = Math.PI / 2;
  registerMeshMaterial(swHub, mats.dashTrim, 'ivi-1', ownedMaterials, clickableMeshes);
  swGroup.add(swHub);

  // 3 Steering wheel spokes
  [0, Math.PI, -Math.PI / 2].forEach((sa) => {
    const swSpoke = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.15, 0.026, 0.02)));
    swSpoke.position.set(Math.cos(sa) * 0.075, Math.sin(sa) * 0.075, 0);
    swSpoke.rotation.z = sa;
    registerMeshMaterial(swSpoke, mats.metallicSilver, 'ivi-1', ownedMaterials, clickableMeshes);
    swGroup.add(swSpoke);
  });
  ivi.group.add(swGroup);

  // Interior Rearview Mirror mounted high under windshield header
  const intMirror = new THREE.Mesh(trackGeo(createSmoothExtrudedBox(0.19, 0.048, 0.032, 0.012, 0.005, 8, 2)));
  intMirror.position.set(0, 1.66, 0.50);
  registerMeshMaterial(intMirror, mats.trimBlack, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(intMirror);

  addExplodePart(ivi, ivi.group, new THREE.Vector3(0, 0.38, -0.05));

  // =========================================================================
  // 15. ADAS DOMAIN CONTROLLER - 'adas-1'
  // =========================================================================
  const adas = makeAssembly(
    'adas-1',
    true,
    new THREE.Vector3(0, 1.28, 1.15),
    new THREE.Vector3(2.5, 1.5, 2.7)
  );

  const radarGeo = trackGeo(createSmoothExtrudedBox(0.18, 0.12, 0.08, 0.015, 0.006, 8, 2));
  const radar = new THREE.Mesh(radarGeo);
  radar.position.set(0, 0.72, 2.08);
  registerMeshMaterial(radar, mats.adasSensor, 'adas-1', ownedMaterials, clickableMeshes);
  adas.group.add(radar);

  const camPodGeo = trackGeo(createSmoothExtrudedBox(0.22, 0.07, 0.14, 0.015, 0.005, 8, 2));
  const camPod = new THREE.Mesh(camPodGeo);
  camPod.position.set(0, 1.74, 0.56);
  registerMeshMaterial(camPod, mats.adasSensor, 'adas-1', ownedMaterials, clickableMeshes);
  adas.group.add(camPod);

  const ecuGeo = trackGeo(createSmoothExtrudedBox(0.26, 0.07, 0.22, 0.015, 0.006, 8, 2));
  const ecu = new THREE.Mesh(ecuGeo);
  ecu.position.set(0.32, 0.94, 0.82);
  registerMeshMaterial(ecu, mats.metallicSilver, 'adas-1', ownedMaterials, clickableMeshes);
  adas.group.add(ecu);

  addExplodePart(adas, adas.group, new THREE.Vector3(0, 0.55, 0.45));

  // =========================================================================
  // 16. HVAC UNIT (AHU) - 'hvac-1'
  // =========================================================================
  const hvac = makeAssembly(
    'hvac-1',
    true,
    new THREE.Vector3(0, 0.92, 1.45),
    new THREE.Vector3(2.4, 1.3, 2.5)
  );

  const radGeo = trackGeo(createSmoothExtrudedBox(0.92, 0.42, 0.08, 0.02, 0.008, 10, 3));
  const radiator = new THREE.Mesh(radGeo);
  radiator.position.set(0, 0.84, 1.92);
  registerMeshMaterial(radiator, mats.hvacCore, 'hvac-1', ownedMaterials, clickableMeshes);
  hvac.group.add(radiator);

  const blowerGeo = trackGeo(createSmoothExtrudedBox(0.56, 0.26, 0.28, 0.04, 0.012, 10, 3));
  const blower = new THREE.Mesh(blowerGeo);
  blower.position.set(0, 0.88, 0.96);
  registerMeshMaterial(blower, mats.trimBlack, 'hvac-1', ownedMaterials, clickableMeshes);
  hvac.group.add(blower);

  addExplodePart(hvac, hvac.group, new THREE.Vector3(0, 0.24, 0.35));

  const dispose = () => {
    ownedGeometries.forEach((g) => g.dispose());
    ownedMaterials.forEach((m) => m.dispose());
  };

  return {
    root,
    components,
    clickableMeshes,
    dispose,
  };
}
