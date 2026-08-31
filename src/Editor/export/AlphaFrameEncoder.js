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

/**
 * Frame encoders for the alpha-preserving video export path.
 *
 * The bundled encoder (public/corelibs/video/ffmpeg.js - FFmpeg 2.2.1, from
 * bgrins/videoconverter.js) was compiled without zlib, so it can neither inflate nor
 * deflate PNG: it simply cannot read PNG frames. TGA and BMP are the alpha-capable
 * frame transports it *can* read.
 *
 * TGA is the one we use. Its run-length encoding makes it roughly 20x smaller than BMP
 * on flat vector art, which matters a great deal: every frame sits in the worker's memfs
 * at once and worker-asm.js pins TOTAL_MEMORY at 256MB. BMP is kept as a plain fallback.
 */
class AlphaFrameEncoder {
    /**
     * Encode RGBA pixels as a 32-bit run-length-encoded TGA (image type 10).
     * @param {Uint8ClampedArray|Uint8Array} rgba - pixel data, 4 bytes per pixel, top row first.
     * @param {number} width
     * @param {number} height
     * @returns {Uint8Array} the complete .tga file
     */
    static encodeTGA (rgba, width, height) {
        // Every packet costs one header byte and covers at least one pixel, so 5 bytes
        // per pixel is a safe ceiling. The buffer is trimmed with slice() at the end -
        // subarray() would keep the oversized ArrayBuffer alive, and these get cloned
        // into the ffmpeg worker.
        let out = new Uint8Array(18 + width * height * 5);
        let p = 0;

        // Header (18 bytes).
        out[p++] = 0;               // id length
        out[p++] = 0;               // color map type: none
        out[p++] = 10;              // image type: run-length encoded true-color
        p += 5;                     // color map specification: unused, all zero
        p += 4;                     // x/y origin: 0,0
        out[p++] = width & 0xff;
        out[p++] = (width >> 8) & 0xff;
        out[p++] = height & 0xff;
        out[p++] = (height >> 8) & 0xff;
        out[p++] = 32;              // bits per pixel
        out[p++] = 0x28;            // descriptor: 8 alpha bits, top-down row order

        // TGA stores pixels as BGRA, and a run-length packet may not cross a row boundary.
        for (let y = 0; y < height; y++) {
            let row = y * width * 4;
            let x = 0;

            while (x < width) {
                let i = row + x * 4;
                let runLength = 1;

                // How many identical pixels follow this one? (capped at a packet's 128)
                while (x + runLength < width && runLength < 128 &&
                       rgba[i]     === rgba[i + runLength * 4] &&
                       rgba[i + 1] === rgba[i + runLength * 4 + 1] &&
                       rgba[i + 2] === rgba[i + runLength * 4 + 2] &&
                       rgba[i + 3] === rgba[i + runLength * 4 + 3]) {
                    runLength++;
                }

                if (runLength > 1) {
                    // Run-length packet: a count and a single pixel.
                    out[p++] = 0x80 | (runLength - 1);
                    out[p++] = rgba[i + 2];
                    out[p++] = rgba[i + 1];
                    out[p++] = rgba[i];
                    out[p++] = rgba[i + 3];
                    x += runLength;
                    continue;
                }

                // Raw packet: run until pixels start repeating again (a pair is enough to
                // make a run-length packet worthwhile), or until the packet is full.
                let rawLength = 1;
                while (x + rawLength < width && rawLength < 128) {
                    let j = row + (x + rawLength) * 4;
                    let k = j - 4;
                    if (rgba[j]     === rgba[k] &&
                        rgba[j + 1] === rgba[k + 1] &&
                        rgba[j + 2] === rgba[k + 2] &&
                        rgba[j + 3] === rgba[k + 3]) {
                        // This pixel repeats the previous one: end the raw packet before it.
                        rawLength--;
                        break;
                    }
                    rawLength++;
                }
                if (rawLength < 1) rawLength = 1;

                out[p++] = rawLength - 1;
                for (let n = 0; n < rawLength; n++) {
                    let j = row + (x + n) * 4;
                    out[p++] = rgba[j + 2];
                    out[p++] = rgba[j + 1];
                    out[p++] = rgba[j];
                    out[p++] = rgba[j + 3];
                }
                x += rawLength;
            }
        }

        return out.slice(0, p);
    }

    /**
     * Encode RGBA pixels as an uncompressed 32-bit BGRA BMP (BITMAPV4HEADER, so the
     * alpha mask is declared explicitly rather than left to the decoder to guess).
     * Kept as the dumb fallback for encodeTGA.
     * @param {Uint8ClampedArray|Uint8Array} rgba - pixel data, 4 bytes per pixel, top row first.
     * @param {number} width
     * @param {number} height
     * @returns {Uint8Array} the complete .bmp file
     */
    static encodeBMP (rgba, width, height) {
        let headerSize = 14 + 108; // BITMAPFILEHEADER + BITMAPV4HEADER
        let pixelBytes = width * height * 4; // 32bpp rows are always 4-byte aligned
        let out = new Uint8Array(headerSize + pixelBytes);
        let view = new DataView(out.buffer);

        // BITMAPFILEHEADER
        out[0] = 0x42; // 'B'
        out[1] = 0x4d; // 'M'
        view.setUint32(2, out.length, true);
        view.setUint32(10, headerSize, true);

        // BITMAPV4HEADER
        view.setUint32(14, 108, true);          // header size
        view.setInt32(18, width, true);
        view.setInt32(22, height, true);        // positive: bottom-up row order
        view.setUint16(26, 1, true);            // planes
        view.setUint16(28, 32, true);           // bits per pixel
        view.setUint32(30, 3, true);            // compression: BI_BITFIELDS
        view.setUint32(34, pixelBytes, true);
        view.setUint32(54, 0x00ff0000, true);   // red mask
        view.setUint32(58, 0x0000ff00, true);   // green mask
        view.setUint32(62, 0x000000ff, true);   // blue mask
        view.setUint32(66, 0xff000000, true);   // alpha mask
        view.setUint32(70, 0x73524742, true);   // color space: 'BGRs' (sRGB)

        // BMP stores pixels as BGRA, bottom row first.
        let p = headerSize;
        for (let y = height - 1; y >= 0; y--) {
            let row = y * width * 4;
            for (let x = 0; x < width; x++) {
                let i = row + x * 4;
                out[p++] = rgba[i + 2];
                out[p++] = rgba[i + 1];
                out[p++] = rgba[i];
                out[p++] = rgba[i + 3];
            }
        }

        return out;
    }
}

export default AlphaFrameEncoder;
