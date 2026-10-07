// localStorage/sessionStorage can throw (private mode, blocked cookies);
// these helpers fall back to doing nothing.

function safe(storage) {
  return {
    get(key) {
      try {
        return storage().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        storage().setItem(key, value);
      } catch {
        // not remembered; that's fine
      }
    },
    remove(key) {
      try {
        storage().removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

export const local = safe(() => window.localStorage);
export const session = safe(() => window.sessionStorage);
