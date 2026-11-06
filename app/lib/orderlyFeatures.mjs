// Orderly SDK built-in features we pass to OrderlyAppProvider (`features`). Since SDK 3.3 every
// feature is ON unless set to an explicit false.
//
// prediction: OFF (2026-11-06, the 3.4.0 upgrade). Orderly Predict (5-minute BTC UP/DOWN rounds)
// would otherwise appear inside the Perps market selectors, the Markets home tab and Portfolio, and
// its menus link to /predict, a page we don't have. Turning it on is a product decision for borst,
// with its own route, region check and review (its trades move real money), never a side effect
// of an SDK bump.
export const ORDERLY_FEATURES = Object.freeze({ prediction: false });
