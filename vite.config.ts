import { defineConfig, Plugin, type Rollup } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isOrderlyHooksDist, patchAmplitudeInit } from "./tools/amplitudeOptOut.mjs";

function loadConfigTitle(): string {
  try {
    const configPath = path.join(__dirname, "public/config.js");
    if (!fs.existsSync(configPath)) {
      return "Orderly Network";
    }

    const configText = fs.readFileSync(configPath, "utf-8");
    const jsonText = configText
      .replace(/window\.__RUNTIME_CONFIG__\s*=\s*/, "")
      .replace(/;$/, "")
      .trim();

    const config = JSON.parse(jsonText);
    return config.VITE_ORDERLY_BROKER_NAME || "Orderly Network";
  } catch (error) {
    console.warn("Failed to load title from config.js:", error);
    return "Orderly Network";
  }
}

function htmlTitlePlugin(): Plugin {
  const title = loadConfigTitle();
  console.log(`Using title from config.js: ${title}`);

  return {
    name: "html-title-transform",
    transformIndexHtml(html) {
      // Only sync the <title> from config.js. OG/Twitter/Farcaster meta is
      // authoritative in index.html (embed-mini.png + Farcaster embed) — do NOT
      // inject a second og:image/twitter:image here or crawlers get two
      // conflicting cards (this used to point at the stale preview.png).
      return html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);
    },
  };
}

// One long-lived "vendor" chunk for every library the ENTRY loads up front. Hashed files are
// cached forever (public/_headers), so a deploy that only touches app code re-downloads the
// small app chunk, not the ~3 MB SDK tree. Only modules STATICALLY reachable from the entry
// qualify: a catch-all node_modules rule would drag lazy-only packages (WooFi, XMTP, …) into
// the first load. Rollup's virtual helpers (\0commonjsHelpers, the preload helper) ride
// along so the vendor chunk never imports back from app code (no chunk cycle).
export function vendorChunk(): Rollup.ManualChunksOption {
  let fromEntry: Set<string> | null = null;
  return (id, { getModuleIds, getModuleInfo }) => {
    if (!fromEntry) {
      fromEntry = new Set();
      const stack = [...getModuleIds()].filter((m) => getModuleInfo(m)?.isEntry);
      while (stack.length) {
        const m = stack.pop() as string;
        if (fromEntry.has(m)) continue;
        fromEntry.add(m);
        for (const dep of getModuleInfo(m)?.importedIds ?? []) stack.push(dep);
      }
    }
    if (fromEntry.has(id) && (id.includes("/node_modules/") || id.startsWith("\0"))) return "vendor";
    return undefined;
  };
}

// First-load trims (2026-10-11). Two libraries the SDK loads up front ship far more than it uses:
// - Node `crypto`: three first-load modules import it for one SHA-256 hash (and brorand for random
//   bytes it never asks for in a browser), which pulled all of crypto-browserify (~1 MB raw) into
//   the first download. They get app/lib/nodeCryptoLite.mjs (tested against node:crypto); every
//   other importer, all in lazy wallet chunks, keeps the full polyfill.
// - lodash: Orderly's hooks import only `debounce` (and its wallet connector `merge`), but lodash is
//   CommonJS, so the whole library (~565 KB raw) shipped. Those two ESM importers get lodash-es,
//   which tree-shakes to the functions they name.
// Both are allowlists by importer path: a new SDK version that imports more needs a look here.
export const LITE_CRYPTO_IMPORTERS = [
  /node_modules\/@layerzerolabs\/lz-solana-sdk-v2\/dist\/index\.mjs$/,
  /node_modules\/@solana\/spl-type-length-value\/lib\/esm\/splDiscriminate\.js$/,
  /node_modules\/brorand\/index\.js$/,
];
export const LODASH_ES_IMPORTERS = [
  /node_modules\/@orderly\.network\/hooks\/dist\/index\.mjs$/,
  /node_modules\/@orderly\.network\/wallet-connector\/dist\/index\.mjs$/,
];
const isNodeCrypto = (s: string) => s === "crypto" || s === "node:crypto" || /crypto-browserify(\/index\.js)?$/.test(s);
export function firstLoadTrims(): Plugin {
  const lite = fileURLToPath(new URL("./app/lib/nodeCryptoLite.mjs", import.meta.url));
  return {
    name: "nexus-first-load-trims",
    enforce: "pre",
    apply: "build",
    async resolveId(source, importer) {
      if (!importer) return null;
      const from = importer.split("?")[0];
      if (isNodeCrypto(source) && LITE_CRYPTO_IMPORTERS.some((r) => r.test(from))) return lite;
      if (source === "lodash" && LODASH_ES_IMPORTERS.some((r) => r.test(from))) {
        return this.resolve("lodash-es", importer, { skipSelf: true });
      }
      return null;
    },
  };
}

// Orderly's SDK starts Amplitude with every automatic capture on and no option to change it.
// The production build turns that off (see tools/amplitudeOptOut.mjs for what still flows) and
// fails if the SDK's init call ever changes shape.
export function amplitudeOptOut(): Plugin {
  return {
    name: "nexus-amplitude-opt-out",
    enforce: "pre",
    apply: "build",
    transform(code, id) {
      if (!isOrderlyHooksDist(id) || !code.includes("amplitude.init(")) return null;
      return { code: patchAmplitudeInit(code), map: null };
    },
  };
}

export default defineConfig(() => {
  const basePath = process.env.PUBLIC_PATH || "/";

  return {
    server: {
      open: true,
      host: true,
    },
    base: basePath,
    plugins: [
      firstLoadTrims(),
      amplitudeOptOut(),
      react(),
      tsconfigPaths(),
      htmlTitlePlugin(),
      cjsInterop({
        dependencies: ["bs58", "@coral-xyz/anchor", "lodash"],
      }),
      nodePolyfills({
        include: ["buffer", "crypto", "stream"],
      }),
    ],
    build: {
      outDir: "build/client",
      rollupOptions: { output: { manualChunks: vendorChunk() } },
    },
    optimizeDeps: {
      exclude: ["@xmtp/wasm-bindings", "@xmtp/browser-sdk"],
      include: ["react", "react-dom", "react-router-dom"],
    },
  };
});