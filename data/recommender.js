// Adaptive problem picking over the attempt history. Shared by popup.js, background.js
// (importScripts) and progress.js, so keep it a classic script. Needs problem-lists.js.
//
// An attempt is { slug, title, topic, difficulty, endedAt, outcome, elapsedMs,
// wrongSubmits, sawSolution, guess, sessionId }. `outcome` is "solved", "skipped" or
// "rerolled"; `guess` is the pattern the user named, "" for "Not sure", or null when the
// session asked for no guess (a single-topic session).

const HISTORY_STORAGE_KEY = "attemptHistory";
const DAY_MS = 24 * 60 * 60 * 1000;

// Share of picks drawn uniformly from the list, like a plain shuffle. Keeps the mix
// unpredictable even when one topic is clearly the weakest.
const RANDOM_PICK_SHARE = 0.2;
// Chance that a due review takes the slot when one is due.
const REVIEW_PICK_SHARE = 0.25;
// The weakest topic is at most this many times as likely as the strongest one.
const MAX_NEED_WEIGHT = 3;
// Weight multipliers for the topic of the last attempt, the one before it, and so on.
// Soft on purpose: a hard "never twice in a row" rule tells you what the next one isn't.
const RECENT_TOPIC_PENALTIES = [0.25, 0.5, 0.75];
// Each newer attempt in a topic shrinks the weight of the older ones by this factor.
const ATTEMPT_DECAY = 0.85;
// A weak attempt brings the problem back after the first interval; every strong review
// moves it one interval further, and past the last one it never returns.
const REVIEW_INTERVALS_DAYS = [1, 4, 14];
const STRONG_ATTEMPT_SCORE = 0.7;
// Mastery credit cap for attempts in a single-topic session: the topic was known up
// front, so solving says nothing about recognizing it. The review schedule ignores
// the cap, otherwise every drilled problem would come back.
const KNOWN_TOPIC_MAX_SCORE = 0.6;
const TARGET_MINUTES = { Easy: 15, Medium: 25, Hard: 40 };
// Difficulty mix within the picked topic, by that topic's mastery.
const DIFFICULTY_MIX = [
  { below: 0.4, weights: { Easy: 0.5, Medium: 0.45, Hard: 0.05 } },
  { below: 0.7, weights: { Easy: 0.25, Medium: 0.6, Hard: 0.15 } },
  { below: Infinity, weights: { Easy: 0.1, Medium: 0.55, Hard: 0.35 } }
];

// 0..1, how cleanly the attempt went. Naming the pattern is what the score is about;
// solving with a wrong or missing guess keeps some credit, the solution tab caps it.
function scoreAttempt(attempt) {
  const recognized = attempt.guess === null || attempt.guess === attempt.topic;
  if (attempt.outcome === "skipped") {
    return attempt.guess !== null && recognized ? 0.3 : 0;
  }

  let score = recognized ? 1 : 0.4;
  score -= Math.min(attempt.wrongSubmits, 3) * 0.1;
  const targetMs = (TARGET_MINUTES[attempt.difficulty] || TARGET_MINUTES.Medium) * 60000;
  if (attempt.elapsedMs > 2 * targetMs) {
    score -= 0.3;
  } else if (attempt.elapsedMs > targetMs) {
    score -= 0.15;
  }
  if (attempt.sawSolution) {
    score = Math.min(score, 0.2);
  }

  return Math.min(Math.max(score, 0), 1);
}

function isScoredAttempt(attempt) {
  return attempt.outcome !== "rerolled";
}

// Per topic: a Beta(alpha, beta) belief about how well it's mastered, newest attempts
// weighted most, plus plain counts for the progress page.
function getTopicStats(history) {
  const stats = new Map();
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const attempt = history[index];
    if (!isScoredAttempt(attempt)) {
      continue;
    }

    let topic = stats.get(attempt.topic);
    if (!topic) {
      topic = {
        alpha: 1,
        beta: 1,
        weight: 1,
        attempts: 0,
        solved: 0,
        guessed: 0,
        recognized: 0,
        lastAt: attempt.endedAt
      };
      stats.set(attempt.topic, topic);
    }

    const score =
      attempt.guess === null
        ? Math.min(scoreAttempt(attempt), KNOWN_TOPIC_MAX_SCORE)
        : scoreAttempt(attempt);
    topic.alpha += score * topic.weight;
    topic.beta += (1 - score) * topic.weight;
    topic.weight *= ATTEMPT_DECAY;
    topic.attempts += 1;
    if (attempt.outcome === "solved") {
      topic.solved += 1;
    }
    if (attempt.guess !== null) {
      topic.guessed += 1;
      if (attempt.guess === attempt.topic) {
        topic.recognized += 1;
      }
    }
  }

  return stats;
}

function getMastery(topicStats) {
  return topicStats ? topicStats.alpha / (topicStats.alpha + topicStats.beta) : 0.5;
}

// slug -> { step, dueAt } for every problem that is still scheduled to come back.
function getReviewSchedule(history) {
  const schedule = new Map();
  for (const attempt of history) {
    if (!isScoredAttempt(attempt)) {
      continue;
    }

    if (scoreAttempt(attempt) < STRONG_ATTEMPT_SCORE) {
      schedule.set(attempt.slug, {
        step: 0,
        dueAt: attempt.endedAt + REVIEW_INTERVALS_DAYS[0] * DAY_MS
      });
      continue;
    }

    // A clean first attempt never comes back.
    const entry = schedule.get(attempt.slug);
    if (!entry) {
      continue;
    }

    const step = entry.step + 1;
    if (step >= REVIEW_INTERVALS_DAYS.length) {
      schedule.delete(attempt.slug);
    } else {
      schedule.set(attempt.slug, {
        step,
        dueAt: attempt.endedAt + REVIEW_INTERVALS_DAYS[step] * DAY_MS
      });
    }
  }

  return schedule;
}

// Picks one problem for an adaptive session, or null when nothing is left.
// `excludeSlugs` holds the problems this session already used.
function pickAdaptiveProblem(allProblems, filters, history, excludeSlugs, now = Date.now()) {
  const isEligible = (problem) =>
    !excludeSlugs.has(problem.slug) &&
    filters.difficulties.includes(problem.difficulty) &&
    (filters.includePro || !problem.pro);

  const schedule = getReviewSchedule(history);
  const dueReviews = allProblems.filter(
    (problem) => isEligible(problem) && schedule.get(problem.slug)?.dueAt <= now
  );
  if (dueReviews.length && Math.random() < REVIEW_PICK_SHARE) {
    return pickUniform(dueReviews);
  }

  const seenSlugs = new Set(
    history.filter(isScoredAttempt).map((attempt) => attempt.slug)
  );
  // Nested lists, narrowest first: the chosen list, then the ones that contain it.
  const pools = getWideningChain(filters.problemList).map((problemList) =>
    getProblemsForList(allProblems, problemList, filters.includePro).filter(isEligible)
  );
  const freshPools = pools.map((pool) =>
    pool.filter((problem) => !seenSlugs.has(problem.slug))
  );

  if (Math.random() < RANDOM_PICK_SHARE) {
    const pool = freshPools.find((candidates) => candidates.length) || pools[0];
    return pool.length ? pickUniform(pool) : null;
  }

  // Each topic draws from the narrowest list that still has an unseen problem in it.
  const freshByTopic = new Map();
  for (const pool of freshPools) {
    const poolByTopic = groupByTopic(pool);
    for (const [topic, problems] of poolByTopic) {
      if (!freshByTopic.has(topic)) {
        freshByTopic.set(topic, problems);
      }
    }
  }

  if (!freshByTopic.size) {
    // Every eligible problem was attempted before: repeat rather than stop.
    const pool = pools.find((candidates) => candidates.length);
    return pool ? pickUniform(pool) : null;
  }

  const topicStats = getTopicStats(history);
  const recentTopics = history
    .filter(isScoredAttempt)
    .slice(-RECENT_TOPIC_PENALTIES.length)
    .reverse()
    .map((attempt) => attempt.topic);
  const listSizeByTopic = groupByTopic(pools[0]);

  const topics = Array.from(freshByTopic.keys());
  const topicWeights = topics.map((topic) => {
    const stats = topicStats.get(topic);
    // A random draw from the topic's mastery belief: uncertain topics swing widely,
    // so the order of picks is never fixed.
    const mastery = stats ? sampleBeta(stats.alpha, stats.beta) : sampleBeta(1, 1);
    const need = 1 + (MAX_NEED_WEIGHT - 1) * (1 - mastery);
    // Bigger topics come up more often, as in a plain shuffle, but sublinearly.
    const size = Math.sqrt(Math.max(1, listSizeByTopic.get(topic)?.length || 0));
    const recency = recentTopics.reduce(
      (product, recentTopic, index) =>
        recentTopic === topic ? product * RECENT_TOPIC_PENALTIES[index] : product,
      1
    );
    return size * need * recency;
  });
  const topic = topics[pickWeightedIndex(topicWeights)];

  const candidates = freshByTopic.get(topic);
  const mix = DIFFICULTY_MIX.find((entry) => getMastery(topicStats.get(topic)) < entry.below);
  const difficulties = Array.from(new Set(candidates.map((problem) => problem.difficulty)));
  const difficulty =
    difficulties[pickWeightedIndex(difficulties.map((level) => mix.weights[level]))];

  return pickUniform(candidates.filter((problem) => problem.difficulty === difficulty));
}

function groupByTopic(problems) {
  const groups = new Map();
  for (const problem of problems) {
    const topic = problem.topics[0];
    const group = groups.get(topic);
    if (group) {
      group.push(problem);
    } else {
      groups.set(topic, [problem]);
    }
  }

  return groups;
}

function pickUniform(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickWeightedIndex(weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = Math.random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    threshold -= weights[index];
    if (threshold < 0) {
      return index;
    }
  }

  return weights.length - 1;
}

// Beta(alpha, beta) from two gamma draws. Both shapes are >= 1 here (prior 1 plus
// non-negative evidence), which is the range Marsaglia-Tsang handles directly.
function sampleBeta(alpha, beta) {
  const x = sampleGamma(alpha);
  return x / (x + sampleGamma(beta));
}

function sampleGamma(shape) {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = sampleStandardNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v;
    }
  }
}

function sampleStandardNormal() {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
