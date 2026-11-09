// File names for downloads and export entries.

/** ASCII file name from a title, e.g. "Easy Sunday run" → "easy-sunday-run"; the fallback if empty. */
export const fileName = (title: string, fallback: string) =>
  title
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
