# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A fork of the [Wick Editor](https://github.com/Wicklets/wick-editor) (GPLv3) — a browser-based animation/game creation tool. Two codebases live in one repo:

- `src/` — the React editor UI (Vite build).
- `engine/` — the **Wick Engine**, a standalone vanilla-JS library (project model, canvas rendering, tools, export). Built separately with gulp and consumed as a global `window.Wick`, *not* as an npm import.

## Commands

```bash
npm start                  # Vite dev server on http://localhost:5173
npm run build              # production build -> build/
npm run preview            # serve the production build
npm run build-engine       # rebuild engine + copy dist into public/corelibs/wick-engine/
npm test                   # serves the engine test page (see Tests below)
```

**No desktop build.** The Electron/electron-builder scripts, the `build` (electron-builder) block, `public/electron.js`, `entitlements.mac.plist` and the `gh-pages` `deploy` script were removed — none of those binaries were ever declared in `devDependencies` or installed, so every one of them failed. This is a web-only build now. The remaining `*-deploy` scripts are sibling-checkout rsync-and-force-push helpers (`../wick-site`, `../wick-editor-prerelease`, `../wick-editor-phonegap`); they don't need extra tooling but do force-push — don't run them casually.

### Tests

The engine's browser-based Mocha/Chai suite is the only test suite in the repo — there is no unit-test runner for the editor UI. `npm test` and `npm run engine-tests` both serve `engine/` on :9999; open `http://localhost:9999/tests/index.html`. The server stays in the foreground, so this is not CI-usable as-is.

`npm run test-alpha-video` is separate and headless: it runs the bundled ffmpeg build under node to check the alpha video path (see *Transparent backgrounds*).

Tests load the **built** engine (`engine/dist/wickengine.js`), so run `npm run build-engine` after any `engine/src` change or you're testing stale code. Individual test files only run if listed in the `<script>` block of `engine/tests/index.html`; add new ones there. Filter with Mocha's `?grep=` in the URL.

## Engine build (read before touching `engine/src`)

- `engine/gulpfile.js` **concatenates an explicit, ordered file list** into `dist/wickengine.js`. A new source file that isn't added to that array is silently not built.
- There is no babel config, so `gulp-babel` is effectively a pass-through: engine sources are plain ES6 scripts that attach classes onto the global `Wick` namespace (`Wick.Tools.Pen = class ...`). No `import`/`export`, no module scope.
- The build also regenerates `dist/emptyproject.html` by inlining the whole engine into `src/export/html/project.html` — this is what HTML/ZIP project export ships.
- **Two copies of the build are tracked in git**: `engine/dist/` and `public/corelibs/wick-engine/`. `npm run build-engine` writes both; commit both, or the editor runs stale engine code.
- `index.html` loads `/corelibs/wick-engine/wickengine.js` via a plain `<script>` tag before the React bundle. `Editor.jsx` sets `window.Wick.resourcepath = 'corelibs/wick-engine/'`.

## Engine architecture

- **Model** (`engine/src/base/`): `Wick.Base` is the root — every object has a UUID and registers itself in `Wick.ObjectCache`. Parent/child links are stored as UUIDs and resolved lazily, so serialization (`serialize()`/`deserialize()`, project files, undo snapshots) is flat, not a deep tree. `Project` owns `Timeline` → `Layer` → `Frame` → `Path`/`Clip`/`Tween`, plus assets, `Selection`, `History`, and the tool instances (`Project.js`, `this._tools`).
- **View** (`engine/src/view/`): one `View.*` class per model class, each rendering its model into the shared paper.js scope (`Wick.View.paperScope`, also aliased to `window.paper`). `paper-ext/` monkey-patches paper.js (selection widget, erase, boolean/ordering utils, potrace, pressure/gesture input).
- **GUI** (`engine/src/gui/`): the timeline/layers/playhead are *not* React — they're drawn imperatively onto their own canvas by `GUIElement` subclasses, driven by `project.guiElement.draw()`.
- **Tools** (`engine/src/tools/`): each extends `Wick.Tool`, wrapping a `paper.Tool` with `onMouseDown/Drag/Up/Move`, plus double-click detection. Tools read shared state from `Wick.ToolSettings` and signal edits by firing `canvasModified`.
- **Export/import** (`engine/src/export/`): `.wick` project files, HTML, SVG, GIF/image sequence, audio, ZIP, and autosave (backed by `localforage`, which `Editor.jsx` puts on `window` for the engine).

## Editor architecture

- `Editor.jsx` extends `EditorCore.jsx`. `EditorCore` holds the ~200 project-mutating methods (tools, selection, timeline, assets, export); `Editor` holds React state, layout (react-reflex panels), modals, and hotkeys.
- **The live project is deliberately outside React state.** `this.project` is a mutable `Wick.Project`. React state carries only GUI state plus `state.project`, a random string used as a change token.
- Every mutation must be followed by `this.projectDidChange({actionName, skipHistory?, skipReactRender?})` (`Editor.jsx:671`). It requests an autosave, pushes an undo state, calls `project.view.render()` + `project.guiElement.draw()`, and forces a re-render. Skipping it leaves the canvas or the UI stale.
- `Canvas.jsx` is a thin host: it hands its `<div>` to `project.view.canvasContainer` and subscribes to `canvasModified` / `eyedropperPickedColor` events, which call back into `projectDidChange`.
- `actionMap.js` (toolbar/menu actions: icon + tooltip + `this.editor.<method>`) and `hotKeyMap.js` (react-hotkeys sequences, with repeat-key support and user-overridable custom keys) both dispatch into `EditorCore` methods. Adding an action usually means editing both.

### Adding a tool (touch points, cf. commit `5b93ccc7`)

1. `engine/src/tools/<Name>.js` — new `Wick.Tools.<Name>` class.
2. Add the path to the file list in `engine/gulpfile.js`.
3. Register the instance in `Project.js` `this._tools`.
4. `npm run build-engine`.
5. UI: `src/resources/toolbar-icons/<name>.svg`, map it in `Util/ToolIcon/ToolIcon.jsx`, add a `ToolButton` in `Panels/Toolbox/Toolbox.jsx` (grouped tools use the `brushes`-style dropdown), and a settings renderer in `Panels/Toolbox/ToolSettings/ToolSettings.jsx`.
6. Optionally an `activate-<name>` entry in `hotKeyMap.js`.

## Embedding the editor in a host page

`src/Editor/export/EmbedAPI.js` (registered from `Editor.componentDidMount`) hangs `window.makeWick*Export()`, `window.makeWickProjectData()`, `window.loadWickProjectData()` and `window.wickEditorReady` off the editor's window, so a **same-origin** host page holding the editor in an iframe can drive it directly: `await frame.contentWindow.wickEditorReady` then call the globals. A cross-origin host would need a postMessage bridge instead — the current API is same-origin only.

The surface has two halves. **`EmbedAPI.js` is the call-time half**, and it is deliberately a thin facade — every function adapts something the editor already does, so the internals underneath stay free to change:

| Global | Returns |
|---|---|
| `wickEditorReady` | Promise resolving to the editor; also a `wick-editor-ready` event on the window |
| `makeWickMp4Export({width, height, format, onProgress})` | Promise\<Blob\> — `format` is `mp4` (default, H.264), `mov` (QuickTime RLE, real alpha, not browser-playable) or `mp4matte` (double-height alpha matte); an unknown one throws up front |
| `makeWickGifExport(args)` / `makeWickPngSequenceExport(args)` | Promise\<Blob\> (the PNG one is a zip of every frame) |
| `makeWickHtmlExport()` / `makeWickSvgExport()` | Promise\<string\> |
| `makeWickProjectData({format})` | Promise\<string\|Blob\|ArrayBuffer\> — the `.wick` file; `base64` default, also `blob`, `arraybuffer` |
| `loadWickProjectData(data, {format})` | Promise\<Wick.Project\> — replaces the open project |
| `newWickProject({width, height, framerate, name, transparent})` | Promise\<Wick.Project\> — a blank project at a host-chosen stage size |
| `getWickProjectInfo()` | `{width, height, framerate, frameCount, durationMs, name, transparentBackground, backgroundColor}`, read off the live project so a stage-size change made while editing is visible |
| `getWickProjectRevision()` | monotonic integer, bumped from `projectDidChange` |
| `getWickApiVersion()` | integer, currently **3**; absent entirely on builds predating it, which is how a host detects a stale deploy |
| `wickExport` | grouped alias of the six exporters |

**`EmbedMode.js` is the boot-time half.** `wickEditorReady` resolves *after* boot, so anything that must take effect *during* boot cannot be a function call — by the time the host can call it the effect has already happened. Those knobs are URL parameters, which a host always controls because it writes the iframe's `src`: `index.html?embed=1&width=1080&height=1080&framerate=24&transparent=1`. `EmbedMode.js` is the one place the URL is read; nothing threads an embed flag through `EditorCore`/`Editor`.

- `?embed` means **the host owns persistence**. It suppresses the autosave-restore prompt and the version-splash modal (both otherwise cover the document the host just asked for, and both fire before the host can call anything), stops autosave writes (`EditorCore.autoSaveProject`) — autosave is a *single shared slot*, so many host-owned documents through one editor would all overwrite each other — and swaps new/open/save in the menu bar for a **done** button that fires `wick-editor-close-request` on the editor's window. Gated at five call sites in all (the fifth drops new/open from the mobile hamburger menu); grep `isEmbedMode`.
- `?width` / `?height` / `?framerate` / `?transparent` set up the blank boot project. Independent of `?embed`, and the flash-free alternative to calling `newWickProject()` once the editor is up.
- `getWickProjectRevision()` is **conservative**: a few view-only operations (recentering the canvas, stopping playback) also route through `projectDidChange`, so equal means "definitely unchanged, safe to skip the export", while unequal only means "might have changed". Take the baseline *after* `loadWickProjectData()`/`newWickProject()` resolves — boot settles asynchronously and lands one more bump shortly after `wickEditorReady`.
- A host **must** still provide its own close control: key events raised inside an iframe never reach the host document, so Esc-to-close can only ever be the host's. `wick-editor-close-request` only adds the in-editor gesture users reach for first.
- **No single-frame poster export.** The only still-image route is `makeWickPngSequenceExport`, which renders and zips *every* frame. A cheap one-frame export would need `Project.generateImageSequence` (`engine/src/base/Project.js:1773`) to take a frame range — it always starts at playhead 1 and runs to `timeline.length` — and replicating its container/zoom/`publishedMode`/snapshot dance in the editor instead would couple `EmbedAPI.js` to engine internals. Left undone deliberately.

- `makeWickProjectData()` returns a `.wick` file (project data + assets, a couple of KB) rather than the ~2.2MB `makeWickHtmlExport()`, which inlines a whole copy of the engine. `public/player.html` plays that payload: it loads `corelibs/wick-engine/wickengine.js` — the same URL, and so the same HTTP cache entry, the editor loads — and takes commands (`load`/`play`/`pause`/`stop`/`mute`/`transparent`) over postMessage. Its protocol is documented in a comment at the top of the file. It stops painting its own dark backdrop when the loaded project is transparent, so the host page shows through; `transparent` / `?transparent=` override that in either direction.
- `public/host-demo.html` is the dev harness for the whole loop: `npm start`, open `/host-demo.html`, press `W` to open the editor over the player, "Send to player" to export and play. It also exercises `newWickProject()`, `getWickProjectInfo()`, the revision check and the close-request event, and its "embed mode" checkbox picks whether the editor frame is opened as `index.html` or `index.html?embed=1`. The overlay carries its own close buttons because key events inside an iframe never reach the host document. Its "transparent" checkbox opens the editor with `?transparent=1` and puts a checkerboard behind the player, which is how you see that a transparent project really is see-through end to end. `public/embed-test.html` is a smaller, scriptable exercise of the globals (`?only=version,info,revision,newproject,transparent,badformat` to skip the slow exports; `?only=mov,matte` for the alpha video paths, which are not in the default set).
- **To check `?embed` by hand:** untick "embed mode", press `W`, draw, wait 15 s so an autosave lands, close. Press `W` again — the restore prompt appears. Re-tick the box and press `W`: no prompt, and nothing further is written to the autosave slot.
- **One live Wick project per browsing context.** `Wick.View.paperScope` is a single static paper.js scope and `View.Project` calls `paper.setup()` on it, which rebinds `paper.project`/`paper.view` globally; `Wick.ObjectCache` is a per-window singleton too. So the player has to be its own iframe — it cannot share the editor's window, and two players cannot share a host window.
- `Project.inject()` (`engine/src/base/Project.js:1617`) installs a `window.onresize` handler that refers to a global named `project`, so any page calling it needs to define one — `player.html` sets `window.project` for exactly that reason.

## Transparent backgrounds

`Project.transparentBackground` is a boolean on the model, *not* alpha inside `backgroundColor`: three call sites read `backgroundColor.hex` and would silently drop it (`FillBucket.js` gap-fill detection, `Project.inject()`, `View.Project._updateCanvasContainerBGColor`), and keeping the colour around gives the formats that must flatten a matte to flatten onto. Old `.wick` files have no key and default to opaque; new ones opened in stock Wick Editor ignore it and render opaque. It is set from the project settings modal, from `newWickProject({transparent})`, or at boot from `?transparent`.

- **In the editor** the stage is a checkerboard, so "transparent" doesn't look like "white". paper.js `fillColor` takes no pattern, so it is a `paper.Raster` over a cached offscreen canvas (`View.Project._generateSVGCheckerboardStage`). **`new paper.Raster(canvas)` does not do what it looks like** — paper only recognises an `<img>`, and reads anything else as a *Size*, handing back a blank canvas of those dimensions. Assign `raster.image` after construction. The raster is cached and reused rather than rebuilt per render, because paper returns a raster's canvas to its own pool when the raster is given a different image.
- **Published** (player, `inject()`, image-sequence render) the stage paints nothing, black bars are suppressed, and the canvas element itself goes `transparent`.
- **SVG export** goes through `View.Project.exportSVG`, which drops the background layer for a transparent project. `paper.project.exportSVG` dumps every layer in the scope, and marking an item invisible is not enough — paper exports hidden items too, so the checkerboard would land in the file as a base64 image.
- `Project.generateImageSequence` forces `image/png` and turns black bars off when the project is transparent, which is all the **PNG sequence** export needs. It also takes `frameFormat: 'raw'`, which hands back `{data, width, height}` pixel buffers instead of `Image`s — that's what the video path wants, and it skips a base64 round trip per frame.
- **GIF** has no alpha here (gif.js composites onto black), so `GIFExport` flattens each frame onto `backgroundColor` first.

### Video export: the browser encodes, ffmpeg only muxes

`public/corelibs/video/ffmpeg.js` is **FFmpeg 2.2.1 (2014), from bgrins/videoconverter.js**, compiled as asm.js. Three things it *cannot* do shape this whole path:

- **No libx264, no libvpx.** Its only mp4 video encoder is `mpeg4` — MPEG-4 Part 2, which writes an `mp4v` sample entry. **No current browser plays `mp4v`.** Such files open fine in VLC or Parole and are a black box in Chrome. This is the entire reason the H.264 path exists.
- **No zlib.** It cannot inflate PNG (`inflateInit_` is a missing function), so PNG frames are not a usable transport.
- **Built `--disable-parsers --disable-bsfs`.** It cannot find frame boundaries in a raw elementary stream. Handing it the browser's H.264 output as a `.h264` muxes **zero frames** and reports *"Output file is empty, nothing was encoded"* — a container has to do the framing. That is why `WebCodecsEncoder` produces a finished mp4 rather than an elementary stream; don't "simplify" that away.

`VideoExport._planEncoding` therefore picks one of three routes up front, so the frame renderer, the encoder and the ffmpeg command can't disagree later:

| encoder | when | how |
|---|---|---|
| `h264` | `mp4` / `mp4matte`, and the browser has WebCodecs | `export/WebCodecsEncoder.js` encodes H.264 with the browser's own (usually hardware) encoder and muxes it into a complete `avc1` mp4 with `mp4-muxer`. **With no audio that file is the export and ffmpeg never runs**; with audio, ffmpeg adds it via `-i video.mp4 -i audio.wav -c:v copy -c:a aac`. |
| `qtrle` | `mov` | The bundled encoder. Lossless per-pixel alpha, frames fed in as 32-bit RLE **TGA** (`export/AlphaFrameEncoder.js`). |
| `legacy` | `mp4` / `mp4matte` with no WebCodecs | The old mpeg4 path, JPEG frames. Produces `mp4v`, so the result will *not* play in a browser — a fallback, not a target. |

- `mp4matte` packs each frame to double height: premultiplied colour on top, the alpha channel as greyscale below. Recombine with `colour = top + destination * (1 - bottom)`. On the `h264` route this genuinely does play in a browser; on the `legacy` route it inherits `mp4v` and does not.
- **WebCodecs cannot carry alpha.** `alpha: 'keep'` for VP8/VP9 is in the spec but unsupported in shipping browsers (measured, not assumed), so `.mov`/qtrle stays the only true-alpha output. A browser-native transparent video would need a modern `ffmpeg.wasm` core with libvpx (VP9 `yuva420p` WebM) — see the plan's risk list.
- **Frames are streamed, not collected.** `generateImageSequence` takes an `onFrame` callback which suppresses accumulation: a raw 1080p frame is 8MB, and holding a few hundred is how you run a tab out of memory. It may return a promise, which is how the encoder applies backpressure.
- TGA rather than BMP for qtrle because the run-length encoding is ~20x smaller on flat vector art, and memfs is the ceiling there: every frame sits in the worker at once and `worker-asm.js` pins `TOTAL_MEMORY` at 256MB.
- `_ensureValidDimensions` (the odd-pixel crop) is needed by mpeg4 *and* H.264 (both 4:2:0); qtrle has no such rule, so the `.mov` path keeps every pixel.
- `-filter:v showinfo` stays on the paths that re-encode — it is a passthrough, but `_parseProgressMessage` reads its output for the progress bar. A `-c:v copy` mux cannot take a filter, so the H.264 path reports no per-frame progress during muxing (the encode phase reports its own).
- **Verifying it:** `npm run test-alpha-video` drives the bundled ffmpeg under node with no browser, covering both commands — the TGA→qtrle alpha round trip, and the `-c:v copy` mux, asserting no frames are lost (which is what a missing parser looks like). The browser half is `public/embed-test.html?only=mp4,mov,matte`, which loads each exported blob into a `<video>` and reports whether it actually plays.

## Conventions

- Vite aliases (`vite.config.mjs`): `Editor/`, `resources/`, `files/` resolve under `src/`. JSX is allowed in `.js` as well as `.jsx`.
- Styling is SCSS per component (`_component.scss` next to the `.jsx`), with the palette in `src/Editor/_wickbrand.scss`. Sass deprecation warnings for `@import`/global builtins are intentionally silenced.
- Source files carry the GPLv3 header block; keep it on new files.
- `npm run build` copies `CNAME_editor` into `build/`.
- `vite.config.mjs` sets `base: './'` so the build is relocatable (it is deployed to `wickeditor.com/editor/`). **Every runtime asset path must be relative.** CRA rewrote `%PUBLIC_URL%` at build time; Vite does not touch `public/` references, so a leading `/` ships as-is and 404s under any subpath. This applies to `index.html` and to fetches in JS (`fontInfo.js`, `GIFExport.js`, `BuiltinLibrary.jsx`, `EditorCore.jsx`).
- `engine/src/export/zip/` holds only the ZIP-export runtime shell (`index.html`, `preloadjs.min.js`), which gulp copies into `dist/`. The engine itself is *not* kept here — `ZIPExport._downloadDependenciesFiles` fetches `wickengine.js` from `Wick.resourcepath` at runtime. (A stale 2019 build used to sit in this folder; it was unreferenced and has been deleted.)
