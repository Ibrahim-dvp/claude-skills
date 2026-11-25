---
name: video-guide
description: Record a polished product walkthrough video of a web app, in the style of Screen Studio or Loom (eased camera zoom on each step, gliding cursor that really hovers and presses, soft highlight ring with spotlight, animated captions and chapter title cards, cross-fades, optional ElevenLabs voice-over that sounds like one continuous take) plus an illustrated HTML step-by-step guide built from the same run. Use when asked for a video guide, demo video, test guide, user manual with screenshots, onboarding walkthrough, or "a Loom" of an app. Non-technical audience by default.
---

# Video guide: a polished walkthrough video and an illustrated HTML guide

One scripted Playwright run makes both deliverables, so the video and the screenshots always show
the same thing. After the app changes, re-recording is one command.

The scripts are in `${CLAUDE_PLUGIN_ROOT}/skills/video-guide/scripts/`. Copy them into a scratch
working folder (for example `%TEMP%\claude\<name>\rec`) and never into a client folder.

## One command

```sh
node make.js --scenario record.js --guide guide.json --voice <voice id> --out out/name
```

It runs: dry pass (fast, no video: collects the lines and stills) → voice → real recording →
assemble → guide. Each step is cached on its inputs (`.make/state.json`), so a second run only
redoes what changed. Leave out `--voice` for a silent video. Use `--voice stub` to rehearse the
timing and the edit with silent clips, **before spending any ElevenLabs characters**.

| Option | Effect |
|---|---|
| `--no-zoom` | Static camera (no zoom or pan). |
| `--no-spotlight` | Do not dim the screen around the highlighted element. |
| `--deps a.html,b.json` | Extra files the scenario reads; a change in one re-records. |
| `--guide-out <prefix>` | Where the guide goes (default `<out>-guide`). |
| `--fps 50` `--size 1920x1080` `--xfade 0.5` `--transition fade` | Passed to `assemble.js`. |
| `--music bed.mp3` `--music-db -30` | A quiet bed under the voice, ducked while it speaks. **Only a file you hold a licence for.** None is shipped. |
| `--force` | Ignore the cache. |

## The files

| File | What it does |
|---|---|
| `make.js` | The one command above. |
| `recorder-kit.js` | Every helper a scenario needs: `launch` (2x capture), `openPage`, `segStart/segEnd`, `setChapter`, `titleCard`, `show(page, locator, caption, {click})`, `say`, `typeSlow`, `scroll`, `cut`, `finish`. It logs the camera targets and the captions instead of drawing them, and it is voice-aware: a step never ends before its spoken line has ended plus a breath. |
| `overlay.js` | Injected into each page. Draws what must zoom with the page: the cursor (curved, eased glide; squish on press), the ring, spotlight and number badge, the ripple, the animated title cards. It also **blurs list rows that are not ours** (`window.__keep = [...]`) and menu items (`window.__menuKeep`), and hides counters (`window.__hideCounts`). |
| `voice.js` | ElevenLabs text-to-speech. `--list-voices`; `--voice <id>` makes one mp3 per line, each generated with its neighbours as context so the lines flow as one voice; `--stub` makes silent rehearsal clips. Cached; `voice/ledger.json` counts the characters billed. |
| `assemble.js` + `camera.js` | The edit: clock sync, eased zoom and pan, cross-fades at every join, captions composited on top, voice laid in and normalised to −16 LUFS. |
| `build-guide.js` | Builds the HTML guide from `steps.json` and a `guide.json` (texts and translations). One file per language, images embedded, and it refuses to write HTML comments. |
| `example/` | `record.example.js` (a 2-chapter scenario), `login.example.js` (saves sessions), `guide.example.json`. |

## Writing the scenario

```js
const kit = require('./recorder-kit')({ overlay: 'overlay.js', locale: 'en-US', chapterWord: 'Chapter' });
const browser = await kit.launch(chromium);          // not chromium.launch(): this one records at 2x
const app = await kit.openPage(browser, 'app', { storageState: '../state-admin.json' });
await app.goto(BASE + '/dashboard');
kit.segStart('app');                                 // on screen from here
await kit.titleCard(app, '1. The dashboard', 'What you see first');
await kit.show(app, app.getByRole('link', { name: 'Tickets' }), 'Everything is under <b>Tickets</b>.', { click: true });
await kit.typeSlow(app.getByPlaceholder('Search'), 'password');
await kit.cut(app, () => app.goto(BASE + '/settings'));   // a page load, hidden behind a cross-fade
await kit.finish();
```

- **`show` options:** `click`, `still` (take a guide screenshot, default true), `hold` (ms),
  `badge` (step number), `zoom` (`false` = stay wide for this step, or a number = how far in),
  `spotlight` (`false` = no dimming for this step), `ring` (a larger locator to frame, for example
  the whole settings row, while the cursor clicks the small switch inside it).
- **Kit options:** `zoom`, `maxZoom` (1.5), `spotlight`, `accent` (`#rrggbb`), `xfade` (ms),
  `viewport`, `locale`, `chapterWord`.
- **Joins.** Every title card and every `kit.cut` becomes a cross-fade in the edit, in the picture
  and in the sound. Use `kit.cut` for anything the viewer should not sit through.
- **Zoom.** The camera goes to each `show` target and to the field during `typeSlow`. Two steps
  less than about 1.4 s apart are joined by a pan instead of a zoom-out and zoom-in. Elements too
  big to zoom on are left wide. Title cards are never zoomed and captions are never cropped: they
  are added after the zoom.

## The run

0. **Setup:** `npm i playwright`, then `npx playwright install chromium`. ffmpeg and ffprobe must be
   on PATH.
1. **Accounts.** Use throwaway test accounts on **staging**, with neutral names ("Responsabile
   Demo"). Put their passwords in `../pw-<who>.txt`, one folder above the working folder. Run
   `node login.js`. **Never type a real person's password into Playwright.**
2. **Scenario.** Copy `example/record.example.js` to `record.js` and write the chapters. Captions go
   in the audience's language, with **no technical words**. Use invented customer data only.
3. **Rehearse for free:** `node make.js --scenario record.js --voice stub --out out/draft`. Watch
   it, fix the wording and the pacing. Add pronunciation fixes or extra words as `narration.json`:
   `{ "<caption text>": "<what to say>" }`.
4. **Voice:** put the ElevenLabs key in `~/.elevenlabs-key` or `ELEVENLABS_API_KEY`; it is never
   printed. Run `node voice.js --list-voices` and choose a native voice for the language.
5. **Make it:** `node make.js --scenario record.js --guide guide.json --voice <id> --out out/name`.
   A warning that a line "runs past the end of its piece" or "starts before the previous one ended"
   means the scenario bypassed the kit's waits: fix the scenario, do not ship it.
6. **Before anything goes out:**
   - Extract frames at a few zooms and joins (`ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png`) and look at them.
   - `cut/timeline.json` lists when every spoken line starts and ends: check that none overlaps.
   - A fresh agent reviews the stills and the guide text.
   - There must be no `<!--` in the HTML.
   - No one else's data may appear in any still.
   - The video's voice and the captions must say the same thing.

The steps can still be run one at a time: `VG_DRY=1 node record.js`, `node voice.js --voice <id>`,
`node record.js`, `node assemble.js out.mp4`, `node build-guide.js guide.json <out-prefix>`.

## Traps already hit

- **The recording's clock is not yours.** Playwright starts a page video up to a second or two after
  the page opens, differently on every run. The kit flashes two magenta marks (before and after the
  visible part) and `assemble.js` finds them; never cut by wall-clock time alone.
- **Playwright records CSS pixels.** `deviceScaleFactor: 2` alone gives a 1x picture in a corner of a
  2x frame. Only `--force-device-scale-factor=2` on the browser gives real 2x: use `kit.launch`.
- **A changed line re-makes its two neighbours** (they were generated with it as context). Freeze the
  wording with `--voice stub` first.
- **The same caption text twice** shares one clip, generated with the neighbours of its first use.
- **The sign-in rate limit.** A recording signs in many times. Use the saved `storageState`; in a
  "how to sign in" scene, type only the email.
- **Saved sessions expire.** Run `login.js` again right before every recording. A stale session
  lands on the login page, and the run dies 30 s later on the first missing element.
- **An embedded widget on a foreign page is blocked** by its origin allowlist. Serve the fake
  "your website" page *under the app's own origin* with `page.route(BASE + '/fake-path', r => r.fulfill({ body: html }))`.
- **Buttons with no accessible name:** use `locator('button', { hasText })`, not `getByRole`.
- **AI answers take a variable time.** Wait for an expected text (`getByText(regex).waitFor({ timeout: 120000 })`), never a fixed sleep.
- **Closed or archived items vanish from lists.** Order the chapters so that nothing needed later
  is closed earlier.
- **`getByText('Dettagli')` also matches "Dettaglio".** Use `{ exact: true }`.
- **Accents and `…` get mangled through `python -c` or stdin.** Edit the scripts with the editor tool.
- **ffmpeg 8 removed `-filter_complex_script` and `-vsync`.** The scripts use `-/filter_complex <file>`.
- **ElevenLabs:** a client-facing video needs a plan with a **commercial licence**. Check the plan.

## Hosting

The mp4 is about 5–7 MB for 2 minutes at 1280x720, 50 fps. That is small enough to attach to an
email. Otherwise share a Drive link.
