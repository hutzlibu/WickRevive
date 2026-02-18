/*
 * Copyright 2020 WICKLETS LLC
 *
 * This file is part of Wick Engine.
 *
 * Wick Engine is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Wick Engine is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Wick Engine.  If not, see <https://www.gnu.org/licenses/>.
 */

Wick.Tools.Pen = class extends Wick.Tool {
    static get CLOSE_THRESHOLD () {
        return 10;
    }

    constructor () {
        super();

        this.name = 'pen';

        this.path = null;
        this.previewLine = null;
        this.handleGuides = [];
        this._isDragging = false;
        this._currentSegment = null;
    }

    get doubleClickEnabled () {
        return true;
    }

    get cursor () {
        return 'crosshair';
    }

    get isDrawingTool () {
        return true;
    }

    onActivate (e) {
        this._reset();
    }

    onDeactivate (e) {
        if (this.path) {
            this._finishPath();
        }
        this._removeGuides();
    }

    onMouseDown (e) {
        // Check if clicking near the first point to close the path
        if (this.path && this.path.segments.length > 1) {
            var firstPoint = this.path.firstSegment.point;
            if (e.point.subtract(firstPoint).length < Wick.Tools.Pen.CLOSE_THRESHOLD / this.paper.view.zoom) {
                this.path.closePath();
                this._finishPath();
                return;
            }
        }

        if (!this.path) {
            this.path = new this.paper.Path({
                strokeColor: this.getSetting('strokeColor').rgba,
                strokeWidth: this.getSetting('strokeWidth'),
                fillColor: this.getSetting('fillColor').rgba,
                strokeCap: 'round',
            });
        }

        this._currentSegment = this.path.add(e.point);
        this.path.fullySelected = true;
        this._isDragging = false;
        this._removePreviewLine();
    }

    onMouseDrag (e) {
        if (!this._currentSegment) return;

        this._isDragging = true;

        // Set symmetric handles for bezier curves
        var delta = e.point.subtract(this._currentSegment.point);
        this._currentSegment.handleOut = delta;
        this._currentSegment.handleIn = delta.negate();

        this._removeGuides();
        this._drawHandleGuides(this._currentSegment);
    }

    onMouseUp (e) {
        this._isDragging = false;
        this._removeGuides();
    }

    onMouseMove (e) {
        if (!this.path || this.path.segments.length === 0) return;

        this._removePreviewLine();

        var lastPoint = this.path.lastSegment.point;
        this.previewLine = new this.paper.Path.Line(lastPoint, e.point);
        this.previewLine.strokeColor = this.getSetting('strokeColor').rgba;
        this.previewLine.strokeWidth = 1;
        this.previewLine.dashArray = [4, 4];
        this.previewLine.guide = true;

        // Highlight first point if close enough to close
        if (this.path.segments.length > 1) {
            var firstPoint = this.path.firstSegment.point;
            if (e.point.subtract(firstPoint).length < Wick.Tools.Pen.CLOSE_THRESHOLD / this.paper.view.zoom) {
                this.setCursor('pointer');
            } else {
                this.setCursor('crosshair');
            }
        }
    }

    onDoubleClick (e) {
        if (this.path && this.path.segments.length > 0) {
            // Remove the segment just added by onMouseDown (double-click fires both)
            if (this.path.segments.length > 1) {
                this.path.lastSegment.remove();
            }
            this._finishPath();
        }
    }

    onKeyDown (e) {
        if (e.key === 'enter') {
            if (this.path && this.path.segments.length > 0) {
                this._finishPath();
            }
        } else if (e.key === 'escape') {
            this._cancelPath();
        }
    }

    _finishPath () {
        this._removePreviewLine();
        this._removeGuides();

        if (this.path && this.path.segments.length > 1) {
            this.path.fullySelected = false;
            this.path.remove();
            this.addPathToProject(this.path);
            this.fireEvent({eventName: 'canvasModified', actionName: 'pen'});
        } else if (this.path) {
            this.path.remove();
        }

        this.path = null;
        this._currentSegment = null;
    }

    _cancelPath () {
        this._removePreviewLine();
        this._removeGuides();

        if (this.path) {
            this.path.remove();
        }

        this.path = null;
        this._currentSegment = null;
    }

    _reset () {
        this.path = null;
        this.previewLine = null;
        this.handleGuides = [];
        this._isDragging = false;
        this._currentSegment = null;
    }

    _removePreviewLine () {
        if (this.previewLine) {
            this.previewLine.remove();
            this.previewLine = null;
        }
    }

    _removeGuides () {
        this.handleGuides.forEach(function (guide) {
            guide.remove();
        });
        this.handleGuides = [];
    }

    _drawHandleGuides (segment) {
        var handleIn = segment.handleIn;
        var handleOut = segment.handleOut;
        var point = segment.point;

        if (handleOut.length > 0) {
            var lineOut = new this.paper.Path.Line(point, point.add(handleOut));
            lineOut.strokeColor = '#4466FF';
            lineOut.strokeWidth = 1;
            lineOut.guide = true;
            this.handleGuides.push(lineOut);

            var dotOut = new this.paper.Path.Circle(point.add(handleOut), 3 / this.paper.view.zoom);
            dotOut.fillColor = '#4466FF';
            dotOut.guide = true;
            this.handleGuides.push(dotOut);
        }

        if (handleIn.length > 0) {
            var lineIn = new this.paper.Path.Line(point, point.add(handleIn));
            lineIn.strokeColor = '#4466FF';
            lineIn.strokeWidth = 1;
            lineIn.guide = true;
            this.handleGuides.push(lineIn);

            var dotIn = new this.paper.Path.Circle(point.add(handleIn), 3 / this.paper.view.zoom);
            dotIn.fillColor = '#4466FF';
            dotIn.guide = true;
            this.handleGuides.push(dotIn);
        }
    }
}
