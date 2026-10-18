importScripts("data/problem-lists.js", "data/recommender.js");

const SESSION_STORAGE_KEY = "activeSession";
const DATA_PATH = "data/problems.json";

let cachedProblems = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    OPEN_CURRENT_PROBLEM: () => openCurrentProblem(),
    NEETCODE_PROBLEM_ACCEPTED: () =>
      markProblemAccepted(message.slug, message.sessionId),
    ADVANCE_TO_NEXT_PROBLEM: () =>
      advanceToNextProblem(message.slug, message.sessionId, sender.tab?.id),
    SKIP_CURRENT_PROBLEM: () =>
      skipCurrentProblem(message.slug, message.sessionId, sender.tab?.id),
    NEETCODE_SUBMISSION_REJECTED: () =>
      markSubmissionRejected(message.slug, message.sessionId),
    NEETCODE_SOLUTION_VIEWED: () =>
      markSolutionViewed(message.slug, message.sessionId),
    RECORD_PATTERN_GUESS: () =>
      recordPatternGuess(message.slug, message.sessionId, message.guess),
    TOGGLE_SESSION_PAUSE: () => toggleSessionPause(message.sessionId),
    END_SESSION: () => endSession(message.sessionId),
    REGENERATE_CURRENT_QUESTION: () =>
      regenerateCurrentQuestion(
        message.slug,
        message.sessionId,
        sender.tab?.id
      )
  };

  const handler = handlers[message?.type];
  if (!handler) {
    return false;
  }

  handler()
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error(`Failed to handle ${message.type}:`, error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

async function openCurrentProblem() {
  const session = await getSession();
  const currentProblem = getCurrentProblem(session);

  if (!session) {
    return { ok: false, error: "No active session." };
  }

  if (!currentProblem) {
    return { ok: false, error: "Session is already complete." };
  }

  await chrome.tabs.create({ url: currentProblem.url });
  return { ok: true, slug: currentProblem.slug };
}

async function markProblemAccepted(slug, sessionId) {
  const session = await getSession();
  const validationError = validateCurrentProblem(session, slug, sessionId);
  if (validationError) {
    return validationError;
  }

  // The solve time stops here; naming the pattern and reading the editorial after an
  // accepted submit don't count against it.
  if (session.acceptedSlug !== slug) {
    session.currentSolveMs = getCurrentProblemElapsed(session);
  }
  session.acceptedSlug = slug;
  await setSession(session);
  return { ok: true, status: "ready_to_advance", slug };
}

async function advanceToNextProblem(slug, sessionId, tabId) {
  const session = await getSession();
  const validationError = validateCurrentProblem(session, slug, sessionId);
  if (validationError) {
    return validationError;
  }

  if (session.acceptedSlug !== slug) {
    return {
      ok: false,
      error: "Next unlocks after this problem receives an accepted submission."
    };
  }

  if (isGuessPending(session)) {
    return { ok: false, error: "Name the pattern first." };
  }

  if (!session.completedSlugs.includes(slug)) {
    session.completedSlugs.push(slug);
  }

  return moveToNextProblem(session, "advanced", tabId);
}

async function skipCurrentProblem(slug, sessionId, tabId) {
  const session = await getSession();
  const validationError = validateCurrentProblem(session, slug, sessionId);
  if (validationError) {
    return validationError;
  }

  if (isGuessPending(session)) {
    return { ok: false, error: "Name the pattern first." };
  }

  if (!session.skippedSlugs.includes(slug)) {
    session.skippedSlugs.push(slug);
  }

  return moveToNextProblem(session, "skipped", tabId);
}

async function markSubmissionRejected(slug, sessionId) {
  const session = await getSession();
  const validationError = validateCurrentProblem(session, slug, sessionId);
  if (validationError) {
    return validationError;
  }

  session.currentWrongSubmits += 1;
  await setSession(session);
  return { ok: true };
}

async function markSolutionViewed(slug, sessionId) {
  const session = await getSession();
  const validationError = validateCurrentProblem(session, slug, sessionId);
  if (validationError) {
    return validationError;
  }

  if (!session.currentSawSolution) {
    session.currentSawSolution = true;
    await setSession(session);
  }
  return { ok: true };
}

// The first guess sticks: the answer is revealed right after it.
async function recordPatternGuess(slug, sessionId, guess) {
  const session = await getSession();
  const validationError = validateCurrentProblem(session, slug, sessionId);
  if (validationError) {
    return validationError;
  }

  if (!session.patternChoices.length) {
    return { ok: false, error: "This session doesn't ask for the pattern." };
  }

  if (guess !== "" && !session.patternChoices.includes(guess)) {
    return { ok: false, error: "Unknown pattern." };
  }

  if (session.currentGuess === null) {
    session.currentGuess = guess;
    await setSession(session);
  }
  return { ok: true, guess: session.currentGuess };
}

function isGuessPending(session) {
  return session.patternChoices.length > 0 && session.currentGuess === null;
}

// Ends the current problem: one row for the summary screen, one attempt for the history.
async function recordCurrentProblemAttempt(session, outcome) {
  const problem = getCurrentProblem(session);
  if (!problem) {
    return;
  }

  const endedAt = getEffectiveNow(session);
  const elapsedMs =
    outcome === "solved" && session.currentSolveMs !== null
      ? session.currentSolveMs
      : getCurrentProblemElapsed(session);
  const guess = session.patternChoices.length ? session.currentGuess : null;

  if (outcome !== "rerolled") {
    session.questionTimes.push({
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      topic: problem.topics[0],
      guess,
      elapsedMs,
      outcome: outcome === "skipped" ? "skipped" : "completed"
    });
  }

  await appendAttempt({
    slug: problem.slug,
    title: problem.title,
    topic: problem.topics[0],
    difficulty: problem.difficulty,
    endedAt,
    outcome,
    elapsedMs,
    wrongSubmits: session.currentWrongSubmits,
    sawSolution: session.currentSawSolution,
    guess,
    sessionId: session.id
  });
}

function getCurrentProblemElapsed(session) {
  const startedAt = session.currentProblemStartedAt || session.startedAt;
  return Math.max(
    0,
    getEffectiveNow(session) - startedAt - (session.currentProblemPausedMs || 0)
  );
}

function startCurrentProblem(session) {
  session.acceptedSlug = null;
  session.currentSolveMs = null;
  session.currentProblemStartedAt = Date.now();
  session.currentProblemPausedMs = 0;
  session.currentWrongSubmits = 0;
  session.currentSawSolution = false;
  session.currentGuess = null;
  session.completedAt = null;
}

async function moveToNextProblem(session, status, tabId) {
  await recordCurrentProblemAttempt(
    session,
    status === "skipped" ? "skipped" : "solved"
  );

  session.currentIndex += 1;
  session.acceptedSlug = null;

  // Adaptive sessions pick each problem only when it's reached, so the result just
  // recorded already counts.
  if (session.adaptive && session.currentIndex < session.size) {
    const nextPick = await pickNextAdaptiveProblem(session);
    if (nextPick) {
      session.queue.push(nextPick);
    } else {
      session.size = session.queue.length;
    }
  }

  const nextProblem = getCurrentProblem(session);
  if (!nextProblem) {
    session.completedAt = getEffectiveNow(session);
    await setSession(session);
    return { ok: true, status: "completed" };
  }

  startCurrentProblem(session);
  await setSession(session);

  await navigateToProblem(tabId, nextProblem.url);
  return { ok: true, status, nextSlug: nextProblem.slug };
}

async function navigateToProblem(tabId, url) {
  if (tabId) {
    await chrome.tabs.update(tabId, { url });
    return;
  }

  await chrome.tabs.create({ url });
}

async function endSession(sessionId) {
  const session = await getSession();
  if (!session) {
    return { ok: true, status: "ended" };
  }

  if (sessionId && session.id !== sessionId) {
    return { ok: false, error: "This session is no longer active." };
  }

  await chrome.storage.local.remove(SESSION_STORAGE_KEY);
  return { ok: true, status: "ended" };
}

async function toggleSessionPause(sessionId) {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "No active session." };
  }

  if (sessionId && session.id !== sessionId) {
    return { ok: false, error: "This session is no longer active." };
  }

  if (session.completedAt || session.currentIndex >= session.size) {
    return { ok: false, error: "Session is already complete." };
  }

  if (session.isPaused) {
    const pausedDuration = Date.now() - session.pausedAt;
    session.totalPausedMs += pausedDuration;
    session.currentProblemPausedMs += pausedDuration;
    session.pausedAt = null;
    session.isPaused = false;
    await setSession(session);
    return { ok: true, status: "resumed" };
  }

  session.pausedAt = Date.now();
  session.isPaused = true;
  await setSession(session);
  return { ok: true, status: "paused" };
}

async function regenerateCurrentQuestion(slug, sessionId, tabId) {
  const session = await getSession();
  const validationError = validateCurrentProblem(session, slug, sessionId);
  if (validationError) {
    return validationError;
  }

  const replacement = session.adaptive
    ? await pickNextAdaptiveProblem(session)
    : await pickReplacementProblem(session);

  if (!replacement) {
    return {
      ok: false,
      error: "No alternate problems matched your filters."
    };
  }

  await recordCurrentProblemAttempt(session, "rerolled");
  session.queue[session.currentIndex] = replacement;
  startCurrentProblem(session);
  await setSession(session);

  if (tabId) {
    await chrome.tabs.update(tabId, { url: replacement.url });
  } else {
    await navigateToProblem(null, replacement.url);
  }

  return {
    ok: true,
    status: "question_regenerated",
    slug: replacement.slug
  };
}

async function pickReplacementProblem(session) {
  const problems = await ensureProblemData();
  const usedSlugs = new Set(session.queue.map((problem) => problem.slug));
  const candidates = filterProblems(problems, session.filters).filter(
    (problem) => !usedSlugs.has(problem.slug)
  );

  return candidates.length ? shuffle(candidates)[0] : null;
}

// Skips every problem this session has shown, including the rerolled ones.
async function pickNextAdaptiveProblem(session) {
  const [problems, history] = await Promise.all([
    ensureProblemData(),
    getAttemptHistory()
  ]);
  const usedSlugs = new Set(session.queue.map((problem) => problem.slug));
  for (const attempt of history) {
    if (attempt.sessionId === session.id) {
      usedSlugs.add(attempt.slug);
    }
  }

  return pickAdaptiveProblem(problems, session.filters, history, usedSlugs);
}

async function getAttemptHistory() {
  const stored = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
  return stored[HISTORY_STORAGE_KEY] || [];
}

async function appendAttempt(attempt) {
  const history = await getAttemptHistory();
  history.push(attempt);
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: history });
}

async function ensureProblemData() {
  if (!cachedProblems) {
    cachedProblems = await loadProblems();
  }

  return cachedProblems;
}

async function loadProblems() {
  const response = await fetch(chrome.runtime.getURL(DATA_PATH));
  if (!response.ok) {
    throw new Error(`Failed to load problems.json: ${response.status}`);
  }

  return response.json();
}

function validateCurrentProblem(session, slug, sessionId) {
  if (!session) {
    return { ok: false, error: "No active session." };
  }

  if (sessionId && session.id !== sessionId) {
    return { ok: false, error: "This session is no longer active." };
  }

  const currentProblem = getCurrentProblem(session);
  if (!currentProblem || currentProblem.slug !== slug) {
    return { ok: false, error: "This is not the current queued problem." };
  }

  return null;
}

function getCurrentProblem(session) {
  return session?.queue?.[session.currentIndex] || null;
}

function getEffectiveNow(session) {
  return session.isPaused ? session.pausedAt : Date.now();
}

async function getSession() {
  const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  const session = stored[SESSION_STORAGE_KEY] || null;
  if (!session) {
    return null;
  }

  session.completedSlugs ||= [];
  session.skippedSlugs ||= [];
  session.acceptedSlug ??= null;
  session.currentProblemStartedAt ??= session.startedAt;
  session.isPaused ??= false;
  session.pausedAt ??= null;
  session.totalPausedMs ??= 0;
  session.currentProblemPausedMs ??= 0;
  session.completedAt ??= null;
  session.questionTimes ??= [];
  // Sessions stored before adaptive picking hold their whole queue up front.
  session.size ??= session.queue.length;
  session.adaptive ??= false;
  session.patternChoices ??= [];
  session.currentWrongSubmits ??= 0;
  session.currentSawSolution ??= false;
  session.currentGuess ??= null;
  session.currentSolveMs ??= null;
  if (session.currentIndex >= session.size && !session.completedAt) {
    session.completedAt = getEffectiveNow(session);
  }
  return session;
}

async function setSession(session) {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
}
