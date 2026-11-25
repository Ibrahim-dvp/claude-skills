# claude-skills

Skills for [Claude Code](https://claude.com/claude-code), packaged as a plugin marketplace you can install in two commands.

## 🎬 video-guide: Loom-style video guides, recorded by Claude

Ask Claude *"make a video guide of our app"*. It writes a Playwright scenario, records the app, and gives you back **two deliverables from the same run**:

1. **A walkthrough video** that looks screen-recorded by a person:
   - a moving cursor that glides to each target;
   - an orange highlight ring with a step number;
   - a click ripple;
   - a caption bar explaining each step;
   - full-screen chapter title cards;
   - optional **AI voice-over** ([ElevenLabs](https://elevenlabs.io)), timed so each step waits for its sentence to finish.
2. **An illustrated step-by-step guide.** It is a single HTML file with every screenshot embedded and the click target circled and numbered, ready to email. It can come in several languages from one recording.

Because both come from one script, **the video and the screenshots always show the same thing**. When the app changes, you re-record with one command instead of re-shooting by hand.

### What makes it practical for real projects

- **Privacy on shared test servers.** Rows and menu items that don't belong to your demo data are blurred, and counters can be hidden.
- **No passwords during recording.** Test accounts sign in once and the session is reused. This also avoids sign-in rate limits.
- **The voice is cached per sentence**, so re-recording after a UI change costs no new characters.
- **No hidden notes in client deliverables.** The guide builder refuses to write HTML comments.
- **Traps already solved** are written into the skill: embedded widgets blocked by origin checks, AI answers with variable timing, buttons with no accessible name, ffmpeg 8 flag changes, and more.

### Install

In Claude Code:

```
/plugin marketplace add Ibrahim-dvp/claude-skills
/plugin install video-guide@ibrahim-skills
```

Or from a terminal:

```sh
claude plugin marketplace add Ibrahim-dvp/claude-skills
claude plugin install video-guide@ibrahim-skills
```

Update later with `/plugin marketplace update ibrahim-skills`.

### Requirements

- Node.js 18+, then `npm i playwright` and `npx playwright install chromium` in your working folder
- `ffmpeg` and `ffprobe` on your PATH
- Optional, for the voice-over: an ElevenLabs API key in `~/.elevenlabs-key` or `ELEVENLABS_API_KEY`. For anything you publish or give to a client, use a plan whose licence allows commercial use.

### How it works

```
record.js ──▶ page videos + segments.json   (which page is on screen when)
          ──▶ shots/*.png + steps.json      (stills + captions for the guide)
          ──▶ lines.json                    (every spoken line)
voice.js  ──▶ voice/*.mp3 + manifest.json   (one clip per line, cached)
record.js ──▶ cues.json                     (second run: steps now wait for their clip)
assemble.js ─▶ final.mp4                    (cut, join, lay each clip at its cue)
build-guide.js ▶ guide_IT.html, guide_EN.html …
```

| Script | Role |
|---|---|
| `recorder-kit.js` | `show(page, locator, caption, { click })` moves the cursor, rings the element, captions it, takes a still and clicks. Also `titleCard`, `say`, `typeSlow`, chapters and segments. |
| `overlay.js` | Injected into each page. Draws the cursor, ring, badge, ripple, captions and title cards, and blurs data that isn't part of the demo. |
| `voice.js` | ElevenLabs text-to-speech: `--list-voices`, then `--voice <id>`. |
| `assemble.js` | ffmpeg cut, concat and voice mix, with loudness normalised. |
| `build-guide.js` | The HTML guide in any number of languages, built from `guide.json`. |
| `example/` | A two-chapter scenario, a session-saving login script, and a guide config. |

Full instructions, the recording checklist and the known traps are in [`SKILL.md`](plugins/video-guide/skills/video-guide/SKILL.md).

## Contributing

Issues and pull requests are welcome. To add a skill:

1. Create `plugins/<name>/.claude-plugin/plugin.json` and `plugins/<name>/skills/<name>/SKILL.md`.
2. Register it in `.claude-plugin/marketplace.json`.
3. Bump `version` in `plugin.json` on every change, so installed copies get the update.

## License

[MIT](LICENSE) © Ibrahim Bensaadoune
