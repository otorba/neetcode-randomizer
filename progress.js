const DATA_PATH = "data/problems.json";
const RECENT_ATTEMPT_COUNT = 20;
const MIXUP_COUNT = 8;
const REVIEW_LIST_COUNT = 12;

const elements = {
  summary: document.getElementById("summary"),
  topicRows: document.getElementById("topic-rows"),
  timeTargets: document.getElementById("time-targets"),
  reviewList: document.getElementById("review-list"),
  mixupList: document.getElementById("mixup-list"),
  attemptList: document.getElementById("attempt-list"),
  exportButton: document.getElementById("export-button"),
  importInput: document.getElementById("import-input"),
  clearButton: document.getElementById("clear-button"),
  debugLogButton: document.getElementById("debug-log-button"),
  statusMessage: document.getElementById("status-message")
};

let topics = [];
let problemsBySlug = new Map();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  elements.exportButton.addEventListener("click", exportHistory);
  elements.importInput.addEventListener("change", importHistory);
  elements.clearButton.addEventListener("click", clearHistory);
  elements.debugLogButton.addEventListener("click", exportDebugLog);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[HISTORY_STORAGE_KEY]) {
      render(changes[HISTORY_STORAGE_KEY].newValue || []);
    }
  });

  const response = await fetch(chrome.runtime.getURL(DATA_PATH));
  const problems = await response.json();
  topics = Array.from(new Set(problems.flatMap((problem) => problem.topics)));
  problemsBySlug = new Map(problems.map((problem) => [problem.slug, problem]));
  render(await getHistory());
}

async function getHistory() {
  const stored = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  return stored[HISTORY_STORAGE_KEY] || [];
}

function render(history) {
  const scored = history.filter(isScoredAttempt);
  const topicStats = getTopicStats(history);
  const now = Date.now();
  // A slug the problem data no longer holds can't be picked, so it isn't listed.
  const reviews = Array.from(getReviewSchedule(history), ([slug, entry]) => ({
    problem: problemsBySlug.get(slug),
    ...entry
  }))
    .filter((review) => review.problem)
    .sort((a, b) => a.dueAt - b.dueAt);
  const dueCount = reviews.filter((review) => review.dueAt <= now).length;
  const guessed = scored.filter((attempt) => attempt.guess !== null);
  const named = guessed.filter((attempt) => attempt.guess === attempt.topic).length;
  const solved = scored.filter((attempt) => attempt.outcome === "solved");
  const solvedSolo = solved.filter((attempt) => getAttemptHelp(attempt) === "none").length;

  elements.summary.innerHTML = [
    ["Attempts", scored.length],
    ["Solved", solved.length],
    ["Solved solo", solved.length ? `${Math.round((solvedSolo / solved.length) * 100)}%` : "—"],
    ["Named correctly", guessed.length ? `${Math.round((named / guessed.length) * 100)}%` : "—"],
    ["Reviews due", dueCount]
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><span class="label">${label}</span><strong>${value}</strong></div>`
    )
    .join("");

  const rows = topics
    .map((topic) => ({ topic, stats: topicStats.get(topic) }))
    .sort((a, b) => getMastery(a.stats) - getMastery(b.stats) || a.topic.localeCompare(b.topic));
  elements.topicRows.innerHTML = rows
    .map(({ topic, stats }) => {
      const mastery = getMastery(stats);
      const level = mastery < 0.4 ? "low" : mastery < 0.7 ? "mid" : "high";
      return `
        <tr>
          <td>${escapeHtml(topic)}${stats?.misnamed ? ` <span class="tag" title="You named this pattern for a problem of another one. That lowers its mastery too.">named by mistake ${stats.misnamed}×</span>` : ""}</td>
          <td class="mastery-col">
            <span class="bar ${stats ? level : "none"}"><span style="width: ${stats ? Math.round(mastery * 100) : 0}%"></span></span>
          </td>
          <td>${stats?.attempts ?? 0}</td>
          <td>${stats?.solved ?? 0}</td>
          <td>${stats?.solved ? `${stats.solvedSolo}/${stats.solved}` : "—"}</td>
          <td>${stats?.guessed ? `${stats.recognized}/${stats.guessed}` : "—"}</td>
          <td>${stats?.lastAt ? formatAgo(now - stats.lastAt) : "never"}</td>
        </tr>
      `;
    })
    .join("");

  elements.timeTargets.textContent = `Going over the time target lowers the score: ${Object.keys(
    TARGET_MINUTES
  )
    .map((difficulty) => {
      const targetMs = getTimeTargetMs(history, difficulty);
      const paced = targetMs !== getDefaultTimeTargetMs(difficulty);
      return `${difficulty} ${Math.round(targetMs / 60000)} min${paced ? " (from your pace)" : ""}`;
    })
    .join(" · ")}.`;

  const listedReviews = reviews.slice(0, REVIEW_LIST_COUNT);
  elements.reviewList.innerHTML = reviews.length
    ? listedReviews
        .map(({ problem, step, dueAt }) => {
          const due = dueAt <= now;
          const meta = [problem.difficulty, problem.topics[0]];
          if (problem.pro) {
            meta.push("Pro");
          }
          meta.push(`review ${step + 1} of ${REVIEW_INTERVALS_DAYS.length}`);
          return `
            <li class="${due ? "due" : "upcoming"}">
              <div class="attempt-info">
                <a href="${escapeHtml(problem.url)}" target="_blank" rel="noreferrer">${escapeHtml(problem.title)}</a>
                <span class="meta">${escapeHtml(meta.join(" · "))}</span>
              </div>
              <span class="badge">${due ? "due" : "upcoming"}</span>
              <span class="time">${due ? formatAgo(now - dueAt) : formatUntil(dueAt - now)}</span>
            </li>
          `;
        })
        .join("") +
      (reviews.length > listedReviews.length
        ? `<li class="empty">and ${reviews.length - listedReviews.length} more</li>`
        : "")
    : `<li class="empty">Nothing scheduled to come back.</li>`;

  const mixups = new Map();
  for (const attempt of guessed) {
    if (attempt.guess && attempt.guess !== attempt.topic) {
      const key = `${attempt.guess}\n${attempt.topic}`;
      mixups.set(key, (mixups.get(key) || 0) + 1);
    }
  }
  const topMixups = Array.from(mixups).sort((a, b) => b[1] - a[1]).slice(0, MIXUP_COUNT);
  elements.mixupList.innerHTML = topMixups.length
    ? topMixups
        .map(([key, count]) => {
          const [guess, topic] = key.split("\n");
          return `<li><span>${escapeHtml(guess)} → <b>${escapeHtml(topic)}</b></span><span class="count">${count}×</span></li>`;
        })
        .join("")
    : `<li class="empty">No mix-ups yet.</li>`;

  const repeats = getRepeatAttempts(history);
  const recent = history.slice(-RECENT_ATTEMPT_COUNT).reverse();
  elements.attemptList.innerHTML = recent.length
    ? recent
        .map(
          (attempt) => `
            <li class="${attempt.outcome}">
              <div class="attempt-info">
                <a href="https://neetcode.io/problems/${encodeURIComponent(attempt.slug)}" target="_blank" rel="noreferrer">${escapeHtml(attempt.title)}</a>
                <span class="meta">${escapeHtml(formatAttemptMeta(attempt, repeats.has(attempt)))}</span>
              </div>
              <span class="badge">${attempt.outcome}</span>
              <span class="time">${formatElapsed(attempt.elapsedMs)}</span>
            </li>
          `
        )
        .join("")
    : `<li class="empty">Finish a session problem to start the history.</li>`;
}

function formatAttemptMeta(attempt, isRepeat) {
  const parts = [attempt.difficulty, attempt.topic];
  if (isRepeat) {
    parts.push("review");
  }
  if (attempt.guess !== null && attempt.outcome !== "rerolled") {
    parts.push(
      attempt.guess === attempt.topic
        ? "✓ named"
        : attempt.guess
          ? `✗ said ${attempt.guess}`
          : "not named"
    );
  }
  if (attempt.wrongSubmits) {
    parts.push(`${attempt.wrongSubmits} wrong`);
  }
  const help = getAttemptHelp(attempt);
  if (help === "hint") {
    parts.push("used a hint");
  } else if (help === "solution") {
    parts.push("saw the solution");
  }

  return parts.join(" · ");
}

async function exportHistory() {
  downloadJson("history", await getHistory());
}

// The log plus the state it acted on, so one file is enough to troubleshoot from.
async function exportDebugLog() {
  const stored = await chrome.storage.local.get([
    DEBUG_LOG_STORAGE_KEY,
    "activeSession",
    "settings"
  ]);
  downloadJson("debug-log", {
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    activeSession: stored.activeSession || null,
    settings: stored.settings || null,
    entries: stored[DEBUG_LOG_STORAGE_KEY] || []
  });
}

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `neetcode-randomizer-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Merges a previous export into the current history; attempts present in both count once.
async function importHistory() {
  const [file] = elements.importInput.files;
  elements.importInput.value = "";
  if (!file) {
    return;
  }

  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported) || !imported.every(isAttemptShape)) {
      throw new Error("That file isn't a NeetCode Randomizer history export.");
    }

    const merged = new Map();
    for (const attempt of [...(await getHistory()), ...imported]) {
      merged.set(`${attempt.sessionId}:${attempt.slug}:${attempt.endedAt}:${attempt.outcome}`, attempt);
    }
    const history = Array.from(merged.values()).sort((a, b) => a.endedAt - b.endedAt);
    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: history });
    setStatus(`Imported. ${history.length} attempts in the history.`);
  } catch (error) {
    setStatus(error instanceof SyntaxError ? "That file isn't valid JSON." : error.message);
  }
}

function isAttemptShape(attempt) {
  return (
    typeof attempt?.slug === "string" &&
    typeof attempt.topic === "string" &&
    typeof attempt.endedAt === "number" &&
    ["solved", "skipped", "rerolled"].includes(attempt.outcome)
  );
}

async function clearHistory() {
  if (!window.confirm("Delete the whole attempt history? Export it first if you want a copy.")) {
    return;
  }

  await chrome.storage.local.remove(HISTORY_STORAGE_KEY);
  render([]);
  setStatus("History cleared.");
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function formatUntil(milliseconds) {
  const days = Math.ceil(milliseconds / DAY_MS);
  if (days > 1) {
    return `in ${days} days`;
  }

  const hours = Math.ceil(milliseconds / 3600000);
  return hours > 1 ? `in ${hours} h` : "within the hour";
}

function formatAgo(milliseconds) {
  const days = Math.floor(milliseconds / DAY_MS);
  if (days >= 1) {
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  const hours = Math.floor(milliseconds / 3600000);
  return hours >= 1 ? `${hours} h ago` : "just now";
}
