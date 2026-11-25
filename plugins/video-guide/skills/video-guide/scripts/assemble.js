// Cuts the per-page recordings into the final video and lays the voice-over on it.
//   node assemble.js [out.mp4]
// Reads segments.json (which part of which page video, in order) and, when present,
// cues.json + voice/manifest.json (which clip starts when). Needs ffmpeg/ffprobe on PATH.
const fs = require('fs');
const { execFileSync } = require('child_process');

const OUT = process.argv[2] || 'guida.mp4';
const { segments, videos } = JSON.parse(fs.readFileSync('segments.json', 'utf8'));
const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = (f) => Math.round(1000 * parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()));

fs.rmSync('cut', { recursive: true, force: true });
fs.mkdirSync('cut');

// 1. Cut every segment at the same frame rate and codec, so the concat needs no re-encode.
const parts = segments.map((s, i) => {
  const file = `cut/s${String(i).padStart(2, '0')}.mp4`;
  ff(['-ss', (s.from / 1000).toFixed(3), '-to', (s.to / 1000).toFixed(3), '-i', videos[s.page],
    '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', file]);
  return { ...s, file, ms: dur(file) };
});
fs.writeFileSync('cut/list.txt', parts.map((p) => `file '${p.file.replace('cut/', '')}'`).join('\n'));
const silent = 'cut/silent.mp4';
ff(['-f', 'concat', '-safe', '0', '-i', 'cut/list.txt', '-c', 'copy', silent]);

// 2. No voice: the silent cut is the result.
const voice = fs.existsSync('cues.json') && fs.existsSync('voice/manifest.json');
if (!voice) { fs.copyFileSync(silent, OUT); console.log('no voice-over;', OUT, dur(OUT), 'ms'); process.exit(0); }

// 3. Place each cue on the final timeline: start of its segment + offset inside it.
const manifest = JSON.parse(fs.readFileSync('voice/manifest.json', 'utf8'));
const cues = JSON.parse(fs.readFileSync('cues.json', 'utf8'));
let offset = 0;
const starts = parts.map((p) => { const o = offset; offset += p.ms; return o; });
const placed = [];
for (const c of cues) {
  const i = parts.findIndex((p) => p.page === c.page && c.t >= p.from && c.t <= p.to);
  if (i < 0 || !manifest[c.line]) { console.warn('cue outside every segment, skipped:', c.line.slice(0, 50)); continue; }
  placed.push({ at: starts[i] + (c.t - parts[i].from), file: manifest[c.line].file, ms: manifest[c.line].ms, line: c.line });
}
placed.sort((a, b) => a.at - b.at);
for (let k = 1; k < placed.length; k++) {
  const overlap = placed[k - 1].at + placed[k - 1].ms - placed[k].at;
  if (overlap > 150) console.warn(`overlap ${overlap} ms: "${placed[k - 1].line.slice(0, 40)}" -> "${placed[k].line.slice(0, 40)}"`);
}

// 4. Mix: every clip delayed to its start, summed without level drop, then normalised.
const inputs = ['-i', silent];
const chains = [];
placed.forEach((p, k) => {
  inputs.push('-i', p.file);
  chains.push(`[${k + 1}:a]adelay=${p.at}|${p.at},aresample=44100[a${k}]`);
});
const mix = `${placed.map((_, k) => `[a${k}]`).join('')}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[aout]`;
fs.writeFileSync('cut/filter.txt', [...chains, mix].join(';\n'));
ff([...inputs, '-/filter_complex', 'cut/filter.txt', '-map', '0:v', '-map', '[aout]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', OUT]);
console.log(`voice-over: ${placed.length} clips;`, OUT, dur(OUT), 'ms');
