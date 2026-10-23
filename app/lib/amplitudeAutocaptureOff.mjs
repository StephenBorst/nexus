// Stand-in for @amplitude/plugin-autocapture-browser, used ONLY by Amplitude's browser client
// (vite.config.ts firstLoadTrims). The client imports the real plugin up front (~130 KB raw in the
// first download) but builds it only when `autocapture` asks for element interactions, and Orderly's
// SDK never sets `autocapture` (tools/firstLoadTrims.test.mjs checks both). So the real plugin never
// ran here. If a future config did turn it on, this stand-in captures nothing, which is what we want
// anyway: tools/amplitudeOptOut.mjs already switches Amplitude's automatic tracking off.
export const autocapturePlugin = () => ({
  name: "nexus-autocapture-off",
  type: "enrichment",
  setup: async () => undefined,
  execute: async (event) => event,
});
