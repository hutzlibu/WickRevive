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

import React, { Component } from 'react';
import { DropTarget } from 'react-dnd';
import DragDropTypes from 'Editor/DragDropTypes.js';

import ContextMenu from 'Editor/Util/ContextMenu/ContextMenu';
import HotKeyInterface from 'Editor/hotKeyMap';

import './_canvas.scss';

// Value from Editor/_wickbrand.scss $editor-canvas-border
const EDITOR_CANVAS_BORDER = '#6A6A6A';

class Canvas extends Component {
  constructor (props) {
    super(props);

    this.canvasContainer = React.createRef();

    this.state = {
      contextMenu: null, // {x, y} of the open right click menu, null if closed.
    };
  }

  componentDidMount() {
    this.attachProjectToComponent(this.props.project);

    this.updateCanvas(this.props.project);

    // paper.js tools don't check which mouse button was pressed, so right clicks
    // have to be swallowed before they reach the canvas element.
    let container = this.canvasContainer.current;
    container.addEventListener('mousedown', this.swallowRightClick, true);
    container.addEventListener('pointerdown', this.swallowRightClick, true);

    this.props.onRef(this);
  }

  componentWillUnmount () {
    let container = this.canvasContainer.current;
    if(!container) return;
    container.removeEventListener('mousedown', this.swallowRightClick, true);
    container.removeEventListener('pointerdown', this.swallowRightClick, true);
  }

  swallowRightClick = (e) => {
    if(e.button !== 2) return;
    e.preventDefault();
    e.stopPropagation();
  }

  componentDidUpdate () {
    this.updateCanvas(this.props.project);
  }

  attachProjectToComponent = (project) => {
    if(this.currentAttachedProject === project) return;
    this.currentAttachedProject = project;

    project.view.canvasBGColor = EDITOR_CANVAS_BORDER;
    project.view.canvasContainer = this.canvasContainer.current;
    project.view.resize();

    project.view.on('canvasModified', (e, actionName) => {
      this.props.projectDidChange({ actionName: `Canvas Modified ${actionName}` });
    });

    project.view.on('eyedropperPickedColor', (e) => {
      this.props.onEyedropperPickedColor(e);
    });
  }

  updateCanvas = (project) => {
    this.attachProjectToComponent(project);
  }

  onContextMenu = (e) => {
    e.preventDefault();

    if(this.props.previewPlaying) {
      this.closeContextMenu();
      return;
    }

    // Right clicking an object acts on that object, not on whatever was selected before.
    if(!this.props.editor.selectObjectAtPosition(e.clientX, e.clientY)) {
      this.closeContextMenu();
      return;
    }

    this.setState({contextMenu: {x: e.clientX, y: e.clientY}});
  }

  closeContextMenu = () => {
    if(!this.state.contextMenu) return;
    this.setState({contextMenu: null});
  }

  getContextMenuItems = () => {
    let editor = this.props.editor;
    // Use the full key map so the hotkeys are still shown while preview is playing.
    let keyMap = editor.getKeyMap(true);
    let hotkeyOf = (action) => HotKeyInterface.getHotKey(keyMap, action);

    return [
      {label: 'Flip Horizontal', icon: 'flipHorizontal', action: editor.flipSelectedHorizontal, hotkey: hotkeyOf('flip-horizontal')},
      {label: 'Flip Vertical', icon: 'flipVertical', action: editor.flipSelectedVertical, hotkey: hotkeyOf('flip-vertical')},
      {divider: true},
      {label: 'Bring to Front', icon: 'bringToFront', action: editor.sendSelectionToFront, hotkey: hotkeyOf('bring-to-front')},
      {label: 'Bring Forward', icon: 'bringForwards', action: editor.moveSelectionForwards, hotkey: hotkeyOf('move-forwards')},
      {label: 'Send Backward', icon: 'sendBackwards', action: editor.moveSelectionBackwards, hotkey: hotkeyOf('move-backwards')},
      {label: 'Send to Back', icon: 'sendToBack', action: editor.sendSelectionToBack, hotkey: hotkeyOf('send-to-back')},
      {divider: true},
      {label: 'Delete', icon: 'delete', action: editor.deleteSelectedObjects, hotkey: hotkeyOf('delete'), danger: true},
    ];
  }

  render() {
    const { connectDropTarget, isOver } = this.props;
    const { contextMenu } = this.state;

    return connectDropTarget (
      <div id="canvas-container-wrapper" style={{width:"100%", height:"100%"}} aria-label="Canvas" onContextMenu={this.onContextMenu}>
        { isOver && <div className="drag-drop-overlay" /> }
        <div id="wick-canvas-container" ref={this.canvasContainer}></div>
        { contextMenu &&
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={this.getContextMenuItems()}
            onClose={this.closeContextMenu}
          /> }
      </div>
    )
  }
}

// react-dnd drag and drop target params
const canvasTarget = {
  drop(props, monitor, component) {
    const dropLocation = monitor.getClientOffset();
    let draggedItem = monitor.getItem();
    if(draggedItem.files && draggedItem.files.length > 0) {
      // Dropped a file from native filesystem
      if(draggedItem.files[0].name.endsWith('.wick')) {
        // Wick Project (.wick file)
        var file = draggedItem.files[0];
        props.importProjectAsWickFile(file);
      } else {
        // Assets (images, sounds, etc)
        props.createAssets(draggedItem.files, [], {create: true, location: dropLocation});
      }
    } else {
      // Dropped an asset from the asset library
      props.createImageFromAsset(draggedItem.uuid, dropLocation.x, dropLocation.y);
    }
  }
}

function collect(connect, monitor) {
  return {
    connectDropTarget: connect.dropTarget(),
    isOver: monitor.isOver(),
  };
}

export default DropTarget(DragDropTypes.CANVAS, canvasTarget, collect)(Canvas);
