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

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/**
 * H.264 video encoding through the browser's own VideoEncoder.
 *
 * Why this exists: the bundled encoder (public/corelibs/video/ffmpeg.js - FFmpeg 2.2.1,
 * from bgrins/videoconverter.js) has no libx264 and no libvpx. The best it can put in an
 * .mp4 is MPEG-4 Part 2, whose sample entry is `mp4v`, and no current browser will play
 * that - exports opened fine in VLC and were a black box in Chrome. The browser has an
 * H.264 encoder of its own, usually hardware-backed, so we use that instead.
 *
 * This produces a complete, video-only .mp4. It does not hand ffmpeg an elementary
 * stream, because it can't: that ffmpeg was built `--disable-parsers --disable-bsfs`, so
 * it cannot find frame boundaries in raw H.264 and silently muxes zero frames. Feed it an
 * mp4 instead and the container supplies the boundaries, which is why VideoExport layers
 * audio in afterwards with `-i video.mp4 -i audio.wav -c:v copy -c:a aac`.
 *
 * Two things this deliberately does not do:
 *  - Alpha. WebCodecs advertises `alpha: 'keep'` for VP8/VP9, but no shipping browser
 *    supports it (measured, not assumed), so genuinely transparent video is still out of
 *    reach. The .mov/qtrle path stays on the bundled encoder for that.
 *  - Audio. AAC encoding is not reliably available through AudioEncoder, and the existing
 *    ffmpeg audio path already works.
 *
 * Where WebCodecs is missing, VideoExport falls back to the old mpeg4 path.
 */

// Tried in order; the first one the browser accepts at the requested size wins. High
// profile first for quality, then baseline, which is the most widely decodable.
const CODEC_CANDIDATES = [
    'avc1.640034', // High, level 5.2  - covers 4K
    'avc1.640028', // High, level 4.0  - covers 1080p
    'avc1.42E028', // Baseline, level 4.0
    'avc1.42001F', // Baseline, level 3.1
    'avc1.42E01E', // Baseline, level 3.0
];

// How far the encoder's queue may run ahead of the renderer before we let it drain.
// Every queued frame is a full uncompressed image the encoder is holding for us.
const MAX_QUEUED_FRAMES = 8;

class WebCodecsEncoder {
    /**
     * @returns {boolean} whether this browser has the WebCodecs pieces we need.
     */
    static isAvailable () {
        return typeof window !== 'undefined' &&
               typeof window.VideoEncoder === 'function' &&
               typeof window.VideoFrame === 'function';
    }

    /**
     * Vector animation is mostly flat colour, so this can be modest and still look clean.
     * The floor matters more than the formula: it is what keeps a small stage from being
     * given a bitrate low enough to smear.
     */
    static _bitrate (width, height, framerate) {
        let bits = width * height * framerate * 0.12;
        return Math.round(Math.min(Math.max(bits, 1000000), 24000000));
    }

    /**
     * Find a VideoEncoder configuration this browser will actually accept.
     * @returns {Promise<object|null>} the config, or null if H.264 is unreachable here.
     */
    static async findSupportedConfig (width, height, framerate) {
        if (!WebCodecsEncoder.isAvailable()) return null;

        // H.264 is 4:2:0, so both dimensions have to be even. VideoExport already crops
        // for the same reason, but an odd size fails at configure() time rather than at
        // isConfigSupported(), so don't rely on it having happened.
        if (!width || !height || width % 2 === 1 || height % 2 === 1) return null;

        for (let codec of CODEC_CANDIDATES) {
            let config = {
                codec: codec,
                width: width,
                height: height,
                framerate: framerate,
                bitrate: WebCodecsEncoder._bitrate(width, height, framerate),
                // AVCC (length-prefixed samples plus an avcC description), which is what
                // goes inside an mp4. The Annex-B form is only useful for elementary
                // streams, and this ffmpeg cannot read those at all.
                avc: {format: 'avc'},
                latencyMode: 'quality',
            };

            try {
                let support = await window.VideoEncoder.isConfigSupported(config);
                if (support && support.supported) return config;
            } catch (e) {
                // An unparseable codec string throws rather than reporting unsupported.
            }
        }

        return null;
    }

    /**
     * @param {object} config - from findSupportedConfig()
     * @param {number} framerate - the project framerate, used for frame timestamps
     */
    constructor (config, framerate) {
        this.framerate = framerate || 12;
        this.frameIndex = 0;
        this.error = null;

        // A keyframe every couple of seconds, so the result is seekable.
        this._keyFrameInterval = Math.max(1, Math.round(this.framerate * 2));

        this._muxer = new Muxer({
            target: new ArrayBufferTarget(),
            video: {
                codec: 'avc',
                width: config.width,
                height: config.height,
                frameRate: this.framerate,
            },
            // moov at the front, so the file plays without seeking to the end first.
            fastStart: 'in-memory',
        });

        this._encoder = new window.VideoEncoder({
            output: (chunk, meta) => {
                try {
                    this._muxer.addVideoChunk(chunk, meta);
                } catch (e) {
                    this.error = e;
                }
            },
            error: e => {
                this.error = e;
            },
        });

        this._encoder.configure(config);
    }

    /**
     * Encode one frame of RGBA pixels. Alpha is discarded - H.264 has no alpha channel,
     * so the caller must have composited already.
     * @param {Uint8ClampedArray|Uint8Array} rgba
     * @param {number} width
     * @param {number} height
     * @returns {Promise} resolves once the encoder has room for another frame.
     */
    async addFrame (rgba, width, height) {
        if (this.error) throw this.error;

        let frame = new window.VideoFrame(rgba, {
            format: 'RGBA',
            codedWidth: width,
            codedHeight: height,
            timestamp: Math.round((this.frameIndex * 1e6) / this.framerate),
            duration: Math.round(1e6 / this.framerate),
        });

        let keyFrame = (this.frameIndex % this._keyFrameInterval) === 0;
        this.frameIndex += 1;

        try {
            this._encoder.encode(frame, {keyFrame: keyFrame});
        } finally {
            // encode() does not take ownership.
            frame.close();
        }

        // Backpressure: the renderer can outrun the encoder.
        while (!this.error && this._encoder.encodeQueueSize > MAX_QUEUED_FRAMES) {
            await new Promise(resolve => window.setTimeout(resolve, 0));
        }
        if (this.error) throw this.error;
    }

    /**
     * Flush the encoder and finalize the container.
     * @returns {Promise<Uint8Array>} a complete, video-only .mp4 with an `avc1` track.
     */
    async finish () {
        try {
            await this._encoder.flush();
        } finally {
            if (this._encoder.state !== 'closed') this._encoder.close();
        }

        if (this.error) throw this.error;
        if (this.frameIndex === 0) throw new Error('no frames were encoded');

        this._muxer.finalize();
        return new Uint8Array(this._muxer.target.buffer);
    }

    /** Tear the encoder down without producing a file (used on the error path). */
    abort () {
        try {
            if (this._encoder.state !== 'closed') this._encoder.close();
        } catch (e) {
            // Already closed or never configured; nothing to do.
        }
    }
}

export default WebCodecsEncoder;
