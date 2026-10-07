// A steady clock for the recorder. Timers in a worker keep their pace when
// the tab is in the background; the page's own slow down to once a second.
let timer = null;
self.addEventListener("message", ({ data: interval }) => {
  clearInterval(timer);
  if (interval > 0) timer = setInterval(() => self.postMessage("tick"), interval);
});
