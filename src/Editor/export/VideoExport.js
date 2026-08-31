import AudioExport from './AudioExport';
import AlphaFrameEncoder from './AlphaFrameEncoder';
import WebCodecsEncoder from './WebCodecsEncoder';

import b64toBuff from 'base64-arraybuffer';

var ENABLE_LOGGING = false;
var EXPORT_IMAGE_START = 10;
var EXPORT_AUDIO_START = 40;
var EXPORT_VIDEO_START = 70;

class VideoExport {
    /**
     * The video targets, and what each one is actually good for.
     *
     * - 'mp4' is H.264 when the browser can encode it (see WebCodecsEncoder), which is the
     *   only way to get a file a browser will play: the bundled ffmpeg has no libx264, and
     *   its mpeg4 fallback writes an `mp4v` sample entry that Chrome, Firefox and Safari
     *   all refuse. Either way there is no alpha channel, so a transparent project is
     *   flattened onto its background color first.
     * - 'mov' is QuickTime RLE: genuine lossless per-pixel alpha, which is what an NLE
     *   wants, but no browser will play it in a <video> tag. Always the bundled encoder -
     *   WebCodecs has no lossless-alpha codec.
     * - 'mp4matte' is the same mp4, but each frame is double height, with the premultiplied
     *   color on top and the alpha channel as greyscale below. A consumer that knows the
     *   convention recombines it in one line of shader maths.
     */
    static VIDEO_FORMATS = {
      mp4:      { extension: '.mp4', mimeType: 'video/mp4',        suffix: '',       label: '.mp4' },
      mov:      { extension: '.mov', mimeType: 'video/quicktime',  suffix: '',       label: '.mov' },
      mp4matte: { extension: '.mp4', mimeType: 'video/mp4',        suffix: '-matte', label: '.mp4' },
    }

    /**
     * project, format, onProgress, onError, onFinish;
     */
    static renderVideo = async (args) => {
      let route = await VideoExport._planEncoding(args);

      let images = await VideoExport._generateProjectImages(args, route);
      let soundInfo = [...args.project.soundsPlayed]; // Make a deepcopy of the sound info.
      args.soundInfo = soundInfo;
      let audio = await VideoExport._generateAudioFile(args);

      await VideoExport._generateVideo({images:images, audio:audio, args, route});
    }

    /* Falls back to plain mp4 for anything unrecognised. */
    static _resolveFormat = (args) => {
      let format = args.format;
      return VideoExport.VIDEO_FORMATS[format] ? format : 'mp4';
    }

    /**
     * Decide up front how this export is going to be encoded, so that the frame renderer,
     * the encoder and the ffmpeg command can't disagree about it later.
     *
     * encoder is one of:
     *   'h264'   - the browser encodes; ffmpeg only muxes the audio in afterwards.
     *   'qtrle'  - the bundled encoder, for lossless alpha in a .mov.
     *   'legacy' - the bundled encoder's mpeg4, when WebCodecs isn't available.
     */
    static _planEncoding = async (args) => {
      let format = VideoExport._resolveFormat(args);
      let dimensions = VideoExport._frameDimensions(args, format);

      // The matte frames get packed to double height before they are encoded.
      let outputHeight = (format === 'mp4matte') ? dimensions.height * 2 : dimensions.height;

      let codecConfig = (format === 'mov')
        ? null
        : await WebCodecsEncoder.findSupportedConfig(dimensions.width, outputHeight, args.project.framerate);

      let encoder = codecConfig ? 'h264' : (format === 'mov' ? 'qtrle' : 'legacy');

      if (encoder === 'legacy') {
        console.warn('Wick video export: WebCodecs H.264 is not available here, falling back '
          + 'to the bundled MPEG-4 Part 2 encoder. The result will play in desktop video '
          + 'players but not in a browser.');
      }

      return {
        format: format,
        width: dimensions.width,
        height: dimensions.height,
        outputHeight: outputHeight,
        encoder: encoder,
        codecConfig: codecConfig,
      };
    }

    /* The size every rendered frame is captured at. */
    static _frameDimensions = (args, format) => {
      let width = args.width || args.project.width;
      let height = args.height || args.project.height;

      // The odd-dimension crop is there for the mpeg4 encoder, and H.264 is 4:2:0 so it
      // needs the same. qtrle has no such rule, so the .mov path keeps every pixel.
      if (format === 'mov') return { width: width, height: height };

      return VideoExport._ensureValidDimensions(width, height);
    }

    static _generateAudioFile = async (args) => {
      let {onProgress} = args;

      onProgress && onProgress('Generating Audio Track...', EXPORT_AUDIO_START);

      return AudioExport.generateAudioFile(args);
    }

    /**
     * Render every frame of the project and turn it into whatever the chosen route needs:
     * an encoded .mp4 (WebCodecs), TGA frames (qtrle) or JPEG frames (legacy mpeg4).
     *
     * Frames are handled one at a time as they are rendered rather than collected first -
     * a raw 1080p frame is 8MB, so accumulating a few hundred of them is how you run a tab
     * out of memory.
     */
    static _generateProjectImages = async (args, route) => {

      let { project, onProgress } = args;
      let format = route.format;

      // Anything that has to look at the alpha channel needs the pixels themselves: the
      // .mov path to write TGA, the matte path to pack them, WebCodecs to build a
      // VideoFrame, and a transparent project on the legacy path to composite over its
      // background color (a canvas handed straight to toDataURL('image/jpeg') would
      // flatten onto black instead).
      let needsRawFrames = route.encoder !== 'legacy' ||
                           format === 'mp4matte' ||
                           project.transparentBackground;

      let encoder = (route.encoder === 'h264')
        ? new WebCodecsEncoder(route.codecConfig, project.framerate)
        : null;

      let files = [];
      let frameNumber = 0;

      let handleFrame = (frame) => {
        let paddedNum = (frameNumber + '').padStart(12, '0');
        frameNumber += 1;

        if (encoder) {
          let prepared = VideoExport._prepareFrame(frame, format, project);
          // Returns a promise, so the renderer waits when the encoder queue is full.
          return encoder.addFrame(prepared.data, prepared.width, prepared.height);
        }

        if (route.encoder === 'qtrle') {
          // TGA, not PNG: this ffmpeg build has no zlib and cannot inflate PNG. Its
          // run-length encoding also keeps the frames small enough to all fit in the
          // worker's 256MB memfs at once.
          files.push({
            name: "frame" + paddedNum + ".tga",
            data: AlphaFrameEncoder.encodeTGA(frame.data, frame.width, frame.height),
          });
          return;
        }

        let src = needsRawFrames
          ? VideoExport._frameToJpegDataURL(VideoExport._prepareFrame(frame, format, project))
          : frame.src;

        // Get the base 64 value and convert it to an array buffer.
        let buffer = b64toBuff.decode(src.split(',')[1]);
        files.push({name: "frame" + paddedNum + ".jpg", data: new Uint8Array(buffer)});
      };

      onProgress && onProgress('Rendering Images', EXPORT_IMAGE_START);

      try {
        await new Promise((resolve, reject) => {
          project.generateImageSequence({
              imageType: 'image/jpeg',
              frameFormat: needsRawFrames ? 'raw' : 'image',

              width: route.width,
              height: route.height,

              onProgress: (currentFrame, numTotalFrames) => {
                let progress = EXPORT_IMAGE_START + (currentFrame/numTotalFrames) * 20;
                onProgress('Rendering Frame ' + currentFrame + '/' + numTotalFrames, progress);
              },

              onFrame: handleFrame,
              onError: reject,
              onFinish: resolve,
          });
        });

        if (encoder) {
          onProgress('Encoding Video', EXPORT_AUDIO_START);
          files.push({name: 'video.mp4', data: await encoder.finish()});
        } else {
          onProgress('Converting Frames', EXPORT_AUDIO_START);
        }
      } catch (error) {
        if (encoder) encoder.abort();
        throw error;
      }

      return files;
    }

    /**
     * Turn a rendered frame into the pixels the chosen format wants to encode.
     * @param {object} frame - {data, width, height} from generateImageSequence's 'raw' mode
     * @returns {object} {data, width, height}
     */
    static _prepareFrame = (frame, format, project) => {
      if (format === 'mp4matte') return VideoExport._packAlphaMatte(frame);
      if (project.transparentBackground) return VideoExport._flattenFrame(frame, project.backgroundColor);
      return frame;
    }

    /**
     * Composite a raw RGBA frame onto an opaque matte color, for the formats that can't
     * carry alpha.
     * @param {object} frame - {data, width, height}
     * @param {Wick.Color} matteColor
     * @returns {object} {data, width, height}
     */
    static _flattenFrame = (frame, matteColor) => {
      let matte = [matteColor.r * 255, matteColor.g * 255, matteColor.b * 255];
      let source = frame.data;
      let out = new Uint8ClampedArray(source.length);

      for (let i = 0; i < source.length; i += 4) {
        let alpha = source[i + 3] / 255;
        out[i]     = source[i]     * alpha + matte[0] * (1 - alpha);
        out[i + 1] = source[i + 1] * alpha + matte[1] * (1 - alpha);
        out[i + 2] = source[i + 2] * alpha + matte[2] * (1 - alpha);
        out[i + 3] = 255;
      }

      return {data: out, width: frame.width, height: frame.height};
    }

    /**
     * Pack a raw RGBA frame into a double-height opaque frame: premultiplied color on top,
     * the alpha channel as greyscale below. A consumer recombines the two halves with
     * `color = top + destination * (1 - bottom)`.
     * @param {object} frame - {data, width, height}
     * @returns {object} {data, width, height} - height is doubled
     */
    static _packAlphaMatte = (frame) => {
      let source = frame.data;
      let out = new Uint8ClampedArray(source.length * 2);

      for (let i = 0; i < source.length; i += 4) {
        let alpha = source[i + 3] / 255;

        out[i]     = source[i]     * alpha;
        out[i + 1] = source[i + 1] * alpha;
        out[i + 2] = source[i + 2] * alpha;
        out[i + 3] = 255;

        let j = source.length + i;
        out[j] = out[j + 1] = out[j + 2] = source[i + 3];
        out[j + 3] = 255;
      }

      return {data: out, width: frame.width, height: frame.height * 2};
    }

    /* The legacy mpeg4 path transports frames as JPEG, which means a canvas round trip. */
    static _frameToJpegDataURL = (frame) => {
      let canvas = window.document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvas.getContext('2d').putImageData(
        new window.ImageData(frame.data, frame.width, frame.height), 0, 0);
      return canvas.toDataURL('image/jpeg');
    }

    static _generateVideo = async ({images, audio, args, route}) => {
      let { project, onProgress, onFinish, skipDownload } = args;
      let format = route.format;
      let formatInfo = VideoExport.VIDEO_FORMATS[format];

      // Save on Done
      let onDone = (data) => {
        if(!(data instanceof Uint8Array)) {
          data = new Uint8Array(data);
        }
        let blob = new Blob([data], {type: formatInfo.mimeType});
        // Embedded callers (see export/EmbedAPI.js) want the blob handed back
        // instead of dropped into the user's downloads folder.
        if(!skipDownload) {
          window.saveFileFromWick(blob, project.name + formatInfo.suffix, formatInfo.extension);
          onProgress("Rendering Complete! Downloading...", 100);
        } else {
          onProgress("Rendering Complete!", 100);
        }
        onFinish(blob);
      }

      // With WebCodecs the browser has already produced a finished mp4. If there is no
      // audio to add, there is nothing left for ffmpeg to do.
      if (route.encoder === 'h264' && !audio) {
        onProgress("Rendering Final Video", EXPORT_VIDEO_START);
        onDone(images.find(file => file.name === 'video.mp4').data);
        return;
      }

      let workerReady = false;
      let _worker = new Worker("corelibs/video/worker-asm.js");
      _worker.onmessage = (e) => {
      let msg = e.data;

        switch (msg.type) {
          case "ready": 
            ENABLE_LOGGING && console.log("Worker ready");
            workerReady = true;
            break;
          case "stdout":
            VideoExport._parseProgressMessage(msg.data, args);
            ENABLE_LOGGING && console.log("output: ", msg.data);
            break;
          case "stderr":
            ENABLE_LOGGING && console.error("Error:", msg);
            break;
          case "done":
            ENABLE_LOGGING && console.log(msg);
            onDone(msg.data[0].data);
            break;
          case "exit":
            _worker.terminate();
            break;
          case "error":
            console.error("Video Renderer had an error. Please Try Again")
            console.error(msg)
            args.onError && args.onError(msg.data || 'video worker error');
            break;
          default:
            break;
        }
      }

      let runFFMPEGCommand = (ffmpegArgs, workerMemoryFiles) => {
        ENABLE_LOGGING && console.log("Running ffmpeg", ffmpegArgs, workerMemoryFiles);
        _worker.postMessage({
          type: "command",
          arguments: ffmpegArgs, 
          files: workerMemoryFiles,
          commandName: 'video_render',
        });
      }
    
      let waitUntilReady = (callback) => {
        let waitUntilReadyInterval = setInterval(() => {
          ENABLE_LOGGING && console.log("Waiting on Worker")
          if(workerReady) {
            clearInterval(waitUntilReadyInterval);
            callback();
          }
        }, 10);
      }

      onProgress("Rendering Final Video", EXPORT_VIDEO_START);

      let allFiles = images;

      if (audio) allFiles = allFiles.concat([{ data:audio, name:"audio.wav"}]);

      let outputName = 'out' + formatInfo.extension;
      let command;

      if (route.encoder === 'h264') {
          // The browser encoded the video; ffmpeg is only here to mux the audio alongside
          // it. Note that `-c:v copy` works from an *mp4* where it would not from a raw
          // H.264 stream: this ffmpeg was built --disable-parsers --disable-bsfs, so it
          // can only find frame boundaries when a container gives them to it.
          command = [
              '-i', 'video.mp4',
              '-i', 'audio.wav',
              '-c:v', 'copy',
              '-c:a', 'aac',
              '-strict', '-2',
              outputName,
          ];
      } else {
          let inputs = ['-i', 'frame%12d' + (format === 'mov' ? '.tga' : '.jpg')];

          if (audio) {
              inputs = inputs.concat(['-i', 'audio.wav']);
          }

          // Slow down the video if the framerate is less than 6 (framerate <6 causes a corrupted video to render)
          // showinfo is a passthrough, but _parseProgressMessage reads its output, so it
          // stays on every path that re-encodes.
          let filterv = 'showinfo';
          if(project.framerate < 6) {
              filterv = 'setpts='+(6/project.framerate)+'*PTS,' + filterv;
          }

          let codecArgs = (format === 'mov')
              // QuickTime RLE is lossless, so there is no quality knob. argb is stated
              // explicitly so the alpha channel can't get negotiated away.
              ? ['-c:v', 'qtrle', '-pix_fmt', 'argb']
              : ['-pix_fmt', 'yuv420p', '-q:v', '10']; //10=good quality, 31=bad quality

          command = [
              '-r', '' + Math.max(6, project.framerate),
              '-s', route.width + "x" + route.outputHeight,
              ...inputs,
              ...codecArgs,
              '-strict', '-2',
              '-filter:v', filterv,
              outputName,
            ];
      }

      waitUntilReady(() => runFFMPEGCommand(command, allFiles));
    }

    // ffmpeg does not like odd numbers in the video width/height.
    // this chops off pixels to ensure an even width/height
    // this may be an issue specifically with the h264 codec:
    // https://stackoverflow.com/questions/20847674/ffmpeg-libx264-height-not-divisible-by-2
    static _ensureValidDimensions (width, height) {
        var newWidth = width;
        var newHeight = height;

        if(newWidth % 2 === 1) {
            newWidth -= 1;
        }
        if(newHeight % 2 === 1) {
            newHeight -= 1;
        }

        return {
            width: newWidth,
            height: newHeight
        };
    }

    static _parseProgressMessage (message, args) {
        if(!message) return
        if(! (typeof message === 'string')) return;
        if(!message.includes('pts_time:')) return;

        var time;

        time = message.split('pts_time');
        if(!time) return;
        time = time[1];
        if(!time) return;
        time = time.split('pos');
        if(!time) return;
        time = time[0];
        if(!time) return;
        time = time.replace(":", "");
        if(!time) return;
        let timeNumber = Number(time);
        timeNumber = timeNumber.toFixed(2);

        args.onProgress('Rendered: ' + timeNumber + ' seconds', 85);
    }
}

export default VideoExport;
