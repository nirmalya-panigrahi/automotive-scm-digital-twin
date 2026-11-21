/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Layers, Eye, Camera, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { createCarMaterialLibrary } from './carMaterials';
import { buildDefenderModel, DefenderModelHandle } from './buildDefenderModel';
import { loadStudioExrEnvironment } from './proceduralExrEnv';
import { COMPONENT_LIST } from '../../data';

type XrayMode = 'auto' | 'solid' | 'xray';
type CameraPreset = 'focus' | 'studio' | 'top' | 'under';

interface CarTwinViewportProps {
  selectedComponentId: string;
  onSelectComponent: (id: string) => void;
  useSubstitution: boolean;
  calculatedShock: number;
  className?: string;
}

// Reusable module-scope math objects (zero GC inside render loop)
const _camPosGoal = new THREE.Vector3();
const _targetGoal = new THREE.Vector3();
const _highlightColor = new THREE.Color();
const _baseColor = new THREE.Color();
const _pointer = new THREE.Vector2();

const STUDIO_CAM_POS = new THREE.Vector3(4.3, 2.25, 4.6);
const STUDIO_TARGET = new THREE.Vector3(0, 0.85, 0);

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 12, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(2, 6, 23, 0.82)');
  grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.42)');
  grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function CarTwinViewport({
  selectedComponentId,
  onSelectComponent,
  useSubstitution,
  calculatedShock,
  className = 'h-[420px] sm:h-[480px]',
}: CarTwinViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [explodeTarget, setExplodeTarget] = useState(0);
  const [xrayMode, setXrayMode] = useState<XrayMode>('auto');
  const [dockOpen, setDockOpen] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  // Mutable refs read inside WebGL loop without re-creating the scene
  const selectedIdRef = useRef(selectedComponentId);
  const onSelectRef = useRef(onSelectComponent);
  const explodeTargetRef = useRef(explodeTarget);
  const xrayModeRef = useRef(xrayMode);
  const useSubRef = useRef(useSubstitution);
  const shockRef = useRef(calculatedShock);
  const requestRenderRef = useRef<() => void>(() => {});
  const applyPresetRef = useRef<(preset: CameraPreset) => void>(() => {});
  const updateVisualStateRef = useRef<() => void>(() => {});

  selectedIdRef.current = selectedComponentId;
  onSelectRef.current = onSelectComponent;
  explodeTargetRef.current = explodeTarget;
  xrayModeRef.current = xrayMode;
  useSubRef.current = useSubstitution;
  shockRef.current = calculatedShock;

  const selectedMeta = COMPONENT_LIST.find((c) => c.id === selectedComponentId);
  const hoveredMeta = hoveredId ? COMPONENT_LIST.find((c) => c.id === hoveredId) : null;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software WebGL detection (only affects rendering cost, never scene content/logic)
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setContextLost(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 420;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // 2. Scene, Camera, Fog & HDR Studio Environment (RoomEnvironment instant + EXRLoader HDR upgrade)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1120');
    scene.fog = new THREE.FogExp2(0x0b1120, 0.038);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    let activeEnvTarget: THREE.Texture = pmrem.fromScene(roomEnv, 0.04).texture;
    scene.environment = activeEnvTarget;
    roomEnv.dispose();
    pmrem.dispose();

    let disposed = false;
    const cancelExrLoad = loadStudioExrEnvironment(renderer, (hdrEnvMap) => {
      if (disposed) {
        hdrEnvMap.dispose();
        return;
      }
      const prevEnv = activeEnvTarget;
      activeEnvTarget = hdrEnvMap;
      scene.environment = hdrEnvMap;
      prevEnv.dispose();
      requestRender();
    });

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 80);
    camera.position.copy(STUDIO_CAM_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(STUDIO_TARGET);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.1;
    controls.maxDistance = 10.5;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minPolarAngle = 0.12;
    controls.update();

    // 3. 3-Point Sunlight & Studio Softbox Rig (Warm Key Sunlight + Cool Sky/Ground + Rim)
    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x0f172a, 0.72);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.75);
    keyLight.position.set(6.5, 7.2, 5.8);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.radius = 2.5;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 22;
    const d = 3.6;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0003;
    keyLight.shadow.normalBias = 0.018;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.15);
    rimLight.position.set(-6.0, 4.2, -5.5);
    scene.add(rimLight);

    let softboxLight: THREE.RectAreaLight | null = null;
    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      softboxLight = new THREE.RectAreaLight(0xe0f2fe, 3.0, 6.5, 2.4);
      softboxLight.position.set(0, 4.8, 0.4);
      softboxLight.lookAt(0, 0.8, 0);
      scene.add(softboxLight);
    }

    // 4. Ground Showroom Floor + Contact Shadow
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const mats = createCarMaterialLibrary(maxAniso, isSoftwareGl);

    const floorGeo = new THREE.CircleGeometry(18, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      map: mats.floorGridTexture,
      roughness: 0.72,
      metalness: 0.18,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    floor.position.y = 0;
    scene.add(floor);

    const shadowTex = createContactShadowTexture();
    const contactPlaneGeo = new THREE.PlaneGeometry(3.3, 5.6);
    contactPlaneGeo.rotateX(-Math.PI / 2);
    const contactPlaneMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.65,
    });
    const contactPlane = new THREE.Mesh(contactPlaneGeo, contactPlaneMat);
    contactPlane.position.set(0, 0.015, 0);
    scene.add(contactPlane);

    // 5. Build Defender 3D Digital Twin
    const model: DefenderModelHandle = buildDefenderModel(mats);
    scene.add(model.root);

    // Pre-warm shaders on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 6. State & Transitions
    let explodeCurrent = 0;
    let cameraTransitionActive = false;
    _camPosGoal.copy(STUDIO_CAM_POS);
    _targetGoal.copy(STUDIO_TARGET);

    const applyVisualState = () => {
      const selId = selectedIdRef.current;
      const selAssembly = model.components.get(selId);
      const mode = xrayModeRef.current;
      const ghostOuter =
        mode === 'xray' || (mode === 'auto' && Boolean(selAssembly?.isInternal));

      // Highlight color reflects scenario state
      if (useSubRef.current) {
        _highlightColor.setHex(0xf59e0b); // Amber substitution highlight
      } else if (shockRef.current > 15) {
        _highlightColor.setHex(0xf43f5e); // High shock alert rose
      } else {
        _highlightColor.setHex(0x22d3ee); // Standard digital twin cyan
      }

      model.components.forEach((assembly, id) => {
        const isSelected = id === selId;
        assembly.group.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const m = child.material as THREE.MeshStandardMaterial;
          const isGhostable = Boolean(child.userData.isGhostable);

          if (isSelected) {
            // Selected component stands out crisply
            m.transparent = child.userData.baseTransparent;
            m.opacity = child.userData.baseOpacity;
            m.depthWrite = child.userData.baseDepthWrite;

            _baseColor.setHex(child.userData.baseColorHex);
            // Slightly lift very dark base materials (rubber, leather, matte trim) so glow reads clearly
            m.color.copy(_baseColor).lerp(_highlightColor, 0.28);
            m.emissive.copy(_highlightColor);
            m.emissiveIntensity = id === 'gls-1' ? 0.95 : 0.72;
            if (id === 'gls-1') {
              m.transparent = true;
              m.opacity = 0.65;
            }
          } else if (ghostOuter && isGhostable) {
            // Ghost outer shell / glass so internal assemblies are unobstructed
            _baseColor.setHex(child.userData.baseColorHex);
            m.color.copy(_baseColor);
            m.emissive.setHex(0x0f172a);
            m.emissiveIntensity = 0.1;
            m.transparent = true;
            m.opacity = id === 'gls-1' ? 0.12 : 0.17;
            m.depthWrite = false;
          } else {
            // Normal resting appearance
            _baseColor.setHex(child.userData.baseColorHex);
            m.color.copy(_baseColor);
            m.emissive.setHex(child.userData.baseEmissiveHex);
            m.emissiveIntensity = child.userData.baseEmissiveIntensity;
            m.transparent = child.userData.baseTransparent;
            m.opacity = child.userData.baseOpacity;
            m.depthWrite = child.userData.baseDepthWrite;
          }
        });
      });
    };

    const applyCameraPreset = (preset: CameraPreset) => {
      if (preset === 'studio') {
        _targetGoal.copy(STUDIO_TARGET);
        _camPosGoal.copy(STUDIO_CAM_POS);
      } else if (preset === 'top') {
        _targetGoal.set(0, 0.7, 0);
        _camPosGoal.set(0.01, 6.4, 0.6);
      } else if (preset === 'under') {
        _targetGoal.set(0, 0.55, 0);
        _camPosGoal.set(3.4, 0.55, 3.2);
      } else {
        const asm = model.components.get(selectedIdRef.current);
        if (asm) {
          _targetGoal.copy(asm.focusTarget);
          _camPosGoal.copy(asm.focusTarget).add(asm.cameraOffset);
        } else {
          _targetGoal.copy(STUDIO_TARGET);
          _camPosGoal.copy(STUDIO_CAM_POS);
        }
      }
      cameraTransitionActive = true;
      requestRender();
    };

    applyPresetRef.current = applyCameraPreset;
    updateVisualStateRef.current = () => {
      applyVisualState();
      requestRender();
    };

    // 7. Coalesced On-Demand Rendering + Software WebGL Pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        let needsMoreFrames = false;

        // Smooth exploded-view damping
        const expTarget = explodeTargetRef.current;
        if (Math.abs(explodeCurrent - expTarget) > 0.002) {
          explodeCurrent = isSoftwareGl
            ? expTarget
            : THREE.MathUtils.damp(explodeCurrent, expTarget, 7.5, dt);
          if (Math.abs(explodeCurrent - expTarget) <= 0.002) explodeCurrent = expTarget;
          else needsMoreFrames = true;

          model.components.forEach((asm) => {
            for (let i = 0; i < asm.explodeParts.length; i++) {
              const p = asm.explodeParts[i];
              p.object.position
                .copy(p.basePos)
                .addScaledVector(p.explodeDelta, explodeCurrent);
            }
          });
        }

        // Smooth camera focus transition
        if (cameraTransitionActive) {
          if (isSoftwareGl) {
            camera.position.copy(_camPosGoal);
            controls.target.copy(_targetGoal);
            cameraTransitionActive = false;
          } else {
            const k = 1 - Math.exp(-6.5 * dt);
            camera.position.lerp(_camPosGoal, k);
            controls.target.lerp(_targetGoal, k);
            if (
              camera.position.distanceTo(_camPosGoal) < 0.025 &&
              controls.target.distanceTo(_targetGoal) < 0.015
            ) {
              camera.position.copy(_camPosGoal);
              controls.target.copy(_targetGoal);
              cameraTransitionActive = false;
            } else {
              needsMoreFrames = true;
            }
          }
        }

        if (controls.update()) {
          needsMoreFrames = true;
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRenderRef.current = requestRender;

    // 8. Controls & Raycasting Interaction
    const onControlStart = () => {
      cameraTransitionActive = false;
    };
    const onControlChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    const raycaster = new THREE.Raycaster();
    let downX = 0;
    let downY = 0;
    let lastHoverTime = 0;

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist > 6) return; // Dragging orbit, not clicking
      updatePointer(e);
      raycaster.setFromCamera(_pointer, camera);
      const hits = raycaster.intersectObjects(model.clickableMeshes, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.componentId as string | undefined;
        if (hitId) {
          onSelectRef.current(hitId);
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 60) return;
      lastHoverTime = now;
      updatePointer(e);
      raycaster.setFromCamera(_pointer, camera);
      const hits = raycaster.intersectObjects(model.clickableMeshes, false);
      const hitId =
        hits.length > 0 ? (hits[0].object.userData.componentId as string) : null;
      setHoveredId((prev) => (prev === hitId ? prev : hitId));
      renderer.domElement.style.cursor = hitId ? 'pointer' : 'grab';
    };

    const onPointerLeave = () => {
      setHoveredId(null);
      renderer.domElement.style.cursor = 'grab';
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    // WebGL context loss safety
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    // ResizeObserver for responsive container
    const resizeObserver = new ResizeObserver(() => {
      if (disposed || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    // Initial state & draw
    applyVisualState();
    requestRender();

    return () => {
      disposed = true;
      cancelExrLoad();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlChange);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      model.dispose();
      mats.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      contactPlaneGeo.dispose();
      contactPlaneMat.dispose();
      shadowTex.dispose();
      activeEnvTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Re-apply highlight/X-ray & gently focus camera when dropdown or scenario props change
  useEffect(() => {
    updateVisualStateRef.current();
  }, [selectedComponentId, xrayMode, useSubstitution, calculatedShock]);

  // Smoothly focus camera on component whenever selectedComponentId changes
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    applyPresetRef.current('focus');
  }, [selectedComponentId]);

  useEffect(() => {
    requestRenderRef.current();
  }, [explodeTarget]);

  const handleToggleExplode = useCallback(() => {
    setExplodeTarget((prev) => (prev > 0.5 ? 0 : 1));
  }, []);

  const accentBadgeClass = useSubstitution
    ? 'text-amber-400 border-amber-500/40'
    : calculatedShock > 15
      ? 'text-rose-400 border-rose-500/40'
      : 'text-cyan-400 border-cyan-500/40';

  return (
    <div className={`relative w-full rounded-xl overflow-hidden border border-slate-800 bg-[#0b1120] select-none ${className}`}>
      {/* Isolated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Context Lost / WebGL Fallback */}
      {contextLost && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 text-center p-6 z-30">
          <p className="text-sm font-semibold text-slate-200 mb-1">3D Viewport Unavailable</p>
          <p className="text-xs font-mono text-slate-400">
            WebGL rendering context could not be initialized on this device.
          </p>
        </div>
      )}

      {/* Top-Left Minimal Spec Readout (no backdrop-filter over WebGL, no pulsing dots) */}
      <div className="absolute top-3.5 left-3.5 z-10 pointer-events-none max-w-[75%]">
        <div className={`inline-flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-[#0b1120]/90 border ${accentBadgeClass}`}>
          <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400">
            3D BOM Twin · {selectedMeta?.category ?? 'Assembly'}
          </span>
          <span className="text-xs font-semibold text-white truncate">
            {selectedMeta?.name ?? 'Vehicle Assembly'}
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            {selectedMeta?.weight_kg ?? 0} kg · Click any 3D part to inspect · Drag to orbit
          </span>
        </div>
      </div>

      {/* Top-Right Hover Inspector Readout */}
      {hoveredMeta && hoveredMeta.id !== selectedComponentId && (
        <div className="absolute top-3.5 right-3.5 z-10 pointer-events-none hidden sm:block">
          <div className="px-3 py-1.5 rounded-lg bg-[#0b1120]/90 border border-slate-700 text-[10px] font-mono text-slate-300">
            Click to select: <span className="text-cyan-400 font-semibold">{hoveredMeta.name}</span>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center w-[min(740px,94%)] pointer-events-none">
        <button
          type="button"
          onClick={() => setDockOpen((o) => !o)}
          className="pointer-events-auto mb-1.5 px-3 py-1 rounded-t-md bg-[#0f172a]/95 border border-b-0 border-slate-700 text-[10px] font-mono uppercase tracking-wider text-slate-300 hover:text-cyan-400 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          {dockOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          {dockOpen ? 'Hide 3D Controls' : 'Show 3D Controls'}
        </button>

        {dockOpen && (
          <div className="pointer-events-auto w-full rounded-lg bg-[#0f172a]/95 border border-slate-700/90 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xl">
            {/* Exploded View Slider + Toggle */}
            <div className="flex items-center gap-2.5 min-w-[190px] flex-1">
              <button
                type="button"
                onClick={handleToggleExplode}
                className={`px-2.5 py-1.5 rounded text-[10px] font-mono uppercase tracking-wider border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  explodeTarget > 0.5
                    ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <Layers size={12} />
                {explodeTarget > 0.5 ? 'Assemble' : 'Explode'}
              </button>
              <input
                type="range"
                aria-label="Exploded view separation"
                min="0"
                max="1"
                step="0.02"
                value={explodeTarget}
                onChange={(e) => setExplodeTarget(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] font-mono text-slate-400 tabular-nums w-8 text-right shrink-0">
                {Math.round(explodeTarget * 100)}%
              </span>
            </div>

            {/* X-Ray Shell Mode */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded p-0.5 shrink-0">
              <Eye size={12} className="text-slate-500 ml-1.5 mr-1" />
              {(['auto', 'solid', 'xray'] as XrayMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setXrayMode(mode)}
                  className={`px-2 py-1 rounded text-[10px] font-mono uppercase transition-colors cursor-pointer whitespace-nowrap ${
                    xrayMode === mode
                      ? 'bg-slate-800 text-cyan-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode === 'auto' ? 'Auto X-Ray' : mode}
                </button>
              ))}
            </div>

            {/* Camera Presets */}
            <div className="flex items-center gap-1 shrink-0">
              <Camera size={12} className="text-slate-500 mr-1 hidden sm:inline" />
              {(
                [
                  ['focus', 'Focus'],
                  ['studio', '3/4'],
                  ['top', 'Top'],
                  ['under', 'Low'],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPresetRef.current(preset)}
                  className="px-2 py-1 rounded bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-[10px] font-mono uppercase text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                title="Reset View & Assemble"
                onClick={() => {
                  setExplodeTarget(0);
                  setXrayMode('auto');
                  applyPresetRef.current('studio');
                }}
                className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
