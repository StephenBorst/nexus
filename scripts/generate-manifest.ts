import { writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
// The manifest itself lives in tools/manifest/manifest.mjs (one source, pinned by its test).
import { manifestJson } from "../tools/manifest/manifest.mjs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function writeManifestFiles(json: string) {
  const publicPath = join(__dirname, "../public/manifest.json");
  writeFileSync(publicPath, json);
  console.log("✓ Generated: public/manifest.json");

  const buildPath = join(__dirname, "../build/client/manifest.json");
  if (existsSync(join(__dirname, "../build/client"))) {
    writeFileSync(buildPath, json);
    console.log("✓ Generated: build/client/manifest.json");
  }
}

try {
  console.log("\n🔨 Generating PWA manifest...\n");
  writeManifestFiles(manifestJson());
  console.log("\n✅ Manifest generation complete!\n");
} catch (error) {
  console.error("❌ Error generating manifest:", (error as Error).message);
}
