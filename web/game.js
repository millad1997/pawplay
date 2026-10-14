/* Pawplay: a touch game for cats.
   Plain JS with no dependencies, so the same files run in Safari, as a
   Home Screen app, and inside the iOS wrapper (ios/). */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug');
  const IN_APP = /PouncePartyApp/.test(navigator.userAgent);
  const STANDALONE = IN_APP || navigator.standalone === true ||
    matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TAU = Math.PI * 2;
  const HIT = 1.35;        // hit radius multiplier: paws are not precise
  const HOLD_MS = 2000;    // hold-to-pause duration
  const COUNTDOWN = 3;
  const RING_LEN = 157.08; // circumference of the pause ring (r = 25)

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[(Math.random() * list.length) | 0];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const $ = (sel) => document.querySelector(sel);

  function turnToward(a, b, max) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return a + clamp(d, -max, max);
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------- Storage ----------

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  const OPTIONS = {
    speed: { slow: 0.6, normal: 1, fast: 1.6 },
    size: { s: 0.075, m: 0.1, l: 0.135 },
    length: { 1: 60, 3: 180, 5: 300, 10: 600, 0: Infinity },
    sound: { on: true, off: false },
  };
  const DEFAULTS = { speed: 'normal', size: 'm', length: '3', sound: 'on' };
  const settings = { ...DEFAULTS };
  const saved = store.get('pawplay.settings', {});
  for (const k of Object.keys(DEFAULTS)) {
    if (saved && String(saved[k]) in OPTIONS[k]) settings[k] = String(saved[k]);
  }

  // ---------- Drawing helpers ----------

  function makeLayer(w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [c, g];
  }

  // Quadratic curve through the midpoints of a polyline: smooth, cheap outlines.
  function smoothPath(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const end = pts[pts.length - 1];
    ctx.lineTo(end[0], end[1]);
  }

  function drawStar(ctx, x, y, s, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 ? s * 0.3 : s;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------- Particles (catch bursts, ripples, tap feedback) ----------

  class Particles {
    constructor() { this.list = []; }

    add(p) {
      if (this.list.length >= 300) return;
      this.list.push({ age: 0, vx: 0, vy: 0, drag: 1, rot: 0, vr: 0, alpha: 1, layer: 'over', ...p });
    }

    clear() { this.list.length = 0; }

    update(dt) {
      const list = this.list;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age >= p.life) { list.splice(i, 1); continue; }
        const k = Math.pow(p.drag, dt);
        p.vx *= k;
        p.vy *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }

    draw(ctx, layer) {
      for (const p of this.list) {
        if (p.layer !== layer) continue;
        const u = p.age / p.life;
        ctx.globalAlpha = p.alpha * (1 - u);
        switch (p.kind) {
          case 'ring': {
            const e = 1 - Math.pow(1 - u, 3);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.lw * (1 - u * 0.6);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, 0, TAU);
            ctx.stroke();
            break;
          }
          case 'dot':
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - u * 0.5), 0, TAU);
            ctx.fill();
            break;
          case 'puff':
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (0.5 + u), 0, TAU);
            ctx.fill();
            break;
          case 'star':
            drawStar(ctx, p.x, p.y, p.size * (1 - u * 0.4), p.rot, p.color);
            break;
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Fish Pond ----------

  function drawLilyPad(g, p) {
    const { r } = p;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    const pad = () => {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, 0.28, TAU - 0.28);
      g.closePath();
    };
    g.save();
    g.translate(r * 0.12, r * 0.16);
    g.fillStyle = 'rgba(3, 18, 45, 0.35)';
    pad();
    g.fill();
    g.restore();
    const grad = g.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#5cc06e');
    grad.addColorStop(1, '#2d7d47');
    g.fillStyle = grad;
    pad();
    g.fill();
    g.strokeStyle = 'rgba(20, 70, 35, 0.35)';
    g.lineWidth = Math.max(1, r * 0.03);
    for (let i = 1; i < 8; i++) {
      const a = 0.28 + (i * (TAU - 0.56)) / 8;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      g.stroke();
    }
    if (p.flower) {
      g.translate(-r * 0.25, r * 0.2);
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        g.fillStyle = i % 2 ? '#ffd6e6' : '#fff0f6';
        g.beginPath();
        g.ellipse(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, r * 0.2, r * 0.09, a, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ffd34d';
      g.beginPath();
      g.arc(0, 0, r * 0.09, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawFish(ctx, tg) {
    const r = tg.r;
    const swim = 0.35 + Math.min(1, tg.speed / (r * 6)) * 0.65;
    const spineY = (u) => Math.sin(tg.phase - u * 2.6) * r * 0.22 * u * u * swim;
    const N = 12;
    const top = [];
    const bot = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = r * 1.1 - u * r * 2.2;
      const y = spineY(u);
      const half = r * 0.46 * (u < 0.28
        ? 0.1 + 0.9 * Math.sqrt(u / 0.28)
        : 1 - Math.pow((u - 0.28) / 0.72, 1.4) * 0.84);
      top.push([x, y - half]);
      bot.push([x, y + half]);
    }
    const outline = top.concat(bot.reverse());
    const bodyPath = () => {
      ctx.beginPath();
      smoothPath(ctx, outline);
      ctx.closePath();
    };
    const tailX = -r * 1.1;
    const tailY = spineY(1);
    const tailA = Math.atan2(tailY - spineY(11 / 12), -r * 2.2 / N);

    ctx.save();
    ctx.translate(tg.x, tg.y);
    ctx.rotate(tg.heading);

    // shadow on the pond floor
    ctx.save();
    ctx.translate(r * 0.22, r * 0.3);
    ctx.fillStyle = 'rgba(3, 15, 40, 0.35)';
    bodyPath();
    ctx.fill();
    ctx.restore();

    // tail fan
    ctx.save();
    ctx.translate(tailX, tailY);
    ctx.rotate(tailA + Math.sin(tg.phase - 2.6) * 0.3 * swim);
    ctx.fillStyle = 'rgba(255, 168, 60, 0.92)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.08, 0);
    ctx.quadraticCurveTo(r * 0.35, -r * 0.1, r * 0.72, -r * 0.5);
    ctx.quadraticCurveTo(r * 0.5, 0, r * 0.72, r * 0.5);
    ctx.quadraticCurveTo(r * 0.35, r * 0.1, -r * 0.08, 0);
    ctx.fill();
    ctx.restore();

    // pectoral fins
    const fin = 0.7 + Math.sin(tg.phase * 1.3) * 0.25;
    ctx.fillStyle = 'rgba(255, 200, 95, 0.8)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(r * 0.35, s * r * 0.45, r * 0.3, r * 0.12, s * fin, 0, TAU);
      ctx.fill();
    }

    // body with koi markings
    const grad = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
    grad.addColorStop(0, '#ffb81f');
    grad.addColorStop(0.5, '#ffd84d');
    grad.addColorStop(1, '#ffb81f');
    ctx.fillStyle = grad;
    bodyPath();
    ctx.fill();
    ctx.save();
    bodyPath();
    ctx.clip();
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.ellipse(r * 0.5, spineY(0.27) - r * 0.12, r * 0.28, r * 0.2, 0.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, spineY(0.57) + r * 0.14, r * 0.3, r * 0.2, -0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff6e2';
    ctx.beginPath();
    ctx.ellipse(-r * 0.62, spineY(0.78), r * 0.22, r * 0.14, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 245, 200, 0.55)';
    ctx.lineWidth = r * 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 3; i <= 8; i++) {
      const u = i / N;
      ctx.lineTo(r * 1.1 - u * r * 2.2, spineY(u));
    }
    ctx.stroke();

    // eyes
    for (const s of [-1, 1]) {
      const ey = spineY(0.1) + s * r * 0.22;
      ctx.fillStyle = '#14161c';
      ctx.beginPath();
      ctx.arc(r * 0.82, ey, r * 0.075, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(r * 0.84, ey - r * 0.025, r * 0.025, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  const FISH = {
    key: 'fish',
    name: 'Fish Pond',
    motion: { dart: 0.8, wander: 0.2, turn: 3.4, accel: 2.4, freezeP: 0.3, redart: 0.35, freeze: [0.5, 1.4], wanderT: [1.2, 2.8], edgeBias: 0 },
    anim: { base: 4, speed: 10 },
    tapColor: '#dff0ff',

    scene(w, h, dpr) {
      const m = Math.min(w, h);
      const [bg, g] = makeLayer(w, h, dpr);
      const grad = g.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.6);
      grad.addColorStop(0, '#2b78c8');
      grad.addColorStop(0.55, '#1a4f94');
      grad.addColorStop(1, '#0c2a58');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      // pebbles on the pond floor
      const pebbles = Math.round((w * h) / 9000);
      for (let i = 0; i < pebbles; i++) {
        g.fillStyle = Math.random() < 0.55 ? 'rgba(8, 28, 70, 0.12)' : 'rgba(130, 190, 250, 0.06)';
        g.beginPath();
        g.ellipse(rand(0, w), rand(0, h), rand(2, m * 0.016), rand(2, m * 0.011), rand(0, TAU), 0, TAU);
        g.fill();
      }
      // lily pads hug the edges so open water stays in the middle
      const count = clamp(Math.round((w * h) / 120000), 3, 7);
      for (let i = 0; i < count; i++) {
        const r = m * rand(0.07, 0.11);
        const side = i % 4;
        const along = rand(0.1, 0.9);
        const inset = r * rand(0.2, 0.9);
        drawLilyPad(g, {
          x: side === 0 || side === 2 ? along * w : side === 1 ? w - inset : inset,
          y: side === 1 || side === 3 ? along * h : side === 0 ? inset : h - inset,
          r,
          rot: rand(0, TAU),
          flower: Math.random() < 0.35,
        });
      }
      const sparkles = Array.from({ length: clamp(Math.round((w * h) / 40000), 6, 30) }, () => ({
        x: rand(0, w), y: rand(0, h), p: rand(0, TAU), s: rand(0.8, 1.8),
      }));
      const blobs = Array.from({ length: 6 }, () => ({
        ax: rand(0.2, 0.45) * w, ay: rand(0.2, 0.45) * h,
        fx: rand(0.03, 0.07), fy: rand(0.03, 0.07), p: rand(0, TAU), r: rand(0.25, 0.45) * m,
      }));
      return { bg, sparkles, blobs };
    },

    drawScene(ctx, sc, t, w, h) {
      ctx.drawImage(sc.bg, 0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of sc.blobs) {
        const x = w / 2 + Math.sin(t * b.fx * TAU + b.p) * b.ax;
        const y = h / 2 + Math.cos(t * b.fy * TAU + b.p * 1.3) * b.ay;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, b.r);
        gr.addColorStop(0, 'rgba(120, 190, 255, 0.1)');
        gr.addColorStop(1, 'rgba(120, 190, 255, 0)');
        ctx.fillStyle = gr;
        ctx.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2);
      }
      ctx.fillStyle = '#e2f2ff';
      for (const s of sc.sparkles) {
        const a = Math.sin(t * s.s + s.p);
        if (a < 0.1) continue;
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + a * 1.3, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    },

    drawTarget: drawFish,

    onUpdate(tg, dt, fx, m) {
      tg.ripple = (tg.ripple || 0) - dt;
      if (tg.ripple <= 0 && tg.speed > m * 0.06 && !tg.entering) {
        tg.ripple = 0.35;
        fx.add({
          kind: 'ring', layer: 'under',
          x: tg.x - Math.cos(tg.heading) * tg.r * 0.4,
          y: tg.y - Math.sin(tg.heading) * tg.r * 0.4,
          r0: tg.r * 0.5, r1: tg.r * 1.6, life: 1.2, color: '#bfe1ff', lw: 2, alpha: 0.35,
        });
      }
    },

    burst(fx, x, y, r) {
      fx.add({ kind: 'ring', x, y, r0: r * 0.3, r1: r * 2.2, life: 0.7, color: '#e6f4ff', lw: 4, alpha: 0.9 });
      fx.add({ kind: 'ring', x, y, r0: r * 0.1, r1: r * 1.4, life: 0.55, color: '#ffffff', lw: 3, alpha: 0.7 });
      for (let i = 0; i < 16; i++) {
        const a = rand(0, TAU);
        const s = r * rand(2, 6);
        fx.add({
          kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.02,
          life: rand(0.45, 0.8), size: r * rand(0.06, 0.13), color: pick(['#ffffff', '#cfe8ff', '#9fd0ff']),
        });
      }
    },
  };

  // ---------- Mouse Chase ----------

  function drawMouse(ctx, tg) {
    const r = tg.r;
    const moving = clamp(tg.speed / (r * 4), 0, 1);
    const twitch = tg.state === 'freeze' ? Math.sin(tg.age * 38) * 0.5 + 0.5 : 0;

    ctx.save();
    ctx.translate(tg.x, tg.y);
    ctx.rotate(tg.heading);

    ctx.fillStyle = 'rgba(70, 40, 15, 0.22)';
    ctx.beginPath();
    ctx.ellipse(r * 0.05, r * 0.15, r * 1.05, r * 0.62, 0, 0, TAU);
    ctx.fill();

    // tail
    const sway = Math.sin(tg.phase * 0.5 + tg.age * 2) * r * (0.25 + 0.35 * moving);
    ctx.strokeStyle = '#c99a9a';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, 0);
    ctx.bezierCurveTo(-r * 1.5, sway, -r * 2, -sway, -r * 2.55, sway * 0.5);
    ctx.stroke();

    // feet, alternating while running
    const step = Math.sin(tg.phase) * r * 0.14 * moving;
    ctx.fillStyle = '#f0a8b0';
    for (const [fx, fy, s] of [[0.45, -0.42, 1], [0.45, 0.42, -1], [-0.5, -0.46, -1], [-0.5, 0.46, 1]]) {
      ctx.beginPath();
      ctx.ellipse(fx * r + step * s, fy * r, r * 0.13, r * 0.08, 0, 0, TAU);
      ctx.fill();
    }

    // body
    ctx.beginPath();
    ctx.moveTo(r * 1.02, 0);
    ctx.bezierCurveTo(r * 0.75, -r * 0.36, r * 0.25, -r * 0.6, -r * 0.4, -r * 0.56);
    ctx.bezierCurveTo(-r * 1.08, -r * 0.5, -r * 1.08, r * 0.5, -r * 0.4, r * 0.56);
    ctx.bezierCurveTo(r * 0.25, r * 0.6, r * 0.75, r * 0.36, r * 1.02, 0);
    const grad = ctx.createRadialGradient(r * 0.1, -r * 0.15, r * 0.1, 0, 0, r * 1.1);
    grad.addColorStop(0, '#8d939d');
    grad.addColorStop(0.6, '#6a707a');
    grad.addColorStop(1, '#4c515a');
    ctx.fillStyle = grad;
    ctx.fill();

    // ears
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#727883';
      ctx.beginPath();
      ctx.arc(r * 0.22, s * r * 0.43, r * 0.25, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#f2b0b8';
      ctx.beginPath();
      ctx.arc(r * 0.24, s * r * 0.45, r * 0.15, 0, TAU);
      ctx.fill();
    }

    // eyes
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(r * 0.62, s * r * 0.17, r * 0.065, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(r * 0.64, s * r * 0.17 - r * 0.02, r * 0.022, 0, TAU);
      ctx.fill();
    }

    // whiskers and nose twitch while the mouse is frozen
    ctx.strokeStyle = 'rgba(40, 40, 45, 0.55)';
    ctx.lineWidth = Math.max(1, r * 0.025);
    for (const s of [-1, 1]) {
      for (const k of [0.2, 0.45]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.92, s * r * 0.05);
        ctx.lineTo(r * (1.3 - k * 0.25), s * r * (k + twitch * 0.06));
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#f3a0ab';
    ctx.beginPath();
    ctx.arc(r * (1.02 + twitch * 0.03), 0, r * 0.075, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const MOUSE = {
    key: 'mouse',
    name: 'Mouse Chase',
    motion: { dart: 1.05, wander: 0.25, turn: 16, accel: 9, freezeP: 0.6, redart: 0.75, freeze: [0.35, 1.5], wanderT: [0.5, 1.2], edgeBias: 0.55 },
    anim: { base: 0.5, speed: 30 },
    tapColor: '#7a5a3a',

    scene(w, h, dpr) {
      const m = Math.min(w, h);
      const [bg, g] = makeLayer(w, h, dpr);
      const plank = clamp(m / 6.5, 30, 96);
      const tones = ['#ecd6b0', '#e6cda4', '#f0dcba', '#e2c597', '#e9d2a9'];
      for (let y = -rand(0, plank); y < h; y += plank) {
        let x = -rand(0, w * 0.5);
        while (x < w) {
          const len = rand(0.5, 1.1) * Math.max(w, 420);
          g.fillStyle = pick(tones);
          g.fillRect(x, y, len, plank);
          g.strokeStyle = 'rgba(150, 105, 55, 0.13)';
          g.lineWidth = 1;
          for (let k = 0; k < 4; k++) {
            const gy = y + rand(4, plank - 4);
            const amp = rand(1, 3);
            g.beginPath();
            for (let gx = x; gx <= x + len; gx += 24) g.lineTo(gx, gy + Math.sin(gx * 0.03 + k) * amp);
            g.stroke();
          }
          if (Math.random() < 0.3) {
            g.fillStyle = 'rgba(140, 95, 50, 0.25)';
            g.beginPath();
            g.ellipse(x + rand(0.1, 0.9) * len, y + plank / 2, rand(4, 9), rand(2, 4), 0, 0, TAU);
            g.fill();
          }
          g.fillStyle = 'rgba(120, 80, 40, 0.3)';
          g.fillRect(x + len - 1, y, 2, plank);
          x += len;
        }
        g.fillStyle = 'rgba(120, 80, 40, 0.32)';
        g.fillRect(0, y + plank - 1.5, w, 1.5);
      }
      // a patch of window light
      g.fillStyle = 'rgba(255, 248, 225, 0.2)';
      g.beginPath();
      g.moveTo(w * 0.55, 0);
      g.lineTo(w * 0.95, 0);
      g.lineTo(w * 0.7, h);
      g.lineTo(w * 0.3, h);
      g.closePath();
      g.fill();
      const vg = g.createRadialGradient(w / 2, h / 2, m * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.62);
      vg.addColorStop(0, 'rgba(60, 35, 10, 0)');
      vg.addColorStop(1, 'rgba(60, 35, 10, 0.3)');
      g.fillStyle = vg;
      g.fillRect(0, 0, w, h);
      return { bg };
    },

    drawScene(ctx, sc, t, w, h) {
      ctx.drawImage(sc.bg, 0, 0, w, h);
    },

    drawTarget: drawMouse,

    burst(fx, x, y, r) {
      for (let i = 0; i < 10; i++) {
        const a = rand(0, TAU);
        const s = r * rand(1, 3);
        fx.add({
          kind: 'puff', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.05,
          life: rand(0.5, 0.8), size: r * rand(0.25, 0.4), color: '#f8eedc', alpha: 0.8,
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = rand(0, TAU);
        const s = r * rand(2.5, 4.5);
        fx.add({
          kind: 'star', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.04,
          life: 0.7, size: r * rand(0.16, 0.26), color: '#ffc928', vr: rand(-8, 8),
        });
      }
    },
  };

  // ---------- Butterfly Garden ----------

  function drawFlower(g, f) {
    g.save();
    g.translate(f.x, f.y);
    g.fillStyle = 'rgba(20, 60, 20, 0.25)';
    g.beginPath();
    g.arc(f.r * 0.15, f.r * 0.2, f.r * 1.05, 0, TAU);
    g.fill();
    g.fillStyle = f.color;
    for (let i = 0; i < f.petals; i++) {
      const a = f.rot + (i * TAU) / f.petals;
      g.beginPath();
      g.ellipse(Math.cos(a) * f.r * 0.55, Math.sin(a) * f.r * 0.55, f.r * 0.5, f.r * 0.32, a, 0, TAU);
      g.fill();
    }
    g.fillStyle = f.center;
    g.beginPath();
    g.arc(0, 0, f.r * 0.32, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(120, 70, 0, 0.35)';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(rand(-0.15, 0.15) * f.r, rand(-0.15, 0.15) * f.r, f.r * 0.04, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function butterflyWings(ctx, r, open, plain) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side * open, 1);
      let grad;
      if (!plain) {
        grad = ctx.createLinearGradient(0, 0, r * 1.1, 0);
        grad.addColorStop(0, '#1b4fd0');
        grad.addColorStop(0.6, '#3d8bff');
        grad.addColorStop(1, '#79bcff');
        ctx.fillStyle = grad;
        ctx.strokeStyle = '#0e2559';
        ctx.lineWidth = r * 0.07;
        ctx.lineJoin = 'round';
      }
      // forewing
      ctx.beginPath();
      ctx.moveTo(r * 0.05, -r * 0.15);
      ctx.bezierCurveTo(r * 0.35, -r * 1.05, r * 1.2, -r * 1.05, r * 1.08, -r * 0.32);
      ctx.quadraticCurveTo(r * 0.75, r * 0.02, r * 0.05, r * 0.02);
      ctx.closePath();
      ctx.fill();
      if (!plain) ctx.stroke();
      // hindwing
      ctx.beginPath();
      ctx.moveTo(r * 0.05, r * 0.02);
      ctx.bezierCurveTo(r * 0.85, -r * 0.02, r * 0.95, r * 0.7, r * 0.5, r * 0.85);
      ctx.quadraticCurveTo(r * 0.2, r * 0.82, r * 0.05, r * 0.35);
      ctx.closePath();
      ctx.fill();
      if (!plain) {
        ctx.stroke();
        ctx.fillStyle = '#ffd43b';
        for (const [x, y, s] of [[0.84, -0.6, 0.11], [0.6, -0.8, 0.075], [0.98, -0.38, 0.07], [0.55, 0.58, 0.1]]) {
          ctx.beginPath();
          ctx.arc(x * r, y * r, s * r, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function drawButterfly(ctx, tg) {
    const r = tg.r;
    const perched = tg.state === 'freeze';
    const flap = perched ? 0.72 + 0.28 * Math.cos(tg.age * 2.2) : Math.abs(Math.cos(tg.phase));
    const open = 0.18 + 0.82 * flap;
    const rot = tg.heading + Math.PI / 2;

    // shadow on the grass: further away the higher it flies
    ctx.save();
    ctx.translate(tg.x + r * 0.55 * tg.alt, tg.y + r * 0.65 * tg.alt);
    ctx.rotate(rot);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#0d2a0d';
    butterflyWings(ctx, r * 0.92, open, true);
    ctx.restore();

    ctx.save();
    ctx.translate(tg.x, tg.y);
    ctx.rotate(rot);
    butterflyWings(ctx, r, open, false);
    ctx.fillStyle = '#20232e';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.05, r * 0.1, r * 0.52, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -r * 0.5, r * 0.12, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#20232e';
    ctx.lineWidth = Math.max(1, r * 0.035);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.04, -r * 0.58);
      ctx.quadraticCurveTo(s * r * 0.08, -r * 0.9, s * r * 0.32, -r * 1.02);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * r * 0.32, -r * 1.02, r * 0.05, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  const BUTTERFLY = {
    key: 'butterfly',
    name: 'Butterfly Garden',
    motion: { dart: 0.5, wander: 0.22, turn: 4.5, accel: 3, freezeP: 0.35, redart: 0.4, freeze: [0.7, 1.8], wanderT: [1, 2.4], edgeBias: 0, flutter: 0.3 },
    anim: { base: 16, speed: 4 },
    tapColor: '#ffffff',

    scene(w, h, dpr) {
      const m = Math.min(w, h);
      const [bg, g] = makeLayer(w, h, dpr);
      const grad = g.createRadialGradient(w * 0.45, h * 0.4, 0, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      grad.addColorStop(0, '#8fd16f');
      grad.addColorStop(0.6, '#62ad4f');
      grad.addColorStop(1, '#3f8a3c');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      const blades = ['#4f9a43', '#71bd5c', '#5aa84b', '#89cf6e', '#3f8737'];
      g.lineCap = 'round';
      const n = Math.round((w * h) / 220);
      for (let i = 0; i < n; i++) {
        const x = rand(0, w);
        const y = rand(0, h);
        const len = rand(5, 13);
        const a = -Math.PI / 2 + rand(-0.5, 0.5);
        g.strokeStyle = pick(blades);
        g.globalAlpha = rand(0.35, 0.8);
        g.lineWidth = rand(1, 2);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
      g.globalAlpha = 1;
      const flowers = [];
      const count = clamp(Math.round((w * h) / 55000), 4, 12);
      for (let i = 0; i < count; i++) {
        const r = m * rand(0.035, 0.05);
        flowers.push({
          x: rand(r * 2, w - r * 2), y: rand(r * 2, h - r * 2), r,
          petals: pick([5, 6]), rot: rand(0, TAU),
          color: pick(['#ffffff', '#fff1a8', '#e2d0ff', '#ffd0e4']),
          center: pick(['#f5b031', '#e8902a']),
        });
      }
      flowers.forEach((f) => drawFlower(g, f));
      const motes = Array.from({ length: clamp(Math.round((w * h) / 50000), 5, 24) }, () => ({
        x: rand(0, w), y: rand(0, h), vx: rand(-6, 6), vy: rand(-4, 4), p: rand(0, TAU),
      }));
      return { bg, perches: flowers, motes };
    },

    drawScene(ctx, sc, t, w, h) {
      ctx.drawImage(sc.bg, 0, 0, w, h);
      ctx.fillStyle = '#fff8c8';
      for (const p of sc.motes) {
        const x = (((p.x + p.vx * t) % w) + w) % w;
        const y = (((p.y + p.vy * t + Math.sin(t + p.p) * 6) % h) + h) % h;
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 1.5 + p.p);
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    drawTarget: drawButterfly,

    onUpdate(tg, dt) {
      tg.alt += ((tg.state === 'freeze' ? 0.15 : 1) - tg.alt) * Math.min(1, dt * 4);
    },

    burst(fx, x, y, r) {
      fx.add({ kind: 'ring', x, y, r0: r * 0.2, r1: r * 1.8, life: 0.6, color: '#ffffff', lw: 3, alpha: 0.8 });
      for (let i = 0; i < 18; i++) {
        const a = rand(0, TAU);
        const s = r * rand(2, 5);
        fx.add({
          kind: 'star', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 0.03,
          life: rand(0.6, 0.95), size: r * rand(0.12, 0.24), vr: rand(-6, 6),
          color: pick(['#ffe05a', '#ffffff', '#8cc8ff']),
        });
      }
    },
  };

  const MODES = { fish: FISH, mouse: MOUSE, butterfly: BUTTERFLY };

  // ---------- Prey-like movement ----------
  // Each target cycles through dart (fast, toward a waypoint), freeze (still,
  // twitching) and wander (slow drift). Unpredictable stop-start motion is
  // what keeps cats interested.

  function pickWaypoint(tg, mode, w, h, sc, first) {
    const r = tg.r;
    const m = Math.min(w, h);
    const pad = r * 1.4;
    tg.perch = false;
    if (!first && sc.perches && Math.random() < 0.5) {
      const f = pick(sc.perches);
      tg.tx = f.x;
      tg.ty = f.y;
      tg.perch = true;
      return;
    }
    if (!first && Math.random() < mode.motion.edgeBias) {
      // run along a wall; usually the one we're already next to
      const inset = r * 1.1;
      const near = [tg.y, w - tg.x, h - tg.y, tg.x];
      const closest = near.indexOf(Math.min(...near));
      const side = near[closest] < r * 2.5 && Math.random() < 0.6 ? closest : (Math.random() * 4) | 0;
      if (side === 0) { tg.tx = rand(pad, w - pad); tg.ty = inset; }
      else if (side === 1) { tg.tx = w - inset; tg.ty = rand(pad, h - pad); }
      else if (side === 2) { tg.tx = rand(pad, w - pad); tg.ty = h - inset; }
      else { tg.tx = inset; tg.ty = rand(pad, h - pad); }
      return;
    }
    let x = w / 2;
    let y = h / 2;
    for (let i = 0; i < 8; i++) {
      x = rand(pad, w - pad);
      y = rand(pad, h - pad);
      if (Math.hypot(x - tg.x, y - tg.y) > m * 0.35) break;
    }
    tg.tx = x;
    tg.ty = y;
  }

  function spawnTarget(mode, w, h, r, sc, fromEdge) {
    const m = r * 1.6;
    let x = rand(m, w - m);
    let y = rand(m, h - m);
    if (fromEdge) {
      const side = (Math.random() * 4) | 0;
      if (side === 0) y = -m;
      else if (side === 1) x = w + m;
      else if (side === 2) y = h + m;
      else x = -m;
    }
    const tg = {
      x, y, r, tx: x, ty: y, heading: 0, speed: 0, state: 'dart', timer: 4,
      phase: rand(0, TAU), turnRate: 0, entering: fromEdge, age: 0, lat: rand(0, TAU), alt: 1, perch: false,
    };
    pickWaypoint(tg, mode, w, h, sc, true);
    tg.heading = Math.atan2(tg.ty - y, tg.tx - x);
    return tg;
  }

  function nextState(tg, mode, w, h, sc) {
    const mo = mode.motion;
    let next;
    if (tg.state === 'dart') {
      if (tg.perch) next = 'freeze';
      else if (Math.random() < mo.freezeP) next = 'freeze';
      else next = Math.random() < mo.redart ? 'dart' : 'wander';
    } else if (tg.state === 'wander') {
      next = Math.random() < 0.7 ? 'dart' : 'freeze';
    } else {
      next = Math.random() < 0.8 ? 'dart' : 'wander';
    }
    tg.state = next;
    if (next === 'dart') {
      pickWaypoint(tg, mode, w, h, sc, false);
      tg.timer = 4;
    } else if (next === 'freeze') {
      tg.timer = rand(mo.freeze[0], mo.freeze[1]) * (tg.perch ? 1.6 : 1);
    } else {
      tg.timer = rand(mo.wanderT[0], mo.wanderT[1]);
      tg.turnRate = rand(-1, 1);
    }
  }

  function updateTarget(tg, mode, dt, w, h, spd, sc, fx) {
    const mo = mode.motion;
    const m = Math.min(w, h);
    tg.age += dt;
    tg.timer -= dt;
    let desired = 0;

    if (tg.state === 'dart') {
      const dx = tg.tx - tg.x;
      const dy = tg.ty - tg.y;
      const d = Math.hypot(dx, dy);
      tg.heading = turnToward(tg.heading, Math.atan2(dy, dx), mo.turn * dt * (tg.entering ? 2 : 1));
      desired = mo.dart * m * spd * clamp(d / (tg.r * 3), 0.25, 1);
      if (d < tg.r * 0.5 || (tg.timer <= 0 && !tg.entering)) nextState(tg, mode, w, h, sc);
    } else if (tg.state === 'wander') {
      tg.turnRate = clamp(tg.turnRate + (Math.random() - 0.5) * 10 * dt, -2.2, 2.2);
      tg.heading += tg.turnRate * dt;
      const edge = tg.r * 2.2;
      if (tg.x < edge || tg.x > w - edge || tg.y < edge || tg.y > h - edge) {
        tg.heading = turnToward(tg.heading, Math.atan2(h / 2 - tg.y, w / 2 - tg.x), mo.turn * dt);
      }
      desired = mo.wander * m * spd;
      if (tg.timer <= 0) nextState(tg, mode, w, h, sc);
    } else if (tg.timer <= 0) {
      nextState(tg, mode, w, h, sc);
    }

    tg.speed += (desired - tg.speed) * Math.min(1, mo.accel * dt);
    let vx = Math.cos(tg.heading) * tg.speed;
    let vy = Math.sin(tg.heading) * tg.speed;
    if (mo.flutter && tg.state !== 'freeze') {
      const s = Math.sin(tg.age * 6.5 + tg.lat) * m * mo.flutter * spd;
      vx -= Math.sin(tg.heading) * s;
      vy += Math.cos(tg.heading) * s;
    }
    tg.x += vx * dt;
    tg.y += vy * dt;

    if (tg.entering) {
      if (tg.x > tg.r && tg.x < w - tg.r && tg.y > tg.r && tg.y < h - tg.r) tg.entering = false;
    } else {
      tg.x = clamp(tg.x, tg.r * 0.6, w - tg.r * 0.6);
      tg.y = clamp(tg.y, tg.r * 0.6, h - tg.r * 0.6);
    }
    tg.phase += dt * (mode.anim.base + (mode.anim.speed * tg.speed) / m);
    if (mode.onUpdate) mode.onUpdate(tg, dt, fx, m);
  }

  // ---------- Sound (synthesised, no audio files) ----------

  const sfx = {
    ctx: null,
    out: null,
    noiseBuf: null,

    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.out = this.ctx.createGain();
          this.out.gain.value = 0.7;
          this.out.connect(this.ctx.destination);
          const len = Math.floor(this.ctx.sampleRate * 0.6);
          this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const data = this.noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      } catch { /* audio unavailable */ }
    },

    ready() {
      return settings.sound === 'on' && this.ctx && this.ctx.state === 'running';
    },

    tone(type, f0, f1, dur, vol, delay = 0) {
      const c = this.ctx;
      const t0 = c.currentTime + delay;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.out);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    noise(freq, q, dur, vol, delay = 0, type = 'bandpass') {
      const c = this.ctx;
      const t0 = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(this.out);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },

    catch(key) {
      if (!this.ready()) return;
      if (key === 'fish') {
        this.noise(1400, 0.7, 0.28, 0.35);
        this.tone('sine', 260, 820, 0.14, 0.35, 0.02);
        this.tone('sine', 380, 1100, 0.12, 0.25, 0.1);
      } else if (key === 'mouse') {
        for (let i = 0; i < 3; i++) {
          const f = 2900 + i * 250;
          this.tone('triangle', f, f * 1.18, 0.07, 0.18, i * 0.085);
        }
        this.tone('sine', 600, 150, 0.08, 0.2);
      } else {
        [1318.5, 1661.2, 1975.5, 2637].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.14, i * 0.06));
      }
    },

    idle(key) {
      if (!this.ready()) return;
      if (key === 'fish') {
        this.tone('sine', rand(280, 400), 900, 0.1, 0.12);
      } else if (key === 'mouse') {
        const f = rand(2800, 3300);
        this.tone('triangle', f, f * 1.15, 0.06, 0.08);
        this.tone('triangle', f, f * 1.2, 0.06, 0.08, 0.1);
      } else {
        for (let i = 0; i < 3; i++) this.noise(4000, 0.5, 0.05, 0.05, i * 0.06, 'highpass');
        this.tone('sine', 2093, 2093, 0.3, 0.04, 0.1);
      }
    },
  };

  // ---------- Game state ----------

  const stage = $('#stage');
  const ctx = stage.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1 };
  const game = {
    mode: null, key: null, scene: null, state: 'home',
    caught: 0, elapsed: 0, limit: Infinity, clock: 0,
    target: null, respawnAt: 0, nextIdle: 0, countdown: 0, cdShown: 0,
    fx: new Particles(),
  };

  const hud = $('#hud');
  const hudPill = $('.hud-pill');
  const hudCount = $('#hudCount');
  const hudTime = $('#hudTime');
  const screens = { home: $('#home'), setup: $('#setup') };
  const overlays = { countdown: $('#countdown'), pause: $('#pause'), finish: $('#finish'), tips: $('#tips') };

  const targetRadius = () => clamp(Math.min(view.w, view.h) * OPTIONS.size[settings.size], 24, 120);

  function showScreen(name) {
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  }

  function showOverlay(name, on) {
    overlays[name].hidden = !on;
  }

  function resizeStage() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === view.w && h === view.h && dpr === view.dpr && game.scene) return;
    view.w = w;
    view.h = h;
    view.dpr = dpr;
    stage.width = Math.round(w * dpr);
    stage.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!game.mode || game.state === 'home') return;
    game.scene = game.mode.scene(w, h, dpr);
    const tg = game.target;
    if (tg) {
      tg.r = targetRadius();
      if (!tg.entering) {
        tg.x = clamp(tg.x, tg.r, w - tg.r);
        tg.y = clamp(tg.y, tg.r, h - tg.r);
      }
      tg.tx = clamp(tg.tx, tg.r, w - tg.r);
      tg.ty = clamp(tg.ty, tg.r, h - tg.r);
    }
    renderGame();
  }

  function renderGame() {
    const sc = game.scene;
    if (!sc) return;
    game.mode.drawScene(ctx, sc, game.clock, view.w, view.h);
    game.fx.draw(ctx, 'under');
    if (game.target) game.mode.drawTarget(ctx, game.target);
    game.fx.draw(ctx, 'over');
  }

  function updateHud() {
    const count = String(game.caught);
    if (hudCount.textContent !== count) hudCount.textContent = count;
    const time = game.limit === Infinity ? fmtTime(game.elapsed) : fmtTime(Math.ceil(game.limit - game.elapsed));
    if (hudTime.textContent !== time) hudTime.textContent = time;
  }

  function updateGame(dt) {
    game.clock += dt;
    game.fx.update(dt);
    if (game.state === 'countdown') {
      game.countdown -= dt;
      const n = Math.ceil(game.countdown);
      if (n !== game.cdShown && n > 0) {
        game.cdShown = n;
        $('#cdNum').textContent = n;
      }
      if (game.countdown <= 0) beginPlay();
      return;
    }
    game.elapsed += dt;
    if (game.elapsed >= game.limit) {
      game.elapsed = game.limit;
      finish(true);
      return;
    }
    const { w, h } = view;
    if (!game.target && game.clock >= game.respawnAt) {
      game.target = spawnTarget(game.mode, w, h, targetRadius(), game.scene, true);
    }
    if (game.target) {
      updateTarget(game.target, game.mode, dt, w, h, OPTIONS.speed[settings.speed], game.scene, game.fx);
      if (game.clock >= game.nextIdle) {
        game.nextIdle = game.clock + rand(4, 9);
        sfx.idle(game.key);
      }
    }
    updateHud();
  }

  // ---------- Flow ----------

  let wakeLock = null;
  async function keepAwake(on) {
    if (IN_APP) return; // the iOS wrapper keeps the screen on natively
    try {
      if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { /* not supported or not allowed */ }
  }

  function enterFullscreen() {
    if (STANDALONE || DEBUG) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    } catch { /* not allowed here */ }
  }

  function exitFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch { /* ignore */ }
  }

  function startGame(key) {
    game.mode = MODES[key];
    game.key = key;
    store.set('pawplay.settings', settings);
    if (settings.sound === 'on') sfx.unlock();
    enterFullscreen();
    keepAwake(true);
    game.caught = 0;
    game.elapsed = 0;
    game.limit = OPTIONS.length[settings.length];
    game.clock = 0;
    game.target = null;
    game.scene = null;
    game.fx.clear();
    game.state = 'countdown';
    showScreen(null);
    showOverlay('finish', false);
    showOverlay('pause', false);
    document.body.classList.add('playing');
    resizeStage();
    updateHud();
    hud.hidden = false;
    beginCountdown();
  }

  function beginCountdown() {
    game.state = 'countdown';
    game.countdown = COUNTDOWN;
    game.cdShown = COUNTDOWN;
    game.target = null;
    $('#cdNum').textContent = COUNTDOWN;
    showOverlay('countdown', true);
  }

  function beginPlay() {
    game.state = 'playing';
    showOverlay('countdown', false);
    game.respawnAt = game.clock;
    game.nextIdle = game.clock + rand(2, 4);
  }

  function pause() {
    if (game.state !== 'playing' && game.state !== 'countdown') return;
    game.state = 'paused';
    cancelHold();
    showOverlay('countdown', false);
    $('#pauseStats').textContent = `${game.caught} caught · ${fmtTime(game.elapsed)} played`;
    showOverlay('pause', true);
  }

  function resume() {
    showOverlay('pause', false);
    keepAwake(true);
    beginCountdown(); // gives the owner time to set the device down again
  }

  function finish(timeUp) {
    if (game.state === 'finished') return;
    game.state = 'finished';
    cancelHold();
    showOverlay('countdown', false);
    showOverlay('pause', false);
    hud.hidden = true;
    store.set('pawplay.lastSession', { mode: game.key, caught: game.caught, seconds: Math.round(game.elapsed), at: Date.now() });
    $('#finishTitle').textContent = game.caught > 0 ? 'Nice hunting!' : (timeUp ? "Time's up" : 'All done');
    $('#statCaught').textContent = game.caught;
    $('#statCaughtLbl').textContent = game.caught === 1 ? 'target caught' : 'targets caught';
    $('#statTime').textContent = fmtTime(game.elapsed);
    $('#finishNote').hidden = game.caught > 0;
    showOverlay('finish', true);
    renderGame();
  }

  function goHome() {
    game.state = 'home';
    game.target = null;
    game.fx.clear();
    hud.hidden = true;
    for (const name of Object.keys(overlays)) showOverlay(name, false);
    document.body.classList.remove('playing');
    exitFullscreen();
    keepAwake(false);
    renderLastSession();
    showScreen('home');
  }

  function relDay(ts) {
    const d = new Date(ts);
    const now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return 'today';
    if (diff === 1) return 'yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderLastSession() {
    const s = store.get('pawplay.lastSession', null);
    const el = $('#lastSession');
    if (!s || !MODES[s.mode]) { el.hidden = true; return; }
    el.textContent = `Last game: ${MODES[s.mode].name} · ${s.caught} caught · ${fmtTime(s.seconds)} · ${relDay(s.at)}`;
    el.hidden = false;
  }

  // ---------- Input ----------

  function catchTarget(tg) {
    game.target = null;
    game.caught++;
    game.mode.burst(game.fx, tg.x, tg.y, tg.r);
    game.respawnAt = game.clock + rand(0.4, 0.8);
    game.nextIdle = Math.max(game.nextIdle, game.clock + 3);
    sfx.catch(game.key);
    updateHud();
    hudPill.classList.remove('bump');
    void hudPill.offsetWidth;
    hudPill.classList.add('bump');
  }

  stage.addEventListener('pointerdown', (e) => {
    if (game.state !== 'playing') return;
    e.preventDefault();
    const tg = game.target;
    if (tg && Math.hypot(e.clientX - tg.x, e.clientY - tg.y) <= tg.r * HIT) {
      catchTarget(tg);
    } else {
      game.fx.add({
        kind: 'ring', x: e.clientX, y: e.clientY, r0: 4, r1: targetRadius() * 0.8,
        life: 0.45, color: game.mode.tapColor, lw: 3, alpha: 0.55,
      });
    }
  }, { passive: false });
  stage.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  // Hold-to-pause: a quick paw tap never stops the game.
  const pauseBtn = $('#pauseBtn');
  const pauseRing = $('#pauseRing');
  const holdHint = $('#holdHint');
  let holdStart = 0;
  let hintTimer = 0;

  function cancelHold() {
    holdStart = 0;
    pauseBtn.classList.remove('holding');
    pauseRing.style.strokeDashoffset = RING_LEN;
  }

  function tickHold(now) {
    if (!holdStart) return;
    const p = Math.min(1, (now - holdStart) / HOLD_MS);
    pauseRing.style.strokeDashoffset = RING_LEN * (1 - p);
    if (p >= 1) pause();
  }

  pauseBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (game.state !== 'playing' && game.state !== 'countdown') return;
    holdStart = performance.now();
    pauseBtn.classList.add('holding');
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    pauseBtn.addEventListener(type, () => {
      if (!holdStart) return;
      cancelHold();
      holdHint.classList.add('show');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => holdHint.classList.remove('show'), 1600);
    });
  }
  pauseBtn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  // Keep the page still: no pinch zoom, double-tap zoom, callouts or scrolling mid-game.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => {
    if (document.body.classList.contains('playing')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pause();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
    } else {
      lastFrame = performance.now();
      if (game.state === 'paused' || game.state === 'finished') keepAwake(true);
    }
  });

  window.addEventListener('resize', () => {
    resizeStage();
    for (const p of previews) p.resize();
  });

  // ---------- Menus ----------

  class Preview {
    constructor(canvas, mode) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.fx = new Particles();
      this.clock = rand(0, 20);
      this.w = 0;
      this.h = 0;
      this.setMode(mode);
    }

    setMode(mode) {
      this.mode = mode;
      this.scene = null;
      this.resize(true);
    }

    resize(force) {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (!force && rect.width === this.w && rect.height === this.h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = rect.width;
      this.h = rect.height;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.scene = this.mode.scene(this.w, this.h, dpr);
      this.fx.clear();
      this.target = spawnTarget(this.mode, this.w, this.h, Math.min(this.w, this.h) * 0.13, this.scene, false);
      this.step(0);
    }

    step(dt) {
      if (!this.scene) return;
      this.clock += dt;
      updateTarget(this.target, this.mode, dt, this.w, this.h, 0.8, this.scene, this.fx);
      this.fx.update(dt);
      this.mode.drawScene(this.ctx, this.scene, this.clock, this.w, this.h);
      this.fx.draw(this.ctx, 'under');
      this.mode.drawTarget(this.ctx, this.target);
    }
  }

  const homePreviews = [...document.querySelectorAll('.mode-card')].map(
    (card) => new Preview(card.querySelector('canvas'), MODES[card.dataset.mode]),
  );
  const setupPreview = new Preview($('#setupPreview'), FISH);
  const previews = [...homePreviews, setupPreview];
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { for (const p of previews) p.resize(); });
    for (const p of previews) ro.observe(p.canvas);
  }

  const form = $('#settingsForm');
  function syncForm() {
    for (const k of Object.keys(DEFAULTS)) {
      const input = form.querySelector(`input[name="${k}"][value="${settings[k]}"]`);
      if (input) input.checked = true;
    }
  }
  form.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (!(name in settings)) return;
    settings[name] = value;
    store.set('pawplay.settings', settings);
    if (name === 'sound' && value === 'on') {
      sfx.unlock();
      setTimeout(() => sfx.catch(game.key), 60);
    }
  });

  function openSetup(key) {
    game.key = key;
    $('#setupTitle').textContent = MODES[key].name;
    syncForm();
    showScreen('setup');
    screens.setup.scrollTop = 0;
    setupPreview.setMode(MODES[key]);
  }

  for (const card of document.querySelectorAll('.mode-card')) {
    card.addEventListener('click', () => openSetup(card.dataset.mode));
  }
  $('#backBtn').addEventListener('click', () => showScreen('home'));
  $('#startBtn').addEventListener('click', () => startGame(game.key));
  $('#resumeBtn').addEventListener('click', resume);
  $('#endBtn').addEventListener('click', () => finish(false));
  $('#replayBtn').addEventListener('click', () => startGame(game.key));
  $('#anotherBtn').addEventListener('click', goHome);
  $('#tipsBtn').addEventListener('click', () => showOverlay('tips', true));
  $('#tipsClose').addEventListener('click', () => showOverlay('tips', false));
  overlays.tips.addEventListener('click', (e) => {
    if (e.target === overlays.tips) showOverlay('tips', false);
  });

  // ---------- Main loop ----------

  let lastFrame = performance.now();
  let frozen = false; // screenshot mode holds a single frame
  function frame(now) {
    requestAnimationFrame(frame);
    if (frozen) return;
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    tickHold(now);
    if (game.state === 'countdown' || game.state === 'playing') {
      updateGame(dt);
      renderGame();
    } else if (!REDUCED_MOTION) {
      if (!screens.home.hidden) for (const p of homePreviews) p.step(dt);
      else if (!screens.setup.hidden) setupPreview.step(dt);
    }
  }

  if (STANDALONE) document.body.classList.add('standalone');
  renderLastSession();
  resizeStage();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !IN_APP &&
      !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  if (DEBUG) {
    window.__pawplay = {
      get state() { return game.state; },
      get caught() { return game.caught; },
      get elapsed() { return game.elapsed; },
      get target() {
        const t = game.target;
        return t && { x: t.x, y: t.y, r: t.r, entering: t.entering, state: t.state };
      },
      skipCountdown() { if (game.state === 'countdown') game.countdown = 0; },
      advance(sec) { game.elapsed += sec; },
      settings: () => ({ ...settings }),
    };
  }

  // Screenshot mode for App Store images: index.html#shot=<screen>-<mode>, e.g. #shot=play-fish.
  // The iOS debug build passes it through with the launch argument `-shot play-fish`.
  const shot = /shot=(home|setup|play|catch|finish)-(fish|mouse|butterfly)/.exec(location.hash);
  if (shot) runShot(shot[1], shot[2]);

  function runShot(screen, key) {
    Object.assign(settings, DEFAULTS);
    if (screen === 'home') return;
    if (screen === 'setup') {
      openSetup(key);
      return;
    }
    settings.sound = 'off';
    startGame(key);
    game.countdown = 0;
    game.caught = 7;
    game.elapsed = 64;
    if (screen === 'finish') {
      game.caught = 14;
      game.elapsed = 180;
      finish(true);
      return;
    }
    // Hold the frame once the target is well inside the screen (and a butterfly's wings are open).
    const wait = setInterval(() => {
      const tg = game.target;
      if (!tg || tg.entering || tg.age < 1.6) return;
      if (tg.x < view.w * 0.15 || tg.x > view.w * 0.85 || tg.y < view.h * 0.2 || tg.y > view.h * 0.82) return;
      if (key === 'butterfly' && tg.state !== 'freeze' && Math.abs(Math.cos(tg.phase)) < 0.85) return;
      clearInterval(wait);
      if (screen === 'catch') {
        catchTarget(tg);
        setTimeout(() => { frozen = true; }, 220);
      } else {
        frozen = true;
      }
    }, 30);
  }
})();
