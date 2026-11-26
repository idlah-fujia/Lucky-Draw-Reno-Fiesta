/* Timeout for fetch that still works when AbortSignal.timeout is missing (Chrome 80–102). */
function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch (error) {}
  if (typeof AbortController === 'undefined') return undefined;
  var controller = new AbortController();
  setTimeout(function () {
    try { controller.abort(); } catch (error) {}
  }, ms);
  return controller.signal;
}
