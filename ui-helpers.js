// Shared by content.js (listed before it in the manifest), popup.js, progress.js and
// background.js (importScripts), so nothing here may touch the DOM at load time.

// Least to most help on a problem; a higher level replaces a lower one.
const HELP_LEVELS = ["none", "hint", "solution"];

function maxHelpLevel(a, b) {
  return HELP_LEVELS.indexOf(a) >= HELP_LEVELS.indexOf(b) ? a : b;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Adaptive sessions pick each problem when it's reached, so the queue can be shorter
// than the session. Sessions stored before that have no `size`.
function getSessionSize(session) {
  return session.size ?? session.queue.length;
}

function isSessionComplete(session) {
  return Boolean(session) && session.currentIndex >= getSessionSize(session);
}

// The session clock stops while paused and once the session is complete.
function getSessionClockTime(session) {
  return session?.completedAt || session?.pausedAt || Date.now();
}

function getSessionElapsed(session) {
  const endTime = getSessionClockTime(session);
  return Math.max(
    0,
    endTime - (session?.startedAt || endTime) - (session?.totalPausedMs || 0)
  );
}

function getProblemSlugFromPath(pathname) {
  const match = pathname.match(/^\/problems\/([^/]+)/);
  return match ? match[1] : null;
}
