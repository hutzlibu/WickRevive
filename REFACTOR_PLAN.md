# WickRevive Refactor Plan

Scope: **the editor UI (`src/`)**, ordered by payoff-to-risk rather than by module.
The engine (`engine/src/`) is explicitly deferred — see [Deferred](#deferred-not-in-this-plan).

Ground rules for every phase:

- **One phase per branch, one concern per commit.** Nothing here needs a long-lived branch.
- **No behavior changes inside a refactor commit.** If a bug surfaces, note it and fix it in a separate commit so `git bisect` stays useful.
- **`npm run build` must pass at the end of every phase**, and the editor must load a `.wick` project and export one.
- The engine is a black box here. If a phase seems to need an `engine/src` change, stop — that's a signal the phase is mis-scoped.

---

## Phase 0 — Land the working tree first

**Why first:** there are currently **3,933 changed lines across 38 files** uncommitted, plus 12 untracked paths.
Refactoring on top of that produces a diff nobody can review and conflicts nobody can bisect.

### 0a. Clear two blockers before staging anything

- [x] **Confirm the engine build is current.** Run `npm run build-engine` before staging so the bundles match the
      sources committed beside them. Verified current: the two tracked copies are byte-identical to each other and
      contain every new symbol (`useGradientGUI`, `CURSOR_GRAD`, `addFrameOverlayIsActive`,
      `rightClickAtPosition`).
      **Don't use mtimes to check freshness** — gulp stamps `dist/wickengine.js` with the newest *source* file's
      mtime, so `find engine/src -newer engine/dist/wickengine.js` always reports a file and never means anything.
      Grep the bundle for a symbol instead.
- [ ] **The index is already dirty.** Three deletions are staged: `public/electron.js`, `entitlements.mac.plist`,
      `engine/src/export/zip/wickengine.js`. They belong in commit 1 below — just be aware that whatever you
      commit *first* will sweep them in unless you unstage them.

### 0b. Split the working tree into these seven commits

The tree contains **two features that each span `engine/` and `src/`** (gradient editing, timeline context menu).
They cannot be split engine-from-UI without a broken intermediate state — the gradient GUI needs
`Selection.useGradientGUI` to exist, the context menu needs `GUIElement.rightClickAtPosition`. Keep each feature
as one commit crossing both trees.

- [ ] **1 — Housekeeping / drop Electron:** `.gitignore`, `README.md`, `engine/README.md`, `CLAUDE.md`,
      the three staged deletions, the electron-related parts of `package.json`.
- [ ] **2 — Relative asset paths for subpath deploy:** `fontInfo.js`, `export/GIFExport.js`,
      `Modals/BuiltinLibrary/BuiltinLibrary.jsx`, `index.html`, plus the path hunks of `EditorCore.jsx`.
- [ ] **3 — Embed/player API:** `src/Editor/export/EmbedAPI.js`, `public/player.html`, `public/host-demo.html`,
      `public/embed-test.html`, `export/VideoExport.js`, plus the EmbedAPI hunks of `Editor.jsx`.
- [ ] **4 — Gradient editing (engine + UI):** engine `base/Selection.js`, `tools/Cursor.js`, `tools/PathCursor.js`,
      `view/View.Selection.js`, `view/paper-ext/Paper.SelectionWidget.js` (+446 lines) — plus
      `Util/ColorPicker/**` (incl. new `ColorPickerComponents/`), `InspectorColorNumericInput.jsx`,
      `MobileInspectorColor.jsx`, `Util/ToolIcon/ToolIcon.jsx`, `_wickbrand.scss`,
      `toolbar-icons/linear.svg`, `toolbar-icons/radial.svg`, `public/cursors/gradMove.png`.
- [ ] **5 — Timeline context menu + add-frame (engine + UI):** engine `gui/Project.js`, `gui/FramesContainer.js`,
      `base/Frame.js`, `base/Timeline.js` — plus `Util/ContextMenu/`, `Panels/Canvas/Canvas.jsx`,
      `Panels/Timeline/Timeline.jsx`.
- [ ] **6 — Hotkeys / menubar / input leftovers:** `hotKeyMap.js`, `MenuBar.jsx`, `MenuBarButton.jsx`,
      `Util/WickInput/WickInput.jsx`, and the remaining `Inspector.jsx` / `MobileInspector.jsx` hunks.
- [ ] **7 — Rebuild engine:** `engine/dist/**` + `public/corelibs/wick-engine/**`, committed **together** —
      they must never diverge. One trailing commit, *not* per-feature: gulp-concat output can't be meaningfully
      split by feature, and rebuilding at each step would only produce noise.

Commits 2, 3, 4 and 6 all need hunk-level staging (`git add -p`) of `Editor.jsx`, `EditorCore.jsx`,
`Inspector.jsx` and `MobileInspector.jsx`, which each carry changes from several seams.
**Accept that the intermediate commits are not guaranteed to build**; verify `npm run build` at the end of the
sequence only. Phase 0 buys a reviewable history, not a bisectable one — the bisect guarantee starts at Phase 1.

### 0c. Decide on `todo`

- [ ] The `todo` file's first item (embed the editor, export a minimal payload the host plays) is **already
      substantially built** — `EmbedAPI.js`, `player.html` and `host-demo.html` all exist and are documented in
      `CLAUDE.md`. Its other two items (layer inspector, remove the welcome screen) are feature work, not refactor
      work. Decide whether a scratch todo belongs in git at all before committing it.

### 0d. Tag

- [ ] `git tag pre-refactor` so you can always diff against the starting state.

**Done when:** `git status` is clean and `npm run build` succeeds.

---

## Phase 1 — Free wins (~1 day, near-zero risk)

Nothing here changes runtime behavior. Do it all in one branch, separate commits.

### 1a. Delete dead weight

- [ ] `README-create-react-app.md` — **129 KB** of CRA boilerplate, stale since the Vite migration (`266d67bd`).
- [ ] Decide on `build-ios/` — 18 tracked files, an Xcode `WebViewExample` wrapper including two contributors' `xcuserdata` and a binary `.xcuserstate`. Nothing in the build references it. Delete, or move to its own repo.
- [ ] Decide on `svg/testcases/drawing.svg` — a single orphan tracked file with no references.
- [ ] `CNAME`, `CNAME_test` — only `CNAME_editor` is used (by `npm run build`). Confirm the other two are still wanted by the `*-deploy` scripts before removing.

### 1b. One lockfile

- [ ] `package-lock.json` (312 KB) and `yarn.lock` (166 KB) were **both committed in the same commit** and are now drifting silently. Pick npm (matches every `npm run` script and the installed npm 12), delete `yarn.lock`, and add it to `.gitignore`.

### 1c. Prune unused dependencies

Verified zero imports anywhere in `src/`, `index.html`, `public/`, or `vite.config.mjs`:

- [ ] `url-parse`
- [ ] `react-measure`
- [ ] `react-resize-detector`
- [ ] `react-tabs`
- [ ] `@ffmpeg/ffmpeg` — note `src/Editor/export/VideoExport.js` uses the **prebuilt** `public/corelibs/video/ffmpeg.js`, not the npm package. Confirm before removing.

Verify each with `grep -rn "<name>" src index.html public vite.config.mjs` and a clean `npm run build` afterwards.

### 1d. Deduplicate the Bootstrap CSS import

- [ ] `import 'bootstrap/dist/css/bootstrap.min.css'` appears in **exactly 15 files**, one import each (`Editor.jsx`, `Timeline.jsx`, `Inspector.jsx`, `Toolbox.jsx`, `InspectorTitle.jsx`, `MobileInspector.jsx`, `MobileAssetLibrary.jsx`, `BuiltinLibrary.jsx`, …). Keep the one in `Editor.jsx`, delete the other 14: `grep -rln "bootstrap/dist" src`.

### 1e. Linting and formatting

- [ ] Add ESLint (flat config) with `eslint-plugin-react`, `react-hooks`, and `eslint-plugin-import`.
- [ ] Add Prettier, and a `.prettierignore` covering `engine/dist/`, `public/corelibs/`, `build/`.
- [ ] Add scripts: `"lint": "eslint src"`, `"format": "prettier --write src"`.
- [ ] **Land the formatting sweep as its own commit**, and add its SHA to `.git-blame-ignore-revs` so `git blame` survives.
- [ ] Start with warnings, not errors, for `no-unused-vars` — there are 19 `console.log` calls in `src/` and an unknown number of dead locals; triaging them is Phase 1f, not a blocker.
- [ ] Exclude `engine/` from the editor's ESLint config. Its sources are non-module globals and will produce nothing but noise.

### 1f. Triage the 19 `console.log` calls in `src/`

- [ ] Convert genuine diagnostics to a small `src/Editor/Util/log.js` gated on `import.meta.env.DEV`; delete the rest.
- [ ] Separately, look at the `window.onerror` handler in the `Editor` constructor (`src/Editor/Editor.jsx:120`) — it logs and **returns `true`, swallowing every error in the app**. That masks exactly the class of bug Phases 3 and 4 could introduce. At minimum, don't swallow in dev.

**Done when:** `npm run lint` is clean, `npm run build` passes, editor loads and exports a project.

---

## Phase 2 — Build the safety net (before anything structural)

**Why here and not later:** `src/` has **zero tests**. Phases 3 and 4 touch a 1,906-line class that 103 components
call into. Without this phase, "did it still work?" is answered by clicking, and stale-state regressions from
Phase 4 will surface weeks later with no way to attribute them.

This is not a push for full coverage. It is a small set of characterization tests over the parts Phase 3/4 will move.

- [ ] Add Vitest + `@testing-library/react` + `jsdom`. Vitest reuses `vite.config.mjs`, so the aliases (`Editor/`, `resources/`, `files/`) work with no extra config.
- [ ] Add `src/test/setup.js` that loads the built engine (`public/corelibs/wick-engine/wickengine.js`) and sets `window.Wick.resourcepath`, mirroring what `Editor.jsx` does at startup. **Verify the engine can initialize under jsdom before writing tests against it** — it calls `paper.setup()` and touches canvas APIs. If it can't, fall back to a hand-written `window.Wick` stub for the pure-logic tests below and skip the integration ones.
- [ ] `npm test` currently means "serve the engine test page on :9999". Rename that to `test:engine` and give `test` to Vitest, or the two suites will keep colliding.

Write characterization tests — asserting what the code *does today*, not what it should do — for:

- [ ] **Selection queries** — `getSelectionType`, `getSelectedPaths`, `getSelectedClips`, `getSelectedFrames`, `getNumCanvasObjectsSelected`. Pure reads over a constructed project; the highest-value, lowest-cost tests in the repo.
- [ ] **Selection attributes** — `getSelectionAttribute` / `setSelectionAttribute` / `getAllSelectionAttributes`, which the entire Inspector is built on and Phase 3b will touch.
- [ ] **Timeline edits** — `extendFrame`, `shrinkFrame`, `moveFrameRight`, `moveFrameLeft`, `insertBlankFrame`, `cutFrame`.
- [ ] **`projectDidChange`** — called from **73 sites**. Assert it pushes history unless `skipHistory`, and that it re-renders unless `skipReactRender`.
- [ ] **The 6 inspector row components** — render each with props, fire a change, assert `onChange` payload. These are the contract Phase 3a must preserve when merging mobile and desktop.

**Done when:** `npm test` runs green in CI-able form (non-interactive, exits 0), and covers the five areas above.

---

## Phase 3 — Mechanical structure (behavior-preserving)

Both steps are code motion. Neither should change a single call site.

### 3a. Merge the duplicated mobile/desktop inspector rows

**The finding:** six row types are near-identical. Measured differing lines after normalizing the `Mobile`
prefix out of the mobile copy:

| Row type | Desktop | Mobile | Differing lines |
|---|---|---|---|
| `Checkbox` | 54 | 54 | **4** |
| `Selector` | 55 | 55 | **6** |
| `TextInput` | 55 | 55 | **6** |
| `NumericInput` | 55 | 51 | 16 |
| `NumericSlider` | 65 | 62 | 17 |
| `DualNumericInput` | 75 | 69 | 22 |

~700 lines total, and the real differences are only: the CSS class prefix (`inspector-row` vs
`mobile-inspector-row`), the input-id suffix (`-input` vs `-input-mobile`), the container class
(`inspector-large-input-container` vs `mobile-inspector-small-input-container`), and an optional icon
in place of the text label on mobile.

- [ ] Extract one component per row type under `src/Editor/Panels/Inspector/InspectorRow/InspectorRowTypes/`, taking a `variant` prop (`"desktop" | "mobile"`) that selects the class prefix, id suffix, and label-vs-icon rendering.
- [ ] Keep `MobileInspector*.jsx` as thin one-line re-exports passing `variant="mobile"` **for one commit**, so the diff is reviewable; delete them and update the importers in a follow-up commit.
- [ ] Leave `MobileInspectorColor.jsx` alone for now — it has no desktop counterpart of the same shape (the desktop side is `InspectorColorNumericInput.jsx`, and both were just rewritten in the uncommitted color-picker work). Revisit after Phase 4.
- [ ] Consolidate `_inspectorrow.scss` / `_mobileinspectorrow.scss` the same way.

**Payoff:** every future inspector field is written once instead of twice. This is the single most durable
win in the plan, and it is low-risk — the Phase 2 row tests cover it directly.

**Cost:** ~2 days. **Confidence it's really better: high.**

### 3b. Split `EditorCore.jsx`

**The finding:** one flat class, **1,906 lines, 137 methods**, all class-property arrow functions.
`Editor.jsx` extends it and **overrides nothing** — verified — so there is no inheritance subtlety to preserve.

The methods already cluster cleanly. Proposed modules under `src/Editor/actions/`:

| Module | Methods | Examples |
|---|---|---|
| `toolActions.js` | ~12 | `getActiveTool`, `setActiveTool`, `getToolSetting`, `setToolSetting`, `changeBrushSize`, `zoomIn/Out`, `recenterCanvas` |
| `selectionActions.js` | ~30 | `getSelected*` (11 of them), `selectObject(s)`, `clearSelection`, `selectAll`, `get/setSelectionAttribute*`, `selectObjectAtPosition` |
| `transformActions.js` | ~20 | `nudgeSelection*` (9), `finishNudgingObject`, `flipSelected*`, `sendSelectionTo*`, `moveSelection*`, `boolean*` |
| `timelineActions.js` | ~20 | `movePlayhead*`, `extendFrame`, `shrinkFrame`, `moveFrameLeft/Right`, `cutFrame`, `insertBlankFrame`, `createTween`, `addTweenKeyframe` |
| `assetActions.js` | ~11 | `importFileAsAsset`, `createAssets`, `createImageFromAsset`, `isAssetInLibrary`, `getAllSoundAssets`, `getExistingFonts` |
| `exportActions.js` | ~12 | the `exportProjectAs*` family (~330 lines), `exportSelectedClip`, `exportProjectToNewWindow` |
| `projectFileActions.js` | ~14 | `setupNewProject`, `importProjectAsWickFile`, autosave (`requestAutosave`, `autoSaveProject`, `loadAutosavedProject`, …), local file load/delete, `tryToParseProjectURL` |
| `clipboardActions.js` | 4 | `copySelectionToClipboard`, `cutSelectionToClipboard`, `pasteFromClipboard`, `duplicateSelection` |
| `playbackActions.js` | ~4 | `togglePreviewPlaying`, `startPreviewPlayFromBeginning`, `stopPreviewPlaying`, `toggleOnionSkin` |
| `scriptActions.js` | ~5 | `editScript`, `deleteScript`, `getSelectedObjectScript`, `clearCodeEditorError` |

**Mechanism — this is the important part.** Do *not* convert these to functions taking an explicit `editor`
argument; that would rewrite every one of the hundreds of `this.<method>()` call sites. Instead, have each
module export a factory returning an object of closures over `editor`, and assemble them onto `this`.

Note `EditorCore` currently has **no constructor at all** — it is `class EditorCore extends Component` with
nothing but class-property arrow functions, and `Editor.jsx:67` calls a bare `super()` (no `props`). So this
step *adds* the first constructor to `EditorCore`. Class fields initialize immediately after `super()` returns
and before the rest of the constructor body, so the `Object.assign` below runs after any remaining field
initializers — which is what you want. Preserve the existing bare `super()` in `Editor.jsx` or add `props` to
both; don't change one without the other.

```js
// src/Editor/actions/selectionActions.js
export function createSelectionActions (editor) {
  return {
    selectAll: () => { /* body verbatim, `this` -> `editor` */ },
    clearSelection: () => { /* ... */ },
  };
}

// EditorCore.jsx  — new; this class currently has no constructor
class EditorCore extends Component {
  constructor (props) {
    super(props);
    Object.assign(this,
      createToolActions(this),
      createSelectionActions(this),
      /* ... */
    );
  }
  // remaining class-property arrow functions stay as they are
}
```

Call sites (`this.selectAll()`, `this.props.editor.selectAll()`) stay **byte-identical**. That property is
what makes this safe.

- [ ] Move one module per commit, in ascending order of risk: `clipboardActions` → `playbackActions` → `scriptActions` → `toolActions` → `assetActions` → `timelineActions` → `transformActions` → `exportActions` → `projectFileActions` → `selectionActions`.
- [ ] After each move, confirm the method count is conserved: the total across `EditorCore.jsx` + `src/Editor/actions/*.js` must stay at 137 until you deliberately collapse the nudge wrappers.
- [ ] Watch for methods that call each other across module boundaries (e.g. `deleteSelectedObjects` → `projectDidChange`, `nudgeSelection*` → `finishNudgingObject`). Since everything is assigned onto the same `editor` object, `editor.otherMethod()` keeps working — but assembly **order** matters if any factory calls another's method *during construction* rather than inside a closure. Check for that before moving.
- [ ] There are **9** nudge methods: a base `nudgeSelection(x, y)` plus 8 directional wrappers `nudgeSelection{Up,Down,Left,Right}{,More}`. The base already exists, so this is just collapsing the 8 wrappers to one-liners over it — keep all 8 names, since `hotKeyMap.js` and `actionMap.js` reference them by name.

**Payoff:** navigability and reviewable diffs — real, but organizational. It does **not** fix the coupling;
Phase 4 does.

**Cost:** ~2 days. **Confidence it's really better: medium** — this is filing, not fixing. Its main value is
making Phase 4 tractable.

---

## Phase 4 — The actual fix: prop drilling and re-render cost

**Do not start this before Phase 2 is green.** This is the only phase that can introduce silent stale-state bugs.

**The findings:**

- `Editor.jsx`'s `render()` hand-passes **199 props** across 12 panels. `Inspector` alone takes **22**; `MobileContainer` takes **41**.
- The convention is already **inconsistent**: `props.editor` is read at **85 sites**, but `editor={...}` is passed at only **3**. So some components get the whole editor and others get a curated prop list, with no rule distinguishing them.
- Only **11 of 103** components read `props.project`, yet there are just **2** uses of `PureComponent`/`React.memo` in the entire tree — so every one of the **73** `projectDidChange` calls re-renders everything.

Sequence:

- [ ] **4a.** Introduce `EditorContext` exposing the action groups from Phase 3b plus `projectDidChange`. Phase 3b is what makes this a small, coherent context rather than a 137-key bag.
- [ ] **4b.** Migrate panels off drilled props **one panel per commit**, largest first: `MobileContainer` (41), `Inspector` (22), then the rest. Keep the props accepted alongside the context for one commit per panel so each step is independently revertable.
- [ ] **4c.** Once a panel reads from context, add `React.memo` / `PureComponent` to it and to its leaf rows. Measure before and after with the React DevTools profiler on a project with a few hundred paths — **if there's no measurable improvement, stop here and keep the remaining panels as they are.** The re-render cost is inferred from the numbers above, not yet measured; treat it as a hypothesis to test in 4c, not a settled fact.
- [ ] **4d.** Only after 4c shows a real win: consider whether `state.project` (the random-string change token) can become a finer-grained invalidation signal. This is the deepest change in the plan and is optional.

**Cost:** 1–2 weeks. **Confidence it's really better: genuine but unproven** — the largest available win and the
most likely to bite. The per-panel, per-commit sequencing exists so you can stop at any point and keep the gains.

---

## Deferred (not in this plan)

`engine/src/` — 25,274 LOC, 111 files. Recorded here so the reasoning isn't lost:

- `Project.js` is **2,030 lines** and owns assets, selection, history, mouse input, keyboard input, zoom, focus, and serialization. It is a god object, but a fairly organized one — and it owns `_serialize`/`_deserialize`. **Getting that wrong corrupts users' saved `.wick` files**, the worst failure mode in this repo.
- The build is `gulp-concat` over a **hand-maintained ordered list of 111 files**, producing **93** bare `Wick.* =` global assignments. Replacing it with a real module build is the highest-value engine change and the prerequisite for everything else there.
- **64** test scripts are wired into `engine/tests/index.html` (56 top-level + the `paper-ext/` set), and every one of them exists on disk. Two top-level files are **not** listed and therefore never run: `test.Wick.SVGAsset.js`, and `test Wick.SVGFile.js` — note the **space** in that second filename, which is very likely why it was never wired up. **Cheap win — wire both up (or delete them) independently of any refactor.**
- `paper-ext/` carries **17** prototype/inject patches on paper.js.

When the engine's turn comes, the order is: wire up the orphan tests → make the engine suite runnable
headlessly in CI → replace gulp-concat with a module build → only then consider splitting `Project.js`.

---

## Baseline measurements (2026-08-18, at `pre-refactor`)

Re-run these after each phase to confirm the plan is actually moving the numbers.

```
src/ LOC                                19,831   (120 files, 103 components, 77 scss)
engine/src LOC                          25,274   (112 files)
EditorCore.jsx                           1,906 lines / 137 methods
Editor.jsx                               1,277 lines
Inspector.jsx                            1,037 lines
MobileInspector.jsx                        891 lines
props drilled in Editor.jsx render          199
props.editor read sites / editor= passed  85 / 3
projectDidChange call sites                  73
PureComponent + memo + sCU uses               2
components reading props.project        11 of 103
tests in src/                                 0
engine tests wired / unwired               64 / 2
console.log in src/ / engine/            19 / 32
bootstrap.min.css imports in src/             15
uncommitted at plan time            3,933 lines across 38 files + 8 untracked paths
```
