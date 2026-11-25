// The camera: turns the recorder's log ("look at this rectangle from t1", "let go at t2") into
// one smooth zoom-and-pan curve per piece of video, written as ffmpeg expressions.
//
// How it stays smooth. The camera has three numbers: zoom z, and the centre (cx, cy) it looks at,
// in page pixels. Every move is a "transition": from time `at`, over `d` seconds, add a delta to
// each number, eased with smoothstep (3u^2 - 2u^3: zero speed at both ends, so no jerk when a move
// starts or stops). The curve is simply   value(t) = home + sum(delta_k * ease((t - at_k) / d_k)).
// Because the moves ADD, a new move may start while the previous one is still finishing and the
// result is still one continuous curve. There are no keyframes to hit and no linear jumps.
const IN = 0.95;   // seconds to zoom in
const PAN = 0.85;  // seconds to move between two zoomed targets
const OUT = 1.0;   // seconds to zoom back out
const LINGER = 0.12; // the camera lets go a moment after the step ends
const STAY = 1.4;  // if the next step starts within this, pan to it instead of zooming out and in

// Where the camera should sit for a target rectangle. `capH` is the height the caption bar
// covers at the bottom of the frame: the target is centred in what is left above it.
function fit(r, { W, H, capH = 110, margin = 90, minZoom = 1.12 }) {
  let z = Math.min(r.max, W / (r.w + 2 * margin), (H - capH) / (r.h + 2 * margin));
  if (!(z >= minZoom)) return { z: 1, cx: W / 2, cy: H / 2 }; // a big element: zooming would crop it
  const clamp = (v, half, full) => Math.min(full - half, Math.max(half, v));
  return { z, cx: clamp(r.x + r.w / 2, W / (2 * z), W), cy: clamp(r.y + r.h / 2 + capH / (2 * z), H / (2 * z), H) };
}

// events: [{t (s, piece-local), type:'focus', x,y,w,h,max} | {t, type:'release'}], sorted.
function plan(events, view) {
  const home = { z: 1, cx: view.W / 2, cy: view.H / 2 };
  const moves = [];
  let at = home;
  const go = (t, d, to) => {
    if (to.z === at.z && to.cx === at.cx && to.cy === at.cy) return;
    moves.push({ at: t, d, dz: to.z - at.z, dx: to.cx - at.cx, dy: to.cy - at.cy });
    at = to;
  };
  events.forEach((e, i) => {
    if (e.type === 'focus') { go(e.t, at.z === 1 ? IN : PAN, fit(e, view)); return; }
    const next = events.slice(i + 1).find((n) => n.type === 'focus');
    if (next && next.t - e.t < STAY) return; // stay zoomed, the next focus pans
    go(e.t + LINGER, OUT, home);
  });
  if (at.z !== 1) go(view.end - OUT, OUT, home); // never leave a piece zoomed: the join must be full-frame
  return { home, moves };
}

// The same curve, evaluated in JS (used by the self-test and for debugging).
const ease = (u) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };
function at(p, t) {
  const s = { ...p.home };
  for (const m of p.moves) { const e = ease((t - m.at) / m.d); s.z += m.dz * e; s.cx += m.dx * e; s.cy += m.dy * e; }
  return s;
}

// ffmpeg expressions for zoompan. `it` is the input frame time; S is recording pixels per page pixel.
function expr(p, S) {
  const f = (n) => Number(n.toFixed(4));
  const e = (m) => { const u = `clip((it-${f(m.at)})/${f(m.d)},0,1)`; return `${u}*${u}*(3-2*${u})`; };
  const sum = (base, key) => base + p.moves.filter((m) => Math.abs(m[key]) > 1e-6).map((m) => `${m[key] < 0 ? '-' : '+'}${f(Math.abs(m[key]))}*${e(m)}`).join('');
  return {
    z: sum(f(p.home.z), 'dz'),
    // top-left corner of the visible window, in recording pixels; zoompan clamps it to the frame
    x: `(${sum(f(p.home.cx), 'dx')})*${S}-iw/zoom/2`,
    y: `(${sum(f(p.home.cy), 'dy')})*${S}-ih/zoom/2`,
  };
}

module.exports = { fit, plan, at, expr };

// node camera.js  -> self-test: the curve is continuous, eased, inside the frame, and ends at home.
if (require.main === module) {
  const view = { W: 1280, H: 720, end: 12 };
  const p = plan([
    { t: 1, type: 'focus', x: 40, y: 60, w: 200, h: 40, max: 1.5 }, { t: 4, type: 'release' },
    { t: 4.6, type: 'focus', x: 1000, y: 600, w: 220, h: 60, max: 1.5 }, { t: 7, type: 'release' },
    { t: 9, type: 'focus', x: 0, y: 100, w: 1280, h: 500, max: 1.5 }, { t: 10, type: 'release' },
  ], view);
  let prev = at(p, 0); let maxStep = 0; let ok = true;
  for (let t = 0; t <= view.end; t += 0.02) {
    const s = at(p, t);
    maxStep = Math.max(maxStep, Math.abs(s.z - prev.z));
    const hw = view.W / (2 * s.z); const hh = view.H / (2 * s.z);
    if (s.cx < hw - 0.5 || s.cx > view.W - hw + 0.5 || s.cy < hh - 0.5 || s.cy > view.H - hh + 0.5) { ok = false; console.log('outside frame at', t.toFixed(2), s); }
    prev = s;
  }
  const end = at(p, view.end);
  console.log('moves', p.moves.length, 'max zoom step per 20 ms', maxStep.toFixed(4), 'zoom at 3s', at(p, 3).z.toFixed(2), 'ends at', end.z.toFixed(3));
  if (!ok || maxStep > 0.02 || Math.abs(end.z - 1) > 1e-6 || p.moves.length !== 3) { console.error('FAIL'); process.exit(1); }
  console.log('OK');
}
