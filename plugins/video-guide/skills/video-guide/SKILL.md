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
| `--fps 50` `--transition fade` | Passed to `assemble.js`. |
| `--size 1920x1080` | Output size. It must have the shape of the recording (16:9 for the default 1280x720 viewport) and even numbers; anything else is refused with the size to use instead, because it would stretch the picture. For another shape, set the kit's `viewport`. |
| `--xfade 0.5` | Seconds of cross-fade at every join. `--xfade 0` gives hard cuts. |
| `--room-db -60` `--no-room` | Room tone: very quiet filtered noise (made by ffmpeg, nothing licensed) under the whole voice track, so the gaps between lines are not dead digital silence. On by default at −60 dBFS; `--no-room` switches it off. |
| `--music bed.mp3` `--music-db -30` | A quiet bed under the voice, ducked while it speaks. **Only a file you hold a licence for.** None is shipped. |
| `--force` | Ignore the cache. |

## The files

| File | What it does |
|---|---|
| `make.js` | The one command above. |
| `recorder-kit.js` | Every helper a scenario needs: `launch` (2x capture), `openPage`, `segStart/segEnd`, `setChapter`, `titleCard`, `show(page, locator, caption, {click})`, `say`, `typeSlow`, `scroll`, `cut`, `finish`. It logs the camera targets and the captions instead of drawing them, and it is voice-aware: a step never ends before its spoken line has ended plus a breath. |
| `overlay.js` | Injected into each page. Draws what must zoom with the page: the cursor (curved, eased glide; squish on press), the ring, spotlight and number badge, the ripple, the animated title cards. It also **blurs list rows that are not ours** (`window.__keep = [...]`) and menu items (`window.__menuKeep`), and hides counters (`window.__hideCounts`); which rows and counters is set per app, see "Privacy" below. |
| `voice.js` | ElevenLabs text-to-speech. `--list-voices`; `--voice <id>` makes one mp3 per line, each generated with its neighbours as context so the lines flow as one voice; `--stub` makes silent rehearsal clips. Cached; `voice/ledger.json` counts the characters billed. |
| `assemble.js` + `camera.js` | The edit: clock sync, eased zoom and pan, cross-fades at every join, captions composited on top (at the bottom, or at the top when they would cover their target), voice laid in and normalised to −16 LUFS, room tone under it. |
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
  `viewport`, `locale`, `chapterWord`, `privacy` (see below).
- **Captions.** A caption sits at the bottom. When the element it describes ends up under the bar
  (a button low on the page), the edit puts that caption at the top instead; it fades in and out
  there and never moves while it is on screen. `say` captions have no target and stay at the bottom.
- **Joins.** Every title card and every `kit.cut` becomes a cross-fade in the edit, in the picture
  and in the sound. Use `kit.cut` for anything the viewer should not sit through.
- **Zoom.** The camera goes to each `show` target and to the field during `typeSlow`. Two steps
  less than about 1.4 s apart are joined by a pan instead of a zoom-out and zoom-in. Elements too
  big to zoom on are left wide. Title cards are never zoomed and captions are never cropped: they
  are added after the zoom.

## Privacy: what is blurred and hidden

Nothing is blurred or hidden until the scenario asks for it, with an init script on the page's
context: `window.__keep = ["Mario Prova"]` blurs every list row that contains none of these texts,
`window.__menuKeep = [...]` does the same for menu items, `window.__hideCounts = true` hides counters.

**Which elements are rows and counters depends on the app.** The defaults are the selectors of the
app this skill was first written for (links to `/tickets/c…` and `/customers/c…`, a "Notifiche"
button), so on another app set your own:

```js
const kit = require('./recorder-kit')({ overlay: 'overlay.js', privacy: {
  rows: 'a[href^="/orders/"]',      // one element per list row; the row is blurred unless it holds a __keep text
  rowBox: 'tr, li',                 // the ancestor that gets blurred (default 'tr, li'; the element itself if none)
  counts: 'nav a span, header button *', // hidden when their whole text is a number ("12", "9+")
  hide: '[data-unread]',            // always hidden
  mainNumbers: true,                // also hide any bare number of 2+ digits inside <main> (default true)
} });
```

Any key left out keeps its default; `''` or `false` switches that rule off. Always look at the
stills afterwards: a selector that matches nothing blurs nothing, and says nothing.

## The run

0. **Setup:** `npm i playwright`, then `npx playwright install chromium`. ffmpeg and ffprobe must be
   on PATH. **ffmpeg 7.1 or newer** is what this is tested with: the filter graphs are passed with
   `-/filter_complex <file>`, which older builds do not have. On an older build `assemble.js` falls
   back to `-filter_complex_script`; that path is not tested, so upgrade if it fails.
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
   means the scenario bypassed the kit's waits: fix the scenario, do not ship it. A warning that the
   page "is recorded at 1x" means the browser was started with `chromium.launch`: use `kit.launch`.
   An error about **clock marks** means the recording could not be lined up with the log (see the
   first trap): record again, do not work around it.
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
  visible part) and `assemble.js` finds them; never cut by wall-clock time alone. A recording can
  lose one mark (it started late, or was cut short). `assemble.js` works out which one is left from
  where the marks and the pieces can fit in the file, says so in a warning, and **stops with an
  error** when it cannot be sure, instead of producing a video whose captions are out of step.
- **Never take a CSS-pixel screenshot while recording.** `page.screenshot({ scale: 'css' })` drops
  the page to 1x for an instant, and the recording keeps it: one or two frames of the page shrunk
  into the top-left corner on grey. `kit.shot` takes the stills at the device scale for that
  reason. If a scenario needs its own screenshot mid-recording, leave `scale` out.
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
- **ffmpeg 8 removed `-filter_complex_script` and `-vsync`.** The scripts use `-/filter_complex <file>` (ffmpeg 7.1+) and fall back to the old flag only on older builds.
- **ElevenLabs:** a client-facing video needs a plan with a **commercial licence**. Check the plan.

## Hosting

The mp4 is about 6–8 MB for 2 minutes at 1280x720, 50 fps. That is small enough to attach to an
email. Otherwise share a Drive link.
