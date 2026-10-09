/** Helpers for jsdom tests. */

let visibility: DocumentVisibilityState | null = null;

/** Override document.visibilityState (restore with `restoreVisibility`). */
export function setVisibility(v: DocumentVisibilityState, dispatch = true) {
  if (visibility === null) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  }
  visibility = v;
  if (dispatch) document.dispatchEvent(new Event('visibilitychange'));
}

export function restoreVisibility() {
  if (visibility === null) return;
  visibility = null;
  Reflect.deleteProperty(document, 'visibilityState');
}

/** Disable the rAF loop so tests drive updates explicitly (via visibilitychange). */
export function noAnimationFrames(stub: (name: string, value: unknown) => void) {
  stub('requestAnimationFrame', () => 0);
  stub('cancelAnimationFrame', () => undefined);
}
