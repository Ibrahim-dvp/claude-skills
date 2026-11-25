// Voice-over clips for the guide video, made with ElevenLabs text-to-speech.
//
//   node voice.js --list-voices            list the voices on the account (name, id, language labels)
//   node voice.js --voice <id> [--lines lines.json]
//        makes one mp3 per spoken line, cached by content, and writes voice/manifest.json
//        { "<line text>": { "file": "voice/<hash>.mp3", "ms": 3120 } }
//
// The API key is read from the ELEVENLABS_API_KEY environment variable or from the file
// ~/.elevenlabs-key. It is never printed. The lines come from lines.json, which record.js
// writes on a dry run (every caption and title card, HTML removed), plus narration.json
// overrides { "<caption text>": "<what to say instead>" } for pronunciation or extra words.
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

async function speak(text, voice, out) {
  const res = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`tts: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

function durationMs(file) {
  const s = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Math.round(parseFloat(s) * 1000);
}

async function build(voice) {
  const lines = JSON.parse(fs.readFileSync(arg('--lines', 'lines.json'), 'utf8'));
  const overrides = fs.existsSync('narration.json') ? JSON.parse(fs.readFileSync('narration.json', 'utf8')) : {};
  fs.mkdirSync('voice', { recursive: true });
  const manifest = {};
  let chars = 0;
  for (const line of lines) {
    const said = overrides[line] || line;
    const hash = crypto.createHash('sha1').update(`${voice}|${MODEL}|${said}`).digest('hex').slice(0, 16);
    const file = `voice/${hash}.mp3`;
    if (!fs.existsSync(file)) {
      await speak(said, voice, file);
      chars += said.length;
      console.log('made', file, said.slice(0, 60));
    }
    manifest[line] = { file, ms: durationMs(file) };
  }
  fs.writeFileSync('voice/manifest.json', JSON.stringify(manifest, null, 1));
  console.log(`manifest: ${Object.keys(manifest).length} lines, ${chars} new characters billed`);
}

(async () => {
  if (process.argv.includes('--list-voices')) return listVoices();
  const voice = arg('--voice');
  if (!voice) throw new Error('usage: node voice.js --voice <voice_id>  (or --list-voices)');
  return build(voice);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
