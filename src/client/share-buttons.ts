// Which share buttons the plan page shows (spec 5 feature 4, decisions D30, D41): of those the host
// offers, the ones the browser supports; the device's share sheet first, which already offers the
// chat apps, so the WhatsApp link stays only where it has no sheet to replace it. Without the DOM,
// so it is tested in Node.

/** Which of the host's buttons are shown. */
export interface ShareButtons {
  /** "Share": the device's share sheet. */
  native: boolean;
  /** "Copy link". */
  copy: boolean;
  /** The WhatsApp link. */
  apps: boolean;
  /** The share section itself: whether any button is shown (it starts hidden without WhatsApp). */
  section: boolean;
}

/** From what the browser supports (the Web Share API, the clipboard) and the host offers. */
export function shareButtons({
  supports,
  offered,
}: {
  supports: { share: boolean; copy: boolean };
  /** What the host chose for this plan, whatever the browser supports (decision D41). */
  offered: { native: boolean; copy: boolean; whatsApp: boolean };
}): ShareButtons {
  const native = supports.share && offered.native;
  const copy = supports.copy && offered.copy;
  const apps = offered.whatsApp && !native;
  return { native, copy, apps, section: native || copy || apps };
}
