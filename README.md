# NeetCode Randomizer

A Chrome extension that builds a hidden, randomized practice queue from NeetCode 150 or Blind 75 and
opens the problems on [neetcode.io](https://neetcode.io), one at a time. It is a port of the
[LeetCode Randomizer](https://chromewebstore.google.com/detail/leetcode-randomizer/kpcfdadongbobogdkojpflldijmhllln)
extension (MIT) to NeetCode.

## Features

- Pick a list (NeetCode 150 or Blind 75), a session size (1-10), a topic and difficulties.
- Problems open on `neetcode.io/problems/<slug>`. Next unlocks only after an accepted **Submit**
  (a passing Run does not count).
- In-page session sidebar (`Alt+Shift+H` to expand/collapse): session and problem timers, progress,
  Next, Skip, Pause, Regenerate question, End session.
- Session and problem timers in the problem navbar.
- Optional auto-reset of the editor to the starter code when a queued problem opens.
- Summary screen with time per question when the queue is finished.
- Dark theme matching the neetcode.io palette.

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and select this folder.

## Problem data

`data/problems.json` and `data/blind75-slugs.json` are generated from the problem list embedded in
the neetcode.io bundle, so the slugs are NeetCode's own (for example Contains Duplicate is
`duplicate-integer`). To refresh them, see the usage comment in `scripts/build-problems.mjs`.
