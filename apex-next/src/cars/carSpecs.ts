export type CarId =
  | 'r34'
  | 'supra'
  | 'charger'
  | 'huracan'
  | '370z'
  | 'cybertruck'
  | 'gwagon'
  | 'porsche';

export interface CarSpec {
  id: CarId;
  name: string;
  shortName: string;
  tag: string;
  // Real-world reference specs (shown in garage & mirrored in physics)
  powerHp: number;
  weightKg: number;
  zeroToHundred: string;
  topKmh: number;
  driveType: 'AWD' | 'RWD' | '4x4';
  evInstantTorque?: boolean;
  bodyRollMult?: number;
  defaultColor: string;
  defaultUnderglow: string;
  // Performance physics (m/s = km/h / 3.6, m/s^2)
  top: number;
  accel: number;
  grip: number;
  brake: number;
  driftGrip: number;     // lower = easier/wider slide
  driftControl: number;  // higher = snappier drift control
  nosPower: number;      // extra accel boost
  nosTopBonus: number;   // multiplier over top speed during NOS
  nosChargeRate: number; // drift-to-NOS charge multiplier
  mass: number;
  // Visual proportions & audio
  length: number;
  width: number;
  wheelR: number;
  wheelW: number;
  track: number;
  axleFront: number;
  axleRear: number;
  hoodCam: [number, number]; // [y, z]
  bonnetGun: [number, number]; // [y, z] hood turret mount position
  caliperColor: number;
  rimColor: number;
  engineType: 'rb26' | '2jz' | 'v8' | 'v10' | 'vq37' | 'ev' | 'flat6';
  hasTurbo: boolean;
  // UI rating bars (0..1)
  bars: {
    speed: number;
    accel: number;
    drift: number;
    nos: number;
  };
}

export const CAR_SPECS: Record<CarId, CarSpec> = {
  r34: {
    id: 'r34',
    name: 'Nissan GT-R R34 V-Spec',
    shortName: 'GT-R R34',
    tag: 'AWD · 2.6L RB26DETT Twin-Turbo',
    powerHp: 332,
    weightKg: 1560,
    zeroToHundred: '4.6s',
    topKmh: 268,
    driveType: 'AWD',
    defaultColor: '#cfd6df',
    defaultUnderglow: '#2979ff',
    top: 74.4,
    accel: 23.6,
    grip: 37.0,
    brake: 49,
    driftGrip: 11.4,
    driftControl: 1.24,
    nosPower: 20.5,
    nosTopBonus: 1.30,
    nosChargeRate: 1.12,
    mass: 1.04,
    length: 4.55,
    width: 1.88,
    wheelR: 0.36,
    wheelW: 0.31,
    track: 0.91,
    axleFront: 1.38,
    axleRear: -1.34,
    hoodCam: [1.14, 0.72],
    bonnetGun: [0.765, 1.42],
    caliperColor: 0xc68e28,
    rimColor: 0xd6dce3, // Machined silver HRE 6-spoke style
    engineType: 'rb26',
    hasTurbo: true,
    bars: { speed: 0.78, accel: 0.78, drift: 0.86, nos: 0.86 },
  },
  supra: {
    id: 'supra',
    name: 'Toyota Supra MK4',
    shortName: 'Supra MK4',
    tag: 'RWD · 3.0L 2JZ-GTE Twin-Turbo',
    powerHp: 326,
    weightKg: 1510,
    zeroToHundred: '4.6s',
    topKmh: 285,
    driveType: 'RWD',
    defaultColor: '#ff621f',
    defaultUnderglow: '#ffab00',
    top: 79.2,
    accel: 22.8,
    grip: 29.0,
    brake: 42,
    driftGrip: 9.2,
    driftControl: 1.12,
    nosPower: 25.5,
    nosTopBonus: 1.36,
    nosChargeRate: 1.16,
    mass: 1.00,
    length: 4.50,
    width: 1.90,
    wheelR: 0.36,
    wheelW: 0.32,
    track: 0.92,
    axleFront: 1.34,
    axleRear: -1.30,
    hoodCam: [1.08, 0.66],
    bonnetGun: [0.80, 1.42],
    caliperColor: 0xe52521,
    rimColor: 0xd8dde4,
    engineType: '2jz',
    hasTurbo: true,
    bars: { speed: 0.84, accel: 0.76, drift: 0.92, nos: 1.0 },
  },
  charger: {
    id: 'charger',
    name: 'Dodge Charger Hellcat',
    shortName: 'Charger',
    tag: 'RWD · 6.2L Supercharged HEMI V8',
    powerHp: 797,
    weightKg: 2018,
    zeroToHundred: '3.5s',
    topKmh: 318,
    driveType: 'RWD',
    bodyRollMult: 1.15,
    defaultColor: '#16191f',
    defaultUnderglow: '#ff2a85',
    top: 88.3,
    accel: 26.2,
    grip: 25.5,
    brake: 37,
    driftGrip: 8.1,
    driftControl: 0.96,
    nosPower: 20.0,
    nosTopBonus: 1.24,
    nosChargeRate: 1.20,
    mass: 1.42,
    length: 4.88,
    width: 1.98,
    wheelR: 0.39,
    wheelW: 0.35,
    track: 0.96,
    axleFront: 1.50,
    axleRear: -1.44,
    hoodCam: [1.18, 0.58],
    bonnetGun: [0.905, 1.48],
    caliperColor: 0xff2a2a,
    rimColor: 0x262b33,
    engineType: 'v8',
    hasTurbo: false,
    bars: { speed: 0.93, accel: 0.89, drift: 0.95, nos: 0.84 },
  },
  huracan: {
    id: 'huracan',
    name: 'Lamborghini Huracán EVO',
    shortName: 'Huracán',
    tag: 'AWD · 5.2L Naturally Aspirated V10',
    powerHp: 640,
    weightKg: 1422,
    zeroToHundred: '2.9s',
    topKmh: 325,
    driveType: 'AWD',
    bodyRollMult: 0.72,
    defaultColor: '#f5c518',
    defaultUnderglow: '#39ff14',
    top: 90.3,
    accel: 28.4,
    grip: 39.0,
    brake: 55,
    driftGrip: 12.2,
    driftControl: 1.28,
    nosPower: 20.5,
    nosTopBonus: 1.24,
    nosChargeRate: 0.98,
    mass: 0.92,
    length: 4.46,
    width: 1.96,
    wheelR: 0.36,
    wheelW: 0.34,
    track: 0.96,
    axleFront: 1.36,
    axleRear: -1.32,
    hoodCam: [0.96, 0.72],
    bonnetGun: [0.70, 1.56],
    caliperColor: 0xf5c518,
    rimColor: 0x2a2d34,
    engineType: 'v10',
    hasTurbo: false,
    bars: { speed: 0.96, accel: 0.95, drift: 0.80, nos: 0.86 },
  },
  '370z': {
    id: '370z',
    name: 'Nissan 370Z NISMO',
    shortName: '370Z',
    tag: 'RWD · 3.7L VQ37VHR V6',
    powerHp: 350,
    weightKg: 1480,
    zeroToHundred: '4.9s',
    topKmh: 255,
    driveType: 'RWD',
    defaultColor: '#e52521',
    defaultUnderglow: '#2979ff',
    top: 70.8,
    accel: 21.0,
    grip: 31.2,
    brake: 45,
    driftGrip: 8.5,
    driftControl: 1.42,
    nosPower: 18.5,
    nosTopBonus: 1.28,
    nosChargeRate: 1.50,
    mass: 0.95,
    length: 4.28,
    width: 1.86,
    wheelR: 0.35,
    wheelW: 0.30,
    track: 0.90,
    axleFront: 1.26,
    axleRear: -1.24,
    hoodCam: [1.08, 0.65],
    bonnetGun: [0.79, 1.32],
    caliperColor: 0xff3b3b,
    rimColor: 0xcfd6df,
    engineType: 'vq37',
    hasTurbo: false,
    bars: { speed: 0.74, accel: 0.72, drift: 1.0, nos: 0.94 },
  },
  cybertruck: {
    id: 'cybertruck',
    name: 'Tesla Cybertruck Cyberbeast',
    shortName: 'Cybertruck',
    tag: 'AWD · Tri-Motor EV · Instant Torque',
    powerHp: 845,
    weightKg: 3103,
    zeroToHundred: '2.6s',
    topKmh: 210,
    driveType: 'AWD',
    evInstantTorque: true,
    bodyRollMult: 1.20,
    defaultColor: '#adb7c2',
    defaultUnderglow: '#00e5ff',
    top: 58.3,
    accel: 32.5,
    grip: 28.5,
    brake: 40,
    driftGrip: 10.0,
    driftControl: 1.05,
    nosPower: 22.0,
    nosTopBonus: 1.25,
    nosChargeRate: 1.15,
    mass: 1.98,
    length: 5.10,
    width: 2.02,
    wheelR: 0.43,
    wheelW: 0.34,
    track: 0.97,
    axleFront: 1.64,
    axleRear: -1.58,
    hoodCam: [1.58, 0.72],
    bonnetGun: [1.14, 1.72],
    caliperColor: 0xff3b30,
    rimColor: 0x1e2228,
    engineType: 'ev',
    hasTurbo: false,
    bars: { speed: 0.61, accel: 1.0, drift: 0.82, nos: 0.88 },
  },
  gwagon: {
    id: 'gwagon',
    name: 'Mercedes-AMG G 63',
    shortName: 'G-Wagon',
    tag: '4x4 · 4.0L Biturbo V8 SUV',
    powerHp: 577,
    weightKg: 2560,
    zeroToHundred: '4.5s',
    topKmh: 220,
    driveType: '4x4',
    bodyRollMult: 1.65,
    defaultColor: '#1e242d',
    defaultUnderglow: '#ffaa00',
    top: 61.1,
    accel: 22.6,
    grip: 25.8,
    brake: 36,
    driftGrip: 8.8,
    driftControl: 0.98,
    nosPower: 20.0,
    nosTopBonus: 1.26,
    nosChargeRate: 1.14,
    mass: 1.68,
    length: 4.72,
    width: 1.98,
    wheelR: 0.42,
    wheelW: 0.33,
    track: 0.95,
    axleFront: 1.46,
    axleRear: -1.42,
    hoodCam: [1.58, 0.62],
    bonnetGun: [1.09, 1.56],
    caliperColor: 0xe62020,
    rimColor: 0x22262e,
    engineType: 'v8',
    hasTurbo: true,
    bars: { speed: 0.64, accel: 0.77, drift: 0.85, nos: 0.84 },
  },
  porsche: {
    id: 'porsche',
    name: 'Classic Porsche 911 Turbo',
    shortName: 'Porsche 911',
    tag: 'RWD · Tuned Twin-Turbo Flat-6',
    powerHp: 2800,
    weightKg: 2250,
    zeroToHundred: '2.8s',
    topKmh: 345,
    driveType: 'RWD',
    bodyRollMult: 0.82,
    defaultColor: '#e52521',
    defaultUnderglow: '#00e5ff',
    top: 95.8,
    accel: 29.0,
    grip: 28.0,
    brake: 44,
    driftGrip: 8.5,
    driftControl: 1.30,
    nosPower: 23.0,
    nosTopBonus: 1.28,
    nosChargeRate: 1.20,
    mass: 1.22,
    length: 4.29,
    width: 1.88,
    wheelR: 0.35,
    wheelW: 0.31,
    track: 0.90,
    axleFront: 1.24,
    axleRear: -1.18,
    hoodCam: [1.06, 0.65],
    bonnetGun: [0.68, 1.28],
    caliperColor: 0xe62020,
    rimColor: 0x1b1e24, // Fuchs matte black centers with chrome dish lips
    engineType: 'flat6',
    hasTurbo: true,
    bars: { speed: 1.0, accel: 0.96, drift: 0.95, nos: 0.94 },
  },
};

export const CAR_IDS: CarId[] = [
  'r34',
  'supra',
  'charger',
  'huracan',
  '370z',
  'cybertruck',
  'gwagon',
  'porsche',
];

