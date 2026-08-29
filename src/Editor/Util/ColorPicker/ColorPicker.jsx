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

import React, { useState, useRef, useEffect } from 'react';
import { Popover } from 'reactstrap';
import WickColorPicker from 'Editor/Util/ColorPicker/WickColorPicker';
import { CHECKERBOARD_URL } from 'Editor/Util/ColorPicker/ColorPickerComponents/ColorPickerComponents';

import './_colorpicker.scss';

function arraysEqual(arr1, arr2) {
  if (arr1 === arr2) return true;
  if (!arr1 || !arr2) return false;
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return false;
  }
  return true;
}

export default function ColorPicker (props) {
  const [open, setOpen] = useState(false);
  const [lastObjects, setLastObjects] = useState(props.selectedObjects);
  const buttonRef = useRef(null);
  // Where the pointer went down for the gesture that produced the current click.
  const mouseDownRef = useRef({ target: null, insidePopover: false });

  if (!arraysEqual(props.selectedObjects, lastObjects)) {
    setLastObjects(props.selectedObjects);

    // Close pop-up if selection changed
    if (open)
      toggle();
  }
  let itemID = props.id;
  let popoverID = itemID+'-popover';

  // reactstrap closes the popover on the *click* event, but a slider drag that
  // starts inside the popover and ends outside of it produces exactly that click.
  // Record where the gesture began so `toggle` can tell the two apart.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      const popoverEle = document.getElementById(popoverID);
      mouseDownRef.current = {
        target: e.target,
        insidePopover: !!(popoverEle && popoverEle.contains(e.target)),
      };
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
    };
  }, [open, popoverID]);

  function toggle (e) {
    if (!open) {
      setTimeout(selectPopover, 200);
      setOpen(true);
      return;
    }

    if (!e) {
      // `toggle()` with no event: the popover's own close button (ActionButton calls
      // action() with no arguments) or a programmatic close on selection change.
      setOpen(false);
      return;
    }

    // The popover renders through a portal on <body>, but React still bubbles its
    // events up to this button, so a click on a swatch or slider arrives here too.
    // Those are interactions with the picker, not requests to dismiss it.
    const popoverEle = document.getElementById(popoverID);
    if (popoverEle && popoverEle.contains(e.target)) return;

    // A click on the picker button itself toggles it shut.
    if (buttonRef.current && buttonRef.current.contains(e.target)) {
      setOpen(false);
      return;
    }

    // Everything below is reactstrap's outside-click handler.
    const mouseDown = mouseDownRef.current;
    mouseDownRef.current = { target: null, insidePopover: false };

    // Don't close if the gesture started on the popover (dragging a slider out of it)
    if (mouseDown.insidePopover) return;

    // Don't close if clicked on selected objects
    let clickedCanvas = (e.touches ? e.target : mouseDown.target) === props.targetCanvas;
    let selectionUnchanged = arraysEqual(props.selectedObjects, lastObjects);
    if (clickedCanvas && selectionUnchanged) return;

    setOpen(false);
  }

  function selectPopover () {
    let ele = document.getElementById(popoverID);
    if (ele)
      ele.focus();
  }

  let color = props.color ? props.color : new window.Wick.Color("#FFFFFF")
  let colorCSS = color;
  let colorCSSOpaque = color;
  if (color instanceof window.paper.Color) {
    if (color.gradient) {
      colorCSS = colorCSSOpaque = 'linear-gradient(to right';

      const sortedControlStops = color.gradient.stops.toSorted((objectA, objectB) => objectA.offset - objectB.offset);
      sortedControlStops.forEach(paperControlStop => {
          colorCSS += `, ${paperControlStop.color.toCSS()} ${paperControlStop.offset * 100}%`;
          let { red, green, blue } = paperControlStop.color;
          colorCSSOpaque += `, rgb(${red*255},${green*255},${blue*255}) ${paperControlStop.offset * 100}%`;
      });
      colorCSS += ')';
      colorCSSOpaque += ')';
    }
    else
      colorCSS = color.toCSS();
  }
  // Bring desynced color state up, so if the solid-gradient state updates, the pop-up position updates
  const [desyncedColor, setDesyncedColor] = useState(color);

  return (
      <button
        className="btn-color-picker"
        aria-label="color picker button"
        id={itemID}
        ref={buttonRef}
        onClick={toggle}
        style={props.stroke ?
          { borderColor: colorCSS } :
          color.gradient ?
          { backgroundImage: `${colorCSS}, ${CHECKERBOARD_URL}`, backgroundColor: 'white' } :
          { backgroundColor: colorCSS }
        }>
          {(!props.stroke && color.gradient) &&
          <div className="btn-color-picker-background-opaque"
            style={{ backgroundImage: colorCSSOpaque }} />
          }
          <Popover
            tabIndex={-1}
            id={popoverID}
            placement={props.placement}
            isOpen={open}
            toggle={toggle}
            target={itemID}
            boundariesElement={'viewport'}>
            <WickColorPicker
              toggle={toggle}
              colorPickerType={props.colorPickerType}
              changeColorPickerType={props.changeColorPickerType}
              disableAlpha={props.disableAlpha}
              enableGradient={props.enableGradient}

              color={color}
              desyncedColor={desyncedColor}
              onDesyncedChange={setDesyncedColor}
              onChangeComplete={props.onChangeComplete}
              onChangeIntermediate={props.onChangeIntermediate}

              selectedObjectsBounds={props.selectedObjectsBounds}
              setGradientActive={props.setGradientActive}
              setGradientInactive={props.setGradientInactive}
              getSelectedStopIndex={props.getSelectedStopIndex}
              setSelectedStopIndex={props.setSelectedStopIndex}

              lastColorsUsed={props.lastColorsUsed}
              updateLastColors={props.updateLastColors}
            />
          </Popover>
      </button>
  )
}
