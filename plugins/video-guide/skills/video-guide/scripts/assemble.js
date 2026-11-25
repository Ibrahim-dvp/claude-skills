// The edit: turns the raw page recordings into the final video.
//   node assemble.js [out.mp4] [--no-zoom] [--fps 50] [--size 1280x720] [--xfade 0.5]
//                    [--transition fade] [--music bed.mp3] [--music-db -30]
//
// Reads segments.json (pieces, camera log, captions, clock marks) and, when present, cues.json +
// voice/manifest.json. Needs ffmpeg/ffprobe on PATH. Five passes, each small enough to debug:
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
const [OW, OH] = opt('--size', `${VW}x${VH}`).split('x').map(Number);
const XF = Number(opt('--xfade', (T.xfade || 500) / 1000));
const ZOOM = !flag('--no-zoom');
const TRANSITION = opt('--transition', 'fade');

const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (f, entries) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', f]).toString().trim();
const q = (n) => Number(n.toFixed(3));
const warn = (...a) => console.warn('WARNING:', ...a);
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
  const marks = T.marks.filter((m) => m.page === name).map((m) => m.t);
  if (!seen.length || !marks.length) { warn(`no clock mark found in the "${name}" recording: timing is approximate`); return (t) => t; }
  const off = seen[seen.length - 1] - marks[marks.length - 1]; // the last mark is always inside the recording
  if (seen.length >= 2 && marks.length >= 2 && Math.abs((seen[seen.length - 1] - seen[0]) - (marks[marks.length - 1] - marks[0])) > 120) warn(`the "${name}" recording drifts against the clock`);
  return (t) => t + off;
}
const toVideo = {};
for (const name of Object.keys(T.videos)) toVideo[name] = clock(name);

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
  p.zoomed = plan.moves.length > 0;
  const head = `[0:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=1`;
  let graph = `${head},scale=${OW}:${OH}:flags=lanczos,format=yuv420p[v]`;
  if (p.zoomed) {
    // gbrp: no chroma subsampling, so the window can sit on any pixel (yuv420 would snap to even ones and shimmer)
    const e = camera.expr(plan, S);
    graph = `${head},format=gbrp,zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=1:s=${OW}x${OH}:fps=${FPS},format=yuv420p[v]`;
  }
  fs.writeFileSync('cut/piece.txt', graph);
  ff(['-ss', (p.from / 1000).toFixed(3), '-i', T.videos[p.page], '-/filter_complex', 'cut/piece.txt', '-map', '[v]', '-frames:v', String(p.n),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-an', p.file]);
}
// Where each piece starts in the final video. A join eats `x` seconds: the two pieces overlap there.
pieces.forEach((p, k) => {
  const prev = pieces[k - 1];
  p.x = k ? Math.round(Math.min(XF, prev.d / 2.5, p.d / 2.5) * FPS) / FPS : 0;
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
  ff([...inputs, '-/filter_complex', 'cut/voice.txt', '-map', '[a]', '-c:a', 'pcm_s16le', 'cut/voice.wav']);

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
  const music = opt('--music');
  if (music) {
    // Optional bed (your own, licensed file): looped, very quiet, and ducked further while the voice speaks.
    fs.writeFileSync('cut/music.txt', `[0:a]${af},asplit[v1][v2];[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${opt('--music-db', '-30')}dB,afade=t=in:d=1.5,afade=t=out:st=${q(TOTAL - 2)}:d=2[m];[m][v1]sidechaincompress=threshold=0.02:ratio=6:attack=60:release=600[d];[v2][d]amix=inputs=2:normalize=0:duration=first[a]`);
    ff(['-i', 'cut/voice.wav', '-stream_loop', '-1', '-i', music, '-/filter_complex', 'cut/music.txt', '-map', '[a]', '-t', String(q(TOTAL)), '-c:a', 'pcm_s16le', 'cut/audio.wav']);
  } else ff(['-i', 'cut/voice.wav', '-af', af, '-c:a', 'pcm_s16le', 'cut/audio.wav']);
}

// ---- 4. final -----------------------------------------------------------------------------
const inputs = []; const g = [];
pieces.forEach((p, i) => { inputs.push('-i', p.file); g.push(`[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p[v${i}]`); });
let cur = '[v0]';
pieces.slice(1).forEach((p, j) => { g.push(`${cur}[v${j + 1}]xfade=transition=${TRANSITION}:duration=${p.x}:offset=${q(p.at)}[x${j + 1}]`); cur = `[x${j + 1}]`; });
// Captions: composited after the zoom, at their own size. Fade plus a short slide up on the way in,
// fade plus a smaller slide down on the way out.
const capScale = OW / (VW * 2); // the PNGs were rendered at 2x the page size
let n = pieces.length;
const caps = (T.captions || []).map((c) => {
  const a = place(c.page, c.from); const b = place(c.page, c.to);
  if (!a) return null;
  const start = a.p.at + a.local; const end = Math.min(b && b.p === a.p ? a.p.at + b.local : Infinity, a.p.at + a.p.d - 0.02);
  return end - start > 0.5 ? { start, end, file: c.file } : null;
}).filter(Boolean);
caps.forEach((c, i) => {
  const d = c.end - c.start; const fin = 0.32; const fout = 0.24;
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(q(d)), '-i', c.file);
  g.push(`[${n}:v]scale=iw*${capScale}:-1:flags=lanczos,format=rgba,fade=t=in:st=0:d=${fin}:alpha=1,fade=t=out:st=${q(d - fout)}:d=${fout}:alpha=1,setpts=PTS-STARTPTS+${q(c.start)}/TB[k${i}]`);
  // slide: 16 px up while fading in (ease-out cubic), 8 px down while fading out
  g.push(`${cur}[k${i}]overlay=x=(W-w)/2:y='H-h+16*pow(1-clip((t-${q(c.start)})/${fin},0,1),3)+8*pow(clip((t-${q(c.end - fout)})/${fout},0,1),2)':eof_action=pass[o${i}]`);
  cur = `[o${i}]`; n += 1;
});
g.push(`${cur}fade=t=in:d=0.35,fade=t=out:st=${q(TOTAL - 0.5)}:d=0.5[v]`);
fs.writeFileSync('cut/final.txt', g.join(';\n'));
const audio = hasVoice ? ['-i', 'cut/audio.wav'] : [];
ff([...inputs, ...audio, '-/filter_complex', 'cut/final.txt', '-map', '[v]', ...(hasVoice ? ['-map', `${n}:a`, '-c:a', 'aac', '-b:a', '160k'] : []),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(q(TOTAL)), OUT]);
fs.writeFileSync('cut/timeline.json', JSON.stringify(timeline, null, 1));
console.log(`${OUT}: ${q(TOTAL)} s, ${pieces.length} pieces, ${pieces.length - 1} cross-fades, ${pieces.filter((p) => p.zoomed).length} with camera moves, ${caps.length} captions, ${timeline.lines.length} spoken lines, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
