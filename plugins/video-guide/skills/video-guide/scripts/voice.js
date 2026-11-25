// Voice-over clips for the guide video, made with ElevenLabs text-to-speech.
//
//   node voice.js --list-voices            list the voices on the account (name, id, language labels)
//   node voice.js --voice <id> [--lines lines.json]
//        makes one mp3 per spoken line, cached, and writes voice/manifest.json
//        { "<line text>": { "file": "voice/<hash>.mp3", "ms": 3120 } }
//   node voice.js --stub                   silent clips of a realistic length, no API call and no
//                                          characters spent: use it to rehearse timing and the edit
//
// ONE continuous voice. Each request also carries the line before and the line after
// (ElevenLabs "request stitching", previous_text / next_text). The model then speaks every clip
// as the middle of a paragraph, so pitch and pace flow from one line to the next instead of
// restarting on each sentence. The cache key therefore includes both neighbours: change a line
// and its two neighbours are re-made as well, which is the price of the continuity.
//
// The API key is read from the ELEVENLABS_API_KEY environment variable or from the file
// ~/.elevenlabs-key. It is never printed. The lines come from lines.json, which the scenario
// writes (every caption and title card, HTML removed, in spoken order), plus narration.json
// overrides { "<caption text>": "<what to say instead>" } for pronunciation or extra words.
// voice/ledger.json keeps the running total of billed characters.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const API = 'https://api.elevenlabs.io/v1';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const file = path.join(os.homedir(), '.elevenlabs-key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  throw new Error('No ElevenLabs key: set ELEVENLABS_API_KEY or create ~/.elevenlabs-key');
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};

async function listVoices() {
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': apiKey() } });
  if (!res.ok) throw new Error(`voices: HTTP ${res.status}`);
  const { voices } = await res.json();
  for (const v of voices) {
    const l = v.labels || {};
    console.log([v.voice_id, v.name, l.language || '', l.accent || '', l.gender || '', l.age || '', v.category].join(' | '));
  }
}

async function speak(text, prev, next, voice, out) {
  const res = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      ...(prev ? { previous_text: prev } : {}),
      ...(next ? { next_text: next } : {}),
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`tts: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  // Written under a temporary name first: a failed download must not leave a broken clip in the cache.
  fs.writeFileSync(out + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(out + '.part', out);
}

// Rehearsal clip: silence, about as long as the line takes to say (roughly 15 characters a second).
function stub(text, out) {
  const s = (0.5 + text.length / 15).toFixed(2);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', s, '-c:a', 'libmp3lame', '-b:a', '64k', out]);
}

function durationMs(file) {
  const s = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Math.round(parseFloat(s) * 1000);
}

async function build(voice) {
  const lines = JSON.parse(fs.readFileSync(arg('--lines', 'lines.json'), 'utf8'));
  const overrides = fs.existsSync('narration.json') ? JSON.parse(fs.readFileSync('narration.json', 'utf8')) : {};
  fs.mkdirSync('voice', { recursive: true });
  const said = lines.map((l) => overrides[l] || l);
  const manifest = {};
  let chars = 0;
  for (let i = 0; i < lines.length; i++) {
    const prev = said[i - 1] || ''; const next = said[i + 1] || '';
    const hash = crypto.createHash('sha1').update([voice, MODEL, prev, said[i], next].join('|')).digest('hex').slice(0, 16);
    const file = `voice/${hash}.mp3`;
    if (!fs.existsSync(file)) {
      if (voice === 'stub') stub(said[i], file);
      else { await speak(said[i], prev, next, voice, file); chars += said[i].length; }
      console.log('made', file, said[i].slice(0, 60));
    }
    manifest[lines[i]] = { file, ms: durationMs(file) };
  }
  fs.writeFileSync('voice/manifest.json', JSON.stringify(manifest, null, 1));
  const ledgerFile = 'voice/ledger.json';
  const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : { total: 0, runs: [] };
  if (chars) { ledger.total += chars; ledger.runs.push({ at: new Date().toISOString(), chars }); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1)); }
  console.log(`manifest: ${lines.length} lines, ${chars} new characters billed (${ledger.total} in total for this folder)`);
}

(async () => {
  if (process.argv.includes('--list-voices')) return listVoices();
  const voice = process.argv.includes('--stub') ? 'stub' : arg('--voice');
  if (!voice) throw new Error('usage: node voice.js --voice <voice_id>  (or --stub, or --list-voices)');
  return build(voice);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
