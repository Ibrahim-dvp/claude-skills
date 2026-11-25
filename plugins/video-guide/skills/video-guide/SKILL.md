---
name: video-guide
description: Record a Loom-style walkthrough video of a web app (moving cursor, orange highlight rings with numbers, click ripples, on-screen captions, chapter title cards, optional ElevenLabs voice-over) plus an illustrated HTML step-by-step guide built from the same run. Use when asked for a video guide, demo video, test guide, user manual with screenshots, onboarding walkthrough, or "a Loom" of an app. Non-technical audience by default.
---

# Video guide: a Loom-style walkthrough and an illustrated HTML guide

One scripted Playwright run makes both deliverables, so the video and the screenshots always show
the same thing. After the app changes, re-recording is one command.

The scripts are in `${CLAUDE_PLUGIN_ROOT}/skills/video-guide/scripts/`. Copy them into a scratch
working folder (for example `%TEMP%\claude\<name>\rec`) and never into a client folder.

## The files

| File | What it does |
|---|---|
| `recorder-kit.js` | Every helper a scenario needs: `openPage` (records a video per page), `segStart/segEnd` (which page is on screen), `setChapter`, `titleCard`, `show(page, locator, caption, {click})` (cursor, ring, caption, still, click), `say`, `typeSlow`, `finish`. It is voice-aware: with a voice manifest, every step lasts at least as long as its spoken line. |
| `overlay.js` | Injected into each page. It draws the cursor, the ring and number badge, the ripple, the caption bar and the title cards. It also **blurs list rows that are not ours** (`window.__keep = [...]`) and menu items (`window.__menuKeep`), and hides counters (`window.__hideCounts`). |
| `voice.js` | ElevenLabs text-to-speech. `--list-voices` shows the voices; `--voice <id>` makes one mp3 per spoken line, cached by content, and writes `voice/manifest.json`. |
| `assemble.js` | Cuts each page recording by `segments.json`, joins the cuts, and places each voice clip at its cue time. The output is one mp4. |
| `build-guide.js` | Builds the HTML guide from `steps.json` and a `guide.json` (texts and translations). It writes one file per language, with images embedded, and refuses to write HTML comments. |
| `example/` | `record.example.js` (a 2-chapter scenario), `login.example.js` (saves sessions), `guide.example.json`. |

## The run

0. **Setup:** `npm i playwright`, then `npx playwright install chromium`. ffmpeg and ffprobe must be
   on PATH.
1. **Accounts.** Use throwaway test accounts on **staging**, with neutral names ("Responsabile
   Demo"). Put their passwords in `../pw-<who>.txt`, one folder above the working folder. Run
   `node login.js`. **Never type a real person's password into Playwright.**
2. **Scenario.** Copy `example/record.example.js` to `record.js` and write the chapters. Captions go
   in the audience's language, with **no technical words**. Use invented customer data only.
3. **Silent run:** `node record.js`. It writes `steps.json` (stills), `segments.json`,
   `lines.json` (every spoken line) and the page videos.
4. **Voice (optional):** put the ElevenLabs key in `~/.elevenlabs-key` or `ELEVENLABS_API_KEY`;
   it is never printed. Run `node voice.js --list-voices` and choose a native voice for the
   language, then `node voice.js --voice <id>`. Add pronunciation fixes or extra words as
   `narration.json`: `{ "<caption text>": "<what to say>" }`.
5. **Voiced run:** run `node record.js` again. The steps now wait for their clips, and the run
   writes `cues.json`.
6. **Cut:** `node assemble.js guida.mp4`. An "overlap" warning means a step is too short for its
   line.
7. **Guide:** `node build-guide.js guide.json <out-prefix>`.
8. **Before anything goes out:**
   - A fresh agent reviews the stills and the guide text.
   - There must be no `<!--` in the HTML.
   - No one else's data may appear in any still.
   - The video's voice and the captions must say the same thing.

## Traps already hit

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
- **ffmpeg 8 removed `-filter_complex_script`.** `assemble.js` uses `-/filter_complex <file>`.
- **ElevenLabs:** a client-facing video needs a plan with a **commercial licence**. Check the plan.

## Hosting

The mp4 is about 3–4 MB for 4 minutes at 1280x720. That is small enough to attach to an email.
Otherwise share a Drive link.
