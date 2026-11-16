// The keyboard rule of the instant apply (decisions D64, I82), apart from the DOM so it can be tested.

/** Keys that move a closed select's value without opening it; some browsers fire `change` for each. */
const STEP_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

/** Whether a change that follows this key press should wait for Enter or blur. */
export function waitsForConfirmation(lastKey: string | undefined): boolean {
  return lastKey !== undefined && STEP_KEYS.has(lastKey);
}
