// The edit: turns the raw page recordings into the final video.
//   node assemble.js [out.mp4] [--no-zoom] [--fps 50] [--size 1280x720] [--xfade 0.5]
//                    [--transition fade] [--music bed.mp3] [--music-db -30]
//                    [--room-db -60] [--no-room]
//
//   --size     must keep the recording's aspect ratio (16:9 for the default viewport) and be even;
//              anything else is refused, because it would stretch the picture.
//   --xfade    seconds of cross-fade at every join. 0 = hard cuts (kept as a one-frame fade, so the
//              picture and the sound still have exactly the same length).
//   --room-db  level of the "room tone" laid under the whole voice track (default -60 dBFS RMS).
//              It is filtered noise made by ffmpeg (nothing licensed, nothing shipped): without it the
//              gaps between two lines are digital silence, which sounds like the audio dropped out.
//   --no-room  no room tone.
//
// Reads segments.json (pieces, camera log, captions, clock marks) and, when present, cues.json +
// voice/manifest.json. Needs ffmpeg/ffprobe on PATH (5.1 or newer; the filter graphs are passed
// with -/filter_complex on 7.1+, and with -filter_complex_script on older builds). Four passes,
// each small enough to debug:
//   1. clock   find the magenta marks in each recording, to convert our times into video times
//   2. pieces  cut every piece and apply its camera move (eased zoom and pan, see camera.js)
//   3. voice   lay each clip in its piece, cross-fade the pieces, normalise loudness (EBU R128)
//   4. final   cross-fade the pieces (xfade), composite the captions on top, add the audio
// Video and audio are cross-faded with the same durations at the same joins, so they stay locked.
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const camera = require('./camera');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'guide.mp4';
const T = JSON.parse(fs.readFileSync('segments.json', 'utf8'));
if (T.dry) { console.error('segments.json comes from a dry pass (no video). Run the scenario again without VG_DRY.'); process.exit(1); }
const FPS = Number(opt('--fps', 50)); // 2 x the 25 fps recording: page frames repeat evenly, camera and fades get 50 real steps a second
const VW = T.viewport.width; const VH = T.viewport.height;
const die = (msg) => { console.error('ERROR: ' + msg); process.exit(1); };
const warn = (...a) => console.warn('WARNING:', ...a);
const SIZE = String(opt('--size', `${VW}x${VH}`));
const [OW, OH] = SIZE.split('x').map(Number);
// The picture is scaled straight to --size: a different aspect ratio would stretch it.
if (!/^\d+x\d+$/.test(SIZE) || OW < 2 || OH < 2) die(`--size must look like 1920x1080 (got "${SIZE}")`);
if (OW % 2 || OH % 2) die(`--size ${SIZE}: width and height must be even numbers (H.264 needs that)`);
if (Math.abs(OW * VH - OH * VW) > Math.max(OW, VW)) { // more than about a pixel off
  const h = Math.round((OW * VH) / VW / 2) * 2;
  die(`--size ${SIZE} is not the shape of the recording (${VW}x${VH}): the picture would be stretched. Use --size ${OW}x${h}, or record with a viewport of the shape you want (recorderKit({ viewport: { width, height } })).`);
}
const XF_ASKED = Number(opt('--xfade', (T.xfade || 500) / 1000));
if (!(XF_ASKED >= 0)) die(`--xfade must be a number of seconds, 0 or more (got "${opt('--xfade')}")`);
// A join is always at least one frame long: xfade/acrossfade cannot do a zero-length fade, and
// treating 0 as "one frame" keeps the video and audio graphs identical, so their lengths match.
const XF = Math.max(XF_ASKED, 1 / FPS);
const ZOOM = !flag('--no-zoom');
const TRANSITION = opt('--transition', 'fade');
const ROOM = !flag('--no-room');
const ROOM_DB = Number(opt('--room-db', -60));
if (ROOM && !(ROOM_DB <= -30)) die(`--room-db must be -30 or lower (got "${opt('--room-db')}"): room tone is meant to be barely audible`);

const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (f, entries) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', f]).toString().trim();
const q = (n) => Number(n.toFixed(3));
// A filter graph in a file: "-/filter_complex file" exists from ffmpeg 7.1; before that it was
// "-filter_complex_script file" (removed in 8). A build whose version cannot be read (git
// snapshots) is taken as recent.
function graphFlag(versionLine) {
  const m = /ffmpeg version n?(\d+)\.(\d+)/.exec(versionLine || '');
  return m && (Number(m[1]) < 7 || (Number(m[1]) === 7 && Number(m[2]) < 1)) ? '-filter_complex_script' : '-/filter_complex';
}
const FC = graphFlag(execFileSync('ffmpeg', ['-version']).toString().split('\n')[0]);
fs.rmSync('cut', { recursive: true, force: true });
fs.mkdirSync('cut');

// ---- 1. clock -----------------------------------------------------------------------------
// Playwright starts a recording some time after the page opens, and the delay changes on every
// run. The recorder flashes the page magenta at times it wrote down; finding those flashes in the
// file gives the exact conversion. Without this, zoom and voice drift by up to a second.
function clock(name) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', T.videos[name], '-vf', 'crop=iw/2:ih/2,scale=2:2:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const fps = 25; const runs = [];
  for (let i = 0; i < raw.length / 12; i++) {
    const [r, g, b] = raw.subarray(i * 12, i * 12 + 3);
    const hit = r > 150 && g < 100 && b > 150;
    if (hit && runs.length && runs[runs.length - 1].to === i - 1) runs[runs.length - 1].to = i;
    else if (hit) runs.push({ from: i, to: i });
  }
  const seen = runs.filter((r) => r.to - r.from >= 2).map((r) => (r.from * 1000) / fps);
  const marks = (T.marks || []).filter((m) => m.page === name).map((m) => m.t);
  const total = (raw.length / 12 / fps) * 1000;
  const segs = T.segments.filter((s) => s.page === name);
  const r = pairMarks(seen, marks, total, segs);
  const list = (a) => a.map((m) => (m / 1000).toFixed(2)).join(', ') || 'none';
  if (r.error) die(`clock marks of the "${name}" recording: ${r.error}\n  logged by the recorder at ${list(marks)} s (its clock); found in the file at ${list(seen)} s (the file is ${(total / 1000).toFixed(2)} s long).\n  Without a sure pairing the zoom, the captions and the voice would be out of step with the picture. Record again.`);
  if (r.warning) warn(`"${name}" recording: ${r.warning}`);
  console.log(`clock "${name}": the recording starts ${(-r.off / 1000).toFixed(2)} s after the page opened (${seen.length} of ${marks.length} marks found)`);
  return (t) => t + r.off;
}
// Which flash in the file is which logged mark? Never by position in the list: a recording can
// lose its first mark (it started late) or its last one (it was cut short), and pairing "last with
// last" then shifts everything by the whole length of the video. Every pairing (one flash = one
// mark) is tried, and one is kept only if the whole picture fits it: every other logged mark is
// also found, or falls where the file has no room for it; and every piece to cut lies inside the file.
function pairMarks(seen, marks, total, segs, tol = 120) {
  if (!marks.length) return { off: 0, warning: 'the scenario logged no clock mark (pages must be opened with kit.openPage): timing is approximate' };
  if (!seen.length) return { error: 'no magenta mark was found in the file' };
  const fits = [];
  for (const s of seen) for (const m of marks) {
    const off = s - m;
    if (fits.some((f) => Math.abs(f.off - off) <= tol)) continue;
    const hit = marks.filter((x) => seen.some((y) => Math.abs(y - (x + off)) <= tol));
    const lost = marks.filter((x) => !hit.includes(x));
    // a lost mark is acceptable only at an edge of the file (the flash lasts 240 ms and needs 3 frames)
    const explained = lost.every((x) => x + off < 150 || x + off > total - 350);
    const inside = segs.every((g) => g.from + off >= -tol && g.to + off <= total + tol);
    if (!explained || !inside) continue;
    // The offset is read from the LAST mark that was found. The first one is often the very first
    // frame of the file (the recording started while the page was already magenta), so its real
    // start is unknown by a frame or two; a later mark is seen from its first frame.
    const lastHit = hit[hit.length - 1];
    const at = seen.reduce((a, y) => (Math.abs(y - (lastHit + off)) < Math.abs(a - (lastHit + off)) ? y : a));
    fits.push({ off: at - lastHit, hit: hit.length, lost: lost.length, edge: at < 1000 / 25 });
  }
  if (!fits.length) return { error: `${seen.length} found for ${marks.length} logged, and no pairing fits (a mark is missing from the middle of the file, or the pieces to cut fall outside it)` };
  fits.sort((a, b) => b.hit - a.hit);
  if (fits.length > 1 && fits[1].hit === fits[0].hit) return { error: `${seen.length} found for ${marks.length} logged, and more than one pairing fits` };
  const f = fits[0];
  const stray = seen.length - f.hit;
  const notes = [];
  if (f.lost) notes.push(`${f.lost} of the ${marks.length} clock marks is not in the file (it starts late or was cut short); the timing is taken from the other${f.edge ? ', which is the first frame of the file, so it can be a frame or two off' : ''}`);
  if (stray > 0) notes.push(`${stray} magenta flash(es) in the file are not clock marks and were ignored`);
  return { off: f.off, warning: notes.join('; ') || undefined };
}
const toVideo = {};
for (const name of Object.keys(T.videos)) toVideo[name] = clock(name);
if (ZOOM && (T.cam || []).length) for (const [name, sc] of Object.entries(T.scale || {})) {
  if (sc === 1) warn(`"${name}" was recorded at 1x (browser started with chromium.launch instead of kit.launch): zoomed parts will look soft`);
}

// ---- 2. pieces ----------------------------------------------------------------------------
const frames = (ms) => Math.max(1, Math.round((ms * FPS) / 1000));
const pieces = T.segments.map((s, i) => {
  const from = toVideo[s.page](s.from); const to = toVideo[s.page](s.to);
  return { ...s, i, from, to, n: frames(to - from), file: `cut/p${String(i).padStart(2, '0')}.mp4` };
}).filter((p) => p.to - p.from > 200);
if (!pieces.length) { console.error('no pieces: did the scenario call kit.segStart()?'); process.exit(1); }
for (const p of pieces) {
  p.d = p.n / FPS;
  const S = Number(probe(T.videos[p.page], 'stream=width')) / VW;
  const ev = ZOOM ? T.cam.filter((e) => e.page === p.page).map((e) => ({ ...e, t: (toVideo[p.page](e.t) - p.from) / 1000 })).filter((e) => e.t >= 0 && e.t <= p.d).sort((a, b) => a.t - b.t) : [];
  const plan = camera.plan(ev, { W: VW, H: VH, end: p.d });
  p.plan = plan;
  p.zoomed = plan.moves.length > 0;
  const head = `[0:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=1`;
  let graph = `${head},scale=${OW}:${OH}:flags=lanczos,format=yuv420p[v]`;
  if (p.zoomed) {
    // gbrp: no chroma subsampling, so the window can sit on any pixel (yuv420 would snap to even ones and shimmer)
    const e = camera.expr(plan, S);
    graph = `${head},format=gbrp,zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=1:s=${OW}x${OH}:fps=${FPS},format=yuv420p[v]`;
  }
  fs.writeFileSync('cut/piece.txt', graph);
  ff(['-ss', (p.from / 1000).toFixed(3), '-i', T.videos[p.page], FC, 'cut/piece.txt', '-map', '[v]', '-frames:v', String(p.n),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-an', p.file]);
}
// Where each piece starts in the final video. A join eats `x` seconds: the two pieces overlap there.
pieces.forEach((p, k) => {
  const prev = pieces[k - 1];
  p.x = k ? Math.max(1, Math.round(Math.min(XF, prev.d / 2.5, p.d / 2.5) * FPS)) / FPS : 0;
  p.at = k ? prev.at + prev.d - p.x : 0;
});
const last = pieces[pieces.length - 1];
const TOTAL = last.at + last.d;
const place = (page, t) => { // our clock -> seconds in the final video
  const v = toVideo[page](t);
  const p = pieces.find((c) => c.page === page && v >= c.from - 1 && v <= c.to + 1);
  return p ? { p, local: Math.max(0, (v - p.from) / 1000) } : null;
};

// ---- 3. voice -----------------------------------------------------------------------------
const hasVoice = fs.existsSync('cues.json') && fs.existsSync('voice/manifest.json') && JSON.parse(fs.readFileSync('cues.json', 'utf8')).length > 0;
const timeline = { fps: FPS, total: q(TOTAL), pieces: pieces.map((p) => ({ page: p.page, at: q(p.at), d: q(p.d), xfade: p.x, zoomed: p.zoomed })), lines: [] };
if (hasVoice) {
  const manifest = JSON.parse(fs.readFileSync('voice/manifest.json', 'utf8'));
  const inputs = []; const g = []; let k = 0;
  pieces.forEach((p) => { p.clips = []; });
  for (const c of JSON.parse(fs.readFileSync('cues.json', 'utf8'))) {
    const w = place(c.page, c.t); const m = manifest[c.line];
    if (!w || !m) { warn('line outside every piece, skipped:', c.line.slice(0, 50)); continue; }
    const len = m.ms / 1000; const end = w.local + len;
    if (end > w.p.d - 0.05) warn(`line runs past the end of its piece and is cut: "${c.line.slice(0, 50)}"`);
    const prevLine = timeline.lines[timeline.lines.length - 1];
    if (prevLine && w.p.at + w.local < prevLine.end) warn(`line starts before the previous one ended: "${c.line.slice(0, 50)}"`);
    timeline.lines.push({ start: q(w.p.at + w.local), end: q(w.p.at + end), line: c.line });
    inputs.push('-i', m.file);
    // Every clip gets a short fade at both ends (no click where an mp3 starts or stops mid-wave).
    const ms = Math.round(w.local * 1000);
    g.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.02,afade=t=out:st=${q(Math.max(0, len - 0.09))}:d=0.09,adelay=${ms}|${ms}[c${k}]`);
    w.p.clips.push(`[c${k}]`); k += 1;
  }
  // One audio track per piece, exactly as long as its video, then the same cross-fades as the video.
  pieces.forEach((p, i) => {
    g.push(`anullsrc=r=48000:cl=stereo,atrim=0:${q(p.d)}[b${i}]`);
    g.push(p.clips.length ? `[b${i}]${p.clips.join('')}amix=inputs=${p.clips.length + 1}:normalize=0:duration=first:dropout_transition=0[p${i}]` : `[b${i}]anull[p${i}]`);
  });
  let cur = '[p0]';
  pieces.slice(1).forEach((p, j) => { g.push(`${cur}[p${j + 1}]acrossfade=d=${p.x}:c1=tri:c2=tri[m${j + 1}]`); cur = `[m${j + 1}]`; });
  g.push(`${cur}atrim=0:${q(TOTAL)},afade=t=in:d=0.3,afade=t=out:st=${q(TOTAL - 0.6)}:d=0.6[a]`);
  fs.writeFileSync('cut/voice.txt', g.join(';\n'));
  ff([...inputs, FC, 'cut/voice.txt', '-map', '[a]', '-c:a', 'pcm_s16le', 'cut/voice.wav']);

  // Loudness, two passes: measure, then one fixed gain (linear) to -16 LUFS. A single pass would
  // "ride" the level and pump the breaths between sentences.
  const target = 'I=-16:TP=-1.5:LRA=11';
  const m1 = spawnSync('ffmpeg', ['-hide_banner', '-i', 'cut/voice.wav', '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const j = JSON.parse(m1.slice(m1.lastIndexOf('{'), m1.lastIndexOf('}') + 1));
  timeline.loudness = { before_lufs: j.input_i, before_true_peak: j.input_tp };
  // Pure silence (stub clips) measures as -inf: there is nothing to normalise.
  const af = Number.isFinite(Number(j.input_i))
    ? `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`
    : 'anull';
  // Room tone: brown noise, band-limited, two unrelated channels, fixed seeds (the same input
  // gives the same file). Filtered like this, amplitude 1 measures -15.7 dBFS RMS, hence the gain.
  // It is added AFTER the loudness gain, so its level is exactly --room-db whatever the voice needed.
  const noise = (seed) => `anoisesrc=color=brown:amplitude=1:seed=${seed}:r=48000:d=${q(TOTAL + 1)}`;
  const room = ROOM
    ? `${noise(7)}[n1];${noise(11)}[n2];[n1][n2]join=inputs=2:channel_layout=stereo,highpass=f=80,lowpass=f=6000,volume=${q(ROOM_DB + 15.7)}dB,afade=t=in:d=0.3,afade=t=out:st=${q(TOTAL - 0.6)}:d=0.6[room]` : '';
  const music = opt('--music');
  // loudnorm leaves timestamps that run a few hundredths of a second ahead of its samples, and a
  // cut made on them comes out short. The samples are re-stamped (asetpts), everything is made a
  // little too long, and the mix is cut to the exact length of the picture at the very end.
  const g2 = [`[0:a]${af},asetpts=N/SR/TB,apad=whole_dur=${q(TOTAL + 0.5)}${music ? ',asplit[v1][v2]' : '[v2]'}`];
  const mix = ['[v2]'];
  if (music) {
    // Optional bed (your own, licensed file): looped, very quiet, and ducked further while the voice speaks.
    g2.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${opt('--music-db', '-30')}dB,afade=t=in:d=1.5,afade=t=out:st=${q(TOTAL - 2)}:d=2[m]`, '[m][v1]sidechaincompress=threshold=0.02:ratio=6:attack=60:release=600[d]');
    mix.push('[d]');
  }
  if (ROOM) { g2.push(room); mix.push('[room]'); }
  g2.push(mix.length > 1 ? `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,atrim=0:${q(TOTAL)}[a]` : `[v2]atrim=0:${q(TOTAL)}[a]`);
  fs.writeFileSync('cut/audio.txt', g2.join(';\n'));
  ff(['-i', 'cut/voice.wav', ...(music ? ['-stream_loop', '-1', '-i', music] : []), FC, 'cut/audio.txt', '-map', '[a]', '-c:a', 'pcm_s16le', 'cut/audio.wav']);
  timeline.room_db = ROOM ? ROOM_DB : null;
}

// ---- 4. final -----------------------------------------------------------------------------
const inputs = []; const g = [];
pieces.forEach((p, i) => { inputs.push('-i', p.file); g.push(`[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p[v${i}]`); });
let cur = '[v0]';
pieces.slice(1).forEach((p, j) => { g.push(`${cur}[v${j + 1}]xfade=transition=${TRANSITION}:duration=${p.x}:offset=${q(p.at)}[x${j + 1}]`); cur = `[x${j + 1}]`; });
// Captions: composited after the zoom, at their own size. Fade plus a short slide on the way in,
// fade plus a smaller slide on the way out.
//
// Top or bottom. A caption sits at the bottom unless it would cover what it talks about: the
// target rectangle the recorder logged is followed through the camera move (so this is decided on
// the picture the viewer sees, zoomed or not), and if the bar would overlap it at the bottom, and
// overlaps it less at the top, the caption goes to the top. The side is chosen once for the whole
// life of the caption: it fades in and out where it is, it never jumps while on screen.
const capScale = OW / (VW * 2); // the PNGs were rendered at 2x the page size
const K = OW / VW;              // output pixels per page pixel
const PAD = { top: 20, side: 52, bottom: 52 }; // transparent margins of the PNG (2x pixels), see renderCap
const TOP_Y = Math.round(16 * K);              // bar 26 page px from the top edge, as it is from the bottom one
const pngSize = (f) => { const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
function capSide(c, a, endLocal) {
  if (!c.target) return 'bottom';
  const { w, h } = pngSize(c.file);
  const bw = (w - 2 * PAD.side) * capScale; const bh = (h - PAD.top - PAD.bottom) * capScale;
  const x0 = (OW - bw) / 2;
  const bars = { bottom: OH - PAD.bottom * capScale - bh, top: TOP_Y + PAD.top * capScale };
  const cover = { bottom: 0, top: 0 };
  const ring = 9; // the highlight ring is drawn this far outside the element
  for (let t = a.local + 0.3; t <= Math.max(a.local + 0.3, endLocal - 0.2); t += 0.1) {
    const s = camera.at(a.p.plan, t);
    const X = ((c.target.x - ring - s.cx) * s.z + VW / 2) * K; const Y = ((c.target.y - ring - s.cy) * s.z + VH / 2) * K;
    const W2 = (c.target.w + 2 * ring) * s.z * K; const H2 = (c.target.h + 2 * ring) * s.z * K;
    const ox = Math.min(X + W2, x0 + bw) - Math.max(X, x0);
    if (ox <= 0) continue;
    for (const side of ['bottom', 'top']) cover[side] = Math.max(cover[side], Math.min(Y + H2, bars[side] + bh) - Math.max(Y, bars[side]));
  }
  return cover.bottom > 2 && cover.top < cover.bottom ? 'top' : 'bottom';
}
let n = pieces.length;
const caps = (T.captions || []).map((c) => {
  const a = place(c.page, c.from); const b = place(c.page, c.to);
  if (!a) return null;
  const endLocal = Math.min(b && b.p === a.p ? b.local : Infinity, a.p.d - 0.02);
  const start = a.p.at + a.local; const end = a.p.at + endLocal;
  return end - start > 0.5 ? { start, end, file: c.file, side: capSide(c, a, endLocal) } : null;
}).filter(Boolean);
caps.forEach((c, i) => {
  const d = c.end - c.start; const fin = 0.32; const fout = 0.24;
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(q(d)), '-i', c.file);
  g.push(`[${n}:v]scale=iw*${capScale}:-1:flags=lanczos,format=rgba,fade=t=in:st=0:d=${fin}:alpha=1,fade=t=out:st=${q(d - fout)}:d=${fout}:alpha=1,setpts=PTS-STARTPTS+${q(c.start)}/TB[k${i}]`);
  // slide toward its place while fading in (16 px, ease-out cubic), 8 px back while fading out;
  // a bottom caption comes up from below, a top caption comes down from above
  const slide = `16*pow(1-clip((t-${q(c.start)})/${fin},0,1),3)+8*pow(clip((t-${q(c.end - fout)})/${fout},0,1),2)`;
  const y = c.side === 'top' ? `${TOP_Y}-(${slide})` : `H-h+${slide}`;
  g.push(`${cur}[k${i}]overlay=x=(W-w)/2:y='${y}':eof_action=pass[o${i}]`);
  cur = `[o${i}]`; n += 1;
});
timeline.captions = caps.map((c) => ({ start: q(c.start), end: q(c.end), side: c.side }));
g.push(`${cur}fade=t=in:d=0.35,fade=t=out:st=${q(TOTAL - 0.5)}:d=0.5[v]`);
fs.writeFileSync('cut/final.txt', g.join(';\n'));
const audio = hasVoice ? ['-i', 'cut/audio.wav'] : [];
ff([...inputs, ...audio, FC, 'cut/final.txt', '-map', '[v]', ...(hasVoice ? ['-map', `${n}:a`, '-c:a', 'aac', '-b:a', '160k'] : []),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(q(TOTAL)), OUT]);
fs.writeFileSync('cut/timeline.json', JSON.stringify(timeline, null, 1));
console.log(`${OUT}: ${q(TOTAL)} s, ${pieces.length} pieces, ${pieces.length - 1} ${XF_ASKED === 0 ? 'hard cuts' : 'cross-fades'}, ${pieces.filter((p) => p.zoomed).length} with camera moves, ${caps.length} captions (${caps.filter((c) => c.side === 'top').length} at the top), ${timeline.lines.length} spoken lines, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
