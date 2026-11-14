// Raw database file scans (privacy tests). A rounded coordinate such as 48.12 is a short needle:
// the file also holds wall-clock timestamps (`...T20:45:48.126Z`) that contain it by chance. A
// REAL stored in SQLite is 8 binary bytes, not text, so this scan only catches text, JSON or log
// leaks; numbers in tables are covered by the snapshot comparison. Hence a boundary-aware match:
// the needle counts only when no digit or `.` comes before it, it is not preceded by a clock
// colon (`45:`), and no digit follows it. JSON like `"lat":48.12` still counts.
export function hasStandalone(raw: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![0-9.])(?<![0-9]:)${escaped}(?![0-9])`).test(raw);
}
