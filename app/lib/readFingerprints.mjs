// ── Registered reads, frozen by fingerprint (borst 2026-11-20, pipeline-if-then.md "Reads no longer retire") ──────────
// One entry per registered read: the sha256 of the events its scoreboard generator fires on the fixed seeded tapes
// (workers/nexus-lab-api/readFingerprint.mjs), and how many. Recorded with the registration, never edited:
// readFingerprint.test.mjs recomputes each and fails on a difference. A read whose events change is a new read with a
// new name and date. A new registration adds its line in the same PR (print it: node workers/nexus-lab-api/readFingerprint.mjs).
// The 17 below were recorded on 2026-11-20, when this freeze replaced signed registrations; each read registered earlier
// on its own page, and these are the rules as they run today.
export const TAPES_SHA256 = "8b452c55974a11794127a4b31426cd251e5288e5cbf2decdb5d6873846a5a39e";

export const READ_FINGERPRINTS = Object.freeze({
  rsi_reset_deep: Object.freeze({ at: "2026-11-20", events: 48, sha256: "d683ee0b625b1a642f65853960ee425b18716fffd7310b7e0ee1f472e5e1ffb3" }),
  level_reclaim: Object.freeze({ at: "2026-11-20", events: 85, sha256: "4ee72442a922259aac81cf3bd394ef78901637d8a4b5b1df0dc900891400678b" }),
  oi_div_reversal: Object.freeze({ at: "2026-11-20", events: 48, sha256: "8d0a5a380bd1886435edf0fe6377c3a960c334535348a537d92e03f0063e1e34" }),
  session_momentum: Object.freeze({ at: "2026-11-20", events: 157, sha256: "26e089201c17db2a035a49aded23e1d47986ab06c3ecda8b91490d9a05410b5d" }),
  confluence_follow: Object.freeze({ at: "2026-11-20", events: 200, sha256: "d9be191d56919be9732a44940d94003f5828e2fb46ea2ca6b67cbf5ef4acf2d0" }),
  oi_div_reversal_4h: Object.freeze({ at: "2026-11-20", events: 45, sha256: "58e16fdc9d2bb9704b5130783837b846dc425432388a042111007880e5fdfdab" }),
  oi_coil_break: Object.freeze({ at: "2026-11-20", events: 82, sha256: "2c8f00ebe3bd6333f050bd393388f934bbb2053a6f684888620c1347ff99dba7" }),
  session_fade: Object.freeze({ at: "2026-11-20", events: 157, sha256: "948f79ad830d57cf84cc4e617e3f4fb6601a2d07ca78cdb91261916a511fc08a" }),
  level_reclaim_tight: Object.freeze({ at: "2026-11-20", events: 37, sha256: "b9d6e1fb94628020ac3a0384cc6c26c7832b3aaa4dc5fcc1a52171c958805920" }),
  spot_absorb: Object.freeze({ at: "2026-11-20", events: 154, sha256: "96b0125d2ca0d68bd1e0a3f29ffa2498000fffba892159f762c55a5c71a0c332" }),
  btc_lead_lag: Object.freeze({ at: "2026-11-20", events: 339, sha256: "94c35e5355d48d2d5fcd3f79cd57b26b782a106644d7b99ebcb75ef6f67a1985" }),
  funding_basis_split: Object.freeze({ at: "2026-11-20", events: 191, sha256: "d14f17689f366ecd16b586bd56cdf7766c5e5fa9ae6eb8f466406a350cd456b0" }),
  smart_consensus_2x: Object.freeze({ at: "2026-11-20", events: 243, sha256: "56021bdb3dd71ee832bc1dd2f04a083db9160abd343b681ca261967267843c2c" }),
  shelf_breakdown_short: Object.freeze({ at: "2026-11-20", events: 4, sha256: "1da911d46b0e47eccaa9e4a2533456d2edaa09e86669caf2d7062fcb017eb754" }),
  bb_rsi_momentum: Object.freeze({ at: "2026-11-20", events: 294, sha256: "d99ea16cf1d749dbe1a6f97794f637074323c794c83fd8b7104b66ea2069ec26" }),
  session_fade_short: Object.freeze({ at: "2026-11-20", events: 77, sha256: "857acd382b4ef38f723d4e5e0c62da3574ee2e20572de06086ce56e836d183ef" }),
  oi_div_reversal_4h_long: Object.freeze({ at: "2026-11-20", events: 18, sha256: "d11b0de2adecb9d65b2eeddbefe25aece0e5f8a3d2401e341fb2792e5e165219" }),
});
