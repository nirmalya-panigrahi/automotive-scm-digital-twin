/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

/**
 * Generates an uncompressed 32-bit float OpenEXR equirectangular HDR environment
 * combining a sunlit alpine/studio sky dome, bright overhead softbox strip highlights,
 * and a dark reflective studio floor horizon for high-contrast clearcoat car reflections.
 */
function buildStudioSkyExrBuffer(width: number, height: number): ArrayBuffer {
  const numChannels = 3; // B, G, R (alphabetical order per OpenEXR spec)
  const bytesPerSample = 4; // FLOAT (pixelType = 2)
  const bytesPerScanlineData = width * numChannels * bytesPerSample;

  const encoder = new TextEncoder();
  const headerChunks: Uint8Array[] = [];
  let headerByteLen = 0;

  const pushBytes = (arr: Uint8Array) => {
    headerChunks.push(arr);
    headerByteLen += arr.length;
  };

  const pushCString = (str: string) => {
    const encoded = encoder.encode(str);
    const out = new Uint8Array(encoded.length + 1);
    out.set(encoded);
    out[encoded.length] = 0;
    pushBytes(out);
  };

  const pushAttr = (name: string, type: string, payload: Uint8Array) => {
    pushCString(name);
    pushCString(type);
    const sizeBuf = new Uint8Array(4);
    new DataView(sizeBuf.buffer).setUint32(0, payload.length, true);
    pushBytes(sizeBuf);
    pushBytes(payload);
  };

  // Magic + version
  const preamble = new Uint8Array(8);
  const preView = new DataView(preamble.buffer);
  preView.setUint32(0, 20000630, true);
  preamble[4] = 2;
  pushBytes(preamble);

  // channels (B, G, R)
  const chParts: number[] = [];
  for (const chName of ['B', 'G', 'R']) {
    chParts.push(chName.charCodeAt(0), 0);
    const info = new Uint8Array(16);
    const iv = new DataView(info.buffer);
    iv.setInt32(0, 2, true); // pixelType = 2 (FLOAT)
    iv.setUint8(4, 0); // pLinear
    iv.setInt32(8, 1, true); // xSampling
    iv.setInt32(12, 1, true); // ySampling
    for (let i = 0; i < 16; i++) chParts.push(info[i]);
  }
  chParts.push(0);
  pushAttr('channels', 'chlist', new Uint8Array(chParts));

  // compression = 0 (NO_COMPRESSION)
  pushAttr('compression', 'compression', new Uint8Array([0]));

  // dataWindow & displayWindow
  const win = new Uint8Array(16);
  const wv = new DataView(win.buffer);
  wv.setInt32(0, 0, true);
  wv.setInt32(4, 0, true);
  wv.setInt32(8, width - 1, true);
  wv.setInt32(12, height - 1, true);
  pushAttr('dataWindow', 'box2i', win);
  pushAttr('displayWindow', 'box2i', win);

  // lineOrder = 0 (INCREASING_Y)
  pushAttr('lineOrder', 'lineOrder', new Uint8Array([0]));

  // pixelAspectRatio = 1.0
  const par = new Uint8Array(4);
  new DataView(par.buffer).setFloat32(0, 1.0, true);
  pushAttr('pixelAspectRatio', 'float', par);

  // screenWindowCenter = (0, 0)
  pushAttr('screenWindowCenter', 'v2f', new Uint8Array(8));

  // screenWindowWidth = 1.0
  const sww = new Uint8Array(4);
  new DataView(sww.buffer).setFloat32(0, 1.0, true);
  pushAttr('screenWindowWidth', 'float', sww);

  // End of header
  pushBytes(new Uint8Array([0]));

  const offsetTableSize = height * 8;
  const scanlineChunkSize = 8 + bytesPerScanlineData;
  const totalSize = headerByteLen + offsetTableSize + height * scanlineChunkSize;

  const buffer = new ArrayBuffer(totalSize);
  const u8 = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Copy header
  let cursor = 0;
  for (const chunk of headerChunks) {
    u8.set(chunk, cursor);
    cursor += chunk.length;
  }

  // Write scanline offset table
  const dataStart = headerByteLen + offsetTableSize;
  for (let y = 0; y < height; y++) {
    const chunkOffset = dataStart + y * scanlineChunkSize;
    view.setUint32(cursor, chunkOffset >>> 0, true);
    view.setUint32(cursor + 4, Math.floor(chunkOffset / 0x100000000), true);
    cursor += 8;
  }

  // Sun direction normalized (matches primary directional sunlight)
  const sunDir = new THREE.Vector3(6.5, 7.2, 5.8).normalize();
  const dir = new THREE.Vector3();

  // Fill HDR equirectangular pixels
  for (let y = 0; y < height; y++) {
    view.setInt32(cursor, y, true); // line_no
    view.setUint32(cursor + 4, bytesPerScanlineData, true); // data_len
    cursor += 8;

    // v = 1 at y=0 (zenith), -1 at y=height-1 (nadir)
    const theta = (y / (height - 1)) * Math.PI; // 0 = +Y zenith, PI = -Y nadir
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const bRowStart = cursor;
    const gRowStart = cursor + width * 4;
    const rRowStart = cursor + width * 8;

    for (let x = 0; x < width; x++) {
      const phi = (x / width) * Math.PI * 2;
      dir.set(sinTheta * Math.cos(phi), cosTheta, sinTheta * Math.sin(phi));

      let r = 0.06;
      let g = 0.09;
      let b = 0.14;

      if (dir.y >= 0) {
        // Upper sky dome: deep azure zenith blending into bright crisp studio horizon band
        const horizonFactor = Math.pow(1 - dir.y, 3.2);
        r = 0.28 + 0.85 * horizonFactor;
        g = 0.48 + 0.85 * horizonFactor;
        b = 0.85 + 0.65 * horizonFactor;

        // Crisp overhead automotive studio softbox strips for elongated body & glass highlights
        if (dir.y > 0.62 && Math.abs(dir.x) < 0.42 && Math.abs(dir.z) < 0.24) {
          r += 4.5;
          g += 4.7;
          b += 5.0;
        }
        // Secondary side studio light strip
        if (dir.y > 0.25 && dir.y < 0.52 && dir.x < -0.55) {
          r += 2.2;
          g += 2.8;
          b += 3.6;
        }

        // High-dynamic-range solar disc + corona
        const sunDot = Math.max(0, dir.dot(sunDir));
        const sunDisc = Math.pow(sunDot, 160) * 18.0;
        const sunGlow = Math.pow(sunDot, 10) * 1.8;
        r += sunDisc * 1.05 + sunGlow * 1.05;
        g += sunDisc * 0.98 + sunGlow * 0.95;
        b += sunDisc * 0.86 + sunGlow * 0.82;
      } else {
        // Dark studio ground bounce with subtle cyan grid horizon reflection
        const groundT = Math.min(1, Math.abs(dir.y) * 3.5);
        r = THREE.MathUtils.lerp(0.22, 0.04, groundT);
        g = THREE.MathUtils.lerp(0.28, 0.055, groundT);
        b = THREE.MathUtils.lerp(0.36, 0.09, groundT);
      }

      const pxOff = x * 4;
      view.setFloat32(bRowStart + pxOff, b, true);
      view.setFloat32(gRowStart + pxOff, g, true);
      view.setFloat32(rRowStart + pxOff, r, true);
    }

    cursor += bytesPerScanlineData;
  }

  return buffer;
}

/**
 * Loads a procedural high-resolution HDR environment via Three.js EXRLoader + PMREMGenerator
 * with zero external network dependencies.
 */
export function loadStudioExrEnvironment(
  renderer: THREE.WebGLRenderer,
  onReady: (envMap: THREE.Texture) => void
): () => void {
  let cancelled = false;
  const exrBuffer = buildStudioSkyExrBuffer(512, 256);
  const blobUrl = URL.createObjectURL(new Blob([exrBuffer], { type: 'application/octet-stream' }));

  const loader = new EXRLoader();
  loader.setDataType(THREE.FloatType);

  loader.load(
    blobUrl,
    (exrTexture) => {
      URL.revokeObjectURL(blobUrl);
      if (cancelled) {
        exrTexture.dispose();
        return;
      }
      exrTexture.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const envMap = pmrem.fromEquirectangular(exrTexture).texture;
      exrTexture.dispose();
      pmrem.dispose();
      onReady(envMap);
    },
    undefined,
    () => {
      URL.revokeObjectURL(blobUrl);
    }
  );

  return () => {
    cancelled = true;
  };
}
