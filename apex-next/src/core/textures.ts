import * as THREE from 'three';

export function canvasTex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat = true,
  srgb = true
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function makeAsphaltTexture(nightWet: boolean, expressway = false): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const map = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = nightWet ? '#171b24' : expressway ? '#2a2e36' : '#262930';
    c.fillRect(0, 0, w, h);

    // Multi-scale mineral aggregate grain
    for (let i = 0; i < 18000; i++) {
      const s = nightWet ? 16 + Math.random() * 28 : 26 + Math.random() * 42;
      c.fillStyle = `rgba(${s | 0},${(s + 2) | 0},${(s + 5) | 0},0.34)`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    for (let i = 0; i < 4500; i++) {
      const s = nightWet ? 38 + Math.random() * 25 : 58 + Math.random() * 36;
      c.fillStyle = `rgba(${s | 0},${s | 0},${(s + 3) | 0},0.20)`;
      c.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }

    // Tire rubber racing line & subtle tar seams
    const grooveL = c.createLinearGradient(w * 0.14, 0, w * 0.36, 0);
    grooveL.addColorStop(0, 'rgba(10,12,15,0)');
    grooveL.addColorStop(0.5, nightWet ? 'rgba(6,8,12,0.42)' : 'rgba(12,13,16,0.32)');
    grooveL.addColorStop(1, 'rgba(10,12,15,0)');
    c.fillStyle = grooveL;
    c.fillRect(w * 0.14, 0, w * 0.22, h);

    const grooveR = c.createLinearGradient(w * 0.64, 0, w * 0.86, 0);
    grooveR.addColorStop(0, 'rgba(10,12,15,0)');
    grooveR.addColorStop(0.5, nightWet ? 'rgba(6,8,12,0.42)' : 'rgba(12,13,16,0.32)');
    grooveR.addColorStop(1, 'rgba(10,12,15,0)');
    c.fillStyle = grooveR;
    c.fillRect(w * 0.64, 0, w * 0.22, h);

    if (expressway) {
      // Sri Lanka E03 4-lane expressway markings: yellow shoulder lines + twin white dashed lane dividers + center double line
      c.fillStyle = '#f5b82e';
      c.fillRect(10, 0, 6, h);
      c.fillRect(w - 16, 0, 6, h);

      c.fillStyle = '#eef2f5';
      c.fillRect(w * 0.27 - 2.5, 0, 5, h * 0.44);
      c.fillRect(w * 0.73 - 2.5, 0, 5, h * 0.44);

      c.fillStyle = '#f5b82e';
      c.fillRect(w * 0.5 - 6, 0, 4, h);
      c.fillRect(w * 0.5 + 2, 0, 4, h);
    } else {
      // Crisp motorsport track edge lines
      c.fillStyle = nightWet ? '#8deeff' : '#eaedf0';
      c.fillRect(10, 0, 7, h);
      c.fillRect(w - 17, 0, 7, h);

      // Weathered center dashed line
      c.fillStyle = nightWet ? '#ffcf5c' : '#e2e2da';
      c.fillRect(w / 2 - 3, 0, 6, h * 0.44);
    }
  });

  const roughnessMap = canvasTex(
    256,
    256,
    (c, w, h) => {
      c.fillStyle = nightWet ? '#585858' : '#cfcfcf';
      c.fillRect(0, 0, w, h);
      if (nightWet) {
        // Glossy wet reflections + tire polished lines
        for (let i = 0; i < 80; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          const rx = 14 + Math.random() * 34;
          const ry = 24 + Math.random() * 64;
          const g = c.createRadialGradient(x, y, 2, x, y, Math.max(rx, ry));
          g.addColorStop(0, 'rgba(26,26,26,0.88)');
          g.addColorStop(1, 'rgba(110,110,110,0)');
          c.fillStyle = g;
          c.beginPath();
          c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
          c.fill();
        }
      } else {
        for (let i = 0; i < 2400; i++) {
          const v = 175 + Math.random() * 58;
          c.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
          c.fillRect(Math.random() * w, Math.random() * h, 3, 3);
        }
        // Slightly smoother polished racing groove
        c.fillStyle = 'rgba(135,135,135,0.22)';
        c.fillRect(w * 0.20, 0, w * 0.14, h);
        c.fillRect(w * 0.66, 0, w * 0.14, h);
      }
    },
    true,
    false
  );

  // Tangent-space normal map encoding stone aggregate micro-relief
  const normalMap = canvasTex(
    256,
    256,
    (c, w, h) => {
      const img = c.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < w * h; i++) {
        const nx = (Math.random() - 0.5) * 0.55;
        const ny = (Math.random() - 0.5) * 0.55;
        const nz = Math.sqrt(Math.max(0.1, 1 - nx * nx - ny * ny));
        const p = i * 4;
        d[p] = ((nx * 0.5 + 0.5) * 255) | 0;
        d[p + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
        d[p + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
        d[p + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    },
    true,
    false
  );

  return { map, roughnessMap, normalMap };
}

export function makeOffroadSurfaceTexture(): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  // Neutral bright pale sand-gravel base so vertex colors smoothly shade sand, mud & river silt
  const map = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#ddd6c7';
    c.fillRect(0, 0, w, h);

    // Subtle dusty tire ruts carved down the offroad racing line
    const rutL = c.createLinearGradient(w * 0.16, 0, w * 0.38, 0);
    rutL.addColorStop(0, 'rgba(95,78,56,0)');
    rutL.addColorStop(0.5, 'rgba(95,78,56,0.34)');
    rutL.addColorStop(1, 'rgba(95,78,56,0)');
    c.fillStyle = rutL;
    c.fillRect(w * 0.16, 0, w * 0.22, h);

    const rutR = c.createLinearGradient(w * 0.62, 0, w * 0.84, 0);
    rutR.addColorStop(0, 'rgba(95,78,56,0)');
    rutR.addColorStop(0.5, 'rgba(95,78,56,0.34)');
    rutR.addColorStop(1, 'rgba(95,78,56,0)');
    c.fillStyle = rutR;
    c.fillRect(w * 0.62, 0, w * 0.22, h);

    // Coarse dirt clods, gravel stones & wind-blown sand grain
    for (let i = 0; i < 19000; i++) {
      const dark = Math.random() < 0.45;
      const v = dark ? 115 + Math.random() * 45 : 195 + Math.random() * 52;
      c.fillStyle = `rgba(${v | 0},${(v - 6) | 0},${(v - 16) | 0},0.28)`;
      c.fillRect(Math.random() * w, Math.random() * h, 2 + (Math.random() > 0.88 ? 2 : 0), 2);
    }

    // Knobby off-road tread chevrons inside ruts
    c.fillStyle = 'rgba(72,56,38,0.18)';
    for (let y = 0; y < h; y += 16) {
      c.fillRect(w * 0.23, y, 22, 5);
      c.fillRect(w * 0.72, y + 6, 22, 5);
    }
  });

  const roughnessMap = canvasTex(
    256,
    256,
    (c, w, h) => {
      c.fillStyle = '#d4d4d4';
      c.fillRect(0, 0, w, h);
      // Darker slick patches inside mud ruts
      for (let i = 0; i < 42; i++) {
        const x = (Math.random() < 0.5 ? 0.27 : 0.73) * w + (Math.random() - 0.5) * 32;
        const y = Math.random() * h;
        const g = c.createRadialGradient(x, y, 2, x, y, 28);
        g.addColorStop(0, 'rgba(42,42,42,0.85)');
        g.addColorStop(1, 'rgba(180,180,180,0)');
        c.fillStyle = g;
        c.beginPath();
        c.ellipse(x, y, 16, 28, 0, 0, Math.PI * 2);
        c.fill();
      }
      for (let i = 0; i < 2400; i++) {
        const v = 175 + Math.random() * 70;
        c.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    },
    true,
    false
  );

  const normalMap = canvasTex(
    256,
    256,
    (c, w, h) => {
      const img = c.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / w;
          // Carve parallel rut slopes along U plus pebbles
          const rutTilt =
            Math.exp(-(((u - 0.27) * 14) ** 2)) * -(u - 0.27) * 8 +
            Math.exp(-(((u - 0.73) * 14) ** 2)) * -(u - 0.73) * 8;
          const nx = rutTilt * 0.45 + (Math.random() - 0.5) * 0.75;
          const ny = 0.08 * Math.sin((y / h) * Math.PI * 12) + (Math.random() - 0.5) * 0.75;
          const inv = 1 / Math.hypot(nx, ny, 1);
          const p = (y * w + x) * 4;
          d[p] = ((nx * inv * 0.5 + 0.5) * 255) | 0;
          d[p + 1] = ((ny * inv * 0.5 + 0.5) * 255) | 0;
          d[p + 2] = ((inv * 0.5 + 0.5) * 255) | 0;
          d[p + 3] = 255;
        }
      }
      c.putImageData(img, 0, 0);
    },
    true,
    false
  );

  return { map, roughnessMap, normalMap };
}

export function makeWaterNormalMap(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (c, w, h) => {
      const img = c.createImageData(w, h);
      const d = img.data;
      const tau = Math.PI * 2;
      for (let y = 0; y < h; y++) {
        const v = (y / h) * tau;
        for (let x = 0; x < w; x++) {
          const u = (x / w) * tau;
          // Tileable multi-harmonic ocean swell & chop derivatives
          const dhdu =
            0.16 * Math.cos(u * 2 + v * 1) * 2 +
            0.09 * Math.cos(u * 5 - v * 3) * 5 +
            0.05 * Math.cos(u * 9 + v * 7) * 9;
          const dhdv =
            0.16 * Math.cos(u * 2 + v * 1) * 1 -
            0.09 * Math.cos(u * 5 - v * 3) * 3 +
            0.05 * Math.cos(u * 9 + v * 7) * 7;
          let nx = -dhdu * 0.35;
          let ny = -dhdv * 0.35;
          const nz = 1;
          const inv = 1 / Math.hypot(nx, ny, nz);
          nx *= inv;
          ny *= inv;
          const oz = nz * inv;
          const p = (y * w + x) * 4;
          d[p] = ((nx * 0.5 + 0.5) * 255) | 0;
          d[p + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
          d[p + 2] = ((oz * 0.5 + 0.5) * 255) | 0;
          d[p + 3] = 255;
        }
      }
      c.putImageData(img, 0, 0);
    },
    true,
    false
  );
}

export function makeBarrierTexture(accentHex: string, night: boolean, offroad = false): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (c, w, h) => {
      if (offroad) {
        // Baja off-road timber rail, sand berm base & orange/white rally tape stripe
        c.fillStyle = '#9c7850';
        c.fillRect(0, 0, w, h);

        // Weathered timber guardrail plank
        const wood = c.createLinearGradient(0, h * 0.14, 0, h * 0.48);
        wood.addColorStop(0, '#785233');
        wood.addColorStop(0.5, '#5e3d23');
        wood.addColorStop(1, '#4a2f1a');
        c.fillStyle = wood;
        c.fillRect(0, h * 0.14, w, h * 0.34);

        // Timber fence post joints
        c.fillStyle = '#3b2413';
        c.fillRect(0, h * 0.08, 12, h * 0.92);
        c.fillRect(w * 0.5 - 6, h * 0.08, 12, h * 0.92);

        // Diagonal Baja orange-white rally marker strip along mid-rail
        c.fillStyle = '#f4f1ea';
        c.fillRect(0, h * 0.50, w, h * 0.11);
        c.fillStyle = accentHex;
        for (let sx = -32; sx < w + 32; sx += 40) {
          c.beginPath();
          c.moveTo(sx, h * 0.50);
          c.lineTo(sx + 20, h * 0.50);
          c.lineTo(sx + 6, h * 0.61);
          c.lineTo(sx - 14, h * 0.61);
          c.closePath();
          c.fill();
        }

        // Sand & mud splatter at base
        c.fillStyle = 'rgba(72,48,26,0.45)';
        c.fillRect(0, h * 0.78, w, h * 0.22);
        for (let i = 0; i < 3000; i++) {
          const v = 90 + Math.random() * 85;
          c.fillStyle = `rgba(${v | 0},${(v - 18) | 0},${(v - 38) | 0},0.22)`;
          c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
        }
        return;
      }

      // Base weathered concrete Jersey wall
      c.fillStyle = night ? '#272c38' : '#b7bec6';
      c.fillRect(0, 0, w, h);

      // Corrugated galvanized Armco guardrail upper beam
      const railGrad = c.createLinearGradient(0, h * 0.10, 0, h * 0.50);
      railGrad.addColorStop(0, night ? '#3c4558' : '#cfd6de');
      railGrad.addColorStop(0.22, night ? '#1b202b' : '#7b848f');
      railGrad.addColorStop(0.5, night ? '#48546b' : '#dce2e8');
      railGrad.addColorStop(0.78, night ? '#1d222e' : '#7a838e');
      railGrad.addColorStop(1, night ? '#323a4a' : '#aeb6c0');
      c.fillStyle = railGrad;
      c.fillRect(0, h * 0.10, w, h * 0.40);

      // Subtle FIA safety accent stripe along mid-wall
      c.fillStyle = accentHex;
      c.globalAlpha = night ? 0.85 : 0.72;
      c.fillRect(0, h * 0.52, w, h * 0.08);
      c.globalAlpha = 1;

      // Dark bottom road-spray & concrete expansion joints
      c.fillStyle = night ? 'rgba(8,10,16,0.55)' : 'rgba(55,60,66,0.38)';
      c.fillRect(0, h * 0.82, w, h * 0.18);
      c.fillRect(0, 0, 5, h);
      c.fillRect(w - 5, 0, 5, h);

      // Concrete speckle grit
      for (let i = 0; i < 3200; i++) {
        const v = night ? 25 + Math.random() * 35 : 130 + Math.random() * 75;
        c.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.22)`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    },
    true,
    true
  );
}

export function makeGrilleTexture(): THREE.CanvasTexture {
  return canvasTex(
    128,
    64,
    (c, w, h) => {
      c.fillStyle = '#090b0f';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#333a45';
      c.lineWidth = 2;
      const step = 12;
      for (let x = -h; x < w + h; x += step) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + h * 0.6, h);
        c.stroke();
        c.beginPath();
        c.moveTo(x + h * 0.6, 0);
        c.lineTo(x, h);
        c.stroke();
      }
    },
    true,
    true
  );
}

export function makeContactShadowTexture(): THREE.CanvasTexture {
  return canvasTex(
    128,
    256,
    (c, w, h) => {
      c.clearRect(0, 0, w, h);
      // Soft ambient occlusion elliptical drop shadow underneath chassis & wheels
      c.save();
      c.translate(w / 2, h / 2);
      c.scale(1, h / w);
      const g = c.createRadialGradient(0, 0, w * 0.14, 0, 0, w * 0.49);
      g.addColorStop(0, 'rgba(2, 4, 8, 0.90)');
      g.addColorStop(0.55, 'rgba(4, 6, 10, 0.62)');
      g.addColorStop(0.82, 'rgba(6, 8, 12, 0.22)');
      g.addColorStop(1, 'rgba(6, 8, 12, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, w * 0.5, 0, Math.PI * 2);
      c.fill();
      c.restore();
    },
    false,
    true
  );
}

export function makeCurbTexture(primary: string, secondary: string): THREE.CanvasTexture {
  return canvasTex(32, 64, (c, w, h) => {
    c.fillStyle = primary;
    c.fillRect(0, 0, w, h / 2);
    c.fillStyle = secondary;
    c.fillRect(0, h / 2, w, h / 2);
  });
}

export function makeGroundTexture(baseColor: string, darkSpec: string, lightSpec: string): THREE.CanvasTexture {
  return canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = baseColor;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = Math.random() < 0.5 ? darkSpec : lightSpec;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  });
}

export function makeBannerTexture(title: string, accentHex: string): THREE.CanvasTexture {
  return canvasTex(
    1024,
    128,
    (c, w, h) => {
      c.fillStyle = '#090d16';
      c.fillRect(0, 0, w, h);

      // Accent top & bottom neon strips
      c.fillStyle = accentHex;
      c.fillRect(0, 0, w, 8);
      c.fillRect(0, h - 8, w, 8);

      // Checkered sides
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 6; x++) {
          c.fillStyle = (x + y) % 2 ? '#101521' : '#f4f7fb';
          c.fillRect(x * 26 + 8, 12 + y * 26, 26, 26);
          c.fillRect(w - 164 + x * 26, 12 + y * 26, 26, 26);
        }
      }

      c.fillStyle = '#ffffff';
      c.font = 'italic 900 44px system-ui, -apple-system, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(title, w / 2, h / 2 + 2);
    },
    false
  );
}

export function makeChevronTexture(accentHex: string): THREE.CanvasTexture {
  return canvasTex(
    256,
    128,
    (c, w, h) => {
      c.fillStyle = '#0b101b';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = accentHex;
      c.lineWidth = 10;
      c.strokeRect(5, 5, w - 10, h - 10);

      c.fillStyle = accentHex;
      for (const ox of [54, 126, 198]) {
        c.beginPath();
        c.moveTo(ox - 24, 24);
        c.lineTo(ox + 16, h / 2);
        c.lineTo(ox - 24, h - 24);
        c.lineTo(ox - 2, h - 24);
        c.lineTo(ox + 38, h / 2);
        c.lineTo(ox - 2, 24);
        c.closePath();
        c.fill();
      }
    },
    false
  );
}

export function makeGlowTexture(): THREE.CanvasTexture {
  return canvasTex(
    128,
    128,
    (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    },
    false
  );
}

export function makeBuildingWindowTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    512,
    (c, w, h) => {
      c.fillStyle = '#0b101d';
      c.fillRect(0, 0, w, h);
      const colors = ['#74e8ff', '#ffe29a', '#ff64b8', '#a8c5ff', '#162038'];
      const cols = 8;
      const rows = 24;
      const cw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const lit = Math.random();
          if (lit < 0.45) continue;
          c.fillStyle = colors[(Math.random() * 4) | 0];
          c.globalAlpha = 0.45 + Math.random() * 0.55;
          c.fillRect(col * cw + 5, r * rh + 4, cw - 10, rh - 8);
        }
      }
      c.globalAlpha = 1;
    },
    true
  );
}

export function makeShowroomFloorTexture(): THREE.CanvasTexture {
  return canvasTex(
    512,
    512,
    (c, w, h) => {
      c.fillStyle = '#0c111b';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(72, 209, 255, 0.14)';
      c.lineWidth = 2;
      for (let i = 0; i <= 8; i++) {
        const p = (i / 8) * w;
        c.beginPath();
        c.moveTo(p, 0);
        c.lineTo(p, h);
        c.stroke();
        c.beginPath();
        c.moveTo(0, p);
        c.lineTo(w, p);
        c.stroke();
      }
    },
    true
  );
}

export function makeHighwaySignTexture(routeBadge: string, headline: string, subline: string): THREE.CanvasTexture {
  return canvasTex(
    1024,
    224,
    (c, w, h) => {
      c.fillStyle = '#046a38';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 8;
      c.strokeRect(10, 10, w - 20, h - 20);

      // Yellow E03 Expressway route shield
      c.fillStyle = '#f6c318';
      c.fillRect(36, 42, 168, 140);
      c.strokeStyle = '#0d1812';
      c.lineWidth = 5;
      c.strokeRect(42, 48, 156, 128);
      c.fillStyle = '#0d1812';
      c.font = '900 66px system-ui, -apple-system, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(routeBadge, 120, 115);

      // Main highway destination text
      c.fillStyle = '#ffffff';
      c.textAlign = 'left';
      c.font = '900 54px system-ui, -apple-system, sans-serif';
      c.fillText(headline, 238, 86);
      c.fillStyle = '#d5f7e3';
      c.font = '700 34px system-ui, -apple-system, sans-serif';
      c.fillText(subline, 238, 156);
    },
    false
  );
}

export function makeRunwayTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    1024,
    (c, w, h) => {
      c.fillStyle = '#252932';
      c.fillRect(0, 0, w, h);
      // Runway side lines
      c.fillStyle = '#eef2f5';
      c.fillRect(10, 0, 8, h);
      c.fillRect(w - 18, 0, 8, h);
      // Threshold piano keys
      for (let i = 0; i < 6; i++) {
        c.fillRect(28 + i * 36, 20, 20, 62);
        c.fillRect(28 + i * 36, h - 82, 20, 62);
      }
      // Dashed centerline
      for (let y = 120; y < h - 120; y += 70) {
        c.fillRect(w / 2 - 5, y, 10, 40);
      }
    },
    false
  );
}

export function makeIntercoolerTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    128,
    (c, w, h) => {
      c.fillStyle = '#14181f';
      c.fillRect(0, 0, w, h);

      // Cast aluminum side end-tanks
      const tankL = c.createLinearGradient(0, 0, 26, 0);
      tankL.addColorStop(0, '#788492');
      tankL.addColorStop(0.5, '#cbd4df');
      tankL.addColorStop(1, '#6d7785');
      c.fillStyle = tankL;
      c.fillRect(0, 4, 24, h - 8);
      c.fillRect(w - 24, 4, 24, h - 8);

      // Horizontal brushed-aluminum intercooler charge rows + dark cooling fins
      const rows = 9;
      const topPad = 10;
      const usableH = h - topPad * 2;
      const step = usableH / rows;
      for (let r = 0; r < rows; r++) {
        const y = topPad + r * step;
        c.fillStyle = '#adb8c6';
        c.fillRect(24, y, w - 48, 4);
        c.fillStyle = '#dce4ee';
        c.fillRect(24, y, w - 48, 1.5);
        c.fillStyle = '#4f5866';
        for (let x = 28; x < w - 28; x += 6) {
          c.fillRect(x, y + 4.5, 2, step - 5);
        }
      }

      // Subtle center oil/ic stencil mark
      c.fillStyle = 'rgba(20, 30, 48, 0.45)';
      c.fillRect(w * 0.41, h * 0.43, w * 0.18, h * 0.14);
    },
    false
  );
}

export function makeR34HeadlightTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    128,
    (c, w, h) => {
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#10151f');
      bg.addColorStop(0.5, '#252d3c');
      bg.addColorStop(1, '#0e131b');
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);

      // Chrome reflector shroud surround
      c.strokeStyle = '#9aa6b8';
      c.lineWidth = 4;
      c.strokeRect(5, 5, w - 10, h - 10);

      // Helper for circular HID / reflector bowl
      const drawBowl = (cx: number, cy: number, r: number, coreHex: string, ringHex: string) => {
        const g = c.createRadialGradient(cx, cy, 2, cx, cy, r);
        g.addColorStop(0, coreHex);
        g.addColorStop(0.45, '#d8eeff');
        g.addColorStop(0.75, ringHex);
        g.addColorStop(1, '#202633');
        c.fillStyle = g;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#dbe4ef';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(cx, cy, r * 0.76, 0, Math.PI * 2);
        c.stroke();
      };

      // Dual Skyline R34 projector / high-beam optics + inner amber marker prism
      drawBowl(w * 0.30, h * 0.50, 38, '#ffffff', '#687a96');
      drawBowl(w * 0.63, h * 0.50, 32, '#f4f8ff', '#586882');

      c.fillStyle = '#e58618';
      c.fillRect(w * 0.83, h * 0.24, w * 0.11, h * 0.52);
      c.strokeStyle = '#ffbe5c';
      c.lineWidth = 2;
      c.strokeRect(w * 0.83, h * 0.24, w * 0.11, h * 0.52);
    },
    false
  );
}

export function makeR34SideLiveryTexture(): THREE.CanvasTexture {
  // UV X (0 -> 1) maps along side flank from front z = +2.10 to rear z = -2.14; Y (0 -> 1 bottom..top) maps y = 0.15..0.79
  const zMin = -2.14;
  const zMax = 2.10;
  const yMin = 0.15;
  const yMax = 0.79;
  const toX = (z: number, w: number) => ((zMax - z) / (zMax - zMin)) * w;
  const toY = (y: number, h: number) => ((yMax - y) / (yMax - yMin)) * h;

  return canvasTex(
    1024,
    256,
    (c, w, h) => {
      c.clearRect(0, 0, w, h);

      // Subtle panel shutlines (door seam & front fender gap) + flush keyhole trim
      c.strokeStyle = 'rgba(18, 26, 38, 0.32)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(toX(0.68, w), toY(0.79, h));
      c.lineTo(toX(0.68, w), toY(0.16, h));
      c.moveTo(toX(-0.46, w), toY(0.79, h));
      c.lineTo(toX(-0.46, w), toY(0.24, h));
      c.stroke();

      // Lower C-West royal-blue side-skirt stripe + swept diagonal speed slashes toward rear wheel
      const grad = c.createLinearGradient(toX(1.9, w), 0, toX(-2.1, w), 0);
      grad.addColorStop(0, '#0c43cc');
      grad.addColorStop(0.55, '#1357eb');
      grad.addColorStop(1, '#0c43cc');
      c.fillStyle = grad;

      // Front bumper lower corner diagonal hatch stripes
      for (let i = 0; i < 6; i++) {
        const z0 = 2.04 - i * 0.065;
        c.beginPath();
        c.moveTo(toX(z0, w), toY(0.15, h));
        c.lineTo(toX(z0 - 0.035, w), toY(0.15, h));
        c.lineTo(toX(z0 - 0.14, w), toY(0.29, h));
        c.lineTo(toX(z0 - 0.105, w), toY(0.29, h));
        c.closePath();
        c.fill();
      }

      // Solid lower side-skirt stripe + crisp slanted tick cutouts along rocker (z = +0.92 -> -0.95)
      c.beginPath();
      c.moveTo(toX(0.95, w), toY(0.155, h));
      c.lineTo(toX(-0.98, w), toY(0.155, h));
      c.lineTo(toX(-0.98, w), toY(0.255, h));
      c.lineTo(toX(0.95, w), toY(0.235, h));
      c.closePath();
      c.fill();

      // Slanted white/silver hash accents along the blue skirt line
      c.save();
      c.globalCompositeOperation = 'destination-out';
      for (let z = 0.88; z > -0.90; z -= 0.072) {
        c.beginPath();
        c.moveTo(toX(z, w), toY(0.15, h));
        c.lineTo(toX(z - 0.022, w), toY(0.15, h));
        c.lineTo(toX(z - 0.075, w), toY(0.26, h));
        c.lineTo(toX(z - 0.053, w), toY(0.26, h));
        c.closePath();
        c.fill();
      }
      c.restore();

      // Iconic 2F2F twin diagonal swept rear-quarter stripes rising from skirt up over rear haunch
      const drawSweptBand = (zBotA: number, zBotB: number, zTopA: number, zTopB: number) => {
        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(toX(zBotA, w), toY(0.18, h));
        c.lineTo(toX(zBotB, w), toY(0.18, h));
        c.lineTo(toX(zTopB, w), toY(0.76, h));
        c.lineTo(toX(zTopA, w), toY(0.76, h));
        c.closePath();
        c.fill();
      };
      drawSweptBand(-0.08, -0.34, -1.64, -1.96);
      drawSweptBand(-0.44, -0.58, -2.02, -2.14);

      // Slanted speed-slash tick accents along the diagonal mid-body stripe
      c.save();
      c.globalCompositeOperation = 'destination-out';
      for (let t = 0; t < 11; t++) {
        const z = -0.16 - t * 0.145;
        const y0 = 0.21 + t * 0.048;
        c.beginPath();
        c.moveTo(toX(z, w), toY(y0, h));
        c.lineTo(toX(z - 0.032, w), toY(y0, h));
        c.lineTo(toX(z - 0.12, w), toY(y0 + 0.12, h));
        c.lineTo(toX(z - 0.088, w), toY(y0 + 0.12, h));
        c.closePath();
        c.fill();
      }
      c.restore();

      // Crisp geometric tuner decal badges behind front fender arch (NX / R34 stack style)
      c.fillStyle = '#0c43cc';
      c.fillRect(toX(0.95, w), toY(0.45, h), 44, 16);
      c.fillStyle = '#e8f1ff';
      c.font = '900 11px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('NX', toX(0.95, w) + 22, toY(0.45, h) + 8);
      c.fillStyle = '#123e9e';
      c.fillRect(toX(0.95, w), toY(0.36, h), 44, 7);
      c.fillRect(toX(0.95, w), toY(0.32, h), 34, 5);

      // Cut clean circular wheel-well openings centered at front (z=1.38) and rear (z=-1.34) axles
      c.save();
      c.globalCompositeOperation = 'destination-out';
      const rx = (0.415 / (zMax - zMin)) * w;
      const ry = (0.415 / (yMax - yMin)) * h;
      for (const wz of [1.38, -1.34]) {
        c.beginPath();
        c.ellipse(toX(wz, w), toY(0.36, h), rx, ry, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    },
    false
  );
}

