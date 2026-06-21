// Barcode scanning using the browser's built-in BarcodeDetector (free, no SDK, works offline).
// Falls back gracefully with a clear message on browsers that don't support it.
const Scanner = (() => {
  let stream = null;
  let detector = null;
  let rafId = null;
  let running = false;

  function isSupported() {
    return 'BarcodeDetector' in window;
  }

  async function start(videoEl, onResult, onError) {
    if (running) return;
    if (!isSupported()) {
      onError && onError(
        "This browser can't scan barcodes. Use Chrome on Android, or type the code manually."
      );
      return;
    }
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      detector = new BarcodeDetector({
        formats: formats.filter((f) =>
          ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'].includes(f)
        )
      });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      running = true;

      const scan = async () => {
        if (!running) return;
        try {
          const codes = await detector.detect(videoEl);
          if (codes && codes.length) {
            const value = codes[0].rawValue;
            stop(videoEl);
            onResult && onResult(value);
            return;
          }
        } catch (_) { /* transient frame errors are fine */ }
        rafId = requestAnimationFrame(scan);
      };
      rafId = requestAnimationFrame(scan);
    } catch (err) {
      running = false;
      onError && onError(
        err && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access to scan.'
          : 'Could not start the camera. Type the code manually instead.'
      );
    }
  }

  function stop(videoEl) {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  return { isSupported, start, stop };
})();
