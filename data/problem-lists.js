// Shared by popup.js and background.js (importScripts), so keep it a classic script.

const PROBLEM_LIST_ALL = "allNC";
const DEFAULT_PROBLEM_LIST = "neetcode150";

// Ids match the list flags in problems.json `lists`, except "allNC", which is every
// free problem. Pro problems are left out: without a subscription NeetCode shows a
// paywall and the session can never reach an accepted submit.
const PROBLEM_LISTS = [
  { id: "blind75", label: "Blind 75" },
  { id: "neetcode150", label: "NeetCode 150" },
  { id: "neetcode250", label: "NeetCode 250" },
  { id: PROBLEM_LIST_ALL, label: "NeetCode All (free)" }
];

function isKnownProblemList(problemList) {
  return PROBLEM_LISTS.some((list) => list.id === problemList);
}

function getProblemListLabel(problemList) {
  return PROBLEM_LISTS.find((list) => list.id === problemList)?.label || problemList;
}

function getProblemsForList(allProblems, problemList) {
  if (problemList === PROBLEM_LIST_ALL) {
    return allProblems.filter((problem) => !problem.pro);
  }

  return allProblems.filter((problem) => problem.lists.includes(problemList));
}

function filterProblems(allProblems, filters) {
  const pool = getProblemsForList(
    allProblems,
    filters.problemList || DEFAULT_PROBLEM_LIST
  );
  // An empty `topics` means all topics. `topic` is the single-topic shape that
  // sessions started before multi-topic selection still carry in storage.
  const topics = filters.topics ?? (filters.topic ? [filters.topic] : []);

  return pool.filter((problem) => {
    const matchesDifficulty = filters.difficulties.includes(problem.difficulty);
    const matchesTopic =
      !topics.length || problem.topics.some((topic) => topics.includes(topic));

    return matchesDifficulty && matchesTopic;
  });
}

function shuffle(problems) {
  const copy = [...problems];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
}
