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

import queryString from 'query-string';

/**
 * The boot-time half of the embed API.
 *
 * window.wickEditorReady resolves *after* boot, so anything that has to take
 * effect during boot cannot be a function call — by the time a host page can
 * call it, the effect has already happened. Those knobs are URL parameters
 * instead, which an embedding host always controls because it writes the
 * iframe's src:
 *
 *   index.html?embed=1&width=1080&height=1080&framerate=24&transparent=1
 *
 *   embed        - the editor is embedded in a host page that owns persistence.
 *                  Suppresses the autosave-restore prompt, stops autosave writes,
 *                  and swaps new/open/save in the menu bar for a "done" button.
 *   width        - stage width of the project the editor boots with.
 *   height       - stage height.
 *   framerate    - frames per second.
 *   transparent  - the boot project has no background: the stage renders with
 *                  alpha (shown as a checkerboard while editing).
 *
 * The stage parameters are independent of ?embed — they just set up the blank
 * project, and are the flash-free alternative to calling newWickProject() once
 * the editor is up.
 *
 * This module is the one place the URL is read. Everything else asks it a
 * question; nothing threads an embed flag through the editor's internals.
 */

let _params = null;

function params () {
  if (!_params) {
    _params = queryString.parse(window.location.search);
  }
  return _params;
}

/**
 * A bare `?embed` parses to null, so presence is enough — but let a host that
 * builds its URL from a variable turn it off with the obvious spellings rather
 * than by omitting the parameter.
 */
function isFlagSet (value) {
  return value !== undefined && value !== '0' && value !== 'false' && value !== 'no';
}

function positiveNumber (value) {
  let parsed = Number(value);
  return (isFinite(parsed) && parsed > 0) ? parsed : undefined;
}

/**
 * Is the editor running inside a host page that owns the document?
 * @returns {boolean}
 */
export function isEmbedMode () {
  return isFlagSet(params().embed);
}

/**
 * The Wick.Project options named by the URL, ready to hand to the constructor.
 * Absent or nonsense parameters are simply left out, so the project's own
 * defaults apply.
 * @returns {object} - {width?, height?, framerate?, transparentBackground?}
 */
export function getEmbedStageOptions () {
  let urlParams = params();
  let options = {};

  let width = positiveNumber(urlParams.width);
  let height = positiveNumber(urlParams.height);
  let framerate = positiveNumber(urlParams.framerate);

  if (width !== undefined) options.width = width;
  if (height !== undefined) options.height = height;
  if (framerate !== undefined) options.framerate = framerate;
  if (urlParams.transparent !== undefined) {
    options.transparentBackground = isFlagSet(urlParams.transparent);
  }

  return options;
}
