const DATA_PATH = "data/problems.json";
const SESSION_STORAGE_KEY = "activeSession";
const SETTINGS_STORAGE_KEY = "settings";
const DEFAULT_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 10;
const DEFAULT_SETTINGS = {
  autoResetEnabled: true,
  includePro: false,
  problemList: DEFAULT_PROBLEM_LIST
};

const state = {
  problems: [],
  settings: { ...DEFAULT_SETTINGS }
};

const elements = {
  form: document.getElementById("filters-form"),
  problemListSelect: document.getElementById("problem-list-select"),
  allTopics: document.getElementById("all-topics"),
  topicGrid: document.getElementById("topic-grid"),
  questionCountSelect: document.getElementById("question-count"),
  questionCountHint: document.getElementById("question-count-hint"),
  statusMessage: document.getElementById("status-message"),
  autoResetEnabled: document.getElementById("auto-reset-enabled"),
  includePro: document.getElementById("include-pro"),
  includeProOption: document.getElementById("include-pro-option"),
  startButton: document.getElementById("generate-button"),
  progressButton: document.getElementById("progress-button")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();

  try {
    state.problems = await loadProblems();
    await loadStoredSettings();
    populateProblemListOptions();
    hydrateSettingsForm();
    populateTopicOptions();
    updateQuestionCountOptions();
  } catch (error) {
    console.error("Failed to initialize extension:", error);
    setStatusMessage("Could not load problem data. Reload the extension.");
    elements.startButton.disabled = true;
  }
}

function bindEvents() {
  elements.progressButton.addEventListener("click", async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("progress.html") });
    window.close();
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await startSession();
  });

  elements.allTopics.addEventListener("change", () => {
    for (const input of getTopicInputs()) {
      input.checked = elements.allTopics.checked;
    }
    updateQuestionCountOptions();
  });

  elements.topicGrid.addEventListener("change", () => {
    syncAllTopicsCheckbox();
    updateQuestionCountOptions();
  });

  for (const input of elements.form.querySelectorAll('input[name="difficulty"]')) {
    input.addEventListener("change", updateQuestionCountOptions);
  }

  elements.problemListSelect.addEventListener("change", async () => {
    state.settings.problemList = elements.problemListSelect.value;
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: state.settings
    });
    populateTopicOptions();
    updateQuestionCountOptions();
  });

  elements.includePro.addEventListener("change", async () => {
    state.settings.includePro = elements.includePro.checked;
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: state.settings
    });
    populateTopicOptions();
    updateQuestionCountOptions();
  });

  elements.autoResetEnabled.addEventListener("change", async () => {
    state.settings.autoResetEnabled = elements.autoResetEnabled.checked;
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: state.settings
    });
  });
}

async function loadProblems() {
  const response = await fetch(chrome.runtime.getURL(DATA_PATH));
  if (!response.ok) {
    throw new Error(`Failed to load problems.json: ${response.status}`);
  }

  return response.json();
}

async function loadStoredSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_STORAGE_KEY] || {})
  };

  if (!isKnownProblemList(state.settings.problemList)) {
    state.settings.problemList = DEFAULT_PROBLEM_LIST;
  }
}

function populateProblemListOptions() {
  for (const list of PROBLEM_LISTS) {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.label;
    elements.problemListSelect.appendChild(option);
  }
}

function hydrateSettingsForm() {
  elements.autoResetEnabled.checked = state.settings.autoResetEnabled;
  elements.problemListSelect.value = state.settings.problemList;
  elements.includePro.checked = state.settings.includePro;
}

function getTopicInputs() {
  return elements.topicGrid.querySelectorAll('input[name="topic"]');
}

function syncAllTopicsCheckbox() {
  const inputs = getTopicInputs();
  const checkedCount = elements.topicGrid.querySelectorAll(
    'input[name="topic"]:checked'
  ).length;

  elements.allTopics.checked = checkedCount === inputs.length;
  elements.allTopics.indeterminate =
    checkedCount > 0 && checkedCount < inputs.length;
}

// Rebuilds the topic checkboxes for the selected list. Topics that were already
// shown keep their state; new ones follow "All topics".
function populateTopicOptions() {
  const problemList = elements.problemListSelect.value;
  // The Pro checkbox only shows for lists that contain Pro problems.
  elements.includeProOption.hidden = !getProblemsForList(
    state.problems,
    problemList,
    true
  ).some((problem) => problem.pro);

  const pool = getProblemsForList(
    state.problems,
    problemList,
    elements.includePro.checked
  );
  const topics = Array.from(
    new Set(pool.flatMap((problem) => problem.topics))
  ).sort((a, b) => a.localeCompare(b));

  const previousChecked = new Map(
    Array.from(getTopicInputs(), (input) => [input.value, input.checked])
  );
  elements.topicGrid.replaceChildren();

  for (const topic of topics) {
    const label = document.createElement("label");
    label.className = "checkbox-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "topic";
    input.value = topic;
    input.checked = previousChecked.get(topic) ?? elements.allTopics.checked;

    const text = document.createElement("span");
    text.textContent = topic;

    label.append(input, text);
    elements.topicGrid.appendChild(label);
  }

  syncAllTopicsCheckbox();
}

function getFilters() {
  const formData = new FormData(elements.form);
  return {
    count: Number(formData.get("count")),
    difficulties: formData.getAll("difficulty"),
    // Empty means all topics, so a later list switch can't pin stale names.
    topics: elements.allTopics.checked ? [] : formData.getAll("topic"),
    problemList: formData.get("problemList") || DEFAULT_PROBLEM_LIST,
    // A hidden box doesn't apply, so adaptive picks that widen past the list stay free.
    includePro: !elements.includeProOption.hidden && elements.includePro.checked
  };
}

function hasTopicSelection(filters) {
  return elements.allTopics.checked || filters.topics.length > 0;
}

function getMatchingProblemCount(filters = getFilters()) {
  if (!filters.difficulties.length || !hasTopicSelection(filters)) {
    return 0;
  }

  return filterProblems(state.problems, filters).length;
}

function updateQuestionCountOptions() {
  const filters = getFilters();
  const matchingCount = getMatchingProblemCount(filters);
  const previousCount = Number(elements.questionCountSelect.value) || DEFAULT_QUESTION_COUNT;

  elements.questionCountSelect.replaceChildren();

  if (!filters.difficulties.length) {
    elements.questionCountSelect.disabled = true;
    elements.startButton.disabled = true;
    elements.questionCountHint.textContent =
      "Select at least one difficulty to choose a session size.";
    return;
  }

  if (!hasTopicSelection(filters)) {
    elements.questionCountSelect.disabled = true;
    elements.startButton.disabled = true;
    elements.questionCountHint.textContent =
      "Select at least one topic to choose a session size.";
    return;
  }

  if (matchingCount === 0) {
    elements.questionCountSelect.disabled = true;
    elements.startButton.disabled = true;
    const listLabel = getProblemListLabel(filters.problemList);
    elements.questionCountHint.textContent = filters.topics.length
      ? `No problems in ${listLabel} match the selected topics and difficulties.`
      : `No problems in ${listLabel} match the selected difficulties.`;
    return;
  }

  const maxSelectable = Math.min(MAX_QUESTION_COUNT, matchingCount);

  for (let count = 1; count <= maxSelectable; count += 1) {
    const option = document.createElement("option");
    option.value = String(count);
    option.textContent = String(count);
    elements.questionCountSelect.appendChild(option);
  }

  const nextCount = Math.min(Math.max(previousCount, 1), maxSelectable);
  elements.questionCountSelect.value = String(nextCount);
  elements.questionCountSelect.disabled = false;
  elements.startButton.disabled = false;

  if (filters.topics.length === 1) {
    const [topic] = filters.topics;
    elements.questionCountHint.textContent =
      matchingCount === 1
        ? `1 ${topic} problem available.`
        : `${matchingCount} ${topic} problems available. Max session size: ${maxSelectable}.`;
  } else if (!filters.topics.length) {
    elements.questionCountHint.textContent = `${matchingCount} problems. Picks adapt to your progress.`;
  } else if (matchingCount > MAX_QUESTION_COUNT) {
    elements.questionCountHint.textContent = `${matchingCount} problems available. You can queue up to ${MAX_QUESTION_COUNT}.`;
  } else {
    elements.questionCountHint.textContent =
      matchingCount === 1
        ? "1 problem available with these filters."
        : `${matchingCount} problems available with these filters.`;
  }
}

async function startSession() {
  const filters = getFilters();

  if (!filters.difficulties.length) {
    setStatusMessage("Select at least one difficulty.");
    return;
  }

  if (!hasTopicSelection(filters)) {
    setStatusMessage("Select at least one topic.");
    return;
  }

  const matchingProblems = filterProblems(state.problems, filters);
  // All topics means an adaptive session: each problem is picked when it's reached,
  // from the attempt history. A topic selection keeps the plain shuffle.
  const adaptive = !filters.topics.length;
  let queue;
  if (adaptive) {
    const stored = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
    const firstPick = pickAdaptiveProblem(
      state.problems,
      filters,
      stored[HISTORY_STORAGE_KEY] || [],
      new Set()
    );
    queue = firstPick ? [firstPick] : [];
  } else {
    queue = shuffle(matchingProblems).slice(0, filters.count);
  }

  if (!queue.length) {
    setStatusMessage("No problems matched those filters.");
    updateQuestionCountOptions();
    return;
  }

  elements.startButton.disabled = true;
  setStatusMessage("Starting session…");

  const session = {
    id: crypto.randomUUID(),
    filters,
    queue,
    size: adaptive ? filters.count : queue.length,
    adaptive,
    patternChoices: getPatternChoices(filters),
    totalMatches: matchingProblems.length,
    currentIndex: 0,
    completedSlugs: [],
    skippedSlugs: [],
    acceptedSlug: null,
    startedAt: Date.now(),
    currentProblemStartedAt: Date.now(),
    isPaused: false,
    pausedAt: null,
    totalPausedMs: 0,
    currentProblemPausedMs: 0,
    completedAt: null,
    questionTimes: [],
    currentWrongSubmits: 0,
    currentSawSolution: false,
    currentGuess: null,
    currentSolveMs: null
  };

  try {
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
    const response = await chrome.runtime.sendMessage({
      type: "OPEN_CURRENT_PROBLEM"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not open the first problem.");
    }

    window.close();
  } catch (error) {
    console.error("Failed to start session:", error);
    setStatusMessage(error.message);
    elements.startButton.disabled = false;
  }
}

// The patterns offered when naming one. Adaptive sessions offer every pattern, so the
// choices say nothing about which lists a pick came from. A single topic needs no guess.
function getPatternChoices(filters) {
  const topics = filters.topics.length
    ? filters.topics
    : Array.from(new Set(state.problems.flatMap((problem) => problem.topics)));
  return topics.length > 1 ? [...topics].sort((a, b) => a.localeCompare(b)) : [];
}

function setStatusMessage(message) {
  elements.statusMessage.textContent = message;
}
