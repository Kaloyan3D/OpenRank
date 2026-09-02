#!/usr/bin/env node
/**
 * License check (Phase 0): verifies the repository keeps its third-party
 * license obligations visible:
 *
 * 1. THIRD_PARTY_NOTICES.md documents Hevy Ranks (MIT) and Free Exercise DB.
 * 2. The vendored legacy engine carries the upstream MIT license file.
 * 3. The vendored legacy engine files match their recorded SHA-256 checksums
 *    (nothing "improved" the untouched copy in place).
 * 4. The root LICENSE file is present (AGPL-3.0-or-later).
 *
 * Run: pnpm licenses:check
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

let failed = false;
function check(ok, message) {
  console.log(`${ok ? "OK  " : "FAIL"}  ${message}`);
  if (!ok) failed = true;
}

// 1. Third-party notices
const notices = read("THIRD_PARTY_NOTICES.md");
check(notices.includes("Hevy Ranks"), "THIRD_PARTY_NOTICES.md documents Hevy Ranks");
check(notices.includes("MIT"), "THIRD_PARTY_NOTICES.md documents the MIT license");
check(notices.includes("Free Exercise DB"), "THIRD_PARTY_NOTICES.md documents Free Exercise DB");
check(
  notices.includes("ad4ced63f0d1b5c89920619ec3a00da8beace50d"),
  "THIRD_PARTY_NOTICES.md records the pinned upstream commit",
);

// 2. Legacy MIT license file present with copyright
let legacyLicense = "";
try {
  legacyLicense = read("packages/ranking-core/src/legacy/LICENSE");
} catch {
  /* handled below */
}
check(
  legacyLicense.includes("MIT License") &&
    legacyLicense.includes("Copyright (c) 2026 BenjiPy"),
  "legacy engine preserves the upstream MIT license and copyright",
);

// 3. Vendored files match recorded checksums
const EXPECTED = {
  "packages/ranking-core/src/legacy/engine.js":
    "8952b6f9eb25b884c815d0d360342e0ad3066729ab3cdcbcf40e78b112d9a3e6",
  "packages/ranking-core/src/legacy/LICENSE":
    "437342c24ed643693db98fd8a833dd9badbcdcf0afc2214e74f346115217a323",
  "packages/ranking-core/src/legacy/data/exercise-templates.json":
    "cb170066882aaf8e9f2ea0202d633f4210fa6fa7fb341acd8e43a6c5c276dc2e",
};
for (const [file, expected] of Object.entries(EXPECTED)) {
  const actual = createHash("sha256")
    .update(readFileSync(join(repoRoot, file)))
    .digest("hex");
  check(actual === expected, `sha256(${file}) matches pinned upstream`);
}

// 4. Root license
const rootLicense = read("LICENSE");
check(
  rootLicense.includes("GNU AFFERO GENERAL PUBLIC LICENSE"),
  "root LICENSE is the AGPL-3.0 text",
);

// 5. Free Exercise DB snapshot (Phase 2): pinned in sources.lock.json and
//    vendored byte-identical under datasets/upstream/.
const FDB_COMMIT = "a859101d633a01c4a1a920d6a8ce41dabba0705f";
const FDB_SHA = "5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf";
check(
  notices.includes(FDB_COMMIT),
  "THIRD_PARTY_NOTICES.md records the Free Exercise DB pinned commit",
);
let lock = "";
try {
  lock = read("datasets/sources.lock.json");
} catch {
  /* handled below */
}
check(lock.includes("free-exercise-db"), "datasets/sources.lock.json pins free-exercise-db");
check(lock.includes(FDB_COMMIT), "datasets/sources.lock.json records the Free Exercise DB commit");
check(lock.includes(FDB_SHA), "datasets/sources.lock.json records the vendored dataset checksum");
let fdbSha = "";
try {
  fdbSha = createHash("sha256")
    .update(readFileSync(join(repoRoot, "datasets/upstream/free-exercise-db/exercises.json")))
    .digest("hex");
} catch {
  /* handled below */
}
check(fdbSha === FDB_SHA, "sha256(datasets/upstream/free-exercise-db/exercises.json) matches the pin");
let fdbLicense = "";
try {
  fdbLicense = read("datasets/upstream/free-exercise-db/LICENSE.md");
} catch {
  /* handled below */
}
check(
  fdbLicense.includes("unencumbered software released into the public domain"),
  "vendored Free Exercise DB keeps the upstream Unlicense text",
);

if (failed) {
  console.error("\nlicense check FAILED");
  process.exit(1);
}
console.log("\nlicense check passed");