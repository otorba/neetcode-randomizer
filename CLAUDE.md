# NeetCode Randomizer: project notes

Chrome MV3 extension, plain JS, no build step, no dependencies, no tests. Port of the MIT-licensed
LeetCode Randomizer (Chrome Web Store id `kpcfdadongbobogdkojpflldijmhllln`, author eson39) retargeted
at neetcode.io. Keep the original copyright line in `LICENSE`.

## Where things live

- `popup.html` / `popup.js` / `popup.css`: session setup (list, count 1-10, topic, difficulty, auto-reset).
  Writes the `activeSession` and `settings` keys in `chrome.storage.local`.
- `background.js`: the session state machine. All session mutations go through its message handlers
  (`OPEN_CURRENT_PROBLEM`, `NEETCODE_PROBLEM_ACCEPTED`, `ADVANCE_TO_NEXT_PROBLEM`, `SKIP_CURRENT_PROBLEM`,
  `TOGGLE_SESSION_PAUSE`, `REGENERATE_CURRENT_QUESTION`, `END_SESSION`). The content script never
  writes the session directly.
- `content.js`: everything on the problem page. Shadow-DOM hosts for the sidebar, header timer,
  accepted prompt and summary screen, each with its own `get*Styles()` function. The NeetCode-specific
  hooks are the constants at the top (`SUBMIT_BUTTON_SELECTOR`, `RESULT_SELECTOR`, `RESET_*`,
  `EDITOR_SELECTOR`) plus `getChangedSubmissionStatus`, `scheduleEditorReset`, `findResetConfirmButton`
  and `findPageHeaderAnchor`. Everything else is site-agnostic.
- `data/problem-lists.js`: the list registry (`PROBLEM_LISTS`), `getProblemsForList`,
  `filterProblems` and `shuffle`, shared by popup and background (`importScripts`, so it stays a
  classic script).
- `data/problems.json` (1093 entries) is generated. Don't edit it by hand.

## Problem data

- NeetCode slugs differ from LeetCode slugs (`contains-duplicate` -> `duplicate-integer`). Never
  derive a NeetCode URL from a LeetCode slug.
- Source of truth is the problem list embedded in the neetcode.io `main.<hash>.js` bundle: flat
  objects `{problem, pattern, link, difficulty, code, neetcode150:!0, blind75:!0, neetcode250:!0, premiumAlgo100:!0,
  pro:!0, ncLink:"slug/"}`. `scripts/build-problems.mjs <bundle>` parses it as text (never eval),
  keeps every entry with an `ncLink` (the JavaScript set has none and no problem page), stores the
  list flags in `lists` and the Pro flag in `pro`, and fails unless the lists hold exactly
  75 / 150 / 250 / 100. Usage is in the script header. Keep downloaded bundles in a `/tmp` dir, not in
  the repo.
- NeetCode's own list ids (bundle enum): `blind75`, `neetcode150`, `neetcode250`, `allNC`,
  `coreSkills`, `systemDesign`. Core Skills and System Design are not judged problems. There is
  also a `premiumAlgo100` flag (93 of 100 Pro), offered as "Premium 100".
- "NeetCode All" (`allNC`) is 791 free + 302 Pro problems; 75 / 150 / 250 hold no Pro problems,
  Premium 100 holds 93. Pro is opt-in (`settings.includePro`, copied into session
  `filters.includePro`): without a subscription a Pro problem opens a paywall and the session
  can't reach an accepted submit. The popup shows the "Include Pro" box only for lists that
  contain Pro problems.
- `topics` holds a single entry, NeetCode's `pattern` (18 values).
- Session `filters.topics` is an array, empty means all. Sessions stored before multi-topic carry
  `filters.topic` (a string); `filterProblems` reads both.

## NeetCode page facts (from the bundle, verify again when something breaks)

- Angular SPA. Routes: `/problems/:problemId[/:tab[/:postId]]`. The problem page is lazy chunk 7326.
  `curl` returns the same shell for valid and bogus slugs, so links can't be checked by fetch.
- Submit: `app-code-actions .submit-btn`. Its text is `Submitting...` while judging; that is the only
  pending signal, the result panel is not cleared.
- Verdict: `app-output-tab p.submission-result-accepted` or `.submission-result-wrong`; text is
  `status.description` (a raw error message for runtime errors). Run and Submit render into the same
  component, so detection must stay gated on the Submit click. After a submit NeetCode switches to the
  OUTPUT console tab itself.
- Reset: `button[data-tooltip="Reset Code"]` (another layout uses `Reset code` and resets directly).
  It opens an `app-modal` moved to `<body>`: `.modal.dialog-open`, header "Reset Code", footer
  `.modal-card-foot` button "Reset". Reset does nothing until the editor is ready, hence the wait for
  `.monaco-editor`.
- Bare `<header>` tags on the problem page belong to modals. The navbar is `app-problem-navbar .my-navbar`
  (host has `overflow-x: hidden`).
- To re-discover hooks: fetch `https://neetcode.io/practice`, take `runtime.<hash>.js`, download the
  chunks it lists (`<id>.<hash>.js`), grep for `selectors:[["app-...` and the visible text.

## Theme

Dark only, NeetCode `.dark-theme` palette: page `#202225`, card `#2f3136`, deep `#13181c`, borders
`rgba(255,255,255,.08/.15)`, primary `#615fff` / hover `#7c86ff`, success `#48c78e` / `#4ade80`,
difficulty easy `rgb(72,199,142)`, medium `rgb(245,166,35)`, hard `rgb(248,113,113)`. The popup uses CSS
variables in `popup.css` `:root`; the in-page styles in `content.js` use literal colors from the
same palette.

## Verifying changes

- `node --check` on every JS file. A data rebuild asserts the 75 / 150 / 250 / 100 counts itself.
- Visual check without loading the extension: copy the popup and content files to a `/tmp` dir, add a
  stub `window.chrome` (`storage.local.get/set/remove`, `storage.onChanged`, `runtime.getURL/sendMessage`)
  loaded before the scripts, serve with `python3 -m http.server`, and screenshot with
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=...`.
  Give the harness page `<meta charset="utf-8">`, otherwise `›` and `·` render as mojibake.
- Submission detection, auto-reset and the navbar timer can only be verified on live neetcode.io via
  `chrome://extensions` -> Load unpacked. Say so when reporting; don't claim them as tested.

## Known limitation

If a submit fails after `Submitting...` while the output tab still shows an earlier Run's Accepted,
Next unlocks. Requiring a signature change would break the Run-passes-then-Submit-passes path, which
renders identical DOM. Don't "fix" it that way.
