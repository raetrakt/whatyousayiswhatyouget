// Video recording for the tools canvas.
//
// Two encoding paths:
//   • WebCodecs (VideoEncoder + mp4-muxer) — full-range H.264, true white.
//     Reliable on Chromium desktop, so that's the only place we use it.
//   • MediaRecorder + canvas.captureStream — broad support fallback. Firefox
//     emits .webm; Safari emits .mp4 but in limited range (white reads slightly
//     gray). Used everywhere WebCodecs isn't available/reliable.

const RECORD_FPS = 30;

const _isChromium = (() => {
  const brands = navigator.userAgentData?.brands;
  return Array.isArray(brands)
    ? brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))
    : false;
})();
// Only Chromium drives the WebCodecs path. Safari's VideoEncoder accepts the
// config but fails to encode here, and Firefox's is flaky — both use MediaRecorder.
const _useWebCodecs = _isChromium;

// Pick the first H.264 config the browser's encoder actually supports. Hardcoding
// a single profile/level (e.g. High@5.2 avc1.640034) gets rejected by many
// hardware encoders, after which configure() fails and flush() never resolves.
async function _pickEncoderConfig(w, h) {
  if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) return null;
  const codecs = [
    'avc1.640034', // High 5.2
    'avc1.640033', // High 5.1
    'avc1.640032', // High 5.0
    'avc1.64002A', // High 4.2
    'avc1.640028', // High 4.0
    'avc1.4D4028', // Main 4.0
    'avc1.42E028', // Baseline 4.0
  ];
  for (const codec of codecs) {
    const config = {
      codec,
      width: w,
      height: h,
      bitrate: 12_000_000,
      framerate: RECORD_FPS,
      avc: { format: 'avc' },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support?.supported) return config;
    } catch {
      /* try next codec */
    }
  }
  return null;
}

function _supportedRecorderMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  const candidates = [
    'video/mp4;codecs=avc1.42E01E', // Safari can emit a real .mp4
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/**
 * Wire up the record button for a tool's canvas.
 *
 * @param {object}   opts
 * @param {HTMLCanvasElement} opts.canvas       Canvas to capture.
 * @param {HTMLElement}       opts.errorDisplay Element used to surface errors.
 * @param {HTMLElement}       opts.button       The record/stop toggle button.
 * @param {() => string}      opts.getFilename  Returns the download name (no ext).
 */
export function createRecorder({ canvas, errorDisplay, button, getFilename }) {
  let _isRecording = false;
  let _videoEncoder = null;
  let _muxer = null;
  let _recordRafId = null;
  let _recordFrameIndex = 0;
  let _mediaRecorder = null;
  let _recordChunks = [];

  function _downloadBlob(blob, ext) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getFilename() + '.' + ext;
    a.click();
    URL.revokeObjectURL(url);
  }

  function _resetButton() {
    button.disabled = false;
    button.textContent = 'record';
    button.classList.remove('recording');
  }

  function _showError(message) {
    errorDisplay.textContent = message;
    errorDisplay.style.display = 'block';
  }

  // ── MediaRecorder path ────────────────────────────────────────────────────────
  function _startMediaRecorderFallback() {
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      _showError('Video recording is not supported in this browser.');
      return;
    }
    const mime = _supportedRecorderMime();
    const stream = canvas.captureStream(RECORD_FPS);
    const rec = new MediaRecorder(
      stream,
      mime
        ? { mimeType: mime, videoBitsPerSecond: 12_000_000 }
        : { videoBitsPerSecond: 12_000_000 },
    );
    _recordChunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) _recordChunks.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      _downloadBlob(new Blob(_recordChunks, { type }), ext);
      _recordChunks = [];
      _mediaRecorder = null;
      _isRecording = false;
      _resetButton();
    };
    rec.onerror = (e) => {
      console.error('MediaRecorder:', e.error || e);
      _recordChunks = [];
      _mediaRecorder = null;
      _isRecording = false;
      _resetButton();
      _showError('Video recording failed in this browser.');
    };
    _mediaRecorder = rec;
    _isRecording = true;
    button.textContent = 'stop';
    button.classList.add('recording');
    rec.start();
  }

  // ── WebCodecs path ──────────────────────────────────────────────────────────────
  function _abortWebCodecsRecording({ message = null, fallback = false } = {}) {
    const wasCapturing = _isRecording;
    const framesCaptured = _recordFrameIndex;
    _isRecording = false;
    if (_recordRafId) cancelAnimationFrame(_recordRafId);
    _recordRafId = null;
    try {
      _videoEncoder?.close();
    } catch {
      /* already closed */
    }
    _videoEncoder = null;
    _muxer = null;
    _resetButton();

    // If WebCodecs broke right at the start, silently switch to MediaRecorder so
    // the user still gets a file instead of an error.
    if (fallback && wasCapturing && framesCaptured <= 2) {
      _startMediaRecorderFallback();
      return;
    }
    if (message) _showError(message);
  }

  async function startRecording() {
    if (_isRecording) return;

    // H.264 requires even dimensions
    const w = canvas.width & ~1;
    const h = canvas.height & ~1;

    const encoderConfig = _useWebCodecs ? await _pickEncoderConfig(w, h) : null;
    if (!encoderConfig) {
      _startMediaRecorderFallback();
      return;
    }

    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    _muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: w, height: h, frameRate: RECORD_FPS },
      fastStart: 'in-memory',
    });

    _videoEncoder = new VideoEncoder({
      output: (chunk, meta) => _muxer?.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error('VideoEncoder:', e);
        _abortWebCodecsRecording({
          message: 'Video recording failed in this browser. Try Chrome.',
          fallback: true,
        });
      },
    });
    try {
      _videoEncoder.configure(encoderConfig);
    } catch (e) {
      console.error('VideoEncoder.configure failed:', e);
      _abortWebCodecsRecording();
      _startMediaRecorderFallback();
      return;
    }

    _recordFrameIndex = 0;
    _isRecording = true;

    button.textContent = 'stop';
    button.classList.add('recording');

    const frameIntervalMs = 1000 / RECORD_FPS;
    let lastFrameTs = -Infinity;

    function captureLoop(ts) {
      if (!_isRecording || !_videoEncoder) return;
      if (ts - lastFrameTs >= frameIntervalMs && _videoEncoder.encodeQueueSize < 10) {
        lastFrameTs = ts;
        try {
          const timestamp = Math.round(_recordFrameIndex * (1_000_000 / RECORD_FPS));
          const frame = new VideoFrame(canvas, { timestamp });
          _videoEncoder.encode(frame, { keyFrame: _recordFrameIndex % 150 === 0 });
          frame.close();
          _recordFrameIndex++;
        } catch (e) {
          console.error('encode failed:', e);
          _abortWebCodecsRecording({
            message: 'Video recording failed in this browser. Try Chrome.',
            fallback: true,
          });
          return;
        }
      }
      _recordRafId = requestAnimationFrame(captureLoop);
    }
    _recordRafId = requestAnimationFrame(captureLoop);
  }

  async function stopRecording() {
    if (!_isRecording) return;

    // MediaRecorder finalizes asynchronously via its onstop handler.
    if (_mediaRecorder) {
      button.disabled = true;
      button.textContent = 'encoding…';
      try {
        _mediaRecorder.stop();
      } catch (e) {
        console.error('MediaRecorder.stop:', e);
        _mediaRecorder = null;
        _isRecording = false;
        _resetButton();
      }
      return;
    }

    _isRecording = false;
    cancelAnimationFrame(_recordRafId);
    _recordRafId = null;

    button.disabled = true;
    button.textContent = 'encoding…';

    // Some browsers report a config as supported but then hang on flush(); the
    // watchdog keeps the UI from getting stuck on "encoding…" forever.
    let watchdog;
    const timeout = new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('encode-timeout')), 20000);
    });

    try {
      await Promise.race([_videoEncoder.flush(), timeout]);
      clearTimeout(watchdog);
      _videoEncoder.close();
      _videoEncoder = null;

      _muxer.finalize();
      const { buffer } = _muxer.target;
      _muxer = null;

      _downloadBlob(new Blob([buffer], { type: 'video/mp4' }), 'mp4');
      _resetButton();
    } catch (err) {
      clearTimeout(watchdog);
      console.error('Recording failed:', err);
      try {
        _videoEncoder?.close();
      } catch {
        /* already closed */
      }
      _videoEncoder = null;
      _muxer = null;
      _resetButton();
      _showError('Video recording failed in this browser. Try Chrome.');
    }
  }

  button.addEventListener('click', () => {
    if (_isRecording) stopRecording();
    else startRecording();
  });

  return {
    startRecording,
    stopRecording,
    get isRecording() {
      return _isRecording;
    },
  };
}
