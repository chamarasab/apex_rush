import * as THREE from 'three';

export class Particles {
  readonly max: number;
  private cursor = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private growth: Float32Array;
  private baseAlpha: Float32Array;
  private geo: THREE.BufferGeometry;
  readonly mat: THREE.ShaderMaterial;
  readonly points: THREE.Points;

  constructor(scene: THREE.Scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.growth = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);

    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        uniform float uScale;
        varying float vA;
        varying vec3 vC;
        void main() {
          vA = aAlpha;
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vA;
        varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vC, a);
        }
      `,
    });

    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
    growth = 2.6,
    opacity = 0.45
  ): void {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    this.growth[i] = growth;
    this.baseAlpha[i] = opacity;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const o = i * 3;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.vel[o] *= 0.96;
      this.vel[o + 2] *= 0.96;
      this.size[i] += dt * this.growth[i];
      this.alpha[i] = (this.life[i] / this.maxLife[i]) * this.baseAlpha[i];
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    a.aColor.needsUpdate = true;
  }

  reset(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class SkidMarks {
  private max: number;
  private n = 0;
  private dirty = false;
  private pos: Float32Array;
  private geo: THREE.BufferGeometry;
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, max = 2200) {
    this.max = max;
    this.pos = new Float32Array(max * 12);
    const idx = new Uint16Array(max * 6);
    for (let q = 0; q < max; q++) {
      const v = q * 4;
      const o = q * 6;
      idx[o] = v;
      idx[o + 1] = v + 1;
      idx[o + 2] = v + 2;
      idx[o + 3] = v + 1;
      idx[o + 4] = v + 3;
      idx[o + 5] = v + 2;
    }
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshBasicMaterial({
      color: 0x070709,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  add(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, w: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    const px = (dz / l) * w;
    const pz = (-dx / l) * w;
    const o = (this.n++ % this.max) * 12;
    const p = this.pos;
    p[o] = a.x + px;
    p[o + 1] = a.y;
    p[o + 2] = a.z + pz;
    p[o + 3] = a.x - px;
    p[o + 4] = a.y;
    p[o + 5] = a.z - pz;
    p[o + 6] = b.x + px;
    p[o + 7] = b.y;
    p[o + 8] = b.z + pz;
    p[o + 9] = b.x - px;
    p[o + 10] = b.y;
    p[o + 11] = b.z - pz;
    this.dirty = true;
  }

  flush(): void {
    if (this.dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.dirty = false;
    }
  }

  reset(): void {
    this.pos.fill(0);
    this.n = 0;
    this.dirty = true;
  }
}

