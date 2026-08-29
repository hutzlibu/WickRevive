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
 * Renders the project to an MP4 video (frames + audio, muxed by the ffmpeg worker).
 * @returns {Promise<Blob>} the .mp4 file.
 */
export async function makeWickMp4Export (editor, args) {
  let project = requireProject(editor);
  let {width, height, onProgress} = args || {};

  return new Promise((resolve, reject) => {
    VideoExport.renderVideo({
      project: project,
      width: width,
      height: height,
      skipDownload: true,
      onProgress: (message, percent) => onProgress && onProgress(message, percent),
      onError: message => reject(new Error('MP4 export failed: ' + message)),
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

function requireProject (editor) {
  if (!editor || !editor.project) {
    throw new Error('Wick export API: no project is loaded yet. Await window.wickEditorReady first.');
  }
  return editor.project;
}
