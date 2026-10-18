const DATA_PATH = "data/problems.json";
const RECENT_ATTEMPT_COUNT = 20;
const MIXUP_COUNT = 8;

const elements = {
  summary: document.getElementById("summary"),
  topicRows: document.getElementById("topic-rows"),
  mixupList: document.getElementById("mixup-list"),
  attemptList: document.getElementById("attempt-list"),
  exportButton: document.getElementById("export-button"),
  importInput: document.getElementById("import-input"),
  clearButton: document.getElementById("clear-button"),
  statusMessage: document.getElementById("status-message")
};

let topics = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  elements.exportButton.addEventListener("click", exportHistory);
  elements.importInput.addEventListener("change", importHistory);
  elements.clearButton.addEventListener("click", clearHistory);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[HISTORY_STORAGE_KEY]) {
      render(changes[HISTORY_STORAGE_KEY].newValue || []);
    }
  });

  const response = await fetch(chrome.runtime.getURL(DATA_PATH));
  const problems = await response.json();
  topics = Array.from(new Set(problems.flatMap((problem) => problem.topics)));
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
  const dueCount = Array.from(getReviewSchedule(history).values()).filter(
    (entry) => entry.dueAt <= now
  ).length;
  const guessed = scored.filter((attempt) => attempt.guess !== null);
  const named = guessed.filter((attempt) => attempt.guess === attempt.topic).length;

  elements.summary.innerHTML = [
    ["Attempts", scored.length],
    ["Solved", scored.filter((attempt) => attempt.outcome === "solved").length],
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
      const level = !stats ? "none" : mastery < 0.4 ? "low" : mastery < 0.7 ? "mid" : "high";
      return `
        <tr>
          <td>${escapeHtml(topic)}</td>
          <td class="mastery-col">
            <span class="bar ${level}"><span style="width: ${stats ? Math.round(mastery * 100) : 0}%"></span></span>
          </td>
          <td>${stats?.attempts ?? 0}</td>
          <td>${stats?.solved ?? 0}</td>
          <td>${stats?.guessed ? `${stats.recognized}/${stats.guessed}` : "—"}</td>
          <td>${stats ? formatAgo(now - stats.lastAt) : "never"}</td>
        </tr>
      `;
    })
    .join("");

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

  const recent = history.slice(-RECENT_ATTEMPT_COUNT).reverse();
  elements.attemptList.innerHTML = recent.length
    ? recent
        .map(
          (attempt) => `
            <li class="${attempt.outcome}">
              <div class="attempt-info">
                <a href="https://neetcode.io/problems/${encodeURIComponent(attempt.slug)}" target="_blank" rel="noreferrer">${escapeHtml(attempt.title)}</a>
                <span class="meta">${escapeHtml(formatAttemptMeta(attempt))}</span>
              </div>
              <span class="badge">${attempt.outcome}</span>
              <span class="time">${formatElapsed(attempt.elapsedMs)}</span>
            </li>
          `
        )
        .join("")
    : `<li class="empty">Finish a session problem to start the history.</li>`;
}

function formatAttemptMeta(attempt) {
  const parts = [attempt.difficulty, attempt.topic];
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
  if (attempt.sawSolution) {
    parts.push("solution opened");
  }

  return parts.join(" · ");
}

async function exportHistory() {
  const history = await getHistory();
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `neetcode-randomizer-history-${new Date().toISOString().slice(0, 10)}.json`;
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

function formatAgo(milliseconds) {
  const days = Math.floor(milliseconds / DAY_MS);
  if (days >= 1) {
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  const hours = Math.floor(milliseconds / 3600000);
  return hours >= 1 ? `${hours} h ago` : "just now";
}
