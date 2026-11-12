// How the share buttons are stored (decision D41): the chosen names, comma-separated in their
// order, in one column of plans and plan_templates.
import { SHARE_BUTTONS, type ShareButton } from "../../../domain/plan.ts";

export const shareButtonsToText = (buttons: readonly ShareButton[]): string =>
  SHARE_BUTTONS.filter((button) => buttons.includes(button)).join(",");

/** Unknown names and repeats are dropped; an empty or garbled value means no buttons. */
export const shareButtonsFromText = (text: string): ShareButton[] => {
  const named = text.split(",");
  return SHARE_BUTTONS.filter((button) => named.includes(button));
};
