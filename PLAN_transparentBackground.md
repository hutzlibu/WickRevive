# Plan: transparent project background

Goal: a Wick project can have **no background** — the stage renders with alpha — and that
transparency survives all the way through **video export**, plus the PNG sequence, HTML
export and the embed/player loop. GIF is explicitly out of scope (see *Formats that flatten*).

---

## 0. What the bundled encoder can actually do (measured, not assumed)

`public/corelibs/video/ffmpeg.js` is **FFmpeg 2.2.1 (2014), from bgrins/videoconverter.js**,
compiled with emscripten 1.12 as asm.js. It was probed by running it under node
(`ffmpeg_run({arguments:['-encoders']})`); every claim below is from that run or a real
encode/decode round trip, not from the docs.

| Fact | Consequence |
|---|---|
| **No `libx264`, no `libvpx`.** The mp4 export's video stream is really **MPEG-4 Part 2** (`mpeg4`), picked as the mp4 muxer default. | Neither H.264-with-alpha (doesn't exist) nor WebM/VP8-with-alpha (no encoder) is reachable. |
| **No zlib.** PNG encode dies with `missing function: deflateInit2_`, PNG decode with `inflateInit_`. | **ffmpeg cannot read the PNG frames.** The video path's frame transport must be zlib-free. |
| `qtrle` (QuickTime Animation) encoder + `mov` muxer are present. | Alpha video *is* reachable, as `.mov`. |
| `prores_ks` (ProRes 4444, `yuva444p10le`) and `ffv1` are also present. | Optional higher-fidelity alpha targets. |
| `bmp` (32-bit BGRA) and `targa` (RLE, 32-bit) encode **and decode** fine, alpha intact. | These are the viable frame transports. |
| `aac` present but experimental (hence the existing `-strict -2`). | Audio muxes into `.mov` the same way it does into `.mp4`. |

**Verified round trip** (rawvideo RGBA → 32-bit TGA frames → `-c:v qtrle out.mov` → decode
back to RGBA): corner pixel `[0,200,255,0]`, centre `[0,200,255,255]`, 3/3 frames. Alpha is
preserved exactly. TGA-RLE frames were **674 bytes** where the same frame as BMP was
**16,438** — RLE matters a lot for flat vector art (see *Risks*).

### So: "transparent mp4" has to mean one of two things

H.264/MPEG-4 Part 2 has no alpha channel. Two honest deliverables, both in scope:

1. **`.mov` / QuickTime RLE** — genuine per-pixel alpha, lossless, what Premiere / After
   Effects / Resolve / FCP expect. *Not playable in a browser `<video>`.*
2. **Alpha-matte `.mp4`** — the container and codec stay exactly as today; frames are
   rendered at **2× height**: colour (composited over black) on top, alpha as greyscale
   below. Plays anywhere, and any consumer that knows the convention (our `player.html`, a
   host page, a Unity/WebGL shader) recombines it in one line of shader maths. This is the
   answer to "must work with mp4 video export".

Plain `.mp4` stays the default and flattens onto the matte colour (§5).

---

## 1. Model: `Project.transparentBackground`

A boolean flag rather than alpha inside `backgroundColor`, because three call sites read
`backgroundColor.hex` and silently drop alpha (`FillBucket.js:62` uses it for gap-fill
detection, `Project.inject():1620`, `View.Project.js:301`), and because keeping the colour
around gives us a free matte/preview value for the formats that must flatten.

`engine/src/base/Project.js`:
- constructor (~`:40`): `this._transparentBackground = args.transparentBackground || false;`
- `deserialize` (~`:167`): `this._transparentBackground = data.transparentBackground || false;`
- `serialize` (~`:188`): `data.transparentBackground = this._transparentBackground;`
- getter/setter beside `backgroundColor` (`:278`–`:284`).

Old `.wick` files lack the key and default to opaque; new files opened in stock Wick Editor
ignore the key and render opaque. Both directions degrade quietly, which is what we want.

## 2. Rendering the transparent stage

`engine/src/view/View.Project.js`:

- **`_generateSVGCanvasStage()` (`:411`)** — when transparent, don't fill. For the *editor*
  (`!this.model.isPublished`) draw a checkerboard instead so the user can see the stage
  bounds and tell "transparent" from "white". paper.js `fillColor` takes no pattern, so:
  render a checkerboard into an offscreen canvas at stage size once and add it as a
  `paper.Raster`, cached and invalidated on width/height change. If that turns fiddly, a
  flat light-grey fill is an acceptable v1 — but then the transparency is invisible while
  editing, so the checkerboard is the intended target.
- **Black bars (`:404`)** — `isPublished && renderBlackBars` currently paints opaque black
  rects right up to the stage edge (`_generateSVGBorders`, `:449`, with a `0.5px`
  `strokeOffset` that bleeds onto the border pixel). Add `&& !transparentBackground`.
  Note `Project.js:1784` sets `renderBlackBars = true` under a comment that says "Turn off
  black bars" — the comment is wrong, don't be misled by it.
- **`_updateCanvasContainerBGColor()` (`:295`)** — the in-clip branch uses
  `backgroundColor.hex`; when transparent, fall back to the editor border colour.
- **`Project.inject()` (`Project.js:1620`)** — `canvasBGColor = backgroundColor.hex` makes an
  embedded project opaque. When transparent, leave it unset and let the canvas be
  see-through so the host page shows through.

## 3. Editor UI

- `ProjectSettings.jsx`: a **"Transparent background"** checkbox next to the colour swatch
  (`:285`); keep the swatch enabled but relabel it as the matte/preview colour when checked.
  Thread it through `state` (`:69`, `:159`), `acceptProjectSettings` (`:140`) and
  `reset` (`:153`).
- `EditorCore.jsx:819`: add `transparentBackground` to `validKeys` in
  `updateProjectSettings`, or the setting is dropped on the way to the project.
- The colour picker already supports alpha (`ColorPickerComponents.jsx:130`, `disableAlpha`
  prop) — we are *not* using that route, but leave it alone.

## 4. Frame capture with alpha

`Project.generateImageSequence()` (`engine/src/base/Project.js:1773`) is the single choke
point for every rendered-frame export.

- Force `imageType = 'image/png'` and `renderBlackBars = false` when the project is
  transparent. That alone fixes the **PNG sequence** export (it stays in-browser and never
  touches ffmpeg) and the embed API's `makeWickPngSequenceExport`.
- Add `args.frameFormat: 'image' | 'raw'`. In `'raw'` mode, `getImageData()` off
  `renderCopy.view.canvas` after `paper.view.update()` (`:1857`–`:1859`) and push
  `{data, width, height}` instead of building an `Image` from a data URL. The video path
  needs pixels, and this skips the base64 encode/decode round trip entirely. The canvas is
  untainted — Wick assets are data URLs.
- Watch the devicePixelRatio dance (`:1797`, `:1815`): the container is sized
  `args.width/devicePixelRatio` so the backing store lands on `args.width`. Assert the
  `getImageData` dimensions match rather than trusting it.

## 5. Video export

New helper `src/Editor/export/AlphaFrameEncoder.js` — writes a `Uint8ClampedArray` of RGBA
to a **32-bit TGA** (type 10, RLE, descriptor `0x28`: 8 alpha bits + top-down origin), ~40
lines. Ship BMP alongside it as the dumb fallback if the RLE encoder misbehaves. **Not PNG**
— the bundled ffmpeg cannot inflate it.

`src/Editor/export/VideoExport.js`:
- `_generateProjectImages` (`:34`): on the alpha path request `frameFormat:'raw'` and write
  `frame%12d.tga` instead of base64-decoding JPEGs (`:60`–`:74`).
- `_generateVideo` (`:82`): pick the command by mode.
  - **alpha `.mov`**: drop `-pix_fmt yuv420p` and `-q:v`, add `-c:v qtrle`, output `out.mov`,
    blob type `video/quicktime`, extension `.mov`. Keep `-filter:v showinfo` (passthrough,
    and `_parseProgressMessage` at `:215` depends on it) and the `<6 fps` `setpts` guard
    (`:170`).
  - **matte `.mp4`**: pack each frame to double height in a canvas before encoding; the
    existing command is unchanged apart from `-s WxH*2`.
  - `_ensureValidDimensions` (`:198`) exists for the mpeg4 encoder's even-dimension rule;
    qtrle doesn't need it, so skip the 1px crop on the `.mov` path.
- `EditorCore.exportProjectAsVideo` (`:1213`): thread the format through; the toast and
  success message hardcode ".mp4" (`:1239`).
- `ExportOptions.jsx` `renderVideoObject` (`:274`): a format choice — **MP4** /
  **MOV (transparent)** / **MP4 + alpha matte** — surfaced only when the project is
  transparent, and fix the "Creates an .mp4 file" row to match.

## 6. Everything downstream

- **`player.html`** — hardcodes `background: #1a1a1e` (`:13`). Add a `transparent` postMessage
  command (or `?transparent`) so the host can see through to its own page; document it in
  the protocol comment at the top of the file.
- **HTML export** (`engine/src/export/html/project.html`) — the template sets no background,
  so it works for free once `inject()` (§2) stops forcing one.
- **Embed API** (`src/Editor/export/EmbedAPI.js`) — `makeWickMp4Export({alpha})`,
  `transparentBackground` in `getWickProjectInfo()`, `newWickProject({transparent})`, and a
  boot-time **`?transparent=1`** in `EmbedMode.js` alongside `?width`/`?height`/`?framerate`
  (same reasoning: it must land before the blank project is built). Bump
  `WICK_EMBED_API_VERSION` to **3** and update the table in `CLAUDE.md`.
- **Formats that flatten** — GIF (`gif.js` renders alpha as black) and any plain `.mp4`
  composite over `backgroundColor` first, so nothing silently turns black. Per the brief,
  GIF gets no alpha support; it just must not break.
- **SVG export** — check whether it emits a background rect; if it does, gate it on the flag.
  Transparency is otherwise free there.
- **`FillBucket.js:62`** — `backgroundColor.hex` is fine as-is (it only needs an RGB
  reference for gap detection), but confirm hole-filling on a transparent stage behaves.

## 7. Verification

- `npm run build-engine` after every `engine/src` change, and **commit both** `engine/dist/`
  and `public/corelibs/wick-engine/` (stale copies are the classic footgun here).
- Engine suite (`npm test` → `http://localhost:9999/tests/index.html`): add a serialize /
  deserialize round-trip for the flag, and a default-false check on a legacy fixture.
- ffmpeg pipeline: the node probe used for §0 is the cheapest regression test
  (encode → decode → assert corner alpha 0, centre alpha 255). Worth keeping as a script.
- Manual: `host-demo.html`, transparent project, "Send to player" over a coloured host page.
- Manual: the exported `.mov` opens with alpha in a real NLE.

## Risks / decisions to make

- **memfs memory is the real ceiling.** Every frame is held in the worker at once and
  `worker-asm.js` pins `TOTAL_MEMORY` at 256MB. A 1080p BMP frame is 8.3MB — ~30 frames and
  it's gone. TGA-RLE is what makes this workable for flat vector art (24× smaller in the
  probe), but photographic/gradient content will still hit the wall. Mitigations: bump
  `TOTAL_MEMORY` to 512MB (must stay a power of two), and refuse/warn above a computed
  frame budget. This limit exists today with JPEG frames; alpha only makes it tighter.
- **qtrle is lossless** — large files on gradient-heavy art. `prores_ks -profile:v 4444` is
  the alternative if size becomes a complaint (encoder confirmed present, round trip not yet
  measured).
- **`.mov` won't play in a browser.** It is a hand-off-to-an-editor format. The alpha-matte
  `.mp4` is the web-playable half of the answer, and the two together are why both are in
  the plan.
- **Optional, much bigger: replace the encoder.** Swapping videoconverter.js for a modern
  single-threaded `ffmpeg.wasm` core buys real H.264, zlib/PNG, and **VP9 `yuva420p` WebM** —
  transparent video that plays in a plain browser `<video>` tag, which is the format we'd
  actually want. Cost: a ~25MB core, a new worker API, and a re-test of the whole export
  path. Not required for this feature; the right time to consider it is if the memory
  ceiling above starts blocking real projects.

## Suggested order

1. §1 model + §2 rendering + §3 UI — transparency visible and persisted end to end.
2. §4 frame capture — PNG sequence and HTML export become correct for free.
3. §5 `.mov` alpha export — the headline.
4. §5 matte `.mp4` + §6 player/embed — the web-playable half.
5. §6 flatten guards + §7 tests.
