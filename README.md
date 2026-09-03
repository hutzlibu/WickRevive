<h1>Wick Editor</h1>

The Wick Editor is a free and open-source tool for creating games, animations, and everything in-between. It's designed to be the most accessible tool for creating multimedia projects on the web.

The original wick editor is abandoned - and this is a fork mostly done by claude so far.

## Changes

**Build**

- build environment moved to vite
- dropped the Electron desktop build - this is web-only now
- every runtime asset path is relative, so the build can be deployed under a subpath

**Drawing and editing**

- new tool: the pen pencil
- gradient fills, with an on-canvas gradient editor
- right click context menus on the canvas and the timeline
- flip and z-ordering bound to single keys
- the code editor opens over the canvas instead of centered

**Projects and export**

- transparent project backgrounds - the stage can render with alpha, and that survives
  through video, PNG sequence, SVG and HTML export
- video export that actually plays in a browser: H.264 through the browser's own encoder
  where available (the bundled ffmpeg can only write MPEG-4 Part 2, which no browser
  decodes). `.mov` with lossless alpha and a double-height alpha matte `.mp4` are also
  available
- a standalone HTML export button in the menu bar
- an embed API, so a host page can drive the editor in an iframe - see the tables in
  `CLAUDE.md` and `PLAN_wickEmbedAPI.md`, and `public/host-demo.html` for a working harness

## Getting started

You'll need [npm](https://www.npmjs.com/get-npm).

1) Clone this repository:

    ```bash
    git clone https://github.com/hutzlibu/WickRevive/
    ```

2) Change into the newly created folder:

    ```bash
    cd WickRevive
    ```

3) Install all dependencies:

    ```bash
    npm install
    ```

4) Run the editor:

    ```bash
    npm start
    ```

5) Open a web browser and go to `localhost:5173`.

This is a web-only build - there is no desktop/Electron build any more.

## License

Wick Editor is under the GNU v3 Public License. See the [LICENSE](LICENSE.md) for more information.
