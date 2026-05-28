// ── Screen recording: getDisplayMedia → VideoEncoder → mp4-muxer ──────────────
//
//   R            → record (just capture whatever is on screen)
//   Shift+R      → fullscreen + record + replay onboarding animation
//
// Entering fullscreen suppresses Chrome's "this tab is being shared" bar,
// which would otherwise squish the viewport and appear in the recording.
// Outputs H.264 MP4 via WebCodecs + mp4-muxer — no canvas serialisation.

const RECORD_FPS = 60;
const RECORD_BITRATE = 40_000_000; // 40 Mbps — high quality for a graph

let _isRecording = false;
let _videoEncoder = null;
let _muxer = null;
let _reader = null;
let _frameIndex = 0;

function _timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

let _originalTitle = '';

function _setRecordingTitle(state) {
  if (state === 'recording') {
    _originalTitle = document.title;
    document.title = '● REC — ' + _originalTitle;
  } else if (state === 'encoding') {
    document.title = '⏳ encoding… — ' + _originalTitle;
  } else {
    document.title = _originalTitle;
  }
}

// The element we override height on to neutralise the sharing bar viewport shrink
let _svgHeightOverride = null;

function _lockSvgHeight() {
  // Chrome's "this tab is being shared" bar reduces window.innerHeight by ~56 px.
  // Tab capture clips at the new (smaller) viewport, so we pin the SVG to its
  // current full height. It overflows behind the bar; the capture clips that
  // overflow — which is exactly the slice the bar was covering anyway.
  const svgEl = document.querySelector('svg');
  if (!svgEl) return;
  _svgHeightOverride = svgEl.style.height;
  svgEl.style.height = window.innerHeight + 'px';
  // Re-apply on every resize so the lock survives any subsequent viewport changes
  svgEl._recordResizeHandler = () => {
    /* intentional no-op — height is already fixed */
  };
}

function _unlockSvgHeight() {
  const svgEl = document.querySelector('svg');
  if (!svgEl) return;
  svgEl.style.height = _svgHeightOverride ?? '';
  _svgHeightOverride = null;
}

async function startRecording({ withOnboarding = false, onReplayOnboarding = null } = {}) {
  if (_isRecording) return;

  // Snapshot the SVG's true pixel dimensions BEFORE any browser UI appears.
  // We use these for both the height-lock and the encoder config so everything
  // stays consistent even if the sharing bar later changes the viewport.
  const svgEl = document.querySelector('svg');
  const preW = svgEl ? svgEl.clientWidth : window.innerWidth;
  const preH = svgEl ? svgEl.clientHeight : window.innerHeight;

  _lockSvgHeight();

  // Prompt the user to share the current tab
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: RECORD_FPS,
        displaySurface: 'browser',
      },
      audio: false,
      preferCurrentTab: true,
    });
  } catch {
    // User cancelled
    _unlockSvgHeight();
    return;
  }

  const [track] = stream.getVideoTracks();

  // ── CropTarget: restrict capture to the SVG element ──────────────────────
  // Chrome's CropTarget API crops the stream to a specific DOM element's
  // bounding box. The sharing bar lives OUTSIDE that box, so it never
  // appears in the recording regardless of where Chrome renders it.
  if (svgEl && typeof CropTarget !== 'undefined' && CropTarget.fromElement) {
    try {
      const cropTarget = await CropTarget.fromElement(svgEl);
      await track.cropTo(cropTarget);
    } catch {
      // API not available in this context (e.g. cross-origin iframe) — continue
    }
  }

  // Use the pre-bar SVG dimensions for encoding; these match what the SVG is
  // actually rendering regardless of what the track reports post-bar.
  const w = preW & ~1; // H.264 requires even dimensions
  const h = preH & ~1;

  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  _muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h, frameRate: RECORD_FPS },
    fastStart: 'in-memory',
  });

  _videoEncoder = new VideoEncoder({
    output: (chunk, meta) => _muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error('[record] VideoEncoder error:', e);
      stopRecording();
    },
  });

  _videoEncoder.configure({
    codec: 'avc1.640034', // H.264 High Profile Level 5.2
    width: w,
    height: h,
    bitrate: RECORD_BITRATE,
    framerate: RECORD_FPS,
    avc: { format: 'avc' },
  });

  _frameIndex = 0;
  _isRecording = true;
  _setRecordingTitle('recording');

  // When the user stops sharing via the browser's own "Stop sharing" button
  track.addEventListener('ended', () => stopRecording(), { once: true });

  // If requested, trigger onboarding replay after a short settle delay
  if (withOnboarding && typeof onReplayOnboarding === 'function') {
    setTimeout(() => onReplayOnboarding(), 400);
  }

  // Pull frames from the capture stream
  const processor = new MediaStreamTrackProcessor({ track });
  _reader = processor.readable.getReader();

  (async () => {
    while (_isRecording) {
      let result;
      try {
        result = await _reader.read();
      } catch {
        break;
      }
      if (result.done) break;

      const frame = result.value;
      if (_videoEncoder.encodeQueueSize < 10) {
        const timestamp = Math.round(_frameIndex * (1_000_000 / RECORD_FPS));
        // If the frame dimensions don't match (e.g. sharing bar changed the
        // viewport and CropTarget wasn't available), resize before encoding.
        let src = frame;
        if (frame.displayWidth !== w || frame.displayHeight !== h) {
          src = await createImageBitmap(frame, {
            resizeWidth: w,
            resizeHeight: h,
            resizeQuality: 'high',
          });
        }
        const reframed = new VideoFrame(src, { timestamp });
        _videoEncoder.encode(reframed, { keyFrame: _frameIndex % 150 === 0 });
        reframed.close();
        if (src !== frame) src.close();
        _frameIndex++;
      }
      frame.close();
    }
  })();
}

export async function stopRecording() {
  if (!_isRecording) return;
  _isRecording = false;

  // Restore the SVG height so the page snaps back after recording
  _unlockSvgHeight();

  // Signal the reader to stop
  try {
    _reader?.cancel();
  } catch {
    /* ignore */
  }
  _reader = null;

  _setRecordingTitle('encoding');

  await _videoEncoder.flush();
  _videoEncoder.close();
  _videoEncoder = null;

  _muxer.finalize();
  const { buffer } = _muxer.target;
  _muxer = null;

  _setRecordingTitle(null);

  const blob = new Blob([buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `graph-${_timestamp()}.mp4`;
  a.click();
  URL.revokeObjectURL(url);
}

// export function initRecording({ replayOnboarding } = {}) {
//   window.addEventListener('keydown', (e) => {
//     if (e.key !== 'r' && e.key !== 'R') return;
//     // Don't hijack R when the user is typing in an input
//     if (e.target.closest('input, textarea, [contenteditable]')) return;
//     if (_isRecording) {
//       stopRecording();
//     } else if (e.shiftKey) {
//       // Shift+R: fullscreen + record + replay onboarding
//       startRecording({ withOnboarding: true, onReplayOnboarding: replayOnboarding });
//     } else {
//       // R: just record whatever is on screen
//       startRecording();
//     }
//   });
// }
