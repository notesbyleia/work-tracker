(() => {
  const chunks = ["app.chunk.recovery-20260613.1.js","app.chunk.recovery-20260613.2.js","app.chunk.recovery-20260613.3.js","app.chunk.recovery-20260613.4.js","app.chunk.recovery-20260613.5.js","app.chunk.recovery-20260613.6.js","app.chunk.recovery-20260613.7.js"];
  window.__WORK_TRACKER_APP_CHUNKS__ = [];
  const load = (index) => {
    if (index >= chunks.length) {
      const source = window.__WORK_TRACKER_APP_CHUNKS__.join("");
      (0, eval)(source + "\n//# sourceURL=work-tracker-app.js");
      return;
    }
    const script = document.createElement("script");
    script.src = chunks[index] + "?v=recovery-20260613";
    script.onload = () => load(index + 1);
    script.onerror = () => {
      throw new Error("Could not load work tracker app chunk: " + chunks[index]);
    };
    document.head.append(script);
  };
  load(0);
})();
