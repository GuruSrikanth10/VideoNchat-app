// Tells the server about uncaught errors, so problems in browsers the tests
// don't cover still show up. At most a few per page, and nothing personal:
// the message, where in the code, and the page (which the server reduces to
// its kind, never logging a meeting's ID).
const MAX_REPORTS = 5;

export function reportErrors() {
  let sent = 0;
  const report = (details) => {
    if (sent >= MAX_REPORTS || typeof navigator.sendBeacon !== "function") return;
    sent += 1;
    navigator.sendBeacon(
      "/api/client-errors",
      JSON.stringify({ ...details, page: location.pathname }),
    );
  };
  window.addEventListener("error", (event) => {
    report({
      message: String(event.message ?? "error"),
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    report({
      message: String(event.reason?.message ?? event.reason ?? "unhandled rejection"),
      stack: event.reason?.stack,
    });
  });
}
