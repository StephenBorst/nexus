// Orderly SDK built-in features we pass to OrderlyAppProvider (`features`). Since SDK 3.3 every
// feature is ON unless set to an explicit false.
//
// prediction: OFF (2026-11-06, the 3.4.0 upgrade). Orderly Predict (5-minute BTC UP/DOWN rounds)
// would otherwise appear inside the Perps market selectors, the Markets home tab and Portfolio, and
// its menus link to /predict, a page we don't have. borst decided 2026-11-06 to skip Predict, so this
// stays false; never let an SDK bump turn it on.
export const ORDERLY_FEATURES = Object.freeze({ prediction: false });
