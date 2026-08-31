# Audio is the last thing holding ffmpeg in the export path

Parked on 2026-08-31, straight after the WebCodecs H.264 work. Everything below is
measured on this machine, not recalled — the *How to re-measure* section at the bottom
says how, because at least one conclusion here was wrong the first time round.

## The question

Now that the browser encodes the video (`src/Editor/export/WebCodecsEncoder.js`), does the
export path still need the vendored FFmpeg 2.2.1 at all? Almost not. On a modern browser
the only thing left for it to do is turn a WAV into AAC and write a mux.

## Where ffmpeg is still reached

One `new Worker("corelibs/video/worker-asm.js")` remains, in
`src/Editor/export/VideoExport.js`, inside `_generateVideo` — *after* the short circuit
that returns the browser-made mp4 directly. So it is lazy: it is not part of page load,
and a silent project on a modern browser never fetches it at all.

| route | what ffmpeg does | avoidable? |
|---|---|---|
| `h264` **+ audio** | AAC-encode the WAV, mux it alongside the H.264 | **the subject of this document** |
| `qtrle` (`.mov`) | full encode — lossless per-pixel alpha | No. WebCodecs has no lossless-alpha codec. |
| `legacy` (no WebCodecs) | full mpeg4 encode | Only by dropping support for browsers without WebCodecs. |

Nothing else in the repo touches it. GIF export uses `corelibs/gif/gif.worker.js`; the
audio-track export (`EditorCore.exportProjectAsAudioTrack`) is pure JS via `toWav`; the
engine never loads it.

## Sizes

| thing | size |
|---|---|
| `public/corelibs/video/ffmpeg.js` on disk | 22.5 MB |
| …gzipped (what a static host actually serves) | **5.6 MB** |
| …brotli | 4.9 MB |
| `mp4-muxer` added to the main bundle | 32.36 kB raw / **11.28 kB gzip** |

The 22.5 MB figure is the one that provokes, but it is not the transfer cost. 5.6 MB,
HTTP-cached after first use, and only when a project with sound is exported to video.

## The blocker: the browser will not encode AAC

Measured on **real Chrome 152**, via `google-chrome-stable` — *not* the headless
`chromium` build. That distinction matters and cost me a wrong answer: distro Chromium
ships without proprietary codecs, so an AAC result from it says nothing about Chrome.

| probe | result |
|---|---|
| `AudioEncoder` AAC-LC (`mp4a.40.2`) | **not supported** |
| `AudioEncoder` Opus | supported |
| `VideoEncoder` VP9 `alpha: 'keep'` | **not supported** |
| `VideoEncoder` VP8 `alpha: 'keep'` | **not supported** |
| `canPlayType('video/mp4; codecs="avc1.42E01E"')` | `probably` |
| `canPlayType('…avc1.42E01E, mp4a.40.2"')` | `probably` |
| `canPlayType('…avc1.42E01E, opus"')` | `probably` |
| `canPlayType('video/webm; codecs="vp9"')` | `probably` |
| `canPlayType('video/mp4; codecs="mp4v.20.8"')` | **`""`** |

Three things fall out of that table:

- Chrome **decodes** AAC universally but **encodes** none. WebCodecs cannot take over the
  audio leg. This is the whole reason ffmpeg is still here.
- The last row is Chrome's own verdict on the bug that started all of this: MPEG-4 Part 2,
  which is all the bundled encoder could produce for an `.mp4`, is unplayable. Keep it as
  the regression marker.
- VP9/VP8 alpha is unsupported in real Chrome too, so the earlier finding stands: `.mov`
  /qtrle remains the only true-alpha output, and browser-native transparent video still
  needs a modern `ffmpeg.wasm` core with libvpx (VP9 `yuva420p` WebM).

## Options

### A. Opus-in-mp4, no ffmpeg ever
WebCodecs encodes Opus, `mp4-muxer` accepts `codec: 'opus'`, and Chrome plays
`avc1 + opus` (verified above). Removes ffmpeg from the common path completely.

**Against it:** Safari almost certainly will not play Opus in MP4, and NLEs are
hit-and-miss. Untested here — no Safari on this machine. An export format is something the
user hands to *other people*, so this reintroduces the exact failure class we just fixed:
a file that plays fine for the person who made it and not for their audience. Bad default.

### B. Status quo *(recommended for now)*
Universal AAC. 5.6 MB, lazy, cached, and only for projects that have sound.

### C. Both
AAC by default, Opus as an explicit "web-only, no big download" choice. Costs a UI knob
and a second audio path to maintain.

### D. A pure-JS AAC encoder *(the one worth investigating)*
The only option that keeps universal compatibility **and** drops the 5.6 MB. Likely
50–200 kB. Not yet evaluated: no survey of what exists, no check on output quality or
licence compatibility with GPLv3. This is the open question to pick up.

## Recommendation

Stay on **B**, and evaluate **D** when there is appetite. Do not make **A** the default.
The 5.6 MB is lazy, cached and conditional; shipping a file that is silent or unplayable
on someone else's device is worse than a one-time download.

## Also parked (unrelated to audio)

`mp4-muxer` is a static import, so it sits in the main bundle and is downloaded by
everyone, including people who never export a video. `WebCodecsEncoder.findSupportedConfig`
is already `async` and always runs before the muxer is constructed, so a dynamic
`import()` there would move all 11.28 kB gzip into a lazy chunk. Roughly ten lines.

## How to re-measure

**Codec support.** Serve or `file://` a page that calls
`AudioEncoder.isConfigSupported({codec:'mp4a.40.2', sampleRate:44100, numberOfChannels:2, bitrate:128000})`,
`VideoEncoder.isConfigSupported({codec:'vp09.00.10.08', width:320, height:240, bitrate:1e6, alpha:'keep'})`
and `document.createElement('video').canPlayType(...)`, then:

```
google-chrome-stable --headless --disable-gpu --virtual-time-budget=10000 \
  --dump-dom "file:///path/to/probe.html"
```

**Use `google-chrome-stable`, never `chromium`, for any codec question.** Chromium's
answers on AAC and H.264 are about its build, not about the browser your users have.

**Bundle delta of a dependency.** `npm run build` and note the `index-*.js` line; replace
the import with a local stub; build again; diff. Restore and confirm the build hash comes
back identical.

**ffmpeg transfer size.** `gzip -9 -c public/corelibs/video/ffmpeg.js | wc -c`.

**The two ffmpeg commands the export actually runs** are covered headlessly by
`npm run test-alpha-video`; the browser half, including whether an exported blob really
plays, is `public/embed-test.html?only=mp4,mov,matte`.
