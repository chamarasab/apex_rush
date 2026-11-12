import * as THREE from 'three';
import { clamp, lerp, mulberry32, ROAD_Y, smooth, smoothLoop, wrapPi } from '../core/config';
import {
  makeAsphaltTexture,
  makeBannerTexture,
  makeBarrierTexture,
  makeBuildingWindowTexture,
  makeChevronTexture,
  makeCurbTexture,
  makeGroundTexture,
  makeHighwaySignTexture,
  makeOffroadSurfaceTexture,
  makeRunwayTexture,
} from '../core/textures';
import { TRACKS, type TrackId, type TrackTheme } from './trackData';

export class Track {
  readonly theme: TrackTheme;
  readonly open: boolean;
  readonly N: number;
  readonly startIdx: number;
  readonly finishIdx: number;
  readonly roadHalf: number;
  readonly verge: number;
  readonly barrierOff: number;
  readonly wallLim: number;
  readonly length: number;
  readonly ds: number;

  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly lx: Float32Array;
  readonly lz: Float32Array;
  readonly slope: Float32Array;
  readonly head: Float32Array;
  readonly curv: Float32Array;
  readonly line: Float32Array;

  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  readonly group = new THREE.Group();
  readonly standSpots: [number, number][] = [];
  readonly grassTex: THREE.CanvasTexture;
  readonly countdownBulbs: THREE.MeshStandardMaterial[] = [];

  private _tmp = { d: 0, y: 0, i: 0 };
  private disposables: { dispose: () => void }[] = [];

  constructor(scene: THREE.Scene, id: TrackId) {
    this.theme = TRACKS[id];
    this.open = !!this.theme.open;
    this.N = this.open ? 960 : 760;
    this.roadHalf = this.theme.roadHalf;
    this.verge = this.theme.verge;
    this.barrierOff = this.roadHalf + this.verge - 0.35;
    this.wallLim = this.barrierOff - 0.35 - 1.05;

    const curve = new THREE.CatmullRomCurve3(
      this.theme.points.map(p => new THREE.Vector3(p[0], p[1], p[2])),
      !this.open,
      'centripetal'
    );
    curve.arcLengthDivisions = 3600;
    const N = this.N;
    const pts = curve.getSpacedPoints(this.open ? N - 1 : N);
    this.length = curve.getLength();
    this.ds = this.length / (this.open ? N - 1 : N);
    this.startIdx = this.open ? Math.min(80, Math.round(72 / this.ds)) : 0;
    this.finishIdx = this.open ? Math.max(this.startIdx + 60, N - 1 - Math.round(115 / this.ds)) : 0;

    const f = () => new Float32Array(N);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.tx = f();
    this.tz = f();
    this.lx = f();
    this.lz = f();
    this.slope = f();
    this.head = f();

    for (let i = 0; i < N; i++) {
      this.px[i] = pts[i].x;
      this.py[i] = pts[i].y;
      this.pz[i] = pts[i].z;
    }

    for (let i = 0; i < N; i++) {
      const a = pts[this.open ? Math.max(0, i - 1) : (i + N - 1) % N];
      const b = pts[this.open ? Math.min(N - 1, i + 1) : (i + 1) % N];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const hl = Math.hypot(dx, dz);
      dx /= hl;
      dz /= hl;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.lx[i] = dz;
      this.lz[i] = -dx;
      this.slope[i] = (b.y - a.y) / hl;
      this.head[i] = Math.atan2(dx, dz);
    }

    const k = f();
    for (let i = 0; i < N; i++) {
      const a = this.open ? Math.max(0, i - 1) : (i + N - 1) % N;
      const b = this.open ? Math.min(N - 1, i + 1) : (i + 1) % N;
      const span = this.open && (i === 0 || i === N - 1) ? this.ds : 2 * this.ds;
      k[i] = wrapPi(this.head[b] - this.head[a]) / span;
    }
    this.curv = smoothLoop(k, 3, this.open);

    const wide = smoothLoop(k, 22, this.open);
    const line = f();
    const maxOff = this.roadHalf - 2.1;
    for (let i = 0; i < N; i++) {
      line[i] = clamp(wide[i] * 320, -maxOff, maxOff);
    }
    this.line = smoothLoop(line, 8, this.open);

    this.minX = Math.min(...this.px);
    this.maxX = Math.max(...this.px);
    this.minZ = Math.min(...this.pz);
    this.maxZ = Math.max(...this.pz);

    this.grassTex = makeGroundTexture(this.theme.groundBase, this.theme.groundDark, this.theme.groundLight);
    this.disposables.push(this.grassTex);

    scene.add(this.group);
    this.buildMeshes();
  }

  locate(x: number, z: number, hint: number, range = 14): number {
    const N = this.N;
    let best = hint;
    let bd = 1e18;
    for (let o = -range; o <= range; o++) {
      const i = this.open ? clamp(hint + o, 0, N - 1) : ((hint + o) % N + N) % N;
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  locateGlobal(x: number, z: number): number {
    let bd = 1e18;
    let bi = 0;
    for (let i = 0; i < this.N; i++) {
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  }

  nearestInfo(x: number, z: number, out = this._tmp): { d: number; y: number; i: number } {
    let bd = 1e18;
    let bi = 0;
    for (let i = 0; i < this.N; i += 2) {
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    out.d = Math.sqrt(bd);
    out.y = this.py[bi];
    out.i = bi;
    return out;
  }

  surfaceAt(idx: number): 'asphalt' | 'sand' | 'mud' | 'water' {
    if (this.theme.sceneryStyle !== 'offroad') return 'asphalt';
    const y = this.py[idx];
    if (y < 0.06) return 'water';
    if (this.mudBlendAt(idx) > 0.52) return 'mud';
    return 'sand';
  }

  private mudBlendAt(i: number): number {
    const bankMud = clamp((2.3 - this.py[i]) / 1.9, 0, 1);
    const bogWave = smooth(0.38, 0.78, Math.sin((i / this.N) * Math.PI * 6 + 1.0) * 0.5 + 0.5);
    return Math.max(bankMud, bogWave);
  }

  private offroadRiverDist(x: number, z: number): number {
    // River crossing 1 near (80, -185), flowing orthogonal to track segment (105,-148)->(55,-222)
    const s1 = (x - 80) * 0.829 - (z + 185) * 0.559;
    const d1 = (x - 80) * 0.559 + (z + 185) * 0.829 + 16 * Math.sin(s1 * 0.015);
    // River crossing 2 near (-347.5, -48), flowing orthogonal to (-330,-108)->(-365,12)
    const s2 = (x + 347.5) * 0.960 + (z + 48) * 0.280;
    const d2 = (x + 347.5) * 0.280 - (z + 48) * 0.960 + 18 * Math.sin(s2 * 0.014);
    return Math.min(Math.abs(d1), Math.abs(d2));
  }

  terrainHeight(x: number, z: number): number {
    const t = this.nearestInfo(x, z);
    const d = t.d;
    if (this.theme.sceneryStyle === 'harbor') {
      const hills = -1.8 + 8 * Math.sin(x * 0.01) * Math.cos(z * 0.012) * smooth(90, 420, d);
      return lerp(t.y - 0.85, hills, smooth(16, 65, d));
    }
    const n =
      0.5 +
      0.5 * Math.sin(x * 0.0105 + 1.3) * Math.cos(z * 0.0125 + 0.4) +
      0.22 * Math.sin(x * 0.031 + z * 0.027);
    if (this.theme.sceneryStyle === 'offroad') {
      const rDist = this.offroadRiverDist(x, z);
      const riverChannel = 1 - smooth(24, 62, rDist);
      const dunes = 1.8 + n * this.theme.terrainHillHeight * smooth(65, 420, d);
      const hills = lerp(dunes, -0.95, riverChannel);
      return lerp(t.y - 0.72, hills, smooth(16, 68, d));
    }
    if (this.theme.sceneryStyle === 'expressway') {
      // Kelani River crossing beneath New Kelani Bridge (z ≈ 915) + Muthurajawela Wetlands & Negombo Lagoon west of E03
      const kelaniZ = 915 + 32 * Math.sin(x * 0.008);
      const kelaniRiver = 1 - smooth(38, 92, Math.abs(z - kelaniZ));
      const coastEdge = -215 + 36 * Math.sin(z * 0.0045);
      const negomboLagoon =
        z < 360 && z > -1060 ? 1 - smooth(-40, 120, x - coastEdge) : 0;
      const lagoonPocket =
        (1 - smooth(85, 220, Math.hypot((x + 310) * 0.85, z + 640))) *
        (0.65 + 0.35 * Math.sin(x * 0.015) * Math.cos(z * 0.014));
      const airportPad = 1 - smooth(75, 160, Math.hypot((x - 40) * 0.45, z + 1320));
      const waterMask = Math.max(kelaniRiver, negomboLagoon * 0.96, lagoonPocket) * (1 - airportPad);
      const landHills = 1.2 + n * this.theme.terrainHillHeight * smooth(85, 460, d);
      const hills = lerp(lerp(landHills, -2.1, waterMask), 1.9, airportPad);
      return lerp(t.y - 0.85, hills, smooth(18, 72, d));
    }
    const hills = n * this.theme.terrainHillHeight * smooth(70, 420, d);
    return lerp(t.y - 0.75, hills, smooth(18, 78, d));
  }

  private ribbon(
    offA: number,
    offB: number,
    yOffA: number,
    yOffB: number,
    vLen: number,
    filter?: (i: number) => boolean,
    colorFn?: (i: number, out: [number, number, number]) => void
  ): THREE.BufferGeometry {
    const N = this.N;
    const last = this.open ? N - 1 : N;
    const pos = new Float32Array((last + 1) * 6);
    const uv = new Float32Array((last + 1) * 4);
    const col = colorFn ? new Float32Array((last + 1) * 6) : null;
    const rgb: [number, number, number] = [1, 1, 1];
    const idx: number[] = [];

    for (let i = 0; i <= last; i++) {
      const j = this.open ? i : i % N;
      const o = i * 6;
      pos[o] = this.px[j] + this.lx[j] * offA;
      pos[o + 1] = this.py[j] + yOffA;
      pos[o + 2] = this.pz[j] + this.lz[j] * offA;
      pos[o + 3] = this.px[j] + this.lx[j] * offB;
      pos[o + 4] = this.py[j] + yOffB;
      pos[o + 5] = this.pz[j] + this.lz[j] * offB;

      if (col && colorFn) {
        colorFn(j, rgb);
        col[o] = col[o + 3] = rgb[0];
        col[o + 1] = col[o + 4] = rgb[1];
        col[o + 2] = col[o + 5] = rgb[2];
      }

      const v = (i * this.ds) / vLen;
      uv[i * 4] = 0;
      uv[i * 4 + 1] = v;
      uv[i * 4 + 2] = 1;
      uv[i * 4 + 3] = v;

      if (i < last && (!filter || filter(j))) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.disposables.push(g);
    return g;
  }

  private buildMeshes(): void {
    const N = this.N;
    const H = this.roadHalf;
    const g = this.group;
    const th = this.theme;
    const isOffroad = th.sceneryStyle === 'offroad';
    const isExpressway = th.sceneryStyle === 'expressway';

    // 1. Road Surface (Asphalt, E03 Divided Highway, or Offroad Sand / Mud / Riverbed)
    const surfTex = isOffroad ? makeOffroadSurfaceTexture() : makeAsphaltTexture(th.wetRoad, isExpressway);
    this.disposables.push(surfTex.map, surfTex.roughnessMap, surfTex.normalMap);
    const vLen = this.length / Math.round(this.length / (isExpressway ? 16 : 12));

    const offroadRoadColor = isOffroad
      ? (i: number, out: [number, number, number]) => {
          const y = this.py[i];
          const mud = this.mudBlendAt(i);
          // Sand (#dca86c) -> Mud (#4d321c) -> Submerged riverbed silt (#535d56)
          let r = lerp(0.96, 0.36, mud);
          let gr = lerp(0.76, 0.24, mud);
          let b = lerp(0.49, 0.14, mud);
          if (y < 0.35) {
            const w = clamp((0.35 - y) / 0.5, 0, 1);
            r = lerp(r, 0.35, w);
            gr = lerp(gr, 0.41, w);
            b = lerp(b, 0.38, w);
          }
          out[0] = r;
          out[1] = gr;
          out[2] = b;
        }
      : undefined;

    const roadMat = new THREE.MeshStandardMaterial({
      map: surfTex.map,
      roughnessMap: surfTex.roughnessMap,
      normalMap: surfTex.normalMap,
      normalScale: new THREE.Vector2(isOffroad ? 1.15 : th.wetRoad ? 0.35 : 0.72, isOffroad ? 1.15 : th.wetRoad ? 0.35 : 0.72),
      roughness: isOffroad ? 0.88 : th.wetRoad ? 0.40 : 0.86,
      metalness: isOffroad ? 0.04 : th.wetRoad ? 0.28 : 0.04,
      vertexColors: isOffroad,
    });
    this.disposables.push(roadMat);
    const road = new THREE.Mesh(this.ribbon(H, -H, ROAD_Y, ROAD_Y, vLen, undefined, offroadRoadColor), roadMat);
    road.receiveShadow = true;
    g.add(road);

    // 2. Verges + Elevated Road Embankments so elevated sections look grounded
    const offroadVergeColor = isOffroad
      ? (i: number, out: [number, number, number]) => {
          const mud = Math.max(this.mudBlendAt(i), clamp((0.6 - this.py[i]) / 0.8, 0, 1));
          out[0] = lerp(1.0, 0.44, mud);
          out[1] = lerp(1.0, 0.36, mud);
          out[2] = lerp(1.0, 0.26, mud);
        }
      : undefined;
    const vergeMat = new THREE.MeshLambertMaterial({ map: this.grassTex, vertexColors: isOffroad });
    this.disposables.push(vergeMat);
    const outer = H + this.verge;
    for (const [a, b] of [
      [outer, H],
      [-H, -outer],
    ]) {
      const m = new THREE.Mesh(this.ribbon(a, b, 0, 0, 6, undefined, offroadVergeColor), vergeMat);
      m.receiveShadow = true;
      g.add(m);
    }

    // Side retaining walls / embankments under elevated road edges
    const wallMat = new THREE.MeshStandardMaterial({
      color: isOffroad ? 0x6b4d30 : isExpressway ? 0x5c6470 : 0x333944,
      roughness: 0.9,
    });
    this.disposables.push(wallMat);
    for (const side of [1, -1]) {
      const emb = new THREE.Mesh(
        this.ribbon(side * outer, side * (outer + 2.2), 0, isExpressway ? -8.5 : -4.5, 10),
        wallMat
      );
      g.add(emb);
    }

    // 3. Curbs in corners (skip painted race curbs on natural offroad trails & divided highway)
    if (!isOffroad && !isExpressway) {
      const curbTex = makeCurbTexture(th.curbColors[0], th.curbColors[1]);
      const curbMat = new THREE.MeshStandardMaterial({
        map: curbTex,
        roughness: 0.65,
        emissive: th.night ? new THREE.Color(th.curbColors[0]) : new THREE.Color(0x000000),
        emissiveIntensity: th.night ? 0.35 : 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.disposables.push(curbTex, curbMat);
      const isCorner = (i: number) => Math.abs(this.curv[i]) > 0.0052;
      const curbLen = this.length / Math.round(this.length / 4);
      for (const [a, b] of [
        [H + 1.15, H - 0.15],
        [-H + 0.15, -H - 1.15],
      ]) {
        const m = new THREE.Mesh(this.ribbon(a, b, 0.055, 0.055, curbLen, isCorner), curbMat);
        m.receiveShadow = true;
        g.add(m);
      }
    }

    // 4. Instanced FIA Concrete + Galvanized Armco Barriers (or Baja Timber Guardrails)
    const segs = this.open ? Math.floor((N - 1) / 2) : N / 2;
    const barrierTex = makeBarrierTexture(th.accentHex, th.night, isOffroad);
    barrierTex.repeat.set(2, 1);
    const barGeo = new THREE.BoxGeometry(0.65, 1.95, 1);
    const barMat = new THREE.MeshStandardMaterial({
      map: barrierTex,
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.28,
    });
    this.disposables.push(barrierTex, barGeo, barMat);
    const bar = new THREE.InstancedMesh(barGeo, barMat, segs * 2);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const col = new THREE.Color();
    let n = 0;

    for (let k = 0; k < segs; k++) {
      const i = k * 2;
      const j = this.open ? Math.min(N - 1, i + 2) : (i + 2) % N;
      for (const side of [1, -1]) {
        const off = side * this.barrierOff;
        const ax = this.px[i] + this.lx[i] * off;
        const az = this.pz[i] + this.lz[i] * off;
        const bx = this.px[j] + this.lx[j] * off;
        const bz = this.pz[j] + this.lz[j] * off;
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        const dy = this.py[j] - this.py[i];
        p.set((ax + bx) / 2, (this.py[i] + this.py[j]) / 2 - 0.15, (az + bz) / 2);
        e.set(-Math.atan2(dy, len), Math.atan2(dx, dz), 0);
        q.setFromEuler(e);
        s.set(1, 1, len + 0.05);
        m4.compose(p, q, s);
        bar.setMatrixAt(n, m4);
        bar.setColorAt(n, col.setHex(k % 2 ? th.barrierColors[0] : th.barrierColors[1]));
        n++;
      }
    }
    bar.instanceMatrix.needsUpdate = true;
    if (bar.instanceColor) bar.instanceColor.needsUpdate = true;
    bar.castShadow = true;
    bar.receiveShadow = true;
    g.add(bar);

    if (this.open) {
      const capGeo = new THREE.BoxGeometry(this.barrierOff * 2 + 0.65, 2.0, 0.75);
      this.disposables.push(capGeo);
      for (const capIdx of [0, N - 1]) {
        const cap = new THREE.Mesh(capGeo, barMat);
        cap.position.set(this.px[capIdx], this.py[capIdx] + 0.9, this.pz[capIdx]);
        cap.rotation.y = this.head[capIdx];
        cap.castShadow = true;
        g.add(cap);
      }
    }

    // 5. Start/Finish Line & Animated Countdown Gantry
    this.buildStartGantry();

    // 6. Automatic Corner Chevron Signs before sharp corners
    this.buildCornerChevrons();

    // 7. Track-specific Streetlamps / Arches / Skyline / Props
    this.buildTrackProps();
  }

  private buildStartGantry(): void {
    const H = this.roadHalf;
    const th = this.theme;
    const checker = makeCurbTexture('#111111', '#f6f8fb');
    checker.repeat.set(8, 1);
    const lineGeo = new THREE.PlaneGeometry(H * 2, 2.8);
    lineGeo.rotateX(-Math.PI / 2);
    const lineMat = new THREE.MeshStandardMaterial({
      map: checker,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, metalness: 0.7, roughness: 0.35 });
    const postGeo = new THREE.BoxGeometry(0.85, 9.5, 0.85);
    const beamGeo = new THREE.BoxGeometry((H + 2.8) * 2 + 0.9, 2.2, 1.0);
    const bannerGeo = new THREE.PlaneGeometry((H + 2.8) * 2, 1.85);
    const bulbGeo = new THREE.SphereGeometry(0.32, 12, 10);
    this.disposables.push(checker, lineGeo, lineMat, frameMat, postGeo, beamGeo, bannerGeo, bulbGeo);

    this.countdownBulbs.length = 0;
    const addArch = (idx: number, label: string, withBulbs: boolean) => {
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.position.set(this.px[idx], this.py[idx] + ROAD_Y + 0.02, this.pz[idx]);
      line.rotation.y = this.head[idx];
      line.receiveShadow = true;
      this.group.add(line);

      const gantry = new THREE.Group();
      const bannerTex = makeBannerTexture(label, th.accentHex);
      const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
      this.disposables.push(bannerTex, bannerMat);

      for (const sx of [1, -1]) {
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(sx * (H + 2.8), 4.75, 0);
        post.castShadow = true;
        gantry.add(post);
      }
      const beam = new THREE.Mesh(beamGeo, frameMat);
      beam.position.y = 8.4;
      beam.castShadow = true;
      gantry.add(beam);

      const b1 = new THREE.Mesh(bannerGeo, bannerMat);
      b1.position.set(0, 8.4, 0.52);
      const b2 = new THREE.Mesh(bannerGeo, bannerMat);
      b2.position.set(0, 8.4, -0.52);
      b2.rotation.y = Math.PI;
      gantry.add(b1, b2);

      if (withBulbs) {
        for (let i = 0; i < 4; i++) {
          const mat = new THREE.MeshStandardMaterial({
            color: 0x1c2028,
            emissive: new THREE.Color(0x000000),
            emissiveIntensity: 0,
          });
          this.disposables.push(mat);
          this.countdownBulbs.push(mat);
          const pod = new THREE.Mesh(bulbGeo, mat);
          pod.position.set((i - 1.5) * 1.4, 6.85, -0.2);
          gantry.add(pod);
        }
      }

      gantry.position.set(this.px[idx], this.py[idx], this.pz[idx]);
      gantry.rotation.y = this.head[idx];
      this.group.add(gantry);
    };

    if (this.open) {
      addArch(this.startIdx, `START  ·  ${th.name.toUpperCase()}`, true);
      addArch(this.finishIdx, `FINISH  ·  KATUNAYAKE BIA`, false);
    } else {
      addArch(0, `APEX RUSH  ·  ${th.name.toUpperCase()}`, true);
    }
  }

  setCountdownLights(stage: number): void {
    // stage: -1 idle, 0..2 red lights lighting up, 3 green GO!
    this.countdownBulbs.forEach((mat, idx) => {
      if (stage === 3) {
        mat.emissive.setHex(0x39ff14);
        mat.emissiveIntensity = 3.2;
      } else if (stage >= 0 && idx <= stage) {
        mat.emissive.setHex(0xff2020);
        mat.emissiveIntensity = 3.0;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    });
  }

  private buildCornerChevrons(): void {
    const chevTex = makeChevronTexture(this.theme.accentHex);
    const chevMat = new THREE.MeshBasicMaterial({ map: chevTex, side: THREE.DoubleSide });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x20252f, roughness: 0.7 });
    const boardGeo = new THREE.PlaneGeometry(3.2, 1.5);
    const postGeo = new THREE.BoxGeometry(0.16, 2.6, 0.16);
    this.disposables.push(chevTex, chevMat, postMat, boardGeo, postGeo);

    let lastPlaced = -40;
    for (let i = 15; i < this.N - 15; i += 4) {
      const k = this.curv[i];
      if (Math.abs(k) > 0.011 && i - lastPlaced >= 14) {
        lastPlaced = i;
        const turnLeft = k > 0;
        const side = turnLeft ? -1 : 1; // outer edge of turn
        const off = side * (this.barrierOff + 1.1);
        const x = this.px[i] + this.lx[i] * off;
        const z = this.pz[i] + this.lz[i] * off;
        const y = this.py[i];

        const signGroup = new THREE.Group();
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 1.3;
        const board = new THREE.Mesh(boardGeo, chevMat);
        board.position.y = 2.4;
        if (!turnLeft) board.scale.x = -1; // flip arrows for right turn
        signGroup.add(post, board);
        signGroup.position.set(x, y, z);
        signGroup.rotation.y = this.head[i] + Math.PI; // face approaching driver
        this.group.add(signGroup);
      }
    }
  }

  private buildTrackProps(): void {
    const th = this.theme;
    const rnd = mulberry32(42077);

    // Streetlight poles along track (glowing at night, sleek steel poles by day)
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.6, 6);
    const armGeo = new THREE.BoxGeometry(2.6, 0.14, 0.14);
    const lampGeo = new THREE.BoxGeometry(0.9, 0.14, 0.35);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x28303d, metalness: 0.7, roughness: 0.35 });
    const lampColor = th.night ? 0x99ecff : 0xfff5db;
    const lampMat = new THREE.MeshStandardMaterial({
      color: lampColor,
      emissive: new THREE.Color(lampColor),
      emissiveIntensity: th.night ? 2.6 : 0.25,
    });
    this.disposables.push(poleGeo, armGeo, lampGeo, poleMat, lampMat);

    const poleStep = th.night ? 18 : 28;
    const poleCount = Math.floor(this.N / poleStep);
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, poleCount);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, poleCount);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, poleCount);

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const e = new THREE.Euler();

    let idx = 0;
    for (let i = 0; i < this.N && idx < poleCount; i += poleStep) {
      const side = (idx % 2 === 0 ? 1 : -1);
      const off = side * (this.barrierOff + 0.9);
      const x = this.px[i] + this.lx[i] * off;
      const z = this.pz[i] + this.lz[i] * off;
      const y = this.py[i];
      e.set(0, this.head[i], 0);
      q.setFromEuler(e);

      p.set(x, y + 3.8, z);
      m4.compose(p, q, s);
      poles.setMatrixAt(idx, m4);

      p.set(x - this.lx[i] * side * 1.15, y + 7.5, z - this.lz[i] * side * 1.15);
      m4.compose(p, q, s);
      arms.setMatrixAt(idx, m4);

      p.set(x - this.lx[i] * side * 2.1, y + 7.38, z - this.lz[i] * side * 2.1);
      m4.compose(p, q, s);
      lamps.setMatrixAt(idx, m4);
      idx++;
    }
    poles.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    this.group.add(poles, arms, lamps);

    // Night Neon Arches for Neon Tokyo
    if (th.sceneryStyle === 'city') {
      const archCols = [0x00e5ff, 0xff2a85, 0xffe600];
      const archPillar = new THREE.BoxGeometry(0.6, 9.2, 0.6);
      const archTop = new THREE.BoxGeometry((this.roadHalf + 3.0) * 2 + 0.8, 0.55, 0.6);
      this.disposables.push(archPillar, archTop);

      for (let k = 1; k <= 6; k++) {
        const i = Math.floor((k / 7) * this.N);
        const neonCol = archCols[k % archCols.length];
        const mat = new THREE.MeshStandardMaterial({
          color: neonCol,
          emissive: new THREE.Color(neonCol),
          emissiveIntensity: 2.6,
        });
        this.disposables.push(mat);

        const arch = new THREE.Group();
        for (const sx of [1, -1]) {
          const post = new THREE.Mesh(archPillar, mat);
          post.position.set(sx * (this.roadHalf + 3.0), 4.6, 0);
          arch.add(post);
        }
        const top = new THREE.Mesh(archTop, mat);
        top.position.y = 9.0;
        arch.add(top);
        arch.position.set(this.px[i], this.py[i], this.pz[i]);
        arch.rotation.y = this.head[i];
        this.group.add(arch);
      }

      // City Skyline Towers surrounding track
      const winTex = makeBuildingWindowTexture();
      winTex.repeat.set(2, 4);
      const bldgMat = new THREE.MeshStandardMaterial({
        map: winTex,
        emissiveMap: winTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.9,
        roughness: 0.5,
      });
      const bldgGeo = new THREE.BoxGeometry(1, 1, 1);
      this.disposables.push(winTex, bldgMat, bldgGeo);

      const towers: [number, number, number, number, number, number][] = [];
      const cx = (this.minX + this.maxX) / 2;
      const cz = (this.minZ + this.maxZ) / 2;
      const tmp = { d: 0, y: 0, i: 0 };
      for (let k = 0; k < 150; k++) {
        const x = cx + (rnd() - 0.5) * 1150;
        const z = cz + (rnd() - 0.5) * 1150;
        if (this.nearestInfo(x, z, tmp).d < 34) continue;
        const w = 18 + rnd() * 28;
        const d = 18 + rnd() * 28;
        const h = 38 + rnd() * 145;
        towers.push([x, this.terrainHeight(x, z) - 2, z, w, h, d]);
      }
      const im = new THREE.InstancedMesh(bldgGeo, bldgMat, towers.length);
      towers.forEach((b, i) => {
        p.set(b[0], b[1] + b[4] / 2, b[2]);
        q.identity();
        s.set(b[3], b[4], b[5]);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }

    // Suspension bridge towers for Harbor Bay GP
    if (th.sceneryStyle === 'harbor') {
      const pylonMat = new THREE.MeshStandardMaterial({ color: 0xeaf2f8, metalness: 0.5, roughness: 0.4 });
      const cableMat = new THREE.MeshStandardMaterial({ color: 0x00d2ff, emissive: 0x005577, emissiveIntensity: 0.5 });
      const towerGeo = new THREE.BoxGeometry(1.4, 34, 1.4);
      const crossGeo = new THREE.BoxGeometry(this.roadHalf * 2 + 7, 1.8, 1.2);
      this.disposables.push(pylonMat, cableMat, towerGeo, crossGeo);

      for (const frac of [0.22, 0.30]) {
        const i = Math.floor(frac * this.N);
        const bridge = new THREE.Group();
        for (const sx of [1, -1]) {
          const t = new THREE.Mesh(towerGeo, pylonMat);
          t.position.set(sx * (this.roadHalf + 3.4), 16, 0);
          t.castShadow = true;
          bridge.add(t);
        }
        const cb1 = new THREE.Mesh(crossGeo, pylonMat);
        cb1.position.y = 26;
        const cb2 = new THREE.Mesh(crossGeo, cableMat);
        cb2.position.y = 14;
        bridge.add(cb1, cb2);
        bridge.position.set(this.px[i], this.py[i], this.pz[i]);
        bridge.rotation.y = this.head[i];
        this.group.add(bridge);
      }
    }

    // Colombo–Katunayake Expressway (E03): New Kelani Bridge towers, viaduct piers, E03 gantries, Toll Plaza & BIA Airport
    if (th.sceneryStyle === 'expressway') {
      const concreteMat = new THREE.MeshStandardMaterial({ color: 0xd9dfe6, roughness: 0.55, metalness: 0.15 });
      const goldCableMat = new THREE.MeshStandardMaterial({
        color: 0xf4c44e,
        emissive: 0x3a2805,
        emissiveIntensity: 0.35,
        metalness: 0.65,
        roughness: 0.28,
      });
      const steelMat = new THREE.MeshStandardMaterial({ color: 0x262e3a, metalness: 0.72, roughness: 0.35 });
      this.disposables.push(concreteMat, goldCableMat, steelMat);

      // 1. Concrete bridge piers underneath elevated viaduct spans
      const pierGeo = new THREE.BoxGeometry(3.2, 16, 2.2);
      this.disposables.push(pierGeo);
      const pierIndices: number[] = [];
      for (let i = 0; i < this.N; i += 14) {
        if (this.py[i] > 3.1) pierIndices.push(i);
      }
      if (pierIndices.length) {
        const piers = new THREE.InstancedMesh(pierGeo, concreteMat, pierIndices.length);
        pierIndices.forEach((ti, k) => {
          p.set(this.px[ti], this.py[ti] - 8.2, this.pz[ti]);
          e.set(0, this.head[ti], 0);
          q.setFromEuler(e);
          s.set(1, 1, 1);
          m4.compose(p, q, s);
          piers.setMatrixAt(k, m4);
        });
        piers.instanceMatrix.needsUpdate = true;
        this.group.add(piers);
      }

      // 2. Iconic New Kelani Bridge twin diamond cable-stayed pylons over Kelani River
      const towerLegGeo = new THREE.BoxGeometry(1.7, 46, 2.2);
      const crossBeamGeo = new THREE.BoxGeometry(this.roadHalf * 2 + 8.5, 2.1, 2.0);
      const cableGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 5);
      this.disposables.push(towerLegGeo, crossBeamGeo, cableGeo);

      for (const frac of [0.072, 0.104]) {
        const i = Math.floor(frac * this.N);
        const br = new THREE.Group();
        for (const sx of [1, -1]) {
          const leg = new THREE.Mesh(towerLegGeo, concreteMat);
          leg.position.set(sx * (this.roadHalf + 3.4), 19, 0);
          leg.rotation.z = sx * 0.065;
          leg.castShadow = true;
          br.add(leg);

          // Harp pattern golden-steel stay cables on both fore & aft spans
          for (let c = 0; c < 6; c++) {
            const anchorY = 27 + c * 2.4;
            const deckZ = 10 + c * 5.2;
            for (const dir of [-1, 1]) {
              const topV = new THREE.Vector3(sx * (this.roadHalf + 2.2), anchorY, 0);
              const botV = new THREE.Vector3(sx * (this.roadHalf + 1.8), 0.6, dir * deckZ);
              const len = topV.distanceTo(botV);
              const cab = new THREE.Mesh(cableGeo, goldCableMat);
              cab.position.copy(topV).add(botV).multiplyScalar(0.5);
              cab.scale.set(1, len, 1);
              cab.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), topV.clone().sub(botV).normalize());
              br.add(cab);
            }
          }
        }
        const upperBeam = new THREE.Mesh(crossBeamGeo, concreteMat);
        upperBeam.position.y = 33.5;
        const accentBeam = new THREE.Mesh(crossBeamGeo, goldCableMat);
        accentBeam.position.y = 37.5;
        accentBeam.scale.set(0.92, 0.65, 0.8);
        br.add(upperBeam, accentBeam);

        br.position.set(this.px[i], this.py[i], this.pz[i]);
        br.rotation.y = this.head[i];
        this.group.add(br);
      }

      // 3. E03 Sri Lankan Green Overhead Highway Gantry Signs
      const signPostGeo = new THREE.CylinderGeometry(0.28, 0.34, 9.2, 8);
      const signTrussGeo = new THREE.BoxGeometry((this.roadHalf + 2.8) * 2 + 1.2, 0.65, 0.7);
      const signBoardGeo = new THREE.PlaneGeometry(16.5, 3.6);
      this.disposables.push(signPostGeo, signTrussGeo, signBoardGeo);

      const signs: [number, string, string, string][] = [
        [0.24, 'E03', 'PELIYAGODA  ↑  KERAWALAPITIYA 6 KM', 'COLOMBO – KATUNAYAKE EXPRESSWAY'],
        [0.54, 'E03', 'MUTHURAJAWELA  ·  JA-ELA  14 KM', 'NEGOMBO LAGOON VIADUCT'],
        [0.80, 'E03', 'KATUNAYAKE  ·  BIA AIRPORT  2 KM ✈', 'CANADA FRIENDSHIP RD  EXIT'],
      ];
      for (const [frac, badge, head, sub] of signs) {
        const i = Math.floor(frac * this.N);
        const sg = new THREE.Group();
        for (const sx of [1, -1]) {
          const post = new THREE.Mesh(signPostGeo, steelMat);
          post.position.set(sx * (this.roadHalf + 2.8), 4.6, 0);
          post.castShadow = true;
          sg.add(post);
        }
        const truss = new THREE.Mesh(signTrussGeo, steelMat);
        truss.position.y = 8.9;
        const sTex = makeHighwaySignTexture(badge, head, sub);
        const sMat = new THREE.MeshBasicMaterial({ map: sTex });
        this.disposables.push(sTex, sMat);
        const front = new THREE.Mesh(signBoardGeo, sMat);
        front.position.set(0, 7.9, 0.42);
        const back = new THREE.Mesh(signBoardGeo, sMat);
        back.position.set(0, 7.9, -0.42);
        back.rotation.y = Math.PI;
        sg.add(truss, front, back);
        sg.position.set(this.px[i], this.py[i], this.pz[i]);
        sg.rotation.y = this.head[i];
        this.group.add(sg);
      }

      // 4. Katunayake Expressway Toll Plaza Overhead Canopy
      const tollIdx = Math.floor(0.89 * this.N);
      const toll = new THREE.Group();
      const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0b6b42, roughness: 0.4, metalness: 0.25 });
      const tollTrimMat = new THREE.MeshStandardMaterial({ color: 0xf6c318, emissive: 0x554000, emissiveIntensity: 0.45 });
      const etcMat = new THREE.MeshBasicMaterial({ color: 0x1aff8c });
      const tollPostGeo = new THREE.BoxGeometry(1.1, 8.2, 2.8);
      const canopyGeo = new THREE.BoxGeometry((this.roadHalf + 3.4) * 2 + 2, 1.5, 9.5);
      const trimGeo = new THREE.BoxGeometry((this.roadHalf + 3.4) * 2 + 2.2, 0.32, 9.7);
      const laneBeaconGeo = new THREE.BoxGeometry(2.4, 0.55, 0.25);
      this.disposables.push(canopyMat, tollTrimMat, etcMat, tollPostGeo, canopyGeo, trimGeo, laneBeaconGeo);

      for (const sx of [1, -1]) {
        const pillar = new THREE.Mesh(tollPostGeo, concreteMat);
        pillar.position.set(sx * (this.roadHalf + 3.1), 4.1, 0);
        pillar.castShadow = true;
        toll.add(pillar);
      }
      const roof = new THREE.Mesh(canopyGeo, canopyMat);
      roof.position.y = 8.4;
      roof.castShadow = true;
      const roofTrim = new THREE.Mesh(trimGeo, tollTrimMat);
      roofTrim.position.y = 7.75;
      toll.add(roof, roofTrim);
      for (const lx of [-6.8, -2.3, 2.3, 6.8]) {
        for (const zf of [-4.8, 4.8]) {
          const b = new THREE.Mesh(laneBeaconGeo, etcMat);
          b.position.set(lx, 7.1, zf);
          toll.add(b);
        }
      }
      toll.position.set(this.px[tollIdx], this.py[tollIdx], this.pz[tollIdx]);
      toll.rotation.y = this.head[tollIdx];
      this.group.add(toll);

      // 5. Bandaranaike International Airport (BIA) Runway & Control Tower beside northern loop
      const rwyTex = makeRunwayTexture();
      const rwyGeo = new THREE.PlaneGeometry(34, 280);
      rwyGeo.rotateX(-Math.PI / 2);
      const rwyMat = new THREE.MeshStandardMaterial({ map: rwyTex, roughness: 0.78 });
      const apronMat = new THREE.MeshStandardMaterial({ color: 0x323842, roughness: 0.85 });
      const towerMat = new THREE.MeshStandardMaterial({ color: 0xeaf0f6, roughness: 0.45 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x165e8c, emissive: 0x0b3552, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.6 });
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
      this.disposables.push(rwyTex, rwyGeo, rwyMat, apronMat, towerMat, glassMat, beaconMat);

      const airport = new THREE.Group();
      const rwy = new THREE.Mesh(rwyGeo, rwyMat);
      rwy.rotation.y = Math.PI * 0.43;
      rwy.receiveShadow = true;
      airport.add(rwy);

      // Control Tower
      const shaftGeo = new THREE.CylinderGeometry(3.2, 4.2, 32, 12);
      const cabGeo = new THREE.CylinderGeometry(6.8, 4.6, 5.2, 12);
      const capGeo = new THREE.CylinderGeometry(7.2, 7.2, 1.1, 12);
      const beaconGeo = new THREE.SphereGeometry(0.9, 10, 8);
      const fuseGeo = new THREE.CylinderGeometry(2.3, 2.3, 30, 12);
      const wingGeo = new THREE.BoxGeometry(28, 0.45, 5.5);
      const tailGeo = new THREE.BoxGeometry(0.5, 6.2, 4.2);
      this.disposables.push(shaftGeo, cabGeo, capGeo, beaconGeo, fuseGeo, wingGeo, tailGeo);

      const shaft = new THREE.Mesh(shaftGeo, towerMat);
      shaft.position.set(-42, 16, -24);
      const cab = new THREE.Mesh(cabGeo, glassMat);
      cab.position.set(-42, 34, -24);
      const cap = new THREE.Mesh(capGeo, towerMat);
      cap.position.set(-42, 37, -24);
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(-42, 39, -24);
      airport.add(shaft, cab, cap, beacon);

      // Parked / Climbing commercial airliner on runway approach
      const planeGroup = new THREE.Group();
      const fuselage = new THREE.Mesh(fuseGeo, towerMat);
      fuselage.rotation.x = Math.PI / 2;
      const wings = new THREE.Mesh(wingGeo, concreteMat);
      wings.position.set(0, -0.3, 1);
      const tailFin = new THREE.Mesh(tailGeo, tollTrimMat);
      tailFin.position.set(0, 3.2, -13);
      planeGroup.add(fuselage, wings, tailFin);
      planeGroup.position.set(22, 16, 10);
      planeGroup.rotation.set(0.14, Math.PI * 0.43, 0);
      airport.add(planeGroup);

      airport.position.set(40, 2.08, -1320);
      this.group.add(airport);
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const d of this.disposables) d.dispose();
  }
}

