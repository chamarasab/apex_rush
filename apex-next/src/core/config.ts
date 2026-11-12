export const DT = 1 / 60;
export const ROAD_Y = 0.04;

export const PAINT_COLORS = [
  { name: 'Metallic Silver', hex: '#cfd6df' },
  { name: 'Bayside Blue', hex: '#1565e8' },
  { name: 'Renaissance Red', hex: '#e52521' },
  { name: 'Sunset Orange', hex: '#ff621f' },
  { name: 'Giallo Yellow', hex: '#f5c518' },
  { name: 'Verde Mantis', hex: '#56e32b' },
  { name: 'Midnight Purple', hex: '#6a1b9a' },
  { name: 'Electric Cyan', hex: '#00d2ff' },
  { name: 'Championship White', hex: '#eef2f7' },
  { name: 'Gunmetal Grey', hex: '#4a525d' },
  { name: 'Obsidian Black', hex: '#16191f' },
] as const;

export const UNDERGLOW_COLORS = [
  { name: 'Cyan', hex: '#00e5ff' },
  { name: 'Magenta', hex: '#ff2a85' },
  { name: 'Electric Blue', hex: '#2979ff' },
  { name: 'Neon Green', hex: '#39ff14' },
  { name: 'Amber Gold', hex: '#ffab00' },
  { name: 'Off', hex: 'off' },
] as const;

export const DIFFS = {
  easy: { top: 0.88, cornerA: 19.5, grip: 1.0, nosChance: 0.15 },
  normal: { top: 0.96, cornerA: 24.0, grip: 1.0, nosChance: 0.45 },
  hard: { top: 1.03, cornerA: 28.5, grip: 1.06, nosChance: 0.85 },
} as const;

export type DiffKey = keyof typeof DIFFS;
export type QualityLevel = 'ultra' | 'high' | 'medium';

export const BOT_NAMES = ['Takumi', 'Keisuke', 'Dominic', 'Suki', 'Viper', 'Han', 'Dante', 'Ryosuke'];
export const NET_LEAD = 0.06;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const damp = (a: number, b: number, l: number, dt: number): number => lerp(a, b, 1 - Math.exp(-l * dt));
export const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapPi = (a: number): number => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
export const ordinal = (n: number): string => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export function fmtTime(t: number | null | undefined): string {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothLoop(a: Float32Array, w: number, open = false): Float32Array {
  const N = a.length;
  const o = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -w; k <= w; k++) {
      const j = open ? clamp(i + k, 0, N - 1) : ((i + k) % N + N) % N;
      s += a[j];
    }
    o[i] = s / (2 * w + 1);
  }
  return o;
}

