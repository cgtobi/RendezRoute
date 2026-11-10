// Which share buttons the plan page shows (spec 5 feature 4, decision D30): the device's share sheet
// first, which already offers the chat apps; the WhatsApp and X links only where it has none.
// Without the DOM, so it is tested in Node.

export interface ShareButtons {
  /** "Share": the device's share sheet. */
  native: boolean;
  /** "Copy link". */
  copy: boolean;
  /** The WhatsApp and X links. */
  apps: boolean;
}

/** From what the browser supports: the Web Share API and the clipboard. */
export function shareButtons(supports: { share: boolean; copy: boolean }): ShareButtons {
  return { native: supports.share, copy: supports.copy, apps: !supports.share };
}
