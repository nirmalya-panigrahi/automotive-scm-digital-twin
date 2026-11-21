/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CarMaterialLibrary } from './carMaterials';

export interface CarComponentAssembly {
  id: string;
  group: THREE.Group;
  isInternal: boolean;
  focusTarget: THREE.Vector3;
  cameraOffset: THREE.Vector3;
  /** Optional individual sub-part animations during Exploded View */
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
  receiveShadow = true
) {
  const mat = baseMat.clone();
  ownedMaterials.push(mat);
  mesh.material = mat;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.userData.componentId = componentId;
  mesh.userData.isGhostable = componentId === 'biw-1' || componentId === 'gls-1';

  const stdMat = mat as THREE.MeshStandardMaterial;
  mesh.userData.baseColorHex = stdMat.color ? stdMat.color.getHex() : 0xffffff;
  mesh.userData.baseEmissiveHex = stdMat.emissive ? stdMat.emissive.getHex() : 0x000000;
  mesh.userData.baseEmissiveIntensity = stdMat.emissiveIntensity ?? 0;
  mesh.userData.baseOpacity = mat.opacity;
  mesh.userData.baseTransparent = mat.transparent;
  mesh.userData.baseDepthWrite = mat.depthWrite;

  clickableMeshes.push(mesh);
}

function createExtrudedBox(
  w: number,
  h: number,
  d: number,
  radius: number,
  bevel = 0.02
): THREE.ExtrudeGeometry {
  const hw = w / 2 - radius;
  const hh = h / 2 - radius;
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
    depth: d - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.center();
  return geo;
}

function createCoilSpringGeometry(
  radius: number,
  height: number,
  turns: number,
  wireRadius: number
): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const samples = turns * 18;
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
  return new THREE.TubeGeometry(curve, samples, wireRadius, 8, false);
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

  // Shared dimensional constants (Right-handed: +Z front, +Y up, +X right)
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

  // Main Lower Side Sills & Quarter Body Panels (Left & Right)
  const lowerQuarterGeo = trackGeo(createExtrudedBox(0.14, 0.58, 4.26, 0.04, 0.015));
  [-0.86, 0.86].forEach((xPos) => {
    const side = new THREE.Mesh(lowerQuarterGeo);
    side.position.set(xPos, 0.88, -0.04);
    registerMeshMaterial(side, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(side);
    addExplodePart(biw, side, new THREE.Vector3(xPos > 0 ? 0.35 : -0.35, 0.35, 0));
  });

  // Front Hood / Bonnet (sloped Defender clamshell hood)
  const hoodGroup = new THREE.Group();
  hoodGroup.position.set(0, 1.24, 1.44);
  const hoodGeo = trackGeo(createExtrudedBox(1.66, 0.11, 1.38, 0.05, 0.02));
  const hoodMesh = new THREE.Mesh(hoodGeo);
  hoodMesh.rotation.x = 0.045;
  registerMeshMaterial(hoodMesh, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
  hoodGroup.add(hoodMesh);

  // Matte black hood center vent / decal plate
  const hoodVentGeo = trackGeo(createExtrudedBox(0.84, 0.03, 0.92, 0.03, 0.008));
  const hoodVent = new THREE.Mesh(hoodVentGeo);
  hoodVent.position.set(0, 0.06, -0.04);
  hoodVent.rotation.x = 0.045;
  registerMeshMaterial(hoodVent, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
  hoodGroup.add(hoodVent);
  biw.group.add(hoodGroup);
  addExplodePart(biw, hoodGroup, new THREE.Vector3(0, 0.95, 0.25));

  // Front fenders (Left & Right)
  const fenderGeo = trackGeo(createExtrudedBox(0.18, 0.52, 1.42, 0.04, 0.015));
  [-0.85, 0.85].forEach((xPos) => {
    const fender = new THREE.Mesh(fenderGeo);
    fender.position.set(xPos, 1.0, 1.42);
    registerMeshMaterial(fender, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(fender);
    addExplodePart(biw, fender, new THREE.Vector3(xPos > 0 ? 0.45 : -0.45, 0.4, 0.1));
  });

  // Wheel Arch Flares (4x rugged matte black Defender arches)
  const archShape = new THREE.Shape();
  archShape.absarc(0, 0, 0.56, 0, Math.PI, false);
  archShape.absarc(0, 0, 0.46, Math.PI, 0, true);
  const archGeo = trackGeo(
    new THREE.ExtrudeGeometry(archShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 })
  );
  archGeo.center();
  archGeo.rotateY(Math.PI / 2);

  [
    [-0.93, frontZ],
    [0.93, frontZ],
    [-0.93, rearZ],
    [0.93, rearZ],
  ].forEach(([x, z]) => {
    const arch = new THREE.Mesh(archGeo);
    arch.position.set(x, 0.65, z);
    registerMeshMaterial(arch, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(arch);
    addExplodePart(biw, arch, new THREE.Vector3(x > 0 ? 0.55 : -0.55, 0.28, 0));
  });

  // 4 Side Doors with beltline trim & handles
  const doorGeo = trackGeo(createExtrudedBox(0.10, 0.62, 0.96, 0.03, 0.012));
  const doorFrameTopGeo = trackGeo(createExtrudedBox(0.06, 0.48, 0.07, 0.01, 0.006));
  const handleGeo = trackGeo(new THREE.BoxGeometry(0.05, 0.04, 0.16));

  [
    { x: -0.89, z: 0.36, side: -1, front: true },
    { x: 0.89, z: 0.36, side: 1, front: true },
    { x: -0.89, z: -0.66, side: -1, front: false },
    { x: 0.89, z: -0.66, side: 1, front: false },
  ].forEach((d) => {
    const doorGrp = new THREE.Group();
    doorGrp.position.set(d.x, 0.96, d.z);

    const doorPanel = new THREE.Mesh(doorGeo);
    registerMeshMaterial(doorPanel, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    doorGrp.add(doorPanel);

    const handle = new THREE.Mesh(handleGeo);
    handle.position.set(d.side * 0.06, 0.14, -0.30);
    registerMeshMaterial(handle, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    doorGrp.add(handle);

    // Side Mirror on front doors
    if (d.front) {
      const mirrorGeo = trackGeo(createExtrudedBox(0.18, 0.13, 0.12, 0.03, 0.01));
      const mirror = new THREE.Mesh(mirrorGeo);
      mirror.position.set(d.side * 0.13, 0.34, 0.36);
      registerMeshMaterial(mirror, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
      doorGrp.add(mirror);
    }

    const post = new THREE.Mesh(doorFrameTopGeo);
    post.position.set(0, 0.52, -0.44);
    registerMeshMaterial(post, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
    doorGrp.add(post);

    biw.group.add(doorGrp);
    addExplodePart(biw, doorGrp, new THREE.Vector3(d.side * 0.72, 0.25, d.front ? 0.12 : -0.12));
  });

  // Cabin Pillars (A, B, C, D pillars) & Rear Body Shell
  const pillarGeo = trackGeo(new THREE.BoxGeometry(0.10, 0.62, 0.11));
  // A-pillars (raked)
  [-0.78, 0.78].forEach((x) => {
    const aPillar = new THREE.Mesh(pillarGeo);
    aPillar.position.set(x, 1.54, 0.66);
    aPillar.rotation.x = -0.36;
    registerMeshMaterial(aPillar, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(aPillar);
    addExplodePart(biw, aPillar, new THREE.Vector3(0, 0.55, 0));

    // D-pillars (rear)
    const dPillar = new THREE.Mesh(trackGeo(createExtrudedBox(0.14, 0.62, 0.34, 0.02, 0.01)));
    dPillar.position.set(x, 1.54, -1.94);
    registerMeshMaterial(dPillar, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
    biw.group.add(dPillar);
    addExplodePart(biw, dPillar, new THREE.Vector3(0, 0.55, 0));
  });

  // Side Gear Storage Box (right rear quarter, iconic Defender accessory from user image)
  const gearBoxGeo = trackGeo(createExtrudedBox(0.18, 0.38, 0.52, 0.04, 0.015));
  const gearBox = new THREE.Mesh(gearBoxGeo);
  gearBox.position.set(0.98, 1.48, -1.42);
  registerMeshMaterial(gearBox, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
  biw.group.add(gearBox);
  addExplodePart(biw, gearBox, new THREE.Vector3(0.85, 0.65, -0.2));

  // Rear Tailgate + Taillights
  const tailgateGroup = new THREE.Group();
  tailgateGroup.position.set(0, 1.12, -2.14);
  const tailgateGeo = trackGeo(createExtrudedBox(1.64, 0.96, 0.14, 0.04, 0.015));
  const tailgate = new THREE.Mesh(tailgateGeo);
  registerMeshMaterial(tailgate, mats.bodyPaint, 'biw-1', ownedMaterials, clickableMeshes);
  tailgateGroup.add(tailgate);

  const tailLampGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.24, 0.06));
  [-0.72, 0.72].forEach((x) => {
    const lamp = new THREE.Mesh(tailLampGeo);
    lamp.position.set(x, 0.02, -0.07);
    registerMeshMaterial(lamp, mats.taillightLed, 'biw-1', ownedMaterials, clickableMeshes);
    tailgateGroup.add(lamp);
  });
  biw.group.add(tailgateGroup);
  addExplodePart(biw, tailgateGroup, new THREE.Vector3(0, 0.35, -0.65));

  // Contrast Black Roof Panel
  const roofGeo = trackGeo(createExtrudedBox(1.64, 0.09, 2.74, 0.05, 0.02));
  const roofMesh = new THREE.Mesh(roofGeo);
  roofMesh.position.set(0, 1.84, -0.78);
  registerMeshMaterial(roofMesh, mats.roofBlack, 'biw-1', ownedMaterials, clickableMeshes);
  biw.group.add(roofMesh);
  addExplodePart(biw, roofMesh, new THREE.Vector3(0, 1.05, 0));

  // Expedition Roof Rack Assembly (tubular perimeter + cross slats)
  const rackGroup = new THREE.Group();
  rackGroup.position.set(0, 1.94, -0.82);
  const rackRailGeo = trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 2.52, 10));
  rackRailGeo.rotateX(Math.PI / 2);
  [-0.72, 0.72].forEach((x) => {
    const rail = new THREE.Mesh(rackRailGeo);
    rail.position.set(x, 0.04, 0);
    registerMeshMaterial(rail, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    rackGroup.add(rail);
  });
  const rackCrossGeo = trackGeo(new THREE.CylinderGeometry(0.016, 0.016, 1.44, 8));
  rackCrossGeo.rotateZ(Math.PI / 2);
  for (let i = -5; i <= 5; i++) {
    const cross = new THREE.Mesh(rackCrossGeo);
    cross.position.set(0, 0.02, i * 0.23);
    registerMeshMaterial(cross, mats.trimBlack, 'biw-1', ownedMaterials, clickableMeshes);
    rackGroup.add(cross);
  }
  biw.group.add(rackGroup);
  addExplodePart(biw, rackGroup, new THREE.Vector3(0, 1.48, 0));

  // =========================================================================
  // 2. LAMINATED WINDSHIELD & GLAZING - 'gls-1'
  // =========================================================================
  const gls = makeAssembly(
    'gls-1',
    false,
    new THREE.Vector3(0, 1.52, 0.45),
    new THREE.Vector3(3.4, 2.1, 3.6)
  );

  // Front raked windshield
  const windshieldGeo = trackGeo(new THREE.BoxGeometry(1.48, 0.64, 0.03));
  const windshield = new THREE.Mesh(windshieldGeo);
  windshield.position.set(0, 1.54, 0.68);
  windshield.rotation.x = -0.36;
  registerMeshMaterial(windshield, mats.glass, 'gls-1', ownedMaterials, clickableMeshes, false, false);
  gls.group.add(windshield);
  addExplodePart(gls, windshield, new THREE.Vector3(0, 0.95, 0.35));

  // Side windows
  const sideGlassGeo = trackGeo(new THREE.BoxGeometry(0.025, 0.46, 2.48));
  [-0.82, 0.82].forEach((x) => {
    const sg = new THREE.Mesh(sideGlassGeo);
    sg.position.set(x, 1.54, -0.68);
    registerMeshMaterial(sg, mats.glass, 'gls-1', ownedMaterials, clickableMeshes, false, false);
    gls.group.add(sg);
    addExplodePart(gls, sg, new THREE.Vector3(x > 0 ? 0.6 : -0.6, 0.65, 0));
  });

  // Rear tailgate window
  const rearGlassGeo = trackGeo(new THREE.BoxGeometry(1.36, 0.44, 0.03));
  const rearGlass = new THREE.Mesh(rearGlassGeo);
  rearGlass.position.set(0, 1.54, -2.08);
  registerMeshMaterial(rearGlass, mats.glass, 'gls-1', ownedMaterials, clickableMeshes, false, false);
  gls.group.add(rearGlass);
  addExplodePart(gls, rearGlass, new THREE.Vector3(0, 0.75, -0.55));

  // =========================================================================
  // 3. FRONT BUMPER & GRILLE ASSEMBLY - 'ext-1'
  // =========================================================================
  const ext = makeAssembly(
    'ext-1',
    false,
    new THREE.Vector3(0, 0.78, 2.18),
    new THREE.Vector3(2.8, 1.4, 3.2)
  );

  // Main upper grille surround
  const grilleGeo = trackGeo(createExtrudedBox(1.56, 0.34, 0.16, 0.03, 0.015));
  const grille = new THREE.Mesh(grilleGeo);
  grille.position.set(0, 1.02, 2.12);
  registerMeshMaterial(grille, mats.roofBlack, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(grille);

  // Grille horizontal slats
  const slatGeo = trackGeo(new THREE.BoxGeometry(0.84, 0.035, 0.05));
  for (let s = -1; s <= 1; s++) {
    const slat = new THREE.Mesh(slatGeo);
    slat.position.set(0, 1.02 + s * 0.08, 2.20);
    registerMeshMaterial(slat, mats.metallicSilver, 'ext-1', ownedMaterials, clickableMeshes);
    ext.group.add(slat);
  }

  // Sculpted lower bumper bar
  const bumperGeo = trackGeo(createExtrudedBox(1.86, 0.28, 0.28, 0.05, 0.02));
  const bumper = new THREE.Mesh(bumperGeo);
  bumper.position.set(0, 0.68, 2.16);
  registerMeshMaterial(bumper, mats.trimBlack, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(bumper);

  // Silver center bash / skid plate
  const skidGeo = trackGeo(createExtrudedBox(1.06, 0.22, 0.18, 0.03, 0.01));
  const skid = new THREE.Mesh(skidGeo);
  skid.position.set(0, 0.62, 2.25);
  registerMeshMaterial(skid, mats.metallicSilver, 'ext-1', ownedMaterials, clickableMeshes);
  ext.group.add(skid);

  // Twin Defender Halo LED Headlight Pods
  const hlHousingGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.22, 0.10));
  const hlHaloGeo = trackGeo(new THREE.TorusGeometry(0.075, 0.016, 10, 24));
  [-0.62, 0.62].forEach((x) => {
    const housing = new THREE.Mesh(hlHousingGeo);
    housing.position.set(x, 1.02, 2.14);
    registerMeshMaterial(housing, mats.trimBlack, 'ext-1', ownedMaterials, clickableMeshes);
    ext.group.add(housing);

    const halo = new THREE.Mesh(hlHaloGeo);
    halo.position.set(x, 1.02, 2.20);
    registerMeshMaterial(halo, mats.headlightLed, 'ext-1', ownedMaterials, clickableMeshes);
    ext.group.add(halo);
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

  // Twin longitudinal ladder frame rails
  const railGeo = trackGeo(createExtrudedBox(0.11, 0.14, 4.08, 0.015, 0.008));
  [-0.44, 0.44].forEach((x) => {
    const rail = new THREE.Mesh(railGeo);
    rail.position.set(x, 0.44, 0);
    registerMeshMaterial(rail, mats.chassisSteel, 'susp-1', ownedMaterials, clickableMeshes);
    susp.group.add(rail);
  });

  // Crossmembers
  const crossGeo = trackGeo(new THREE.BoxGeometry(0.92, 0.10, 0.10));
  [-1.95, -1.42, -0.25, 0.85, 1.95].forEach((z) => {
    const cross = new THREE.Mesh(crossGeo);
    cross.position.set(0, 0.44, z);
    registerMeshMaterial(cross, mats.chassisSteel, 'susp-1', ownedMaterials, clickableMeshes);
    susp.group.add(cross);
  });

  // Front & Rear Axles + Wishbone Control Arms + Helical Coil Springs
  const axleGeo = trackGeo(new THREE.CylinderGeometry(0.045, 0.045, 1.64, 14));
  axleGeo.rotateZ(Math.PI / 2);
  const diffHousingGeo = trackGeo(new THREE.SphereGeometry(0.13, 16, 14));
  const coilGeo = trackGeo(createCoilSpringGeometry(0.065, 0.28, 6, 0.014));
  const damperGeo = trackGeo(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 10));

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
  // 5. WHEELS & TYRES (SET OF 4) - 'wheel-1'
  // =========================================================================
  const wheel = makeAssembly(
    'wheel-1',
    false,
    new THREE.Vector3(0.88, 0.45, 1.1),
    new THREE.Vector3(3.8, 1.8, 4.0)
  );

  const tireGeo = trackGeo(new THREE.CylinderGeometry(wheelY, wheelY, 0.28, 32));
  tireGeo.rotateZ(Math.PI / 2);
  const rimOuterGeo = trackGeo(new THREE.CylinderGeometry(0.25, 0.25, 0.29, 24));
  rimOuterGeo.rotateZ(Math.PI / 2);
  const spokeGeo = trackGeo(new THREE.BoxGeometry(0.04, 0.44, 0.045));
  const hubCapGeo = trackGeo(new THREE.CylinderGeometry(0.065, 0.065, 0.31, 16));
  hubCapGeo.rotateZ(Math.PI / 2);

  [
    { x: -trackX, z: frontZ, side: -1 },
    { x: trackX, z: frontZ, side: 1 },
    { x: -trackX, z: rearZ, side: -1 },
    { x: trackX, z: rearZ, side: 1 },
  ].forEach((w) => {
    const wGrp = new THREE.Group();
    wGrp.position.set(w.x, wheelY, w.z);

    const tire = new THREE.Mesh(tireGeo);
    registerMeshMaterial(tire, mats.tireRubber, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(tire);

    const rim = new THREE.Mesh(rimOuterGeo);
    registerMeshMaterial(rim, mats.alloyBronze, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(rim);

    // 5-Spoke pattern
    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(spokeGeo);
      spoke.position.x = w.side * 0.135;
      spoke.rotation.x = (s * Math.PI) / 5;
      registerMeshMaterial(spoke, mats.alloyBronze, 'wheel-1', ownedMaterials, clickableMeshes);
      wGrp.add(spoke);
    }

    const cap = new THREE.Mesh(hubCapGeo);
    registerMeshMaterial(cap, mats.trimBlack, 'wheel-1', ownedMaterials, clickableMeshes);
    wGrp.add(cap);

    wheel.group.add(wGrp);
    addExplodePart(wheel, wGrp, new THREE.Vector3(w.side * 0.72, -0.22, 0));
  });

  // =========================================================================
  // 6. BRAKING SYSTEM (COMPLETE) - 'brk-1'
  // =========================================================================
  const brk = makeAssembly(
    'brk-1',
    true,
    new THREE.Vector3(0.75, 0.45, 1.35),
    new THREE.Vector3(2.4, 1.1, 2.5)
  );

  const rotorGeo = trackGeo(new THREE.CylinderGeometry(0.21, 0.21, 0.035, 28));
  rotorGeo.rotateZ(Math.PI / 2);
  const caliperGeo = trackGeo(createExtrudedBox(0.08, 0.14, 0.12, 0.02, 0.01));

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

  const batTrayGeo = trackGeo(createExtrudedBox(0.76, 0.12, 1.84, 0.03, 0.01));
  const batTray = new THREE.Mesh(batTrayGeo);
  batTray.position.set(0, 0.46, -0.05);
  registerMeshMaterial(batTray, mats.batteryPack, 'bat-1', ownedMaterials, clickableMeshes);
  bat.group.add(batTray);

  // Segmented battery cell modules + HV copper/orange busbars
  const cellGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.04, 0.24));
  for (let row = 0; row < 5; row++) {
    [-0.19, 0.19].forEach((cx) => {
      const cell = new THREE.Mesh(cellGeo);
      cell.position.set(cx, 0.53, -0.68 + row * 0.31);
      registerMeshMaterial(cell, mats.hvOrange, 'bat-1', ownedMaterials, clickableMeshes);
      bat.group.add(cell);
    });
  }
  const busbarGeo = trackGeo(new THREE.BoxGeometry(0.06, 0.03, 1.66));
  const busbar = new THREE.Mesh(busbarGeo);
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

  const motorBodyGeo = trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 0.46, 20));
  motorBodyGeo.rotateZ(Math.PI / 2);
  const motorBody = new THREE.Mesh(motorBodyGeo);
  motorBody.position.set(0, 0.54, -1.26);
  registerMeshMaterial(motorBody, mats.metallicSilver, 'edu-1', ownedMaterials, clickableMeshes);
  edu.group.add(motorBody);

  // Copper stator end-rings
  const statorRingGeo = trackGeo(new THREE.TorusGeometry(0.145, 0.025, 10, 24));
  statorRingGeo.rotateY(Math.PI / 2);
  [-0.22, 0.22].forEach((x) => {
    const ring = new THREE.Mesh(statorRingGeo);
    ring.position.set(x, 0.54, -1.26);
    registerMeshMaterial(ring, mats.copper, 'edu-1', ownedMaterials, clickableMeshes);
    edu.group.add(ring);
  });

  // SiC Inverter module atop motor
  const inverterGeo = trackGeo(createExtrudedBox(0.34, 0.10, 0.28, 0.02, 0.01));
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

  const blockGeo = trackGeo(createExtrudedBox(0.46, 0.36, 0.64, 0.04, 0.015));
  const block = new THREE.Mesh(blockGeo);
  block.position.set(0, 0.82, 1.46);
  registerMeshMaterial(block, mats.engineBlock, 'eng-1', ownedMaterials, clickableMeshes);
  eng.group.add(block);

  const valveCoverGeo = trackGeo(createExtrudedBox(0.38, 0.12, 0.58, 0.03, 0.01));
  const valveCover = new THREE.Mesh(valveCoverGeo);
  valveCover.position.set(0, 1.04, 1.46);
  registerMeshMaterial(valveCover, mats.engineCover, 'eng-1', ownedMaterials, clickableMeshes);
  eng.group.add(valveCover);

  // Pulley wheels on front of block
  const pulleyGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 16));
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

  const bellGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.22, 0.48, 16));
  bellGeo.rotateX(Math.PI / 2);
  const bell = new THREE.Mesh(bellGeo);
  bell.position.set(0, 0.64, 0.88);
  registerMeshMaterial(bell, mats.metallicSilver, 'trans-1', ownedMaterials, clickableMeshes);
  trans.group.add(bell);

  const transferCaseGeo = trackGeo(createExtrudedBox(0.28, 0.22, 0.34, 0.03, 0.01));
  const transferCase = new THREE.Mesh(transferCaseGeo);
  transferCase.position.set(0, 0.58, 0.46);
  registerMeshMaterial(transferCase, mats.engineBlock, 'trans-1', ownedMaterials, clickableMeshes);
  trans.group.add(transferCase);

  // Driveshaft connecting to rear axle
  const shaftGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.032, 1.65, 10));
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
  const exhPipeGeo = trackGeo(new THREE.TubeGeometry(exhCurve, 40, 0.032, 10, false));
  const exhPipe = new THREE.Mesh(exhPipeGeo);
  registerMeshMaterial(exhPipe, mats.exhaustSteel, 'exh-1', ownedMaterials, clickableMeshes);
  exh.group.add(exhPipe);

  // Catalytic converter & rear muffler
  const catGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 14));
  catGeo.rotateX(Math.PI / 2);
  const cat = new THREE.Mesh(catGeo);
  cat.position.set(-0.24, 0.38, 0.32);
  registerMeshMaterial(cat, mats.exhaustSteel, 'exh-1', ownedMaterials, clickableMeshes);
  exh.group.add(cat);

  const mufflerGeo = trackGeo(createExtrudedBox(0.26, 0.14, 0.44, 0.03, 0.01));
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
    const tubeGeo = trackGeo(new THREE.TubeGeometry(curve, 28, 0.02, 8, false));
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

    const baseGeo = trackGeo(createExtrudedBox(0.46, 0.12, 0.48, 0.04, 0.015));
    const base = new THREE.Mesh(baseGeo);
    registerMeshMaterial(base, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
    sGrp.add(base);

    const backGeo = trackGeo(createExtrudedBox(0.44, 0.56, 0.12, 0.04, 0.015));
    const back = new THREE.Mesh(backGeo);
    back.position.set(0, 0.30, -0.20);
    back.rotation.x = -0.18;
    registerMeshMaterial(back, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
    sGrp.add(back);

    const headGeo = trackGeo(createExtrudedBox(0.22, 0.18, 0.09, 0.03, 0.01));
    const head = new THREE.Mesh(headGeo);
    head.position.set(0, 0.66, -0.25);
    registerMeshMaterial(head, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
    sGrp.add(head);

    return sGrp;
  };

  seat.group.add(buildBucketSeat(-0.42, 0.18));
  seat.group.add(buildBucketSeat(0.42, 0.18));

  // Rear 2nd-row bench
  const rearBenchBase = new THREE.Mesh(trackGeo(createExtrudedBox(1.32, 0.13, 0.46, 0.04, 0.015)));
  rearBenchBase.position.set(0, 0.72, -0.78);
  registerMeshMaterial(rearBenchBase, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
  seat.group.add(rearBenchBase);

  const rearBenchBack = new THREE.Mesh(trackGeo(createExtrudedBox(1.32, 0.52, 0.12, 0.04, 0.015)));
  rearBenchBack.position.set(0, 1.00, -0.98);
  rearBenchBack.rotation.x = -0.14;
  registerMeshMaterial(rearBenchBack, mats.seatLeather, 'seat-1', ownedMaterials, clickableMeshes);
  seat.group.add(rearBenchBack);

  addExplodePart(seat, seat.group, new THREE.Vector3(0, 0.42, 0));

  // =========================================================================
  // 14. INFOTAINMENT SYSTEM (IVI) - 'ivi-1'
  // =========================================================================
  const ivi = makeAssembly(
    'ivi-1',
    true,
    new THREE.Vector3(0, 1.08, 0.74),
    new THREE.Vector3(2.2, 1.4, 2.2)
  );

  // Dashboard main beam
  const dashGeo = trackGeo(createExtrudedBox(1.44, 0.24, 0.34, 0.04, 0.015));
  const dash = new THREE.Mesh(dashGeo);
  dash.position.set(0, 1.00, 0.76);
  registerMeshMaterial(dash, mats.dashTrim, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(dash);

  // Central touchscreen panel
  const screenHousingGeo = trackGeo(createExtrudedBox(0.36, 0.20, 0.04, 0.02, 0.008));
  const screenHousing = new THREE.Mesh(screenHousingGeo);
  screenHousing.position.set(0, 1.14, 0.64);
  screenHousing.rotation.x = -0.15;
  registerMeshMaterial(screenHousing, mats.trimBlack, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(screenHousing);

  const screenFaceGeo = trackGeo(new THREE.PlaneGeometry(0.32, 0.16));
  const screenFace = new THREE.Mesh(screenFaceGeo);
  screenFace.position.set(0, 1.14, 0.618);
  screenFace.rotation.y = Math.PI;
  screenFace.rotation.x = 0.15;
  registerMeshMaterial(screenFace, mats.screenDisplay, 'ivi-1', ownedMaterials, clickableMeshes, false, false);
  ivi.group.add(screenFace);

  // Steering wheel
  const swRingGeo = trackGeo(new THREE.TorusGeometry(0.16, 0.022, 10, 24));
  const swRing = new THREE.Mesh(swRingGeo);
  swRing.position.set(-0.42, 1.08, 0.56);
  swRing.rotation.x = 0.35;
  registerMeshMaterial(swRing, mats.trimBlack, 'ivi-1', ownedMaterials, clickableMeshes);
  ivi.group.add(swRing);

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

  // Front grille radar unit
  const radarGeo = trackGeo(createExtrudedBox(0.18, 0.12, 0.08, 0.015, 0.006));
  const radar = new THREE.Mesh(radarGeo);
  radar.position.set(0, 0.72, 2.08);
  registerMeshMaterial(radar, mats.adasSensor, 'adas-1', ownedMaterials, clickableMeshes);
  adas.group.add(radar);

  // Windshield upper stereo camera pod
  const camPodGeo = trackGeo(createExtrudedBox(0.22, 0.07, 0.14, 0.015, 0.005));
  const camPod = new THREE.Mesh(camPodGeo);
  camPod.position.set(0, 1.74, 0.56);
  registerMeshMaterial(camPod, mats.adasSensor, 'adas-1', ownedMaterials, clickableMeshes);
  adas.group.add(camPod);

  // Central ADAS compute ECU with heatsink fins
  const ecuGeo = trackGeo(createExtrudedBox(0.26, 0.07, 0.22, 0.015, 0.006));
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

  // Front radiator / condenser core behind grille
  const radGeo = trackGeo(createExtrudedBox(0.92, 0.42, 0.08, 0.02, 0.008));
  const radiator = new THREE.Mesh(radGeo);
  radiator.position.set(0, 0.84, 1.92);
  registerMeshMaterial(radiator, mats.hvacCore, 'hvac-1', ownedMaterials, clickableMeshes);
  hvac.group.add(radiator);

  // Firewall AHU blower/evaporator housing
  const blowerGeo = trackGeo(createExtrudedBox(0.56, 0.26, 0.28, 0.04, 0.012));
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
