# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A fork of the [Wick Editor](https://github.com/Wicklets/wick-editor) (GPLv3) — a browser-based animation/game creation tool. Two codebases live in one repo:

- `src/` — the React editor UI (Vite build).
- `engine/` — the **Wick Engine**, a standalone vanilla-JS library (project model, canvas rendering, tools, export). Built separately with gulp and consumed as a global `window.Wick`, *not* as an npm import.

## Commands

```bash
npm start                  # Vite dev server on http://localhost:5173 (README's :3000 is stale)
npm run build              # production build -> build/
npm run preview            # serve the production build
npm run build-engine       # rebuild engine + copy dist into public/corelibs/wick-engine/
npm test                   # serves the engine test page (see Tests below)
```

**No desktop build.** The Electron/electron-builder scripts, the `build` (electron-builder) block, `public/electron.js`, `entitlements.mac.plist` and the `gh-pages` `deploy` script were removed — none of those binaries were ever declared in `devDependencies` or installed, so every one of them failed. This is a web-only build now. The remaining `*-deploy` scripts are sibling-checkout rsync-and-force-push helpers (`../wick-site`, `../wick-editor-prerelease`, `../wick-editor-phonegap`); they don't need extra tooling but do force-push — don't run them casually.

### Tests

The engine's browser-based Mocha/Chai suite is the only test suite in the repo — there is no unit-test runner for the editor UI. `npm test` and `npm run engine-tests` both serve `engine/` on :9999; open `http://localhost:9999/tests/index.html`. The server stays in the foreground, so this is not CI-usable as-is.

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

- `makeWickProjectData()` returns a `.wick` file (project data + assets, a couple of KB) rather than the ~2.2MB `makeWickHtmlExport()`, which inlines a whole copy of the engine. `public/player.html` plays that payload: it loads `corelibs/wick-engine/wickengine.js` — the same URL, and so the same HTTP cache entry, the editor loads — and takes commands (`load`/`play`/`pause`/`stop`/`mute`) over postMessage. Its protocol is documented in a comment at the top of the file.
- `public/host-demo.html` is the dev harness for the whole loop: `npm start`, open `/host-demo.html`, press `W` to open the editor over the player, "Send to player" to export and play. Key events inside an iframe never reach the host document, which is why the overlay carries its own buttons rather than a `W`-to-close.
- **One live Wick project per browsing context.** `Wick.View.paperScope` is a single static paper.js scope and `View.Project` calls `paper.setup()` on it, which rebinds `paper.project`/`paper.view` globally; `Wick.ObjectCache` is a per-window singleton too. So the player has to be its own iframe — it cannot share the editor's window, and two players cannot share a host window.
- `Project.inject()` (`engine/src/base/Project.js:1617`) installs a `window.onresize` handler that refers to a global named `project`, so any page calling it needs to define one — `player.html` sets `window.project` for exactly that reason.

## Conventions

- Vite aliases (`vite.config.mjs`): `Editor/`, `resources/`, `files/` resolve under `src/`. JSX is allowed in `.js` as well as `.jsx`.
- Styling is SCSS per component (`_component.scss` next to the `.jsx`), with the palette in `src/Editor/_wickbrand.scss`. Sass deprecation warnings for `@import`/global builtins are intentionally silenced.
- Source files carry the GPLv3 header block; keep it on new files.
- `npm run build` copies `CNAME_editor` into `build/`.
- `vite.config.mjs` sets `base: './'` so the build is relocatable (it is deployed to `wickeditor.com/editor/`). **Every runtime asset path must be relative.** CRA rewrote `%PUBLIC_URL%` at build time; Vite does not touch `public/` references, so a leading `/` ships as-is and 404s under any subpath. This applies to `index.html` and to fetches in JS (`fontInfo.js`, `GIFExport.js`, `BuiltinLibrary.jsx`, `EditorCore.jsx`).
- `engine/src/export/zip/` holds only the ZIP-export runtime shell (`index.html`, `preloadjs.min.js`), which gulp copies into `dist/`. The engine itself is *not* kept here — `ZIPExport._downloadDependenciesFiles` fetches `wickengine.js` from `Wick.resourcepath` at runtime. (A stale 2019 build used to sit in this folder; it was unreferenced and has been deleted.)
