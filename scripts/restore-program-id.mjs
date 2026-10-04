#!/usr/bin/env node
/**
 * restore-program-id.mjs
 *
 * `anchor build` re-syncs `declare_id!()` and `Anchor.toml` to whatever
 * Anchor's keypair derivation produces, which drifts from the ID the app
 * client (app/lib/kolo/program.ts) was generated against. This script
 * restores the canonical ID from the app's source of truth and re-runs
 * the Codama client generator so everything stays consistent.
 *
 * Usage: node scripts/restore-program-id.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const libRs = resolve(ROOT, "anchor/programs/vault/src/lib.rs");
const anchorToml = resolve(ROOT, "anchor/Anchor.toml");
const programTs = resolve(ROOT, "app/lib/kolo/program.ts");

// 1. Extract the canonical program ID from the app's source of truth.
const programTsSrc = readFileSync(programTs, "utf8");
const match = programTsSrc.match(/export const KOLO_PROGRAM_ID = address\(\s*"([^"]+)"\s*\)/);
if (!match) {
  console.error("Could not find KOLO_PROGRAM_ID in app/lib/kolo/program.ts");
  process.exit(1);
}
const canonicalId = match[1];
console.log(`Canonical program ID from app/lib/kolo/program.ts: ${canonicalId}`);

// 2. Restore declare_id! in lib.rs
let libRsSrc = readFileSync(libRs, "utf8");
const before = libRsSrc;
libRsSrc = libRsSrc.replace(
  /declare_id!\("([^"]+)"\);/,
  `declare_id!("${canonicalId}");`
);
if (libRsSrc === before) {
  console.warn("Warning: declare_id!() line not found or already correct in lib.rs");
} else {
  writeFileSync(libRs, libRsSrc);
  console.log(`Updated declare_id!() in anchor/programs/vault/src/lib.rs -> ${canonicalId}`);
}

// 3. Restore the vault entry under [programs.devnet] in Anchor.toml
let anchorTomlSrc = readFileSync(anchorToml, "utf8");
const beforeToml = anchorTomlSrc;
anchorTomlSrc = anchorTomlSrc.replace(
  /^vault\s*=\s*"[^"]+"$/m,
  `vault = "${canonicalId}"`
);
if (anchorTomlSrc === beforeToml) {
  console.warn("Warning: Anchor.toml vault= line not matched; leaving as-is");
} else {
  writeFileSync(anchorToml, anchorTomlSrc);
  console.log(`Updated Anchor.toml vault -> ${canonicalId}`);
}

// 4. Regenerate the Codama client so the generated code matches the restored ID.
try {
  execSync("npm run codama:js", { cwd: ROOT, stdio: "inherit" });
  console.log("Codama client regenerated.");
} catch (err) {
  console.error("Codama client regeneration failed:", err.message);
  process.exit(1);
}

console.log("Program ID restore complete.");