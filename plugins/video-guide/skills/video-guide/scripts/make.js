// One command for the whole pipeline. Run it in the working folder, next to the other scripts:
//
//   node make.js --scenario record.js --guide guide.json --voice <voice id> --out out/name
//
//   dry pass   the scenario runs fast, without video, to collect the spoken lines and the stills
//   voice      voice.js makes one clip per line (ElevenLabs; "--voice stub" = silent rehearsal clips)
//   record     the scenario runs for real; every step waits for its line
//   assemble   zoom, cross-fades, captions, voice, loudness  ->  <out>.mp4
//   guide      the illustrated HTML guide                    ->  <guide-out>_XX.html
//
// Every step is cached: its inputs are hashed into .make/state.json and it runs again only when
// one of them changed (or its output is missing). Editing a caption re-does everything after the
// dry pass; editing only guide.json rebuilds only the guide; a second run with no change does nothing.
// Inputs are hashed by content, outputs only by name (an output that exists must not change the key).
//
// Options
//   --scenario <file>     the Playwright scenario (default record.js)
//   --out <prefix>        output prefix (default out/guide)  ->  <prefix>.mp4
//   --guide <file>        guide.json: also build the HTML guide
//   --guide-out <prefix>  prefix of the guide files (default <out>-guide)
//   --voice <id|stub>     narrate with this ElevenLabs voice; leave out for a silent video
//   --deps a.html,b.json  extra files the scenario reads: a change in one re-records
//   --no-zoom             static camera          --no-spotlight   do not dim around the highlight
//   --fps N, --size WxH, --xfade S, --transition NAME, --music FILE, --music-db N,
//   --room-db N, --no-room   passed to assemble.js (see its header)
//   --force               ignore the cache
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const here = (f) => path.join(__dirname, f);
const scenario = opt('--scenario', 'record.js');
const out = opt('--out', 'out/guide');
const guide = opt('--guide');
const guideOut = opt('--guide-out', `${out}-guide`);
const voice = opt('--voice');
const deps = (opt('--deps', '') || '').split(',').filter(Boolean);
const pass = [
  ...['--fps', '--size', '--xfade', '--transition', '--music', '--music-db', '--room-db'].flatMap((n) => (opt(n) !== undefined ? [n, opt(n)] : [])),
  ...['--no-zoom', '--no-room'].filter(flag),
];
if (!fs.existsSync(scenario)) { console.error(`scenario not found: ${scenario}`); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(path.dirname(guideOut), { recursive: true });
fs.mkdirSync('.make', { recursive: true });

const stateFile = '.make/state.json';
const state = fs.existsSync(stateFile) && !flag('--force') ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
// A cache key. file('x') is hashed by CONTENT (an input); anything else is hashed as plain text.
// Never pass an output path through file(): the key would change the moment the output exists.
const file = (p) => ({ file: p });
const hash = (...parts) => {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(p && p.file !== undefined ? (fs.existsSync(p.file) ? fs.readFileSync(p.file) : 'missing') : String(p)).update('|');
  return h.digest('hex').slice(0, 16);
};
const run = (label, file, args = [], env = {}) => {
  console.log(`\n== ${label}`);
  const t = Date.now();
  const r = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(`${label} failed`); process.exit(r.status || 1); }
  console.log(`   ${((Date.now() - t) / 1000).toFixed(0)} s`);
};
// Runs `fn` unless this step already ran with the same key and its outputs are still there.
const step = (name, key, outputs, fn) => {
  if (state[name] === key && outputs.every((f) => fs.existsSync(f))) { console.log(`== ${name}: up to date`); return; }
  fn();
  state[name] = key;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
};

const looks = { VG_ZOOM: flag('--no-zoom') ? '0' : '1', VG_SPOTLIGHT: flag('--no-spotlight') ? '0' : '1' };
const base = hash(file(scenario), file(here('recorder-kit.js')), file(here('overlay.js')), ...deps.map(file), JSON.stringify(looks));
const guideKey = () => hash(file(guide), file(here('build-guide.js')), file('steps.json'));
const buildGuide = (label) => run(label, here('build-guide.js'), [guide, guideOut]);

let voiceKey = 'silent';
if (voice) {
  step('dry pass', base, ['lines.json', 'steps.json'], () => {
    run('dry pass (no video: collects the lines and the stills)', scenario, [], { ...looks, VG_DRY: '1' });
    // A first guide from the dry stills, in case the scenario shows the guide itself on screen.
    if (guide) buildGuide('guide (draft)');
  });
  // voice.js has its own per-line cache, so it always runs: no call is made for a clip that exists.
  run('voice', here('voice.js'), voice === 'stub' ? ['--stub'] : ['--voice', voice]);
  voiceKey = hash(file('voice/manifest.json'));
}
const recKey = hash(base, voiceKey);
step('record', recKey, ['segments.json', 'steps.json'], () => {
  run(voice ? 'record (voiced: every step waits for its line)' : 'record', scenario, [], { ...looks, VG_DRY: '0', VG_VOICE: voice ? '1' : '0' });
  const t = JSON.parse(fs.readFileSync('segments.json', 'utf8'));
  for (const v of Object.values(t.videos)) if (!fs.existsSync(v)) { console.error(`recording missing: ${v}`); process.exit(1); }
});
const mp4 = `${out}.mp4`;
step('assemble', hash(recKey, file(here('assemble.js')), file(here('camera.js')), JSON.stringify(pass), mp4), [mp4], () => {
  run('assemble', here('assemble.js'), [mp4, ...pass]);
});
if (guide) {
  const files = JSON.parse(fs.readFileSync(guide, 'utf8')).languages.map((l) => `${guideOut}_${l.toUpperCase()}.html`);
  step('guide', hash(recKey, guideKey(), guideOut), files, () => buildGuide('guide'));
}
console.log(`\ndone: ${mp4}${guide ? `, ${guideOut}_*.html` : ''}`);
