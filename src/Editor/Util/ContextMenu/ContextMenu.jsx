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
import classNames from 'classnames';
import ReactTooltip from 'react-tooltip';
import { isMobile } from 'react-device-detect';

import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';

import './_contextmenu.scss';

// Space to keep between the menu and the edges of the window.
const SCREEN_MARGIN = 4;

const TOOLTIP_ID = 'context-menu-tooltip';

/**
 * Right click menu, used by the canvas and the timeline.
 * Items are objects of the shape {label, icon, action, hotkey, danger, disabled} or {divider: true}.
 */
class ContextMenu extends Component {
  constructor (props) {
    super(props);

    this.menuRef = React.createRef();

    this.state = {
      x: props.x,
      y: props.y,
    };
  }

  componentDidMount () {
    document.addEventListener('mousedown', this.onDocumentMouseDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('blur', this.props.onClose);
    window.addEventListener('resize', this.props.onClose);

    this.clampToScreen();

    // The tooltip targets mount at the same time as the tooltip itself.
    ReactTooltip.rebuild();
  }

  componentWillUnmount () {
    document.removeEventListener('mousedown', this.onDocumentMouseDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('blur', this.props.onClose);
    window.removeEventListener('resize', this.props.onClose);
  }

  /**
   * Nudges the menu back into the window if it was opened close to an edge.
   */
  clampToScreen = () => {
    let menu = this.menuRef.current;
    if(!menu) return;

    let {width, height} = menu.getBoundingClientRect();
    let x = Math.max(SCREEN_MARGIN, Math.min(this.props.x, window.innerWidth - width - SCREEN_MARGIN));
    let y = Math.max(SCREEN_MARGIN, Math.min(this.props.y, window.innerHeight - height - SCREEN_MARGIN));

    if(x !== this.state.x || y !== this.state.y) {
      this.setState({x: x, y: y});
    }
  }

  onDocumentMouseDown = (e) => {
    if(this.menuRef.current && this.menuRef.current.contains(e.target)) return;
    this.props.onClose();
  }

  onKeyDown = (e) => {
    if(e.key !== 'Escape') return;
    e.stopPropagation();
    this.props.onClose();
  }

  onItemClick = (item) => {
    ReactTooltip.hide();
    this.props.onClose();
    item.action();
  }

  renderItem = (item, i) => {
    if(item.divider) {
      return <div className="context-menu-divider" key={'context-menu-divider-' + i} />;
    }

    return (
      <button
        key={'context-menu-item-' + item.label}
        className={classNames('context-menu-item', {'context-menu-item-danger': item.danger})}
        disabled={item.disabled}
        data-tip={item.hotkey ? `${item.label} (${item.hotkey.toUpperCase()})` : null}
        data-for={TOOLTIP_ID}
        onClick={() => this.onItemClick(item)}>
        <ToolIcon name={item.icon} className="context-menu-item-icon" />
        <span className="context-menu-item-label">{item.label}</span>
      </button>
    );
  }

  render () {
    return (
      <div
        className="context-menu"
        ref={this.menuRef}
        style={{left: this.state.x, top: this.state.y}}
        onContextMenu={e => e.preventDefault()}>
        {this.props.items.map(this.renderItem)}
        <ReactTooltip
          disable={isMobile}
          id={TOOLTIP_ID}
          type='info'
          place='right'
          effect='solid'
          delayShow={300}
          className="wick-tooltip" />
      </div>
    );
  }
}

export default ContextMenu;
