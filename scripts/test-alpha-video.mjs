/*
 * Regression tests for the two things VideoExport asks the bundled ffmpeg build
 * (public/corelibs/video/ffmpeg.js) to do. Runs under node, no browser involved.
 *
 *   1. RGBA pixels -> AlphaFrameEncoder TGA -> qtrle .mov -> decode back to RGBA,
 *      asserting the alpha channel survived. Guards the TGA encoder and the .mov args.
 *
 *   2. an .mp4 plus a .wav -> one .mp4, with `-c:v copy`, asserting every frame made it
 *      across. This is the mux step of the H.264 path. It is worth pinning down because
 *      the obvious simplification - handing ffmpeg the encoder's raw elementary stream
 *      instead of a container - silently produces an empty file: this build is compiled
 *      `--disable-parsers --disable-bsfs`, so it can only find frame boundaries when a
 *      container hands them to it. (That the copied codec is really `avc1` is checked in
 *      the browser instead, by public/embed-test.html's playability probe.)
 *
 * Usage: node scripts/test-alpha-video.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// AlphaFrameEncoder is an ES module written for the editor bundle, but it touches nothing
// browser-specific, so node can import it directly.
const { default: AlphaFrameEncoder } = await import(
    path.join(ROOT, 'src/Editor/export/AlphaFrameEncoder.js')
);

// ffmpeg.js decides it is running under node by looking for `exports`, and that path skips
// the Module/files plumbing we need. Evaluating it as a plain function body keeps it on the
// browser path, which is also the path the editor's worker uses.
function loadFFmpeg () {
    const src = fs.readFileSync(path.join(ROOT, 'public/corelibs/video/ffmpeg.js'), 'utf8');
    // eslint-disable-next-line no-new-func
    return new Function(src + '\nreturn ffmpeg_run;')();
}

const ffmpeg_run = loadFFmpeg();

const WIDTH = 64;
const HEIGHT = 48;
const NUM_FRAMES = 3;

// A frame that is fully transparent except for an opaque cyan square in the middle.
function makeFrame () {
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const i = (y * WIDTH + x) * 4;
            const inside = x >= WIDTH / 4 && x < (WIDTH * 3) / 4 &&
                           y >= HEIGHT / 4 && y < (HEIGHT * 3) / 4;
            rgba[i] = 0;
            rgba[i + 1] = 200;
            rgba[i + 2] = 255;
            rgba[i + 3] = inside ? 255 : 0;
        }
    }
    return rgba;
}

function run (args, files) {
    const out = ffmpeg_run({
        arguments: args,
        files,
        print: () => {},
        printErr: () => {},
    });
    return out || [];
}

function fail (message) {
    console.error('FAIL: ' + message);
    process.exit(1);
}

const frame = makeFrame();
const tga = AlphaFrameEncoder.encodeTGA(frame, WIDTH, HEIGHT);
console.log('TGA frame: ' + tga.length + ' bytes (raw RGBA would be ' + frame.length + ')');

const inputFiles = [];
for (let i = 0; i < NUM_FRAMES; i++) {
    inputFiles.push({ name: 'frame' + String(i).padStart(12, '0') + '.tga', data: tga });
}

// Encode, using the same arguments VideoExport builds for the .mov path.
const encoded = run([
    '-r', '12',
    '-i', 'frame%12d.tga',
    '-c:v', 'qtrle',
    '-pix_fmt', 'argb',
    '-strict', '-2',
    '-filter:v', 'showinfo',
    'out.mov',
], inputFiles);

const mov = encoded.find(f => f.name === 'out.mov');
if (!mov) fail('ffmpeg produced no out.mov (got: ' + encoded.map(f => f.name).join(', ') + ')');
console.log('Encoded out.mov: ' + mov.data.byteLength + ' bytes');

// Decode back to raw RGBA and check the alpha channel survived.
const decoded = run([
    '-i', 'in.mov',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    'out.raw',
], [{ name: 'in.mov', data: new Uint8Array(mov.data) }]);

const raw = decoded.find(f => f.name === 'out.raw');
if (!raw) fail('ffmpeg could not decode out.mov back to rawvideo');

const pixels = new Uint8Array(raw.data);
const frameSize = WIDTH * HEIGHT * 4;
const decodedFrames = pixels.length / frameSize;
if (decodedFrames !== NUM_FRAMES) {
    fail('expected ' + NUM_FRAMES + ' decoded frames, got ' + decodedFrames);
}

for (let f = 0; f < NUM_FRAMES; f++) {
    const base = f * frameSize;
    const corner = base;
    const centre = base + ((HEIGHT / 2) * WIDTH + WIDTH / 2) * 4;

    if (pixels[corner + 3] !== 0) {
        fail('frame ' + f + ': corner alpha is ' + pixels[corner + 3] + ', expected 0');
    }
    if (pixels[centre + 3] !== 255) {
        fail('frame ' + f + ': centre alpha is ' + pixels[centre + 3] + ', expected 255');
    }
    if (pixels[centre + 1] !== 200 || pixels[centre + 2] !== 255) {
        fail('frame ' + f + ': centre color is ' +
            [pixels[centre], pixels[centre + 1], pixels[centre + 2]].join(',') +
            ', expected 0,200,255');
    }
}

console.log('PASS: alpha survived ' + NUM_FRAMES + '/' + NUM_FRAMES + ' frames (corner 0, centre 255).');

/* --- 2. the H.264 path's mux step -------------------------------------------------- */

// Any mp4 will do as the stand-in: what is being tested is that a *container* lets
// `-c:v copy` find frame boundaries at all, which has nothing to do with the codec.
const madeMp4 = run([
    '-r', '12', '-s', WIDTH + 'x' + HEIGHT,
    '-i', 'frame%12d.tga',
    '-pix_fmt', 'yuv420p', '-q:v', '10', '-strict', '-2',
    'out.mp4',
], inputFiles).find(f => f.name === 'out.mp4');
if (!madeMp4) fail('could not build an mp4 to use as the mux input');

function silentWav (seconds) {
    const rate = 44100;
    const samples = rate * seconds;
    const wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF', 0);            wav.writeUInt32LE(36 + samples * 4, 4);
    wav.write('WAVE', 8);            wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);       wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);        wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);       wav.write('data', 36);
    wav.writeUInt32LE(samples * 4, 40);
    return new Uint8Array(wav);
}

let muxLog = [];
const muxed = ffmpeg_run({
    // Exactly the command VideoExport builds for the H.264 route.
    arguments: ['-i', 'video.mp4', '-i', 'audio.wav', '-c:v', 'copy', '-c:a', 'aac', '-strict', '-2', 'out.mp4'],
    files: [
        { name: 'video.mp4', data: new Uint8Array(madeMp4.data) },
        { name: 'audio.wav', data: silentWav(1) },
    ],
    print: line => muxLog.push(line),
    printErr: line => muxLog.push(line),
}) || [];

const withAudio = muxed.find(f => f.name === 'out.mp4');
if (!withAudio) fail('the mux step produced no file');

const muxedBuffer = Buffer.from(withAudio.data);
if (muxedBuffer.indexOf(Buffer.from('mp4a')) === -1) {
    fail('the mux step did not add an audio track');
}

// "Output file is empty, nothing was encoded" is what a missing parser looks like.
// ffmpeg rewrites its progress counter with \r, so several frame= updates land in one
// log line; the highest one across the whole log is the real count.
let framesCopied = 0;
for (const line of muxLog) {
    for (const match of String(line).matchAll(/frame=\s*(\d+)/g)) {
        framesCopied = Math.max(framesCopied, Number(match[1]));
    }
}
if (framesCopied < NUM_FRAMES) {
    fail('the mux step copied ' + framesCopied + '/' + NUM_FRAMES + ' frames. ' +
         'An empty output here means ffmpeg could not frame the video input.');
}

console.log('PASS: mux step copied ' + framesCopied + '/' + NUM_FRAMES +
            ' frames and added an audio track (' + muxedBuffer.length + ' bytes).');
