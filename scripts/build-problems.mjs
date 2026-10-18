// Builds data/problems.json and data/blind75-slugs.json from NeetCode's own
// problem list, which ships inside the neetcode.io main bundle.
//
// Usage:
//   curl -sSL https://neetcode.io/practice | grep -o 'main\.[0-9a-f]*\.js'
//   curl -sSL -o /tmp/nc/main.js https://neetcode.io/<main.js from above>
//   node scripts/build-problems.mjs /tmp/nc/main.js
//
// The bundle is parsed as text, never evaluated.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("Usage: node scripts/build-problems.mjs <path to neetcode main.js>");
  process.exit(1);
}

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const bundle = readFileSync(bundlePath, "utf8");

// Problem entries are flat object literals: {problem:"…",pattern:"…",…}
const entryPattern = /\{problem:"[^{}]*?\}/g;

function readString(entry, key) {
  const match = entry.match(new RegExp(`[{,]${key}:"((?:[^"\\\\]|\\\\.)*)"`));
  return match ? JSON.parse(`"${match[1]}"`) : null;
}

function readFlag(entry, key) {
  return new RegExp(`[{,]${key}:!0`).test(entry);
}

const problems = [];
const blind75Slugs = [];
const seen = new Set();

for (const [entry] of bundle.matchAll(entryPattern)) {
  if (!readFlag(entry, "neetcode150")) {
    continue;
  }

  const title = readString(entry, "problem");
  const slug = readString(entry, "ncLink")?.replace(/\/+$/, "");
  if (!slug) {
    throw new Error(`NeetCode 150 entry without ncLink: ${title}`);
  }

  if (seen.has(slug)) {
    continue;
  }
  seen.add(slug);

  problems.push({
    id: slug,
    title,
    slug,
    url: `https://neetcode.io/problems/${slug}`,
    difficulty: readString(entry, "difficulty"),
    topics: [readString(entry, "pattern")]
  });

  if (readFlag(entry, "blind75")) {
    blind75Slugs.push(slug);
  }
}

if (problems.length !== 150) {
  throw new Error(`Expected 150 NeetCode 150 problems, found ${problems.length}`);
}

if (blind75Slugs.length !== 75) {
  throw new Error(`Expected 75 Blind 75 problems, found ${blind75Slugs.length}`);
}

writeFileSync(join(dataDir, "problems.json"), `${JSON.stringify(problems, null, 2)}\n`);
writeFileSync(
  join(dataDir, "blind75-slugs.json"),
  `${JSON.stringify(blind75Slugs.sort(), null, 2)}\n`
);

console.log(`Wrote ${problems.length} problems, ${blind75Slugs.length} Blind 75 slugs.`);
