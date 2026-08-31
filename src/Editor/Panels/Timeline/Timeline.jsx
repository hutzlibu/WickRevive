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

import './_timeline.scss';
import 'bootstrap/dist/css/bootstrap.min.css';

import iconLock from 'resources/timeline-icons/locked.png';
import iconUnlock from 'resources/timeline-icons/unlocked.png';
import iconHidden from 'resources/timeline-icons/hidden.png';
import iconShown from 'resources/timeline-icons/shown.png';
import iconCopyForward from 'resources/timeline-icons/copyForward.png';
import iconSplit from 'resources/timeline-icons/cut_frame.png';
import iconLayerTween from 'resources/timeline-icons/layerTween.png';
import iconDelete from 'resources/timeline-icons/delete.png';
import iconSmallFrames from 'resources/timeline-icons/framesSmall.png';
import iconNormalFrames from 'resources/timeline-icons/framesNormal.png';
import iconLargeFrames from 'resources/timeline-icons/framesLarge.png';
import iconFrameSizeMenu from 'resources/timeline-icons/frameSizeMenu.png';
import iconGapFillMenuBlankFrames from 'resources/timeline-icons/gapFillMenuBlankFrames.png';
import iconGapFillMenuExtendFrames from 'resources/timeline-icons/gapFillMenuExtendFrames.png';
import iconGapFillBlankFrames from 'resources/timeline-icons/gapFillBlankFrames.png';
import iconGapFillExtendFrames from 'resources/timeline-icons/gapFillExtendFrames.png';

class Timeline extends Component {
  constructor (props) {
    super(props);

    this.canvasContainer = React.createRef();

    this.state = {
      contextMenu: null, // {x, y, target} of the open right click menu, null if closed.
    };
  }

  componentDidMount () {
    let canvasContainerElem = this.canvasContainer.current;
    this.props.project.guiElement.canvasContainer = canvasContainerElem;
    this.props.project.guiElement.draw();
  }

  componentDidUpdate () {
    var project = this.props.project;

    if(project !== this.currentAttachedProject) {
      // Import icons into the timeline GUI.
      let Icons = window.Wick.GUIElement.Icons;
      Icons.loadIcon('hide_layer', iconShown);
      Icons.loadIcon('show_layer', iconHidden);
      Icons.loadIcon('lock_layer', iconUnlock);
      Icons.loadIcon('unlock_layer', iconLock);
      Icons.loadIcon('copy_frame_forward', iconCopyForward);
      Icons.loadIcon('cut_frame', iconSplit);
      Icons.loadIcon('delete_frame', iconDelete);
      Icons.loadIcon('add_tween', iconLayerTween);
      Icons.loadIcon('small_frames', iconSmallFrames);
      Icons.loadIcon('normal_frames', iconNormalFrames);
      Icons.loadIcon('large_frames', iconLargeFrames);
      Icons.loadIcon('frame_size_menu', iconFrameSizeMenu);
      Icons.loadIcon('gap_fill_menu_blank_frames', iconGapFillMenuBlankFrames);
      Icons.loadIcon('gap_fill_menu_extend_frames', iconGapFillMenuExtendFrames);
      Icons.loadIcon('gap_fill_empty_frames', iconGapFillBlankFrames);
      Icons.loadIcon('gap_fill_extend_frames', iconGapFillExtendFrames);

      if(this.currentAttachedProject) {
        this.currentAttachedProject.guiElement.onProjectModified = () => {};
        this.currentAttachedProject.guiElement.onProjectSoftModified = () => {};
      }

      this.currentAttachedProject = project;
      project.guiElement.onProjectModified(this.onProjectModified);
      project.guiElement.onProjectSoftModified(this.onProjectSoftModified);

      let canvasContainerElem = this.canvasContainer.current;
      this.props.project.guiElement.canvasContainer = canvasContainerElem;
      project.guiElement.draw();
    }

    project.guiElement.canvasContainer = this.canvasContainer.current;
  }

  onContextMenu = (e) => {
    e.preventDefault();

    if(this.props.previewPlaying) {
      this.closeContextMenu();
      return;
    }

    // Right clicking a frame or a tween acts on that object, not on whatever was
    // selected before.
    let target = this.props.project.guiElement.rightClickAtPosition(e.clientX, e.clientY);
    if(!target) {
      this.closeContextMenu();
      return;
    }

    this.props.projectDidChange({ actionName: "Select Timeline Object" });

    this.setState({contextMenu: {x: e.clientX, y: e.clientY, target: target}});
  }

  closeContextMenu = () => {
    if(!this.state.contextMenu) return;
    this.setState({contextMenu: null});
  }

  getContextMenuItems = (target) => {
    let editor = this.props.editor;
    let project = this.props.project;
    // Use the full key map so the hotkeys are still shown while preview is playing.
    let keyMap = editor.getKeyMap(true);
    let hotkeyOf = (action) => HotKeyInterface.getHotKey(keyMap, action);

    // Right clicking an empty cell adds a frame to that cell, right clicking an existing
    // frame inserts a blank frame at the playhead.
    let isEmptyCell = target.type === 'empty';
    let addFrame = isEmptyCell
      ? () => this.addFrame(target.playheadPosition, target.layerIndex)
      : editor.insertBlankFrame;

    // The frame that was right clicked, taken from the target rather than the selection so
    // that the tween items act on the clicked cell even when more than one frame is selected.
    let clicked = target.uuid && window.Wick.ObjectCache.getObjectByUUID(target.uuid);
    let clickedFrame = null;
    if(target.type === 'frame') {
      clickedFrame = clicked;
    } else if(target.type === 'tween' && clicked) {
      clickedFrame = clicked.parentFrame;
    }

    // rightClickAtPosition parks the playhead on the clicked cell, so this finds the clicked
    // tween whether the click landed on the tween marker itself or elsewhere in its cell.
    let clickedTween = clickedFrame && clickedFrame.getTweenAtCurrentPlayheadPosition();

    // A tween drives the clips on its frame, so there has to be something there to move.
    let canPasteTween = !!(editor.tweenClipboard && clickedFrame && clickedFrame.contentful);

    return [
      {label: 'Add Frame', icon: 'add', action: addFrame, hotkey: isEmptyCell ? null : hotkeyOf('insert-blank-frame')},
      {label: 'Add Tween', icon: 'tween', action: editor.createTween, hotkey: hotkeyOf('create-tween'), disabled: !project.canCreateTween},
      {divider: true},
      {label: 'Copy Tween', icon: 'copy', action: () => editor.copyTween(clickedTween), disabled: !clickedTween},
      {label: 'Paste Tween', icon: 'paste', action: () => editor.pasteTween(clickedFrame), disabled: !canPasteTween},
      {divider: true},
      {label: 'Delete', icon: 'delete', action: editor.deleteSelectedObjects, hotkey: hotkeyOf('delete'), danger: true, disabled: isEmptyCell},
    ];
  }

  addFrame = (playheadPosition, layerIndex) => {
    // The GUI element calls onProjectModified itself, so there's no projectDidChange here.
    this.props.project.guiElement.addFrame(playheadPosition, layerIndex);
  }

  render() {
    const { connectDropTarget, isOver } = this.props;
    const { contextMenu } = this.state;

    return connectDropTarget (
      <div id="animation-timeline-container" aria-label="Timeline" onContextMenu={this.onContextMenu}>
        { isOver && <div className="drag-drop-overlay" /> }
        <div id="animation-timeline" ref={this.canvasContainer} />
        { contextMenu &&
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={this.getContextMenuItems(contextMenu.target)}
            onClose={this.closeContextMenu}
          /> }
      </div>
    )
  }

  onProjectModified = () => {
      this.props.projectDidChange({ actionName: "Timeline Action" });
  }

  onProjectSoftModified = () => {
      this.props.project.view.render();
  }
}

// react-dnd drag and drop target params
const timelineTarget = {
  drop(props, monitor) {
    const dropLocation = monitor.getClientOffset();
    let draggedItem = monitor.getItem();
    props.dragSoundOntoTimeline(draggedItem.uuid, dropLocation.x, dropLocation.y, true);
  },
  hover(props, monitor, component) {
    const dropLocation = monitor.getClientOffset();
    let draggedItem = monitor.getItem();
    props.dragSoundOntoTimeline(draggedItem.uuid, dropLocation.x, dropLocation.y, false);
  }
}

function collect(connect, monitor) {
  return {
    connectDropTarget: connect.dropTarget(),
    isOver: monitor.isOver(),
  };
}

export default DropTarget(DragDropTypes.TIMELINE, timelineTarget, collect)(Timeline)
