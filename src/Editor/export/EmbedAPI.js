/*
 * Copyright 2020 WICKLETS LLC
 *
 * This file is part of Wick Editor.
 *
 * Wick Editor is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Wick Editor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Wick Editor.  If not, see <https://www.gnu.org/licenses/>.
 */

import VideoExport from './VideoExport';
import GIFExport from './GIFExport';

/**
 * Version of the surface this file registers on the window.
 *
 * Bump it whenever a global is added, removed or changes shape, so a host can
 * check up front rather than discovering a stale deploy as
 * "makeWickMp4Export is not a function" thrown from a callback at the moment
 * the user expects their work back.
 *
 *   1 - the original surface (never stamped: on that build
 *       getWickApiVersion is undefined, which is how a host detects it).
 *   2 - adds newWickProject, getWickProjectInfo, getWickProjectRevision,
 *       getWickApiVersion, the ?embed / ?width / ?height / ?framerate URL
 *       parameters and the 'wick-editor-close-request' event.
 *   3 - adds transparent backgrounds: makeWickMp4Export({format}),
 *       newWickProject({transparent}), transparentBackground in
 *       getWickProjectInfo(), and the ?transparent URL parameter.
 */
export const WICK_EMBED_API_VERSION = 3;

/**
 * Export API for embedding the editor in a host page.
 *
 * These functions render the *current* project and hand the result straight
 * back to the caller instead of triggering a download or opening a modal, so a
 * host page holding a same-origin iframe can do:
 *
 *   await iframe.contentWindow.wickEditorReady;
 *   const html = await iframe.contentWindow.makeWickHtmlExport();
 *
 * Every function returns a Promise. Text formats (HTML, SVG) resolve to a
 * string; binary formats (GIF, MP4, PNG sequence) resolve to a Blob.
 *
 * makeWickProjectData()/loadWickProjectData() are the pair to use when the host
 * page wants to *play* the project rather than save a file of it — see
 * public/player.html and public/host-demo.html.
 *
 * Alongside the exporters this file registers newWickProject() (blank project at
 * a chosen stage size, optionally transparent), getWickProjectInfo() (stage size,
 * transparency and duration readback),
 * getWickProjectRevision() (has anything been edited?) and getWickApiVersion().
 * The knobs that must take effect during boot — before wickEditorReady resolves
 * — are URL parameters instead; see EmbedMode.js.
 *
 * All of them accept an optional args object:
 *   {
 *     width,      // defaults to the project width
 *     height,     // defaults to the project height
 *     onProgress, // (message, percent) => void
 *   }
 * (HTML and SVG export in one shot and ignore these.)
 */

/**
 * Attaches the export API to the window. Called once, from Editor.componentDidMount.
 * @param {Editor} editor - the live editor instance.
 */
export function registerEmbedAPI (editor) {
  window.makeWickHtmlExport = () => makeWickHtmlExport(editor);
  window.makeWickSvgExport = () => makeWickSvgExport(editor);
  window.makeWickGifExport = (args) => makeWickGifExport(editor, args);
  window.makeWickMp4Export = (args) => makeWickMp4Export(editor, args);
  window.makeWickPngSequenceExport = (args) => makeWickPngSequenceExport(editor, args);
  window.makeWickProjectData = (args) => makeWickProjectData(editor, args);
  window.loadWickProjectData = (data, args) => loadWickProjectData(editor, data, args);
  window.newWickProject = (args) => newWickProject(editor, args);
  window.getWickProjectInfo = () => getWickProjectInfo(editor);
  window.getWickProjectRevision = () => getWickProjectRevision(editor);
  window.getWickApiVersion = () => WICK_EMBED_API_VERSION;

  // Grouped alias, for hosts that would rather not reach for six globals.
  window.wickExport = {
    html: window.makeWickHtmlExport,
    svg: window.makeWickSvgExport,
    gif: window.makeWickGifExport,
    mp4: window.makeWickMp4Export,
    pngSequence: window.makeWickPngSequenceExport,
    projectData: window.makeWickProjectData,
  };

  // Resolved once a project is live and the API is safe to call. The host can
  // also listen for the 'wick-editor-ready' event on this window.
  window.wickEditorReady = Promise.resolve(editor);
  window.dispatchEvent(new Event('wick-editor-ready'));
}

/**
 * Bundles the project into the standalone single-file HTML player.
 * @returns {Promise<string>} the complete HTML document (~2.2MB: the engine is inlined).
 */
export async function makeWickHtmlExport (editor) {
  let project = requireProject(editor);

  return new Promise(resolve => {
    window.Wick.HTMLExport.bundleProject(project, html => resolve(html));
  });
}

/**
 * Renders the active timeline to SVG.
 * @returns {Promise<string>} the SVG source.
 */
export async function makeWickSvgExport (editor) {
  let project = requireProject(editor);

  return new Promise((resolve, reject) => {
    window.Wick.SVGFile.toSVGFile(
      project.activeTimeline,
      message => reject(new Error('SVG export failed: ' + message)),
      blob => blob.text().then(resolve, reject));
  });
}

/**
 * Renders the project to an animated GIF.
 * @returns {Promise<Blob>} the .gif file.
 */
export async function makeWickGifExport (editor, args) {
  let project = requireProject(editor);
  let {width, height, onProgress} = args || {};

  return new Promise((resolve, reject) => {
    GIFExport.createAnimatedGIFFromProject({
      project: project,
      width: width,
      height: height,
      onProgress: (message, percent) => onProgress && onProgress(message, percent),
      onError: message => reject(new Error('GIF export failed: ' + message)),
      onFinish: resolve,
    });
  });
}

/**
 * Renders the project to a video.
 *
 * 'mp4' (the default) is H.264, encoded by the browser itself through WebCodecs, so it
 * plays in a <video> tag. It has no alpha channel, so a transparent project is flattened
 * onto its background color. On a browser without WebCodecs this falls back to the
 * bundled encoder's MPEG-4 Part 2, which most browsers will *not* play — see
 * export/WebCodecsEncoder.js.
 *
 * The two formats that say something about alpha:
 *
 *   'mov'      QuickTime RLE, lossless per-pixel alpha. What an NLE wants; no browser
 *              will play it in a <video> tag. Resolves to a video/quicktime blob, so
 *              name the file .mov.
 *   'mp4matte' the same H.264 mp4, but each frame is double height: premultiplied color
 *              on top, alpha as greyscale below. Plays in a browser like any other mp4,
 *              and a consumer that knows the convention recombines the halves with
 *              `color = top + destination * (1 - bottom)`.
 *
 * @param {object} args - {width, height, format: 'mp4' (default) | 'mov' | 'mp4matte', onProgress}
 * @returns {Promise<Blob>} the video file.
 */
export async function makeWickMp4Export (editor, args) {
  let project = requireProject(editor);
  let {width, height, format, onProgress} = args || {};

  if (format !== undefined && !VideoExport.VIDEO_FORMATS[format]) {
    throw new Error('Wick export API: unsupported video format "' + format + '". '
      + 'Expected one of ' + Object.keys(VideoExport.VIDEO_FORMATS).join(', ') + '.');
  }

  return new Promise((resolve, reject) => {
    VideoExport.renderVideo({
      project: project,
      width: width,
      height: height,
      format: format,
      skipDownload: true,
      onProgress: (message, percent) => onProgress && onProgress(message, percent),
      onError: message => reject(new Error('Video export failed: ' + message)),
      onFinish: resolve,
    }).catch(reject);
  });
}

/**
 * Renders every frame of the project to a PNG and zips them up.
 * @returns {Promise<Blob>} a .zip of frame000000000000.png, frame000000000001.png, ...
 */
export async function makeWickPngSequenceExport (editor, args) {
  let project = requireProject(editor);
  let {width, height, onProgress} = args || {};

  return new Promise((resolve, reject) => {
    window.Wick.ImageSequence.toPNGSequence({
      project: project,
      width: width,
      height: height,
      onProgress: (completed, total) => {
        onProgress && onProgress('Rendered ' + completed + '/' + total + ' frames', 100 * (completed / total));
      },
      onError: message => reject(new Error('PNG sequence export failed: ' + message)),
      onFinish: resolve,
    });
  });
}

/**
 * Bundles the project into a .wick file: project data (timeline, layers, frames,
 * paths, clips, scripts, tweens) plus its assets, and nothing else — no engine.
 *
 * This is the payload to hand a host page that wants to play the project. A
 * player page that loads corelibs/wick-engine/wickengine.js — the same URL, and
 * therefore the same HTTP cache entry, this editor loaded — can run it with
 * Wick.WickFile.fromWickFile(). Kilobytes, against the ~2.2MB of
 * makeWickHtmlExport(), which inlines a whole copy of the engine.
 *
 * @param {object} args - {format: 'base64' (default) | 'blob' | 'arraybuffer'}.
 *   base64 is the one to use for postMessage/localStorage.
 * @returns {Promise<string|Blob|ArrayBuffer>} the .wick file.
 */
export async function makeWickProjectData (editor, args) {
  let project = requireProject(editor);
  let format = (args && args.format) || 'base64';

  if (['base64', 'blob', 'arraybuffer'].indexOf(format) === -1) {
    throw new Error('Wick export API: unsupported project data format "' + format + '".');
  }

  let file = await new Promise(resolve => {
    window.Wick.WickFile.toWickFile(project, resolve, format === 'base64' ? 'base64' : 'blob');
  });

  return format === 'arraybuffer' ? file.arrayBuffer() : file;
}

/**
 * The other direction: replaces the editor's project with one produced by
 * makeWickProjectData(). This throws away the current project *and* its undo
 * history, so the host should confirm with the user first.
 * @param {string|Blob|ArrayBuffer} data - a .wick file.
 * @param {object} args - {format: 'base64' (default) | 'blob' | 'arraybuffer'}.
 * @returns {Promise<Wick.Project>} the project now open in the editor.
 */
export async function loadWickProjectData (editor, data, args) {
  if (!editor) {
    throw new Error('Wick export API: the editor is not ready yet. Await window.wickEditorReady first.');
  }
  if (!data) {
    throw new Error('Wick export API: no project data given.');
  }

  // JSZip sniffs Blob/ArrayBuffer/Uint8Array on its own, so only base64 needs
  // to be declared.
  let format = (args && args.format) === 'base64' ? 'base64' : 'blob';

  return new Promise((resolve, reject) => {
    window.Wick.WickFile.fromWickFile(data, project => {
      if (!project) {
        reject(new Error('Wick export API: could not read the project data.'));
        return;
      }
      editor.setupNewProject(project);
      resolve(project);
    }, format);
  });
}

/**
 * Replaces the open project with a blank one at a caller-chosen stage size.
 * Like loadWickProjectData(), this throws away the current project and its undo
 * history.
 *
 * A host creating a new document wants a known stage, not the editor's built-in
 * 720x480 default. To avoid the default flashing up before this call lands, boot
 * the iframe with ?width=…&height=…&framerate=… instead — see EmbedMode.js.
 *
 * @param {object} args - {width, height, framerate, name, transparent}; each
 *   defaults to the Wick.Project default. transparent gives the project no
 *   background, so the stage renders with alpha.
 * @returns {Promise<Wick.Project>} the blank project now open in the editor.
 */
export async function newWickProject (editor, args) {
  if (!editor) {
    throw new Error('Wick export API: the editor is not ready yet. Await window.wickEditorReady first.');
  }

  let {width, height, framerate, name, transparent} = args || {};
  let options = {};

  if (width !== undefined) options.width = width;
  if (height !== undefined) options.height = height;
  if (framerate !== undefined) options.framerate = framerate;
  if (name !== undefined) options.name = name;
  if (transparent !== undefined) options.transparentBackground = !!transparent;

  let project = new window.Wick.Project(options);
  editor.setupNewProject(project);
  return project;
}

/**
 * What the host needs to size its own container to the animation.
 *
 * Read straight off the live project every call rather than cached, so a stage
 * size the user changed mid-edit is reflected: a host sizing from a stale
 * assumption letterboxes the video it gets back.
 *
 * @returns {object} {width, height, framerate, frameCount, durationMs, name,
 *   transparentBackground, backgroundColor}. backgroundColor is what the formats
 *   that cannot carry alpha will flatten onto.
 */
export function getWickProjectInfo (editor) {
  let project = requireProject(editor);
  let frameCount = project.root.timeline.length;

  return {
    width: project.width,
    height: project.height,
    framerate: project.framerate,
    frameCount: frameCount,
    durationMs: project.framerate ? (frameCount / project.framerate) * 1000 : 0,
    name: project.name,
    transparentBackground: !!project.transparentBackground,
    backgroundColor: project.backgroundColor.hex,
  };
}

/**
 * A counter bumped by every project mutation (everything goes through
 * Editor.projectDidChange).
 *
 * The host records it when it hands a document over and compares when it takes
 * it back; equal means nothing was edited and the export can be skipped. That
 * matters because an mp4 export is frame rendering plus an ffmpeg mux — seconds,
 * not milliseconds — so re-running it every time a user opens and closes a
 * document without drawing is the difference between instant and broken.
 *
 * A counter rather than a dirty flag: it survives the host missing an event or
 * reconnecting to an already-open editor, where a flag consumed once does not.
 *
 * Two things to know before comparing values:
 *
 * - It is deliberately conservative. Everything routes through
 *   projectDidChange(), including a few view-only operations (recentering the
 *   canvas, stopping preview playback), so a bump does not prove the document
 *   changed. Equal therefore means "definitely unchanged, safe to skip the
 *   export"; unequal only means "might have changed, so export". Erring this
 *   way costs a redundant export, never a lost edit.
 *
 * - Take the baseline once the document is actually in place: right after
 *   loadWickProjectData() or newWickProject() resolves. Boot settles
 *   asynchronously and lands one more bump shortly after wickEditorReady
 *   resolves, so a baseline read at ready on the editor's own blank project is
 *   stale by one and will read as changed.
 *
 * @returns {number} a monotonically increasing integer.
 */
export function getWickProjectRevision (editor) {
  if (!editor) {
    throw new Error('Wick export API: the editor is not ready yet. Await window.wickEditorReady first.');
  }
  return editor._projectRevision || 0;
}

/**
 * Fired from the editor's own "done" button, which replaces new/open/save in the
 * menu bar when ?embed is set. The host listens for it on the iframe's window:
 *
 *   frame.contentWindow.addEventListener('wick-editor-close-request', ...)
 *
 * A host must still provide its own close control: key events raised inside an
 * iframe never reach the host document, so Esc-to-close can only ever be the
 * host's. This is the in-editor gesture users reach for first, nothing more.
 */
export function requestEmbedClose () {
  window.dispatchEvent(new Event('wick-editor-close-request'));
}

function requireProject (editor) {
  if (!editor || !editor.project) {
    throw new Error('Wick export API: no project is loaded yet. Await window.wickEditorReady first.');
  }
  return editor.project;
}
