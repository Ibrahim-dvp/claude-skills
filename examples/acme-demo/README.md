# Example: Acme Support (fictional app)

The demo video and guide in the main README were made from this folder. Acme Support and every
name in it are invented.

| File | What |
|---|---|
| `demo-app.html` | The fictional app, a single HTML file served through `page.route` (no server). |
| `record.js` | The scenario: 5 chapters written with `recorder-kit.js`. |
| `guide.json` | Texts for the HTML guide. |
| `narration.json` | Spoken text where it should differ from the caption. |
| `output/` | `video-guide-demo.mp4` (narrated, 1:51, 1280x720 at 50 fps), `preview.gif`, `acme-guide_EN.html`. |

## Reproduce

```sh
cp ../../plugins/video-guide/skills/video-guide/scripts/*.js .
npm i playwright && npx playwright install chromium

# Rehearsal: silent clips, no ElevenLabs key needed, no characters spent
node make.js --scenario record.js --guide guide.json --guide-out out/acme-guide \
             --deps demo-app.html --voice stub --out out/video-guide-demo

# The real thing: "Alice" (ElevenLabs premade voice); needs your own key, about 900 characters
node make.js --scenario record.js --guide guide.json --guide-out out/acme-guide \
             --deps demo-app.html --voice Xb7hH8MSUJpSbSDYk0k2 --out out/video-guide-demo
```

Run the same command again and nothing is redone. Change a caption in `record.js` and only the
steps that depend on it run again.

The preview GIF is a 14-second cut of the video:

```sh
ffmpeg -ss 11.6 -t 14 -i out/video-guide-demo.mp4 -filter_complex \
  "fps=15,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  out/preview.gif
```
