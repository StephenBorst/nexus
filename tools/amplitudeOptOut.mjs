// Orderly's SDK (@orderly.network/hooks) starts Amplitude with no `defaultTracking` setting, and in
// @amplitude/analytics-browser 2.x "not set" means everything on: page views, sessions, form
// interactions, file downloads and marketing attribution, for every visitor. There is no SDK option
// to turn that off (only `amplitudeId` / `serverZone` are configurable), and Orderly hasn't answered
// since Oct 3. So the production build rewrites that one call (vite.config.ts `amplitudeOptOut`).
//
// What still flows: Orderly's own named events (trades, deposits…) and its identify call, which sets
// the wallet address as the user id. Those feed Orderly's broker stats; switching them off is a
// bigger call than this patch. What stops: the automatic browsing data, and the visitor's IP address
// being stored with any event (`trackingOptions.ipAddress: false`).
//
// If an SDK upgrade changes the call, patchAmplitudeInit throws and the build fails, instead of
// shipping full tracking silently. tools/amplitudeOptOut.test.mjs checks the installed SDK in CI.

export const AMPLITUDE_INIT = "amplitude.init(amplitudeId, options);";
export const AMPLITUDE_INIT_PATCHED =
  "amplitude.init(amplitudeId, { ...options, defaultTracking: false, trackingOptions: { ...(options && options.trackingOptions), ipAddress: false } });";

/** The one module that starts Amplitude. */
export const isOrderlyHooksDist = (id) => /[\\/]@orderly\.network[\\/]hooks[\\/]dist[\\/]index\.m?js$/.test(String(id).split("?")[0]);

/** Rewrites Orderly's single Amplitude init call. Throws unless it appears exactly once. */
export function patchAmplitudeInit(code) {
  const n = code.split(AMPLITUDE_INIT).length - 1;
  if (n !== 1) {
    throw new Error(
      `[amplitude-opt-out] expected 1 "${AMPLITUDE_INIT}" in @orderly.network/hooks, found ${n}. ` +
      "The SDK changed: update tools/amplitudeOptOut.mjs before shipping, or Amplitude tracks everything again.",
    );
  }
  return code.replace(AMPLITUDE_INIT, AMPLITUDE_INIT_PATCHED);
}
