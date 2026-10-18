// Shared by popup.js and background.js (importScripts), so keep it a classic script.

const PROBLEM_LIST_ALL = "allNC";
const DEFAULT_PROBLEM_LIST = "neetcode150";

// Ids match the list flags in problems.json `lists`, except "allNC", which is every
// problem. Only "premiumAlgo100" and "allNC" hold Pro problems.
const PROBLEM_LISTS = [
  { id: "blind75", label: "Blind 75" },
  { id: "neetcode150", label: "NeetCode 150" },
  { id: "neetcode250", label: "NeetCode 250" },
  { id: "premiumAlgo100", label: "Premium 100" },
  { id: PROBLEM_LIST_ALL, label: "NeetCode All" }
];

function isKnownProblemList(problemList) {
  return PROBLEM_LISTS.some((list) => list.id === problemList);
}

function getProblemListLabel(problemList) {
  return PROBLEM_LISTS.find((list) => list.id === problemList)?.label || problemList;
}

// Pro problems are opt-in: without a subscription NeetCode shows a paywall and
// the session can never reach an accepted submit.
function getProblemsForList(allProblems, problemList, includePro) {
  return allProblems.filter(
    (problem) =>
      (includePro || !problem.pro) &&
      (problemList === PROBLEM_LIST_ALL || problem.lists.includes(problemList))
  );
}

function filterProblems(allProblems, filters) {
  const pool = getProblemsForList(
    allProblems,
    filters.problemList || DEFAULT_PROBLEM_LIST,
    filters.includePro
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
