# Example: Acme Support (fictional app)

The demo video and guide in the main README were made from this folder. Acme Support and every
name in it are invented.

| File | What |
|---|---|
| `demo-app.html` | The fictional app, a single HTML file served through `page.route` (no server). |
| `record.js` | The scenario: 5 chapters written with `recorder-kit.js`. |
| `guide.json` | Texts for the HTML guide. |
| `narration.json` | Spoken text where it should differ from the caption. |
| `output/` | `video-guide-demo.mp4` (narrated, 1:45), `preview.gif`, `acme-guide_EN.html`. |

## Reproduce

```sh
cp ../../plugins/video-guide/skills/video-guide/scripts/*.js .
npm i playwright && npx playwright install chromium
node record.js                       # silent run: stills + lines.json
node build-guide.js guide.json out/acme-guide
node voice.js --voice Xb7hH8MSUJpSbSDYk0k2   # "Alice" (ElevenLabs premade); needs your own key
node record.js                       # voiced run: cues.json
node assemble.js out/video-guide-demo.mp4
node build-guide.js guide.json out/acme-guide
```
