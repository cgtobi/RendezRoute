// Initials for people on plan pages (decision D27). The colour comes from the name alone, never
// from an account or device, so it reveals nothing the name does not already show.

/** How many name colours app.css defines (--avatar-0-bg … --avatar-7-bg and their -fg). */
export const AVATAR_COLOURS = 8;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface Avatar {
  /** The first character as people see it (one grapheme), upper-cased in the page's language. */
  initial: string;
  /** Which of the name colours, 0 to AVATAR_COLOURS - 1. */
  hue: number;
}

export function avatarOf(name: string, language: string): Avatar {
  // One spelling per name: "É" as one character or as "E" plus an accent, with or without spaces.
  const normal = name.trim().normalize("NFC");
  const first = graphemes.segment(normal)[Symbol.iterator]().next().value?.segment ?? "";
  const upper = first.toLocaleUpperCase(language);
  // Some letters grow when upper-cased ("ß" to "SS"); an initial stays one character.
  const initial = [...graphemes.segment(upper)].length === 1 ? upper : first;
  return { initial, hue: colourOf(normal) };
}

/** FNV-1a over the UTF-16 code units, then a final mix, so every character moves the colour. */
function colourOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) % AVATAR_COLOURS;
}

/** A person's initial in their name colour, or the host's in the plan's secondary colour. */
export function Initial({
  name,
  language,
  host = false,
}: {
  name: string;
  language: string;
  host?: boolean;
}) {
  const avatar = avatarOf(name, language);
  return (
    <span class={host ? "avatar avatar-host" : `avatar avatar-${avatar.hue}`} aria-hidden="true">
      {avatar.initial}
    </span>
  );
}

/** A person's name after their initial, as in the host page's lists. */
export function PersonName({ name, language }: { name: string; language: string }) {
  return (
    <span class="person-name">
      <Initial name={name} language={language} />
      {name}
    </span>
  );
}
