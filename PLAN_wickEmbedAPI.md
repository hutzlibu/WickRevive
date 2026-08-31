# PLAN — Wick Editor embed API: host-owned documents

A work order for the **Wick Editor** repo. Self-contained: everything needed to
execute it is below.

Written 2026-08-29. **Executed 2026-08-30 on top of `5680a568`** ("Record the
Phase 0 split in the refactor plan"). §2 and §5 were re-verified against that
commit first and were still accurate as written.

**Status: R1–R4, R6 and R7 are implemented and verified; R5 is deliberately not
built** (see below). The changes are in the working tree, not yet committed —
re-stamp this line with the commit hash once they are.

| Item | Status |
|---|---|
| R1a skip autosave-restore prompt | done (`Editor.jsx` `componentDidMount`) |
| R1b disable autosave writes | done (`EditorCore.autoSaveProject`) |
| R1c suppress file operations | done (`MenuBar.jsx`, `MobileMenu.jsx`) |
| — also: skip the version-splash modal | done; not in the original R1, but the same failure — a boot-time modal covering the document the host just asked for |
| R2 `newWickProject()` + `?width/height/framerate` | done |
| R3 `getWickProjectInfo()` | done |
| R4 `getWickProjectRevision()` | done, with two caveats documented at the function |
| R5 `makeWickPosterExport()` | **not built** — needs an `engine/src` change; see below |
| R6 `getWickApiVersion()` | done, returns `2` |
| R7 close-request event | done, fired by a "done" button shown in embed mode |
| §9 redeploy | done — `/srv/http/Experimente/Release/WickRevive` now carries the API |

**Why R5 was left out**, per its own "check before starting" note and §4's
mis-shaped-requirement rule: the only still-image path in the engine is
`Project.generateImageSequence` (`engine/src/base/Project.js:1773`), which always
starts at playhead 1 and runs to `timeline.length` with no frame-range argument.
A one-frame export needs either that argument added to the engine, or its
container/zoom/`publishedMode`/history-snapshot dance replicated inside
`EmbedAPI.js` — which is exactly the engine coupling §4 forbids. Adding the
range argument is the right fix when R5 is picked up; it is a small,
embed-agnostic engine change, and needs the two-dist-copies rule in §7.

**A finding on R4.** The counter behaves as specified, but two properties are
worth knowing and are now documented at the function and in `CLAUDE.md`. First,
it is conservative: view-only operations (recentering the canvas, stopping
playback) also route through `projectDidChange`, so equal proves unchanged but
unequal does not prove changed — the safe direction, costing a redundant export
rather than a lost edit. Second, boot settles asynchronously and lands one more
bump shortly *after* `wickEditorReady` resolves, so the baseline must be taken
after `loadWickProjectData()`/`newWickProject()` resolves, not at ready. Measured:
stable for 6 s after a load, but 1→2 in the ~2 s after ready on the blank boot
project.

---

## 0. How to use this document

**Work in:** `/srv/http/Experimente/PCOnlyProjects/WickRevive`
This document was authored in another repo; copy it into the Wick repo root
before starting, so it sits beside the code it describes.

**Read first:** that repo's `CLAUDE.md`, especially ▸ *"Embedding the editor in
a host page"* (line ~63). It already documents the existing API, `player.html`,
`host-demo.html`, and the one-project-per-browsing-context rule. **That section
is the user-facing documentation of this API and must be updated by this work**,
or the two descriptions drift.

**Explicitly out of scope:** `REFACTOR_PLAN.md`. Do not fold any of its phases
into this work. It is deferred by decision, not by oversight.

---

## 1. Scope

What the editor should expose to a **host application that embeds it in a
same-origin iframe**, where:

- the **host owns persistence** — it stores each document and hands it back to
  the editor on open, rather than the editor managing a document library;
- there are **many documents**, each opened in the editor one at a time;
- the host wants a **rendered artifact back** (a video, a still frame) when the
  user finishes editing, not a file download;
- the host renders that artifact in its own UI, at its own size.

Nothing here is specific to any one host. Everything below follows from those
four properties alone.

---

## 2. What already exists

`src/Editor/export/EmbedAPI.js` (234 lines), registered from
`Editor.componentDidMount`, hangs these off the editor's window. Committed
2026-08-29 as **`e6b7b7af`** together with `public/player.html`,
`public/host-demo.html` and `public/embed-test.html`.

| Global | Returns |
|---|---|
| `wickEditorReady` | Promise resolving to the editor; also a `wick-editor-ready` event on the window |
| `makeWickMp4Export({width, height, onProgress})` | Promise\<Blob\> — ffmpeg-muxed mp4 |
| `makeWickGifExport(args)` | Promise\<Blob\> |
| `makeWickPngSequenceExport(args)` | Promise\<Blob\> — zip of every frame |
| `makeWickHtmlExport()` | Promise\<string\> — ~2.2 MB, engine inlined |
| `makeWickSvgExport()` | Promise\<string\> |
| `makeWickProjectData({format})` | Promise\<string\|Blob\|ArrayBuffer\> — the `.wick` file; `base64` default, also `blob`, `arraybuffer` |
| `loadWickProjectData(data, {format})` | Promise\<Wick.Project\> — replaces the open project |
| `wickExport` | grouped alias of the six exporters |

**This is already the whole round trip** — open → load a stored document → edit
→ export → hand the result and the updated `.wick` back to the host. The design
is right and must not be changed:

- promises throughout;
- Blobs and strings returned to the caller instead of triggering downloads or
  opening modals;
- `base64` as the default project-data format, which is what survives
  `postMessage` and `localStorage`;
- `makeWickProjectData()` (kilobytes: project + assets, no engine) kept distinct
  from `makeWickHtmlExport()` (~2.2 MB, engine inlined), so a host storing many
  documents stores the small one.

The gaps in §5 are all things an embedding host cannot work around from outside.

---

## 3. The structural constraint on anything new

`wickEditorReady` resolves **after** boot. So anything that must take effect
*during* boot cannot be an API call — by the time the host is able to call it,
boot is over and the effect has already happened.

Those requirements must be **URL parameters**, which an embedding host always
controls because it writes the iframe's `src`.
`EditorCore.tryToParseProjectURL` (`src/Editor/EditorCore.jsx:1445`) already
establishes that pattern with `?project=` and `?example=`.

This is why R1 and R2 are specified as URL parameters rather than functions.

---

## 4. Design constraint — keep it a thin facade

**`EmbedAPI.js` is a wrapper, not a feature.** Implement every addition as a
thin adapter over what the editor already does, so the internals underneath stay
free to change.

Concretely:

- **Do not thread embed-specific flags through `EditorCore`/`Editor` internals.**
  Read the URL once, keep the resulting state in one place, and gate behaviour
  at the smallest number of call sites — ideally one per behaviour.
- **Prefer reading existing state over adding new state.** R3 and R4 should
  derive from `editor.project` and the existing `projectDidChange` path, not
  from parallel bookkeeping that can fall out of sync.
- **No new coupling from the engine to the editor.** `engine/` must not learn
  that embedding exists.
- If a requirement seems to need a deep internal change, that is a signal the
  requirement is mis-shaped — write down what you found rather than pushing the
  change through.

The test of thinness: a later refactor of `EditorCore` should be able to break
this API only by changing something this file explicitly names.

---

## 5. Requirements

### R1 — An embed mode, as a URL parameter — **required for v1**

`index.html?embed=1`. The single most important item: it is what makes embedding
*correct*, not merely possible.

**a. Skip the autosave-restore prompt.** `showAutosavedProjects()`
(defined `src/Editor/EditorCore.jsx:1427`, called on boot from
`src/Editor/Editor.jsx:273`) queues an `AutosaveWarning` modal whenever any
autosave exists. When the host owns persistence, that modal offers to restore an
unrelated document over the one the host just asked for — and it fires before
the host can call anything (§3).

**b. Disable autosave writes.** `src/Editor/EditorCore.jsx:1551` autosaves every
15 s. Autosave is a **single shared slot**, so with many host-owned documents
every one of them writes over the same slot: the mechanism is not merely
redundant when the host persists, it actively corrupts the association between a
document and its saved state.

**c. Optionally suppress file operations in the menu bar** — new / open / save
are meaningless when the host owns the document, and a user reaching for them
gets a result the host never sees. Lowest-value part of R1; skip it if it costs
more than a couple of conditionals.

A URL parameter is the right shape: (a) and (c) are boot-time, and (b) must be
off from the first tick, not from whenever the host's first API call lands.

### R2 — `newWickProject({width, height, framerate})`

Open a **blank** project at a caller-specified stage size. A host creating a new
document needs a known starting stage, not the editor's built-in default.

Also worth exposing boot-time as `?width=…&height=…&framerate=…`, which avoids a
visible flash of the default stage before the host's call lands.

### R3 — `getWickProjectInfo()`

```js
{width, height, framerate, frameCount, durationMs, name}
```

The API currently *accepts* `width`/`height` for export but nothing **reports**
the project's own. A host that sizes its own container to the animation has no
way to follow a stage-size change made during editing, so the exported video
ends up letterboxed inside a container sized from a stale assumption.

Read-only, cheap, callable any time after `wickEditorReady`. Derive it from
`editor.project` — do not cache.

### R4 — `getWickProjectRevision()`

A monotonic integer, bumped from `projectDidChange` (`src/Editor/Editor.jsx:677`)
— which every project mutation already goes through.

The host records it on open and compares on close; equal means nothing changed
and the export can be skipped. This matters because an mp4 export is frame
rendering plus an ffmpeg mux — seconds, not milliseconds — and re-running it
every time a user opens and closes a document without drawing is the difference
between the feature feeling instant and feeling broken.

**A counter, not a boolean dirty flag**: a counter is robust to the host missing
an event or reconnecting to an already-open editor, where a flag consumed once
is not.

### R5 — `makeWickPosterExport({frame, width, height})` → Promise\<Blob\> (PNG)

A single still frame. A host displaying a document that is not currently playing
needs one image, and today the only route to a still is
`makeWickPngSequenceExport`, which renders and zips **every** frame.

Defaults: `frame` = the first frame; `width`/`height` = the project's.

**Check before starting**: if this cannot be built from existing engine APIs and
needs an `engine/src` change, stop and re-scope — see §7's engine rule, and §4's
"mis-shaped requirement" note.

### R6 — `getWickApiVersion()` → integer

An integer the host can compare, incremented whenever this API surface changes.

The concrete failure this prevents: a **deployed build older than the host
expects**. Without a stamp, the host discovers this as
`makeWickMp4Export is not a function` thrown from inside a callback, at the
moment the user finishes editing and expects their work back. With one, the host
can detect it up front and say so. This has already happened in practice — a
deploy that lagged the working copy by a whole feature (§10).

### R7 — A close-request event

`window.dispatchEvent(new Event('wick-editor-close-request'))` from a "Done"
control in the editor's own UI.

Lowest priority, and the only item needing a UI change rather than an API
addition. Note a host **must** provide its own close control regardless: key
events raised inside an iframe never reach the host document, so a host can never
implement Esc-to-close on the editor's behalf. This event only adds the
in-editor gesture users reach for first.

---

## 6. Priority

| Priority | Items | Why |
|---|---|---|
| **Required for v1** | **R1** + the redeploy in §9 | R1 is the only addition without which an embedding host cannot open a document cleanly. The redeploy is what makes any of it reachable. |
| Wanted | R2, R3 | Blank project at a known stage; stage-size readback. A host can ship without them. |
| Later | R4, R5 | Performance (R4) and display quality (R5). |
| Last | R6, R7 | Robustness and polish. |

If time is short, **R1 + redeploy is a complete, useful deliverable.** Stop
there rather than half-landing several items.

---

## 7. Working in this repo

### Commands (verified at `5680a568`)

```bash
npm start            # vite dev server, http://localhost:5173
npm run build        # production build -> build/ (also copies CNAME_editor)
npm run preview      # serve the production build
npm run build-engine # rebuild engine + copy dist into public/corelibs/wick-engine/
npm test             # == npm run engine-tests
```

`npm test` serves `engine/` on :9999 via `python3 -m http.server` and stays in
the foreground; open `http://localhost:9999/tests/index.html`. It is the
**engine's** Mocha suite — there is no unit-test runner for the editor UI, so
this work is verified through the harness below, not by tests.

### Verifying the work — the harness already exists

Three pages in `public/`, all shipped by `e6b7b7af`:

| Page | What it is |
|---|---|
| `host-demo.html` | **The dev harness for the whole embed loop.** `npm start`, open `/host-demo.html`, press `W` to open the editor over the player, "Send to player" to export and play. |
| `player.html` | Plays a `.wick` payload; takes `load`/`play`/`pause`/`stop`/`mute` over postMessage. Protocol documented at the top of the file. |
| `embed-test.html` | Smaller direct exercise of the API globals. |

**Extend `host-demo.html` to exercise whatever you add** — it is the only place
this API is executed end-to-end, and a new global with no harness path is
untested code.

For R1 specifically: the check is that opening the editor with `?embed=1` shows
**no** `AutosaveWarning` modal even when an autosave exists, and that no autosave
is written while embedded. Create an autosave first (edit without `?embed=1`,
wait 15 s), then reload with the parameter.

### Conventions (from `CLAUDE.md` ▸ Conventions)

- **GPLv3 header block on every source file** — keep it on anything new.
- **Every runtime asset path must be relative.** `vite.config.mjs` sets
  `base: './'` so the build is relocatable; a leading `/` ships as-is and 404s
  under any subpath. Applies to `index.html` and to fetches in JS.
- Vite aliases: `Editor/`, `resources/`, `files/` resolve under `src/`. JSX is
  allowed in `.js` as well as `.jsx`.
- SCSS per component (`_component.scss` beside the `.jsx`), palette in
  `src/Editor/_wickbrand.scss`.

### The engine rule — only if you touch `engine/src`

None of R1–R4, R6, R7 should need it. R5 might (see its note). If you do:

- `engine/gulpfile.js` concatenates an **explicit, ordered file list**; a new
  source file not added to that array is silently not built.
- **Two copies of the build are tracked in git** — `engine/dist/` and
  `public/corelibs/wick-engine/`. `npm run build-engine` writes both; **commit
  both**, or the editor runs stale engine code.
- The engine tests load the *built* engine, so rebuild before running them.

### Do not run the deploy scripts

`editor-deploy`, `test-deploy`, `prerelease-deploy`, `phonegap-deploy` all
**force-push** to sibling checkouts (`../wick-site`, `../wick-editor-prerelease`,
`../wick-editor-phonegap`). They are unrelated to the local redeploy in §9, which
is a plain file copy.

---

## 8. Excluded — do not build these

**A postMessage bridge.** The current API is same-origin only, which is the right
trade while hosts are same-origin. A message protocol adds a second surface to
specify, version and debug, and buys nothing until a cross-origin host actually
exists. Add it then, wrapping this API rather than replacing it.

**Export cancellation.** A real gap — `onProgress` exists but there is no way to
abort a running export. It only bites on long animations, so it is not where this
should start.

---

## 9. Definition of done

1. **R1 implemented** as a thin facade per §4, and whichever of R2–R7 were taken.
2. **`host-demo.html` exercises it**, including the R1 autosave check in §7.
3. **`npm run build` passes.**
4. **`CLAUDE.md` ▸ "Embedding the editor in a host page" updated** to describe
   the new surface — that section is this API's documentation.
5. **The local deployed build is refreshed.** This is the step that is easy to
   forget and that blocks every consumer:

   ```bash
   npm run build
   rsync -a --delete build/ /srv/http/Experimente/Release/WickRevive/
   ```

   `/srv/http/Experimente/Release/WickRevive` is the build a host page on this
   machine loads in its iframe. It is **not** a git repo, and it is currently
   dated 12 Aug, built from `5b93ccc7` — i.e. from before the embed API existed
   at all. Until this copy happens, none of this work is reachable by any host:
   the API can be finished and committed and the consumer still sees nothing.

   Verify afterwards:
   ```bash
   grep -rlo "wickEditorReady" /srv/http/Experimente/Release/WickRevive/assets/
   ```
   Non-empty output means the deploy carries the API.

6. **Re-stamp the verification line at the top of this document** with the
   commit you finished on.

---

## 10. Reference — the three trees

| Path | What |
|---|---|
| `/srv/http/Experimente/PCOnlyProjects/WickRevive` | **The working copy — the tree to change.** Has `CLAUDE.md`, `REFACTOR_PLAN.md` (out of scope), a free-text `todo` file, and `src/Editor/export/EmbedAPI.js`. The embed work is committed (`e6b7b7af`). |
| `/srv/http/Experimente/Release/WickRevive` | A **deployed build**, not a git repo. Built 12 Aug from `5b93ccc7` — before the embed API — so it has no `wickEditorReady` and no `makeWick*` in `assets/`. §9 step 5 refreshes it. |
| `/srv/http/Experimente/WickReviveo` | An older parallel checkout of the same commits. **Not** the tree to work in. |

### One constraint hosts must respect

From `CLAUDE.md`: **one live Wick project per browsing context.**
`Wick.View.paperScope` is a single static paper.js scope and `View.Project` calls
`paper.setup()` on it, which rebinds `paper.project`/`paper.view` globally;
`Wick.ObjectCache` is a per-window singleton too.

So an editor and a player each need their own iframe, and two players cannot
share one host window. Keep this in any host-facing documentation of the API — it
is invisible until two projects are live at once, and then presents as
inexplicable cross-talk.
