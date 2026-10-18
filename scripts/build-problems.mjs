// Builds data/problems.json from NeetCode's own problem list, which ships inside
// the neetcode.io main bundle. Every problem with a NeetCode page is kept; `lists`
// carries the bundle's list flags and `pro` marks NeetCode Pro problems.
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

// Bundle flag -> expected size. Must match the list ids in data/problem-lists.js.
const LIST_SIZES = { blind75: 75, neetcode150: 150, neetcode250: 250 };

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
const seen = new Set();
const listCounts = Object.fromEntries(Object.keys(LIST_SIZES).map((id) => [id, 0]));

for (const [entry] of bundle.matchAll(entryPattern)) {
  const title = readString(entry, "problem");
  const lists = Object.keys(LIST_SIZES).filter((id) => readFlag(entry, id));
  const slug = readString(entry, "ncLink")?.replace(/\/+$/, "");

  // Entries without ncLink (the JavaScript set) have no NeetCode problem page.
  if (!slug) {
    if (lists.length) {
      throw new Error(`${lists.join("/")} entry without ncLink: ${title}`);
    }
    continue;
  }

  if (seen.has(slug)) {
    continue;
  }
  seen.add(slug);

  for (const id of lists) {
    listCounts[id] += 1;
  }

  problems.push({
    id: slug,
    title,
    slug,
    url: `https://neetcode.io/problems/${slug}`,
    difficulty: readString(entry, "difficulty"),
    topics: [readString(entry, "pattern")],
    lists,
    pro: readFlag(entry, "pro")
  });
}

for (const [id, expected] of Object.entries(LIST_SIZES)) {
  if (listCounts[id] !== expected) {
    throw new Error(`Expected ${expected} ${id} problems, found ${listCounts[id]}`);
  }
}

writeFileSync(join(dataDir, "problems.json"), `${JSON.stringify(problems, null, 2)}\n`);

const proCount = problems.filter((problem) => problem.pro).length;
console.log(
  `Wrote ${problems.length} problems (${proCount} Pro); ` +
    Object.entries(listCounts).map(([id, count]) => `${id} ${count}`).join(", ")
);
