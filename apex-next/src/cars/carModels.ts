import * as THREE from 'three';
import { CAR_SPECS, type CarId, type CarSpec } from './carSpecs';
import {
  makeContactShadowTexture,
  makeGlowTexture,
  makeGrilleTexture,
  makeIntercoolerTexture,
  makeR34HeadlightTexture,
  makeR34SideLiveryTexture,
} from '../core/textures';

export interface CarVisualRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  bodyMat: THREE.MeshPhysicalMaterial;
  tailMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  rotorMat: THREE.MeshStandardMaterial;
  underglowMat: THREE.MeshBasicMaterial;
  underglowMesh: THREE.Mesh;
  wheels: {
    pivot: THREE.Group;
    spin: THREE.Group;
    front: boolean;
  }[];
  nosFlames: THREE.Group[];
  nosLight: THREE.PointLight | null;
  turretRoot: THREE.Group;
  turretYaw: THREE.Group;
  turretPitch: THREE.Group;
  turretRecoil: THREE.Group;
  muzzleFlash: THREE.Group;
  muzzlePoint: THREE.Object3D;
  dispose: () => void;
}

// Helper: extrude a 2D (z, y) side-profile shape along X width and align +x2d -> +Z (forward)
function extrudeSideProfile(
  pts: [number, number][],
  width: number,
  bevel = 0.045
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], pts[i][1]);
  }
  shape.closePath();

  const innerW = Math.max(0.1, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerW,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -innerW / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// Taper top of cabin slightly in X so greenhouse looks sculpted rather than blocky
function taperTopX(geo: THREE.BufferGeometry, yThreshold: number, xFactor: number): void {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > yThreshold) {
      const t = Math.min(1, (y - yThreshold) / 0.45);
      pos.setX(i, pos.getX(i) * (1 - (1 - xFactor) * t));
    }
  }
  geo.computeVertexNormals();
}

function computeSportScaleX(y: number, z: number, halfL: number): number {
  let scaleX = 1;
  const az = Math.abs(z);
  if (az > halfL * 0.66) {
    const t = Math.min(1, (az - halfL * 0.66) / (halfL * 0.36));
    scaleX *= 1 - 0.085 * t * t;
  }
  if (y < 0.35) {
    const t = Math.min(1, (0.35 - y) / 0.18);
    scaleX *= 1 - 0.055 * t;
  } else if (y > 0.62) {
    const t = Math.min(1, (y - 0.62) / 0.28);
    scaleX *= 1 - 0.032 * t;
  }
  return scaleX;
}

// Sculpt extruded chassis slabs into tapered bumper planforms, lower rocker pinch & fender crown
function sculptBodyGeometry(
  geo: THREE.BufferGeometry,
  halfL: number,
  style: 'sport' | 'box' | 'wedge'
): void {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let scaleX = 1;

    if (style === 'wedge') {
      // Cybertruck keeps flat stainless planar facets with slight extreme corner beveling
      const az = Math.abs(z);
      if (az > halfL * 0.88) {
        const t = Math.min(1, (az - halfL * 0.88) / (halfL * 0.14));
        scaleX *= 1 - 0.04 * t;
      }
    } else if (style === 'box') {
      if (z > halfL * 0.84) {
        const t = Math.min(1, (z - halfL * 0.84) / (halfL * 0.18));
        scaleX *= 1 - 0.055 * t * t;
      }
      if (y < 0.36) {
        const t = Math.min(1, (0.36 - y) / 0.18);
        scaleX *= 1 - 0.045 * t;
      }
    } else {
      // Modern sports/GT cars: swept bumper plan corners + lower rocker sill tumblehome + fender shoulder crown
      scaleX = computeSportScaleX(y, z, halfL);
    }

    x *= scaleX;
    pos.setX(i, x);
  }
  geo.computeVertexNormals();
}

// Conformal curved side decal sheet wrapping flush onto a sculpted sport flank & aero skirt
function makeR34SideDecalGeo(
  sideSign: 1 | -1,
  halfBodyW: number,
  halfL: number,
  skirtHalfX: number,
  skirtZMin: number,
  skirtZMax: number,
  canardHalfX: number
): THREE.BufferGeometry {
  const zMax = halfL - 0.12;
  const zMin = -halfL + 0.11;
  const yMin = 0.138;
  const yMax = 0.79;
  const yBot = 0.145;
  const yTop = 0.765;
  const zCols = 32;
  const yRows = 8;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= yRows; iy++) {
    const ty = iy / yRows;
    const y = yBot + (yTop - yBot) * ty;
    const v = (y - yMin) / (yMax - yMin);
    for (let iz = 0; iz <= zCols; iz++) {
      const tz = iz / zCols;
      const z = zMax + (zMin - zMax) * tz;
      const u = (zMax - z) / (zMax - zMin);
      let surfaceX = halfBodyW * computeSportScaleX(y, z, halfL);
      if (y <= 0.252 && z >= skirtZMin - 0.02 && z <= skirtZMax + 0.02) {
        surfaceX = Math.max(surfaceX, skirtHalfX);
      }
      if (y <= 0.246 && z >= halfL - 0.25) {
        surfaceX = Math.max(surfaceX, canardHalfX);
      }
      const x = sideSign * (surfaceX + 0.006);
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  const stride = zCols + 1;
  for (let iy = 0; iy < yRows; iy++) {
    for (let iz = 0; iz < zCols; iz++) {
      const a = iy * stride + iz;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (sideSign > 0) {
        indices.push(a, b, d, a, d, c);
      } else {
        indices.push(a, d, b, a, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Flush ribbon stripe following top [z, y] body/hood/roof contour points
function makeStripeRibbonGeo(pts: [number, number][], width: number, yLift = 0.003): THREE.BufferGeometry {
  const hw = width / 2;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < pts.length; i++) {
    const [z, y] = pts[i];
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(pts.length - 1, i + 1)];
    const dz = pNext[0] - pPrev[0];
    const dy = pNext[1] - pPrev[1];
    const len = Math.hypot(dz, dy) || 1;
    // Normal pointing upward/outward (+Y for hood +Z tangent, +Y for trunk +Z tangent)
    const nz = -dy / len;
    const ny = Math.abs(dz / len);
    const py = y + ny * yLift;
    const pz = z + nz * yLift;
    positions.push(-hw, py, pz, hw, py, pz);
    if (i > 0) {
      const base = (i - 1) * 2;
      indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeInsideInteriorGeo(cabinGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = cabinGeo.clone();
  g.computeBoundingBox();
  const c = new THREE.Vector3();
  g.boundingBox!.getCenter(c);
  g.translate(-c.x, -c.y, -c.z);
  g.scale(0.84, 0.80, 0.80);
  g.translate(c.x, c.y - 0.025, c.z - 0.02);
  return g;
}

interface SharedCarAssets {
  mCarbon: THREE.MeshStandardMaterial;
  mDarkTrim: THREE.MeshStandardMaterial;
  mInterior: THREE.MeshStandardMaterial;
  mWheelWell: THREE.MeshStandardMaterial;
  mGrille: THREE.MeshStandardMaterial;
  mTire: THREE.MeshStandardMaterial;
  mGlass: THREE.MeshPhysicalMaterial;
  mChrome: THREE.MeshStandardMaterial;
  mIntercooler: THREE.MeshStandardMaterial;
  mPlate: THREE.MeshStandardMaterial;
  mFlameCore: THREE.MeshBasicMaterial;
  mFlameOuter: THREE.MeshBasicMaterial;
  mGunMetal: THREE.MeshStandardMaterial;
  mGunBarrel: THREE.MeshStandardMaterial;
  mGunAccent: THREE.MeshStandardMaterial;
  mGunSight: THREE.MeshBasicMaterial;
  mMuzzleFlash: THREE.MeshBasicMaterial;
  glowTex: THREE.CanvasTexture;
  contactShadowTex: THREE.CanvasTexture;
  icTex: THREE.CanvasTexture;
  r34HlTex: THREE.CanvasTexture;
  r34SideTex: THREE.CanvasTexture;
}

let sharedAssets: SharedCarAssets | null = null;

function getSharedAssets(): SharedCarAssets {
  if (sharedAssets) return sharedAssets;
  const grilleTex = makeGrilleTexture();
  grilleTex.repeat.set(3, 1);
  sharedAssets = {
    mCarbon: new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.34, metalness: 0.45 }),
    mDarkTrim: new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.72, metalness: 0.2 }),
    mInterior: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.94, metalness: 0.04 }),
    mWheelWell: new THREE.MeshStandardMaterial({ color: 0x090b0f, roughness: 0.88, metalness: 0.15 }),
    mGrille: new THREE.MeshStandardMaterial({ map: grilleTex, color: 0xffffff, roughness: 0.48, metalness: 0.65 }),
    mTire: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.86, metalness: 0.06 }),
    mGlass: new THREE.MeshPhysicalMaterial({
      color: 0x050911,
      roughness: 0.03,
      metalness: 0.25,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      reflectivity: 1.0,
      envMapIntensity: 1.9,
      transparent: true,
      opacity: 0.76,
    }),
    mChrome: new THREE.MeshStandardMaterial({ color: 0xdce4ee, roughness: 0.15, metalness: 0.96 }),
    mIntercooler: new THREE.MeshStandardMaterial({ color: 0xa2b0bf, roughness: 0.28, metalness: 0.90 }),
    mPlate: new THREE.MeshStandardMaterial({ color: 0xdde3eb, roughness: 0.45, metalness: 0.25 }),
    mFlameCore: new THREE.MeshBasicMaterial({
      color: 0xe8fbff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    mFlameOuter: new THREE.MeshBasicMaterial({
      color: 0x00b7ff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    mGunMetal: new THREE.MeshStandardMaterial({ color: 0x222832, roughness: 0.34, metalness: 0.84 }),
    mGunBarrel: new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.24, metalness: 0.94 }),
    mGunAccent: new THREE.MeshStandardMaterial({
      color: 0xff6d00,
      emissive: new THREE.Color(0xff4500),
      emissiveIntensity: 0.75,
      roughness: 0.3,
      metalness: 0.4,
    }),
    mGunSight: new THREE.MeshBasicMaterial({ color: 0x00e5ff, toneMapped: false }),
    mMuzzleFlash: new THREE.MeshBasicMaterial({
      color: 0xffd25a,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    glowTex: makeGlowTexture(),
    contactShadowTex: makeContactShadowTexture(),
    icTex: makeIntercoolerTexture(),
    r34HlTex: makeR34HeadlightTexture(),
    r34SideTex: makeR34SideLiveryTexture(),
  };
  return sharedAssets;
}

interface CachedSpecGeos {
  bodyGeo: THREE.BufferGeometry;
  cabinGeo: THREE.BufferGeometry;
  interiorGeo: THREE.BufferGeometry;
  roofCapGeo: THREE.BufferGeometry;
  roofCenterZ: number;
  roofTopY: number;
  tireGeo: THREE.BufferGeometry;
  rimRingGeo: THREE.BufferGeometry;
  rimOuterLipGeo: THREE.BufferGeometry;
  hubGeo: THREE.BufferGeometry;
  spokeGeo: THREE.BufferGeometry;
  rotorGeo: THREE.BufferGeometry;
  caliperGeo: THREE.BufferGeometry;
  splitterGeo: THREE.BufferGeometry;
  skirtGeo: THREE.BufferGeometry;
  diffuserGeo: THREE.BufferGeometry;
  archGeo: THREE.BufferGeometry;
  flameOuterGeo: THREE.BufferGeometry;
  flameInnerGeo: THREE.BufferGeometry;
  exhaustGeo: THREE.BufferGeometry;
}

const geoCache = new Map<CarId, CachedSpecGeos>();

function getSpecGeos(id: CarId): CachedSpecGeos {
  const existing = geoCache.get(id);
  if (existing) return existing;

  const S = CAR_SPECS[id];
  const halfL = S.length / 2;

  let bodyPts: [number, number][];
  let cabinPts: [number, number][];
  let cabinW = S.width * 0.78;
  let cabinTap = 0.78;
  let roofSpan: [number, number, number] = [-0.26, 0.85, 1.27]; // [centerZ, len, topY]

  if (id === 'r34') {
    // Sleek Skyline GT-R R34 C-West profile with inset bevels matching exact outer bumper/hood bounds
    bodyPts = [
      [-halfL + 0.05, 0.21],
      [-halfL + 0.048, 0.745],
      [-1.34, 0.785],
      [0.74, 0.755],
      [1.02, 0.742],
      [1.62, 0.692],
      [2.10, 0.595],
      [halfL - 0.048, 0.495],
      [halfL - 0.048, 0.20],
      [halfL - 0.078, 0.193],
      [-1.92, 0.215],
    ];
    cabinPts = [
      [-1.34, 0.79],
      [-0.76, 1.215],
      [0.22, 1.215],
      [0.84, 0.79],
    ];
    cabinW = S.width * 0.79;
    cabinTap = 0.78;
    roofSpan = [-0.27, 0.90, 1.242];
  } else if (id === 'supra') {
    bodyPts = [
      [-halfL, 0.28],
      [-halfL + 0.14, 0.80],
      [-1.15, 0.83],
      [0.72, 0.80],
      [1.36, 0.77],
      [1.92, 0.67],
      [2.16, 0.56],
      [halfL, 0.40],
      [halfL - 0.09, 0.21],
      [-halfL + 0.06, 0.21],
    ];
    cabinPts = [
      [-1.56, 0.79],
      [-0.78, 1.19],
      [-0.45, 1.22],
      [0.14, 1.22],
      [0.80, 0.77],
    ];
    cabinW = S.width * 0.77;
    cabinTap = 0.76;
    roofSpan = [-0.155, 0.54, 1.248];
  } else if (id === 'charger') {
    bodyPts = [
      [-halfL, 0.28],
      [-halfL + 0.05, 0.86],
      [-1.45, 0.90],
      [0.75, 0.91],
      [2.24, 0.81],
      [halfL, 0.64],
      [halfL - 0.05, 0.24],
      [-halfL + 0.06, 0.24],
    ];
    cabinPts = [
      [-1.50, 0.88],
      [-0.82, 1.32],
      [0.22, 1.32],
      [0.85, 0.88],
    ];
    cabinW = S.width * 0.80;
    cabinTap = 0.82;
    roofSpan = [-0.30, 0.94, 1.348];
  } else if (id === 'huracan') {
    bodyPts = [
      [-halfL, 0.24],
      [-halfL + 0.08, 0.78],
      [-0.70, 0.84],
      [0.75, 0.73],
      [1.40, 0.72],
      [1.95, 0.52],
      [halfL, 0.34],
      [halfL - 0.10, 0.17],
      [-halfL + 0.05, 0.17],
    ];
    cabinPts = [
      [-0.90, 0.79],
      [-0.28, 1.11],
      [0.36, 1.09],
      [1.26, 0.64],
    ];
    cabinW = S.width * 0.72;
    cabinTap = 0.72;
    roofSpan = [0.04, 0.56, 1.13];
  } else if (id === 'cybertruck') {
    bodyPts = [
      [-halfL, 0.54],
      [-halfL + 0.04, 1.22],
      [-1.08, 1.22],
      [-0.20, 1.65],
      [1.38, 1.22],
      [halfL - 0.14, 0.94],
      [halfL, 0.64],
      [halfL - 0.14, 0.30],
      [1.92, 0.30],
      [1.48, 0.25],
      [-1.68, 0.25],
      [-halfL + 0.16, 0.34],
    ];
    cabinPts = [
      [-1.08, 1.24],
      [-0.22, 1.665],
      [1.34, 1.265],
      [0.95, 1.02],
    ];
    cabinW = S.width - 0.03;
    cabinTap = 0.88;
    roofSpan = [-0.20, 0.18, 1.69];
  } else if (id === 'gwagon') {
    bodyPts = [
      [-halfL, 0.36],
      [-halfL + 0.03, 1.06],
      [0.92, 1.06],
      [2.24, 1.00],
      [halfL, 0.86],
      [halfL - 0.04, 0.34],
      [-halfL + 0.04, 0.34],
    ];
    cabinPts = [
      [-halfL + 0.08, 1.04],
      [-halfL + 0.20, 1.68],
      [0.46, 1.68],
      [0.90, 1.04],
    ];
    cabinW = S.width * 0.86;
    cabinTap = 0.90;
    roofSpan = [-0.85, 2.28, 1.718];
  } else if (id === 'porsche') {
    // Classic 911 Turbo (930): teardrop fastback roof, sloped center frunk hood & rear engine deck
    bodyPts = [
      [-halfL + 0.08, 0.21],
      [-halfL, 0.30],
      [-halfL + 0.04, 0.74],
      [-1.22, 0.77],
      [0.58, 0.78],
      [0.92, 0.72],
      [1.56, 0.56],
      [1.92, 0.48],
      [halfL, 0.41],
      [halfL - 0.06, 0.21],
    ];
    cabinPts = [
      [-1.76, 0.75],
      [-0.56, 1.23],
      [0.12, 1.23],
      [0.76, 0.76],
    ];
    cabinW = S.width * 0.77;
    cabinTap = 0.76;
    roofSpan = [-0.22, 0.64, 1.258];
  } else {
    // 370z
    bodyPts = [
      [-halfL, 0.26],
      [-halfL + 0.12, 0.78],
      [-1.10, 0.82],
      [0.62, 0.79],
      [1.30, 0.75],
      [1.82, 0.65],
      [halfL, 0.45],
      [halfL - 0.07, 0.20],
      [-halfL + 0.06, 0.20],
    ];
    cabinPts = [
      [-1.46, 0.76],
      [-0.68, 1.22],
      [0.14, 1.22],
      [0.74, 0.76],
    ];
    cabinW = S.width * 0.77;
    cabinTap = 0.77;
    roofSpan = [-0.27, 0.74, 1.248];
  }

  const bodyWidth = S.width - 0.06;
  const bodyGeo = extrudeSideProfile(bodyPts, bodyWidth, id === 'cybertruck' ? 0.025 : id === 'r34' ? 0.048 : 0.055);
  sculptBodyGeometry(
    bodyGeo,
    halfL,
    id === 'cybertruck' ? 'wedge' : id === 'gwagon' ? 'box' : 'sport'
  );
  const cabinGeo = extrudeSideProfile(cabinPts, cabinW, id === 'cybertruck' ? 0.015 : id === 'r34' ? 0.036 : 0.038);
  taperTopX(cabinGeo, id === 'cybertruck' ? 1.15 : id === 'gwagon' ? 1.06 : 0.85, cabinTap);
  const interiorGeo = makeInsideInteriorGeo(cabinGeo);

  // Hollow toroidal rubber tire with curved sidewalls so spokes, rotors & calipers show cleanly
  const hw = S.wheelW * 0.5;
  const rOut = S.wheelR;
  const rRim = S.wheelR * 0.69;
  const tireProfile = [
    new THREE.Vector2(rRim * 0.88, -hw * 0.84),
    new THREE.Vector2(rOut * 0.91, -hw),
    new THREE.Vector2(rOut, -hw * 0.80),
    new THREE.Vector2(rOut, hw * 0.80),
    new THREE.Vector2(rOut * 0.91, hw),
    new THREE.Vector2(rRim * 0.88, hw * 0.84),
    new THREE.Vector2(rRim * 0.84, hw * 0.84),
    new THREE.Vector2(rRim * 0.84, -hw * 0.84),
    new THREE.Vector2(rRim * 0.88, -hw * 0.84),
  ];
  const tireGeo = new THREE.LatheGeometry(tireProfile, 28);
  tireGeo.rotateZ(Math.PI / 2);

  // Open-ended inner barrel + outer machined alloy rim lip + center hub
  const rimRingGeo = new THREE.CylinderGeometry(rRim, rRim, S.wheelW * 0.86, 24, 1, true);
  rimRingGeo.rotateZ(Math.PI / 2);

  const rimOuterLipGeo = new THREE.TorusGeometry(rRim * 0.985, 0.022, 10, 28);
  rimOuterLipGeo.rotateY(Math.PI / 2);

  const hubGeo = new THREE.CylinderGeometry(S.wheelR * 0.16, S.wheelR * 0.18, 0.055, 14);
  hubGeo.rotateZ(Math.PI / 2);

  // Radial spoke projecting outward from center hub (+Y) for 5/6-spoke deep alloy wheels
  const spokeLen = rRim - S.wheelR * 0.12;
  const spokeGeo = new THREE.BoxGeometry(0.036, spokeLen, 0.044);
  spokeGeo.translate(0, S.wheelR * 0.10 + spokeLen / 2, 0);

  const rotorGeo = new THREE.CylinderGeometry(S.wheelR * 0.56, S.wheelR * 0.56, 0.034, 24);
  rotorGeo.rotateZ(Math.PI / 2);
  const caliperGeo = new THREE.BoxGeometry(0.058, S.wheelR * 0.34, 0.135);

  const splitterGeo = new THREE.BoxGeometry(S.width + 0.06, 0.06, 0.42);
  const skirtGeo = new THREE.BoxGeometry(S.width + 0.05, 0.10, S.axleFront - S.axleRear - 0.75);
  const diffuserGeo = new THREE.BoxGeometry(S.width * 0.86, 0.15, 0.28);

  // Upright semicircular widebody fender arch over each wheel (+Y arc, YZ plane)
  const archGeo = new THREE.TorusGeometry(S.wheelR + 0.025, 0.042, 7, 16, Math.PI);
  archGeo.rotateY(Math.PI / 2);

  // Exhaust flame cones: wide base inside tailpipe (z = 0), sharp tip shooting backward (-Z)
  const flameOuterGeo = new THREE.ConeGeometry(0.105, 0.95, 10, 1, true);
  flameOuterGeo.translate(0, 0.475, 0);
  flameOuterGeo.rotateX(-Math.PI / 2);

  const flameInnerGeo = new THREE.ConeGeometry(0.058, 0.58, 8, 1, true);
  flameInnerGeo.translate(0, 0.29, 0);
  flameInnerGeo.rotateX(-Math.PI / 2);

  const exhaustGeo = new THREE.CylinderGeometry(0.065, 0.072, 0.22, 12);
  exhaustGeo.rotateX(Math.PI / 2);

  const taperT = Math.min(1, (roofSpan[2] - 0.85) / 0.45);
  const roofW = cabinW * (1 - (1 - cabinTap) * taperT) * 0.88;
  const roofCapGeo = new THREE.BoxGeometry(roofW, 0.024, roofSpan[1]);

  const geos: CachedSpecGeos = {
    bodyGeo,
    cabinGeo,
    interiorGeo,
    roofCapGeo,
    roofCenterZ: roofSpan[0],
    roofTopY: roofSpan[2],
    tireGeo,
    rimRingGeo,
    rimOuterLipGeo,
    hubGeo,
    spokeGeo,
    rotorGeo,
    caliperGeo,
    splitterGeo,
    skirtGeo,
    diffuserGeo,
    archGeo,
    flameOuterGeo,
    flameInnerGeo,
    exhaustGeo,
  };
  geoCache.set(id, geos);
  return geos;
}

function addSupraArchWing(
  group: THREE.Group,
  mat: THREE.Material,
  yBase: number,
  zPos: number,
  span: number,
  disposables: { dispose: () => void }[]
): void {
  // Coordinates relative to (0, 0, 0) so geo.scale() shapes only the wing foil instead of multiplying zPos!
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-span * 0.41, -0.04, 0),
    new THREE.Vector3(-span * 0.45, 0.31, -0.015),
    new THREE.Vector3(0, 0.36, -0.035),
    new THREE.Vector3(span * 0.45, 0.31, -0.015),
    new THREE.Vector3(span * 0.41, -0.04, 0),
  ]);
  const geo = new THREE.TubeGeometry(curve, 28, 0.056, 10, false);
  geo.scale(1, 0.60, 2.2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, yBase, zPos);
  mesh.castShadow = true;
  group.add(mesh);
  disposables.push(geo);
}

interface BonnetGunParts {
  turretRoot: THREE.Group;
  turretYaw: THREE.Group;
  turretPitch: THREE.Group;
  turretRecoil: THREE.Group;
  muzzleFlash: THREE.Group;
  muzzlePoint: THREE.Object3D;
}

function buildBonnetGun(
  A: SharedCarAssets,
  disposables: { dispose: () => void }[],
  mountY: number,
  mountZ: number
): BonnetGunParts {
  const turretRoot = new THREE.Group();
  turretRoot.position.set(0, mountY, mountZ);

  const pedGeo = new THREE.CylinderGeometry(0.18, 0.215, 0.06, 16);
  const collarGeo = new THREE.CylinderGeometry(0.155, 0.175, 0.02, 16);
  const yokeGeo = new THREE.BoxGeometry(0.24, 0.095, 0.14);
  const bodyGeo = new THREE.BoxGeometry(0.21, 0.11, 0.36);
  const drumGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.12, 12);
  drumGeo.rotateZ(Math.PI / 2);
  const sightFrameGeo = new THREE.BoxGeometry(0.06, 0.045, 0.09);
  const sightDotGeo = new THREE.SphereGeometry(0.015, 8, 8);
  const shroudGeo = new THREE.BoxGeometry(0.175, 0.068, 0.28);
  const barrelGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.56, 10);
  barrelGeo.rotateX(Math.PI / 2);
  const brakeGeo = new THREE.CylinderGeometry(0.032, 0.026, 0.075, 10);
  brakeGeo.rotateX(Math.PI / 2);
  const flashConeGeo = new THREE.ConeGeometry(0.09, 0.36, 8);
  flashConeGeo.rotateX(Math.PI / 2);
  const flashCoreGeo = new THREE.SphereGeometry(0.075, 8, 8);

  disposables.push(
    pedGeo,
    collarGeo,
    yokeGeo,
    bodyGeo,
    drumGeo,
    sightFrameGeo,
    sightDotGeo,
    shroudGeo,
    barrelGeo,
    brakeGeo,
    flashConeGeo,
    flashCoreGeo
  );

  const ped = new THREE.Mesh(pedGeo, A.mGunMetal);
  ped.position.y = 0.005;
  ped.castShadow = true;
  const collar = new THREE.Mesh(collarGeo, A.mGunAccent);
  collar.position.y = 0.038;
  turretRoot.add(ped, collar);

  const turretYaw = new THREE.Group();
  turretYaw.position.y = 0.048;
  turretRoot.add(turretYaw);

  const yoke = new THREE.Mesh(yokeGeo, A.mGunMetal);
  yoke.position.y = 0.045;
  yoke.castShadow = true;
  turretYaw.add(yoke);

  const turretPitch = new THREE.Group();
  turretPitch.position.y = 0.098;
  turretYaw.add(turretPitch);

  const turretRecoil = new THREE.Group();
  turretPitch.add(turretRecoil);

  const receiver = new THREE.Mesh(bodyGeo, A.mGunMetal);
  receiver.position.set(0, 0, -0.02);
  receiver.castShadow = true;
  turretRecoil.add(receiver);

  const ammoDrum = new THREE.Mesh(drumGeo, A.mGunMetal);
  ammoDrum.position.set(0.145, -0.01, -0.02);
  ammoDrum.castShadow = true;
  const ammoStripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.08), A.mGunAccent);
  disposables.push(ammoStripe.geometry);
  ammoStripe.position.set(0.195, -0.01, -0.02);
  turretRecoil.add(ammoDrum, ammoStripe);

  const sight = new THREE.Mesh(sightFrameGeo, A.mGunBarrel);
  sight.position.set(0, 0.075, -0.02);
  const sightDot = new THREE.Mesh(sightDotGeo, A.mGunSight);
  sightDot.position.set(0, 0.078, 0.028);
  turretRecoil.add(sight, sightDot);

  const shroud = new THREE.Mesh(shroudGeo, A.mGunBarrel);
  shroud.position.set(0, 0.004, 0.25);
  shroud.castShadow = true;
  turretRecoil.add(shroud);

  for (const sx of [-1, 1]) {
    const barrel = new THREE.Mesh(barrelGeo, A.mGunBarrel);
    barrel.position.set(sx * 0.055, 0.004, 0.34);
    barrel.castShadow = true;
    const brake = new THREE.Mesh(brakeGeo, A.mChrome);
    brake.position.set(sx * 0.055, 0.004, 0.625);
    turretRecoil.add(barrel, brake);
  }

  const muzzleFlash = new THREE.Group();
  muzzleFlash.position.set(0, 0.004, 0.67);
  muzzleFlash.visible = false;
  for (const sx of [-1, 1]) {
    const cone = new THREE.Mesh(flashConeGeo, A.mMuzzleFlash);
    cone.position.set(sx * 0.055, 0, 0.16);
    const core = new THREE.Mesh(flashCoreGeo, A.mMuzzleFlash);
    core.position.set(sx * 0.055, 0, 0.02);
    muzzleFlash.add(cone, core);
  }
  turretRecoil.add(muzzleFlash);

  const muzzlePoint = new THREE.Object3D();
  muzzlePoint.position.set(0, 0.004, 0.67);
  turretRecoil.add(muzzlePoint);

  return { turretRoot, turretYaw, turretPitch, turretRecoil, muzzleFlash, muzzlePoint };
}

export function buildCarVisual(
  id: CarId,
  colorHex: string,
  underglowHex: string,
  enablePointLight = false
): CarVisualRig {
  const S: CarSpec = CAR_SPECS[id];
  const A = getSharedAssets();
  const G = getSpecGeos(id);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(colorHex),
    metalness: id === 'r34' ? 0.68 : 0.58,
    roughness: id === 'r34' ? 0.18 : 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: id === 'r34' ? 0.04 : 0.06,
    reflectivity: 0.96,
    envMapIntensity: id === 'r34' ? 1.35 : 1.0,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: S.rimColor,
    metalness: 0.85,
    roughness: 0.24,
  });

  const caliperMat = new THREE.MeshStandardMaterial({
    color: S.caliperColor,
    roughness: 0.32,
    metalness: 0.5,
  });

  const rotorMat = new THREE.MeshStandardMaterial({
    color: 0x3b4048,
    emissive: new THREE.Color(0xff2a00),
    emissiveIntensity: 0,
    metalness: 0.85,
    roughness: 0.35,
  });

  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x700808,
    emissive: new THREE.Color(0xff1414),
    emissiveIntensity: 0.8,
    roughness: 0.2,
  });

  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xdcf4ff),
    emissiveIntensity: 2.0,
    roughness: 0.1,
  });

  const disposables: { dispose: () => void }[] = [bodyMat, rimMat, caliperMat, rotorMat, tailMat, headMat];
  const halfL = S.length / 2;
  const halfW = S.width / 2;

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    shadow = false
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (shadow) m.castShadow = true;
    bodyGroup.add(m);
    return m;
  };

  const m = bodyMat;
  // Main sculpted body, opaque dark cockpit interior & glossy tinted greenhouse glass
  add(G.bodyGeo, m, 0, 0, 0, true);
  add(G.interiorGeo, A.mInterior, 0, 0, 0);
  add(G.cabinGeo, A.mGlass, 0, 0, 0, true);

  let exhaustOffsets: [number, number, number][] = [];

  if (id !== 'gwagon' && id !== 'cybertruck') {
    if (id !== 'r34') {
      // Sport aero splitter, side skirts (R34 uses painted C-West kit below)
      add(G.splitterGeo, A.mCarbon, 0, 0.18, halfL - 0.16);
      add(G.skirtGeo, A.mCarbon, 0, 0.18, (S.axleFront + S.axleRear) / 2);
    }
    add(G.diffuserGeo, A.mCarbon, 0, 0.22, -halfL + 0.10);
  }

  // Flush painted coupe/SUV roof cap (Cybertruck already forms a razor steel ridge)
  if (id !== 'cybertruck') {
    add(G.roofCapGeo, bodyMat, 0, G.roofTopY, G.roofCenterZ);
  }

  // Side mirrors
  const mirrorGeo = new THREE.BoxGeometry(0.18, 0.08, 0.14);
  disposables.push(mirrorGeo);
  const mirrorY =
    id === 'huracan' ? 0.83 : id === 'gwagon' ? 1.15 : id === 'cybertruck' ? 1.06 : id === 'porsche' ? 0.85 : id === 'r34' ? 0.855 : 0.90;
  const mirrorZ = id === 'gwagon' ? 0.65 : id === 'cybertruck' ? 0.86 : id === 'r34' ? 0.48 : 0.42;
  for (const sx of [1, -1]) {
    add(mirrorGeo, id === 'cybertruck' ? A.mDarkTrim : bodyMat, sx * (halfW - 0.02), mirrorY, mirrorZ);
  }

  // Front honeycomb grille / intercooler opening & rear license plate
  if (id !== 'cybertruck' && id !== 'gwagon') {
    const grilleGeo = new THREE.BoxGeometry(S.width * 0.58, 0.18, 0.08);
    const icGeo = new THREE.BoxGeometry(S.width * 0.46, 0.13, 0.06);
    const plateGeo = new THREE.BoxGeometry(0.42, 0.10, 0.03);
    disposables.push(grilleGeo, icGeo, plateGeo);
    if (id !== 'porsche' && id !== 'r34') {
      const grilleY = id === 'huracan' ? 0.27 : id === 'charger' ? 0.48 : 0.33;
      add(grilleGeo, A.mGrille, 0, grilleY, halfL + 0.02);
      if (id === 'supra') {
        add(icGeo, A.mIntercooler, 0, grilleY, halfL + 0.036);
      }
    }
    add(plateGeo, A.mPlate, 0, id === 'huracan' ? 0.46 : id === 'porsche' ? 0.41 : 0.46, -halfL - 0.01);
  }

  if (id === 'r34') {
    const addBeam = (a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, mat: THREE.Material) => {
      const len = a.distanceTo(b);
      const g = new THREE.BoxGeometry(w, h, len);
      disposables.push(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.lookAt(b);
      mesh.castShadow = true;
      bodyGroup.add(mesh);
      return mesh;
    };

    // Painted R34 A-pillars, C-pillar sail panels, roof rails, gloss-black B-pillar dividers & door handles
    const bPillarGeo = new THREE.BoxGeometry(0.032, 0.42, 0.085);
    const handleGeo = new THREE.BoxGeometry(0.026, 0.034, 0.15);
    const hoopGeo = new THREE.TorusGeometry(0.50, 0.024, 8, 18, Math.PI);
    disposables.push(bPillarGeo, handleGeo, hoopGeo);
    const hoop = add(hoopGeo, A.mChrome, 0, 0.80, -0.45);
    hoop.rotation.x = -0.14;
    for (const sx of [1, -1]) {
      addBeam(new THREE.Vector3(sx * 0.72, 0.80, 0.83), new THREE.Vector3(sx * 0.59, 1.23, 0.23), 0.052, 0.046, bodyMat);
      addBeam(new THREE.Vector3(sx * 0.70, 0.815, -1.32), new THREE.Vector3(sx * 0.58, 1.23, -0.76), 0.075, 0.19, bodyMat);
      addBeam(new THREE.Vector3(sx * 0.585, 1.238, 0.22), new THREE.Vector3(sx * 0.585, 1.238, -0.75), 0.048, 0.032, bodyMat);
      const bp = add(bPillarGeo, A.mDarkTrim, sx * 0.655, 1.02, -0.28);
      bp.rotation.z = sx * 0.27;
      add(handleGeo, bodyMat, sx * 0.908, 0.705, -0.18);
    }

    // Painted C-West aero front chin splitter, corner canard winglets & deep sculpted side skirts
    const cwestLipGeo = new THREE.BoxGeometry(1.66, 0.048, 0.20);
    const cornerCanardGeo = new THREE.BoxGeometry(0.14, 0.085, 0.24);
    const skirtW = S.width - 0.07;
    const skirtLen = S.axleFront - S.axleRear - 0.82;
    const skirtZCenter = (S.axleFront + S.axleRear) / 2;
    const cwestSkirtGeo = new THREE.BoxGeometry(skirtW, 0.105, skirtLen);
    disposables.push(cwestLipGeo, cornerCanardGeo, cwestSkirtGeo);
    add(cwestLipGeo, bodyMat, 0, 0.165, halfL - 0.015, true);
    add(cwestSkirtGeo, bodyMat, 0, 0.19, skirtZCenter, true);
    for (const sx of [1, -1]) {
      add(cornerCanardGeo, bodyMat, sx * 0.725, 0.195, halfL - 0.11, true);
    }

    // Exposed GReddy-style finned aluminum front-mount intercooler + flanking brake cooling ducts + upper GT-R grille
    const icCavityGeo = new THREE.BoxGeometry(0.84, 0.24, 0.06);
    const icCoreGeo = new THREE.BoxGeometry(0.76, 0.20, 0.05);
    const icMat = new THREE.MeshStandardMaterial({
      map: A.icTex,
      metalness: 0.78,
      roughness: 0.28,
    });
    const ductGeo = new THREE.BoxGeometry(0.28, 0.15, 0.06);
    const upperGrilleGeo = new THREE.BoxGeometry(0.68, 0.092, 0.075);
    const badgeGeo = new THREE.BoxGeometry(0.088, 0.044, 0.022);
    const badgeMat = new THREE.MeshStandardMaterial({ color: 0xdc1e28, metalness: 0.65, roughness: 0.25 });
    disposables.push(icCavityGeo, icCoreGeo, icMat, ductGeo, upperGrilleGeo, badgeGeo, badgeMat);

    add(icCavityGeo, A.mWheelWell, 0, 0.295, halfL - 0.01);
    add(icCoreGeo, icMat, 0, 0.295, halfL + 0.004);
    add(upperGrilleGeo, A.mGrille, 0, 0.555, halfL - 0.04);
    add(badgeGeo, badgeMat, -0.14, 0.555, halfL + 0.002);
    for (const sx of [1, -1]) {
      const duct = add(ductGeo, A.mWheelWell, sx * 0.59, 0.285, halfL - 0.035);
      duct.rotation.y = sx * 0.16;
    }

    // Center RB26 hood bulge framed cleanly between twin blue stripes + flanking low-profile extractor vents
    const bulgeGeo = new THREE.BoxGeometry(0.155, 0.020, 0.96);
    const ventGeo = new THREE.BoxGeometry(0.18, 0.018, 0.26);
    disposables.push(bulgeGeo, ventGeo);
    const bulge = add(bulgeGeo, bodyMat, 0, 0.746, 1.48);
    bulge.rotation.x = 0.09;
    for (const sx of [1, -1]) {
      const v = add(ventGeo, A.mDarkTrim, sx * 0.42, 0.744, 1.48);
      v.rotation.x = 0.09;
    }

    // Clear multi-projector R34 headlights + amber C-West bumper turn signals + fender markers
    const hlBoxGeo = new THREE.BoxGeometry(0.38, 0.095, 0.105);
    const hlMat = new THREE.MeshPhysicalMaterial({
      map: A.r34HlTex,
      emissiveMap: A.r34HlTex,
      emissive: new THREE.Color(0xdcf4ff),
      emissiveIntensity: 0.75,
      roughness: 0.06,
      metalness: 0.2,
      clearcoat: 1.0,
    });
    const hlProjGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.03, 12);
    hlProjGeo.rotateX(Math.PI / 2);
    const signalBezGeo = new THREE.BoxGeometry(0.145, 0.062, 0.05);
    const signalLensGeo = new THREE.BoxGeometry(0.125, 0.044, 0.056);
    const fenderMarkerGeo = new THREE.BoxGeometry(0.022, 0.024, 0.065);
    const amberMat = new THREE.MeshStandardMaterial({
      color: 0xff8c00,
      emissive: new THREE.Color(0xff6f00),
      emissiveIntensity: 0.85,
      roughness: 0.18,
    });
    disposables.push(hlBoxGeo, hlMat, hlProjGeo, signalBezGeo, signalLensGeo, fenderMarkerGeo, amberMat);
    for (const sx of [1, -1]) {
      const hl = add(hlBoxGeo, hlMat, sx * 0.60, 0.562, halfL - 0.105);
      hl.rotation.y = sx * 0.22;
      hl.rotation.x = 0.22;
      const orb = add(hlProjGeo, headMat, sx * 0.635, 0.556, halfL - 0.072);
      orb.rotation.y = sx * 0.22;

      const sBez = add(signalBezGeo, A.mDarkTrim, sx * 0.60, 0.435, halfL - 0.045);
      sBez.rotation.y = sx * 0.18;
      const sLens = add(signalLensGeo, amberMat, sx * 0.60, 0.435, halfL - 0.042);
      sLens.rotation.y = sx * 0.18;

      add(fenderMarkerGeo, amberMat, sx * 0.908, 0.605, 0.95);
    }

    // 2F2F Royal Blue twin racing stripes (hood, roof, trunk, bumper bar & splitter) + swept side livery decals
    const liveryBlueMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b48d6,
      metalness: 0.48,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const sideLiveryMat = new THREE.MeshPhysicalMaterial({
      map: A.r34SideTex,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      metalness: 0.42,
      roughness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const hoodStripeGeo = makeStripeRibbonGeo(
      [
        [0.86, 0.797],
        [1.02, 0.791],
        [1.62, 0.741],
        [2.10, 0.646],
        [2.238, 0.556],
      ],
      0.205,
      0.004
    );
    const roofStripeGeo = makeStripeRibbonGeo(
      [
        [-0.73, 1.255],
        [0.19, 1.255],
      ],
      0.205,
      0.003
    );
    const trunkStripeGeo = makeStripeRibbonGeo(
      [
        [-2.23, 0.794],
        [-1.35, 0.834],
      ],
      0.205,
      0.004
    );
    const beamStripeGeo = new THREE.BoxGeometry(0.205, 0.095, 0.036);
    const lipStripeGeo = new THREE.BoxGeometry(0.205, 0.050, 0.165);
    const sideDecalR = makeR34SideDecalGeo(
      1,
      halfW - 0.03,
      halfL,
      skirtW / 2,
      skirtZCenter - skirtLen / 2,
      skirtZCenter + skirtLen / 2,
      0.725 + 0.07
    );
    const sideDecalL = makeR34SideDecalGeo(
      -1,
      halfW - 0.03,
      halfL,
      skirtW / 2,
      skirtZCenter - skirtLen / 2,
      skirtZCenter + skirtLen / 2,
      0.725 + 0.07
    );

    disposables.push(
      liveryBlueMat,
      sideLiveryMat,
      hoodStripeGeo,
      roofStripeGeo,
      trunkStripeGeo,
      beamStripeGeo,
      lipStripeGeo,
      sideDecalR,
      sideDecalL
    );
    for (const sx of [1, -1]) {
      add(hoodStripeGeo, liveryBlueMat, sx * 0.19, 0, 0);
      add(roofStripeGeo, liveryBlueMat, sx * 0.19, 0, 0);
      add(trunkStripeGeo, liveryBlueMat, sx * 0.19, 0, 0);
      add(beamStripeGeo, liveryBlueMat, sx * 0.19, 0.456, halfL - 0.01);
      add(lipStripeGeo, liveryBlueMat, sx * 0.19, 0.167, halfL + 0.004);
    }
    add(sideDecalR, sideLiveryMat, 0, 0, 0);
    add(sideDecalL, sideLiveryMat, 0, 0, 0);

    // Tall C-West / GT-R aluminum-strut rear wing + chamfered carbon side endplates
    const wingBlade = new THREE.BoxGeometry(S.width * 0.92, 0.038, 0.30);
    const wingPost = new THREE.BoxGeometry(0.034, 0.31, 0.18);
    const endPlate = new THREE.BoxGeometry(0.026, 0.19, 0.36);
    disposables.push(wingBlade, wingPost, endPlate);
    add(wingBlade, bodyMat, 0, 1.11, -halfL + 0.21, true);
    for (const sx of [1, -1]) {
      const post = add(wingPost, A.mChrome, sx * 0.48, 0.94, -halfL + 0.23, true);
      post.rotation.x = -0.16;
      add(endPlate, A.mCarbon, sx * (S.width * 0.46), 1.09, -halfL + 0.21, true);
    }

    // Rear lower diffuser vertical aero strakes + recessed quad Skyline circular halo ring taillights
    const finGeo = new THREE.BoxGeometry(0.024, 0.13, 0.24);
    const outerBucketGeo = new THREE.CylinderGeometry(0.102, 0.102, 0.04, 18);
    outerBucketGeo.rotateX(Math.PI / 2);
    const innerBucketGeo = new THREE.CylinderGeometry(0.080, 0.080, 0.04, 16);
    innerBucketGeo.rotateX(Math.PI / 2);
    const ringOuterGeo = new THREE.TorusGeometry(0.072, 0.020, 8, 22);
    const ringInnerGeo = new THREE.TorusGeometry(0.052, 0.017, 8, 20);
    disposables.push(finGeo, outerBucketGeo, innerBucketGeo, ringOuterGeo, ringInnerGeo);
    for (const fx of [-0.45, -0.15, 0.15, 0.45]) {
      add(finGeo, A.mDarkTrim, fx, 0.22, -halfL + 0.07);
    }
    for (const sx of [1, -1]) {
      add(outerBucketGeo, A.mDarkTrim, sx * 0.65, 0.625, -halfL - 0.008);
      add(innerBucketGeo, A.mDarkTrim, sx * 0.43, 0.625, -halfL - 0.008);
      add(ringOuterGeo, tailMat, sx * 0.65, 0.625, -halfL - 0.028);
      add(ringInnerGeo, tailMat, sx * 0.43, 0.625, -halfL - 0.028);
    }

    exhaustOffsets = [[-0.56, 0.22, -halfL - 0.02]];
  } else if (id === 'supra') {
    // Iconic Supra MK4 tall curved hoop rear wing anchored flush into trunk deck
    addSupraArchWing(bodyGroup, bodyMat, 0.81, -halfL + 0.28, S.width * 0.90, disposables);

    // Sweeping Supra A80 twin-projector headlights on sloped front fenders
    const hlHousing = new THREE.BoxGeometry(0.36, 0.08, 0.22);
    const hlLens = new THREE.CylinderGeometry(0.048, 0.048, 0.09, 12);
    hlLens.rotateX(Math.PI / 2);
    disposables.push(hlHousing, hlLens);
    for (const sx of [1, -1]) {
      const box = add(hlHousing, A.mDarkTrim, sx * 0.64, 0.61, halfL - 0.16);
      box.rotation.y = sx * 0.22;
      box.rotation.x = 0.45;
      const outerLamp = add(hlLens, headMat, sx * 0.68, 0.60, halfL - 0.10);
      outerLamp.rotation.x = 0.26;
      const innerLamp = add(hlLens, headMat, sx * 0.56, 0.625, halfL - 0.15);
      innerLamp.rotation.x = 0.26;
    }

    // Recessed quad-pod horizontal taillights on dark rear garnish
    const tlBarGeo = new THREE.BoxGeometry(0.50, 0.13, 0.06);
    const tlPodGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.07, 12);
    tlPodGeo.rotateX(Math.PI / 2);
    disposables.push(tlBarGeo, tlPodGeo);
    for (const sx of [1, -1]) {
      add(tlBarGeo, A.mDarkTrim, sx * 0.58, 0.63, -halfL - 0.03);
      for (const ox of [0.41, 0.52, 0.64, 0.75]) {
        add(tlPodGeo, tailMat, sx * ox, 0.63, -halfL - 0.04);
      }
    }

    exhaustOffsets = [
      [-0.54, 0.23, -halfL - 0.02],
      [0.54, 0.23, -halfL - 0.02],
    ];
  } else if (id === 'charger') {
    // Supercharger hood scoop + black decklid lip spoiler
    const scoopGeo = new THREE.BoxGeometry(0.62, 0.15, 0.92);
    const intakeGeo = new THREE.BoxGeometry(0.50, 0.09, 0.08);
    const lipGeo = new THREE.BoxGeometry(S.width * 0.88, 0.08, 0.20);
    const upperGrille = new THREE.BoxGeometry(S.width * 0.84, 0.16, 0.06);
    disposables.push(scoopGeo, intakeGeo, lipGeo, upperGrille);
    add(scoopGeo, A.mCarbon, 0, 0.96, 0.92, true);
    add(intakeGeo, A.mChrome, 0, 0.98, 1.38);
    add(lipGeo, A.mCarbon, 0, 0.93, -halfL + 0.12, true);
    add(upperGrille, A.mDarkTrim, 0, 0.63, halfL + 0.02);

    // Quad halo headlights set inside upper nose grille
    const haloGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.06, 14);
    haloGeo.rotateX(Math.PI / 2);
    disposables.push(haloGeo);
    for (const sx of [1, -1]) {
      add(haloGeo, headMat, sx * 0.72, 0.63, halfL + 0.035);
      add(haloGeo, headMat, sx * 0.54, 0.63, halfL + 0.035);
    }

    // Signature full-width Charger racetrack LED taillight bar!
    const raceBarGeo = new THREE.BoxGeometry(S.width * 0.86, 0.12, 0.06);
    const raceMaskGeo = new THREE.BoxGeometry(S.width * 0.52, 0.055, 0.065);
    disposables.push(raceBarGeo, raceMaskGeo);
    add(raceBarGeo, tailMat, 0, 0.66, -halfL - 0.035);
    add(raceMaskGeo, A.mDarkTrim, 0, 0.66, -halfL - 0.042);

    exhaustOffsets = [
      [-0.68, 0.25, -halfL - 0.02],
      [-0.52, 0.25, -halfL - 0.02],
      [0.52, 0.25, -halfL - 0.02],
      [0.68, 0.25, -halfL - 0.02],
    ];
  } else if (id === 'huracan') {
    // Angular Performante wing, side intakes, engine louvers
    const wingBlade = new THREE.BoxGeometry(S.width * 0.90, 0.045, 0.34);
    const wingPost = new THREE.BoxGeometry(0.06, 0.24, 0.22);
    const louverGeo = new THREE.BoxGeometry(0.95, 0.025, 0.11);
    const intakeGeo = new THREE.BoxGeometry(0.14, 0.34, 0.68);
    disposables.push(wingBlade, wingPost, louverGeo, intakeGeo);

    add(wingBlade, A.mCarbon, 0, 1.03, -halfL + 0.22, true);
    for (const sx of [1, -1]) {
      add(wingPost, A.mCarbon, sx * 0.44, 0.89, -halfL + 0.22);
      add(intakeGeo, A.mDarkTrim, sx * (halfW - 0.02), 0.52, -0.58);
    }
    for (let k = 0; k < 4; k++) {
      add(louverGeo, A.mCarbon, 0, 0.855 - k * 0.015, -0.96 - k * 0.22);
    }

    // Angular Y-shaped LED headlights riding clean on sloped wedge nose
    const hlMain = new THREE.BoxGeometry(0.32, 0.055, 0.18);
    const hlBranch = new THREE.BoxGeometry(0.14, 0.04, 0.10);
    disposables.push(hlMain, hlBranch);
    for (const sx of [1, -1]) {
      const m = add(hlMain, headMat, sx * 0.66, 0.515, halfL - 0.22);
      m.rotation.y = sx * 0.28;
      m.rotation.x = 0.52;
      const b = add(hlBranch, headMat, sx * 0.56, 0.505, halfL - 0.16);
      b.rotation.y = -sx * 0.36;
      b.rotation.x = 0.52;
    }

    // Sharp Huracan Y-LED taillights
    const tlStrip = new THREE.BoxGeometry(0.42, 0.055, 0.06);
    const tlY = new THREE.BoxGeometry(0.16, 0.045, 0.06);
    disposables.push(tlStrip, tlY);
    for (const sx of [1, -1]) {
      add(tlStrip, tailMat, sx * 0.62, 0.63, -halfL - 0.035);
      const y1 = add(tlY, tailMat, sx * 0.52, 0.66, -halfL - 0.035);
      y1.rotation.z = sx * 0.55;
      const y2 = add(tlY, tailMat, sx * 0.52, 0.60, -halfL - 0.035);
      y2.rotation.z = -sx * 0.55;
    }

    exhaustOffsets = [
      [-0.36, 0.36, -halfL - 0.02],
      [-0.20, 0.36, -halfL - 0.02],
      [0.20, 0.36, -halfL - 0.02],
      [0.36, 0.36, -halfL - 0.02],
    ];
  } else if (id === '370z') {
    // Nissan 370Z: Sleek sport wing + boomerang headlights & taillights
    const wingBlade = new THREE.BoxGeometry(S.width * 0.84, 0.055, 0.28);
    const wingPost = new THREE.BoxGeometry(0.08, 0.15, 0.20);
    disposables.push(wingBlade, wingPost);
    add(wingBlade, bodyMat, 0, 0.91, -halfL + 0.22, true);
    for (const sx of [1, -1]) {
      add(wingPost, bodyMat, sx * 0.48, 0.82, -halfL + 0.22);
    }

    // Signature Boomerang LED headlights on front fenders
    const boomA = new THREE.BoxGeometry(0.28, 0.055, 0.14);
    const boomB = new THREE.BoxGeometry(0.10, 0.16, 0.10);
    disposables.push(boomA, boomB);
    for (const sx of [1, -1]) {
      const m1 = add(boomA, headMat, sx * 0.62, 0.585, halfL - 0.16);
      m1.rotation.y = sx * 0.26;
      m1.rotation.x = 0.48;
      const m2 = add(boomB, headMat, sx * 0.71, 0.64, halfL - 0.26);
      m2.rotation.x = 0.62;
    }

    // Signature Boomerang taillights
    const tBoomA = new THREE.BoxGeometry(0.30, 0.06, 0.06);
    const tBoomB = new THREE.BoxGeometry(0.08, 0.18, 0.06);
    disposables.push(tBoomA, tBoomB);
    for (const sx of [1, -1]) {
      add(tBoomA, tailMat, sx * 0.62, 0.62, -halfL - 0.035);
      const tb = add(tBoomB, tailMat, sx * 0.74, 0.68, -halfL - 0.025);
      tb.rotation.z = -sx * 0.28;
    }

    exhaustOffsets = [
      [-0.56, 0.23, -halfL - 0.02],
      [0.56, 0.23, -halfL - 0.02],
    ];
  } else if (id === 'cybertruck') {
    // Matte composite bed tonneau cover + armored lower cladding + steel bumpers
    const bedGeo = new THREE.BoxGeometry(S.width * 0.88, 0.05, 1.38);
    const frontBumpGeo = new THREE.BoxGeometry(S.width + 0.04, 0.28, 0.16);
    const rearBumpGeo = new THREE.BoxGeometry(S.width + 0.04, 0.24, 0.16);
    const sideRockGeo = new THREE.BoxGeometry(S.width + 0.05, 0.14, S.axleFront - S.axleRear - 0.90);
    // Razor-thin full-width front white LED lightbar + rear full-width red LED lightbar
    const frontBarGeo = new THREE.BoxGeometry(S.width * 0.92, 0.045, 0.08);
    const fogGeo = new THREE.BoxGeometry(0.24, 0.06, 0.06);
    const rearBarGeo = new THREE.BoxGeometry(S.width * 0.92, 0.055, 0.08);
    disposables.push(bedGeo, frontBumpGeo, rearBumpGeo, sideRockGeo, frontBarGeo, fogGeo, rearBarGeo);

    add(bedGeo, A.mDarkTrim, 0, 1.245, -halfL + 0.74);
    add(frontBumpGeo, A.mDarkTrim, 0, 0.44, halfL - 0.01);
    add(rearBumpGeo, A.mDarkTrim, 0, 0.42, -halfL + 0.01);
    add(sideRockGeo, A.mDarkTrim, 0, 0.28, (S.axleFront + S.axleRear) / 2);

    add(frontBarGeo, headMat, 0, 0.945, halfL - 0.12);
    for (const sx of [1, -1]) add(fogGeo, headMat, sx * 0.68, 0.48, halfL + 0.045);
    add(rearBarGeo, tailMat, 0, 1.20, -halfL - 0.015);

    // Twin EV under-diffuser plasma boost vents
    exhaustOffsets = [
      [-0.50, 0.30, -halfL + 0.02],
      [0.50, 0.30, -halfL + 0.02],
    ];
  } else if (id === 'gwagon') {
    // Mercedes G63 AMG Panamericana vertical-slat grille + bull bar + running boards + spare tire
    const grilleBox = new THREE.BoxGeometry(S.width * 0.56, 0.28, 0.08);
    const slatGeo = new THREE.BoxGeometry(0.035, 0.24, 0.04);
    const bullBar = new THREE.BoxGeometry(S.width * 0.72, 0.065, 0.10);
    const bullPost = new THREE.BoxGeometry(0.055, 0.32, 0.06);
    const boardGeo = new THREE.BoxGeometry(S.width + 0.14, 0.08, S.axleFront - S.axleRear - 0.92);
    const sidePipeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.24, 10);
    sidePipeGeo.rotateZ(Math.PI / 2);
    const podMat = new THREE.MeshStandardMaterial({
      color: 0xff9800,
      emissive: new THREE.Color(0xff7700),
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    const podGeo = new THREE.BoxGeometry(0.08, 0.065, 0.16);
    const hlRingGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.07, 16);
    hlRingGeo.rotateX(Math.PI / 2);
    const hlDarkGeo = new THREE.BoxGeometry(0.28, 0.28, 0.07);
    const spareTireGeo = new THREE.CylinderGeometry(0.40, 0.40, 0.26, 20);
    spareTireGeo.rotateX(Math.PI / 2);
    const spareCapGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.28, 20);
    spareCapGeo.rotateX(Math.PI / 2);
    const rearLampGeo = new THREE.BoxGeometry(0.38, 0.10, 0.07);
    disposables.push(
      grilleBox,
      slatGeo,
      bullBar,
      bullPost,
      boardGeo,
      sidePipeGeo,
      podMat,
      podGeo,
      hlRingGeo,
      hlDarkGeo,
      spareTireGeo,
      spareCapGeo,
      rearLampGeo
    );

    add(grilleBox, A.mGrille, 0, 0.72, halfL + 0.02);
    for (let s = -3; s <= 3; s++) {
      add(slatGeo, A.mChrome, s * 0.13, 0.72, halfL + 0.048);
    }
    add(bullBar, A.mChrome, 0, 0.50, halfL + 0.09);
    add(bullBar, A.mChrome, 0, 0.80, halfL + 0.09);
    for (const sx of [1, -1]) {
      add(bullPost, A.mChrome, sx * 0.44, 0.65, halfL + 0.09);
      add(hlDarkGeo, A.mDarkTrim, sx * 0.74, 0.73, halfL + 0.015);
      add(hlRingGeo, headMat, sx * 0.74, 0.73, halfL + 0.032);
      // Iconic G-Wagon fender-top amber turn signal indicators
      add(podGeo, podMat, sx * 0.80, 1.07, 1.85);
      // Side running boards & AMG dual side exhaust tips ahead of rear tires
      const sp = add(sidePipeGeo, A.mChrome, sx * (halfW + 0.03), 0.31, -0.78);
      sp.rotation.y = sx * 0.25;
      add(rearLampGeo, tailMat, sx * 0.68, 0.62, -halfL - 0.038);
    }
    add(boardGeo, A.mDarkTrim, 0, 0.34, (S.axleFront + S.axleRear) / 2);

    // Tailgate-mounted spare tire + painted body-matched center cap
    add(spareTireGeo, A.mTire, 0.05, 0.96, -halfL - 0.14, true);
    add(spareCapGeo, bodyMat, 0.05, 0.96, -halfL - 0.145, true);

    exhaustOffsets = [
      [-0.54, 0.32, -halfL - 0.02],
      [0.54, 0.32, -halfL - 0.02],
    ];
  } else if (id === 'porsche') {
    // Classic Porsche 911 Turbo (930): raised front cannon fenders, round chrome frogeye lamps, whale-tail & full lightbar
    const fenderGeo = extrudeSideProfile(
      [
        [0.65, 0.54],
        [0.72, 0.79],
        [1.26, 0.78],
        [1.78, 0.68],
        [2.05, 0.56],
        [2.01, 0.42],
        [0.65, 0.42],
      ],
      0.34,
      0.045
    );
    const hlRingGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.06, 18);
    hlRingGeo.rotateX(Math.PI / 2);
    const hlLensGeo = new THREE.CylinderGeometry(0.088, 0.088, 0.065, 16);
    hlLensGeo.rotateX(Math.PI / 2);

    const chinGeo = new THREE.BoxGeometry(S.width * 0.88, 0.065, 0.16);
    const coolerGrilleGeo = new THREE.BoxGeometry(S.width * 0.44, 0.085, 0.05);
    const fBumperGeo = new THREE.BoxGeometry(S.width * 0.90, 0.075, 0.065);
    const fSignalGeo = new THREE.BoxGeometry(0.20, 0.048, 0.055);
    const amberMat = new THREE.MeshStandardMaterial({
      color: 0xff8c00,
      emissive: new THREE.Color(0xff6a00),
      emissiveIntensity: 0.7,
      roughness: 0.2,
    });

    // Iconic 930 whale-tail wing: painted base + matte black rubberized perimeter rim + engine grille
    const tailBaseGeo = new THREE.BoxGeometry(S.width * 0.78, 0.055, 0.54);
    const tailRearLipGeo = new THREE.BoxGeometry(S.width * 0.82, 0.085, 0.07);
    const tailSideLipGeo = new THREE.BoxGeometry(0.065, 0.080, 0.56);
    const tailGrilleGeo = new THREE.BoxGeometry(S.width * 0.58, 0.024, 0.30);

    // Classic full-width red Porsche rear reflector bar + vertical rubber bumperettes
    const tlFrameGeo = new THREE.BoxGeometry(S.width * 0.84, 0.12, 0.05);
    const tlLensGeo = new THREE.BoxGeometry(S.width * 0.78, 0.082, 0.06);
    const bumperetteGeo = new THREE.BoxGeometry(0.11, 0.14, 0.08);

    disposables.push(
      fenderGeo,
      hlRingGeo,
      hlLensGeo,
      chinGeo,
      coolerGrilleGeo,
      fBumperGeo,
      fSignalGeo,
      amberMat,
      tailBaseGeo,
      tailRearLipGeo,
      tailSideLipGeo,
      tailGrilleGeo,
      tlFrameGeo,
      tlLensGeo,
      bumperetteGeo
    );

    // Sculpted left & right 911 front fenders + round chrome bezel frogeye headlights
    for (const sx of [1, -1]) {
      add(fenderGeo, bodyMat, sx * 0.67, 0, 0, true);
      const ring = add(hlRingGeo, A.mChrome, sx * 0.67, 0.555, halfL - 0.08);
      ring.rotation.x = 0.20;
      const lens = add(hlLensGeo, headMat, sx * 0.67, 0.555, halfL - 0.065);
      lens.rotation.x = 0.20;
      add(fSignalGeo, amberMat, sx * 0.66, 0.375, halfL + 0.025);
      add(bumperetteGeo, A.mDarkTrim, sx * 0.42, 0.38, -halfL - 0.025);
    }
    add(chinGeo, A.mDarkTrim, 0, 0.21, halfL - 0.04);
    add(coolerGrilleGeo, A.mGrille, 0, 0.285, halfL + 0.01);
    add(fBumperGeo, A.mDarkTrim, 0, 0.375, halfL + 0.015);

    // Whale-tail assembly on rear decklid
    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, 0.81, -1.62);
    tailGroup.rotation.x = 0.08;
    const tBase = new THREE.Mesh(tailBaseGeo, bodyMat);
    tBase.castShadow = true;
    const tRearLip = new THREE.Mesh(tailRearLipGeo, A.mDarkTrim);
    tRearLip.position.set(0, 0.02, -0.26);
    tRearLip.castShadow = true;
    const tGrille = new THREE.Mesh(tailGrilleGeo, A.mGrille);
    tGrille.position.set(0, 0.025, 0.03);
    tailGroup.add(tBase, tRearLip, tGrille);
    for (const sx of [1, -1]) {
      const tSide = new THREE.Mesh(tailSideLipGeo, A.mDarkTrim);
      tSide.position.set(sx * (S.width * 0.39), 0.018, 0);
      tailGroup.add(tSide);
    }
    bodyGroup.add(tailGroup);

    // Full-width classic PORSCHE red rear reflector taillight bar
    add(tlFrameGeo, A.mDarkTrim, 0, 0.60, -halfL - 0.005);
    add(tlLensGeo, tailMat, 0, 0.60, -halfL - 0.012);

    exhaustOffsets = [
      [-0.50, 0.23, -halfL - 0.02],
      [0.50, 0.23, -halfL - 0.02],
    ];
  }

  // Wheels + flared wheel arches + hollow deep alloy rims, brake rotors & colored calipers
  const wheels: CarVisualRig['wheels'] = [];
  const wellDiscGeo = new THREE.CylinderGeometry(S.wheelR * 0.62, S.wheelR * 0.62, 0.02, 20);
  wellDiscGeo.rotateZ(Math.PI / 2);
  disposables.push(wellDiscGeo);

  const hw = S.wheelW * 0.5;
  const wheelCoords: [number, number, boolean][] = [
    [S.track, S.axleFront, true],
    [-S.track, S.axleFront, true],
    [S.track, S.axleRear, false],
    [-S.track, S.axleRear, false],
  ];

  const rimLipMat = id === 'porsche' || id === 'r34' ? A.mChrome : rimMat;
  const archMat = id === 'r34' ? bodyMat : A.mCarbon;
  for (const [wx, wz, front] of wheelCoords) {
    const sx = Math.sign(wx);
    // Wheel arch flare + recessed dark inner liner on painted-arch cars
    if (id === 'r34') {
      const liner = new THREE.Mesh(G.archGeo, A.mWheelWell);
      liner.position.set(sx * (halfW - 0.038), S.wheelR - 0.01, wz);
      bodyGroup.add(liner);
    }
    const arch = new THREE.Mesh(G.archGeo, archMat);
    arch.position.set(sx * (halfW - 0.015), S.wheelR - 0.01, wz);
    bodyGroup.add(arch);

    const pivot = new THREE.Group();
    pivot.position.set(wx, S.wheelR, wz);
    const spin = new THREE.Group();
    pivot.add(spin);

    const tire = new THREE.Mesh(G.tireGeo, A.mTire);
    tire.castShadow = true;
    const rimBarrel = new THREE.Mesh(G.rimRingGeo, rimMat);
    const rimLip = new THREE.Mesh(G.rimOuterLipGeo, rimLipMat);
    rimLip.position.x = sx * (hw * 0.84);
    const hub = new THREE.Mesh(G.hubGeo, rimMat);
    hub.position.x = sx * (hw * (id === 'r34' ? 0.42 : 0.60));
    const rotor = new THREE.Mesh(G.rotorGeo, rotorMat);
    rotor.position.x = sx * (hw * 0.06);
    const wellBack = new THREE.Mesh(wellDiscGeo, A.mWheelWell);
    wellBack.position.x = -sx * (hw * 0.36);
    spin.add(tire, rimBarrel, rimLip, hub, rotor, wellBack);

    // 5 or 6 radial alloy spokes with open windows showing the brake rotor & caliper behind
    const spokeCount = id === 'r34' || id === '370z' || id === 'cybertruck' ? 6 : 5;
    for (let k = 0; k < spokeCount; k++) {
      const sp = new THREE.Mesh(G.spokeGeo, rimMat);
      sp.position.x = sx * (hw * (id === 'r34' ? 0.38 : 0.62));
      sp.rotation.x = (k / spokeCount) * Math.PI * 2;
      if (id === 'r34') sp.rotation.z = -sx * 0.13;
      spin.add(sp);
    }

    // Non-spinning brake caliper gripping the rotor behind the alloy spokes
    const cal = new THREE.Mesh(G.caliperGeo, caliperMat);
    cal.position.set(sx * (hw * 0.14), 0.04, front ? -S.wheelR * 0.36 : S.wheelR * 0.36);
    pivot.add(cal);

    root.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  // Exhaust pipes + NOS plasma flame cones
  const nosFlames: THREE.Group[] = [];
  for (const [ex, ey, ez] of exhaustOffsets) {
    add(G.exhaustGeo, A.mChrome, ex, ey, ez);

    const flameGroup = new THREE.Group();
    flameGroup.position.set(ex, ey, ez - 0.08);
    flameGroup.visible = false;
    const outer = new THREE.Mesh(G.flameOuterGeo, A.mFlameOuter);
    const inner = new THREE.Mesh(G.flameInnerGeo, A.mFlameCore);
    flameGroup.add(outer, inner);
    bodyGroup.add(flameGroup);
    nosFlames.push(flameGroup);
  }

  const nosLight = enablePointLight ? new THREE.PointLight(0x00d9ff, 0, 12, 1.8) : null;
  if (nosLight) {
    nosLight.position.set(0, 0.4, -halfL - 0.4);
    bodyGroup.add(nosLight);
  }

  const turret = buildBonnetGun(A, disposables, S.bonnetGun[0], S.bonnetGun[1]);
  bodyGroup.add(turret.turretRoot);

  // Grounding dark ambient occlusion contact shadow plane beneath vehicle
  const aoGeo = new THREE.PlaneGeometry(S.width + 0.95, S.length + 0.95);
  aoGeo.rotateX(-Math.PI / 2);
  const aoMat = new THREE.MeshBasicMaterial({
    map: A.contactShadowTex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const aoMesh = new THREE.Mesh(aoGeo, aoMat);
  aoMesh.position.set(0, 0.018, 0);
  aoMesh.renderOrder = 0;
  root.add(aoMesh);
  disposables.push(aoGeo, aoMat);

  // Underglow neon plane beneath the car
  const ugGeo = new THREE.PlaneGeometry(S.width + 1.5, S.length + 1.4);
  ugGeo.rotateX(-Math.PI / 2);
  const ugColor = underglowHex === 'off' ? 0x000000 : new THREE.Color(underglowHex).getHex();
  const underglowMat = new THREE.MeshBasicMaterial({
    map: A.glowTex,
    color: ugColor,
    transparent: true,
    opacity: underglowHex === 'off' ? 0 : 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const underglowMesh = new THREE.Mesh(ugGeo, underglowMat);
  underglowMesh.position.set(0, 0.045, 0);
  underglowMesh.renderOrder = 1;
  root.add(underglowMesh);
  disposables.push(ugGeo, underglowMat);

  return {
    root,
    bodyGroup,
    bodyMat,
    tailMat,
    headMat,
    rotorMat,
    underglowMat,
    underglowMesh,
    wheels,
    nosFlames,
    nosLight,
    turretRoot: turret.turretRoot,
    turretYaw: turret.turretYaw,
    turretPitch: turret.turretPitch,
    turretRecoil: turret.turretRecoil,
    muzzleFlash: turret.muzzleFlash,
    muzzlePoint: turret.muzzlePoint,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

