# NeetCode Randomizer

A Chrome extension that builds a hidden, randomized practice queue from a NeetCode list and
opens the problems on [neetcode.io](https://neetcode.io), one at a time. It is a port of the
[LeetCode Randomizer](https://chromewebstore.google.com/detail/leetcode-randomizer/kpcfdadongbobogdkojpflldijmhllln)
extension (MIT) to NeetCode.

## Features

- Pick a list (Blind 75, NeetCode 150, NeetCode 250, Premium 100 or NeetCode All), a session size
  (1-10), any combination of topics and difficulties. Pro problems (most of Premium 100, part of
  NeetCode All) are included only when "Include Pro" is checked.
- Problems open on `neetcode.io/problems/<slug>`. Next unlocks only after an accepted **Submit**
  (a passing Run does not count).
- In-page session sidebar (`Alt+Shift+H` to expand/collapse): session and problem timers, progress,
  Next, Skip, Pause, Regenerate question, End session.
- Session and problem timers in the problem navbar.
- Optional auto-reset of the editor to the starter code when a queued problem opens.
- Summary screen with time per question when the queue is finished.
- Dark theme matching the neetcode.io palette.

## Install

1. Clone the repo: `git clone https://github.com/otorba/neetcode-randomizer.git`
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and select the cloned `neetcode-randomizer` folder.

## Problem data

`data/problems.json` is generated from the problem list embedded in the neetcode.io bundle, so the slugs are NeetCode's own (for example Contains Duplicate is
`duplicate-integer`). To refresh them, see the usage comment in `scripts/build-problems.mjs`.
