import { defineConfig, Plugin, type Rollup } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import fs from "fs";
import path from "path";

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

export default defineConfig(() => {
  const basePath = process.env.PUBLIC_PATH || "/";

  return {
    server: {
      open: true,
      host: true,
    },
    base: basePath,
    plugins: [
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