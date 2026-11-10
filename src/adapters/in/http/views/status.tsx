// A state shown as a box (design decision D27): one's response on the plan page, whether this
// browser is logged in on the account page. Green with a tick when one is in.
import type { ResponseKind } from "../../../../domain/response.ts";

/** One's response (or none yet), or being logged in. */
export type StatusState = ResponseKind | "notAnswered" | "loggedIn";

const IN: ReadonlySet<StatusState> = new Set(["joined", "loggedIn"]);

export function Status(props: {
  state: StatusState;
  heading?: string | undefined;
  text: string;
  /** A link below the status, e.g. to change it. */
  action?: { href: string; label: string } | undefined;
  /** Read out when the page opens, as a notice would be: right after the change it shows. */
  announce?: boolean;
}) {
  return (
    <section
      class={`status status-${props.state}`}
      role={props.announce === true ? "status" : undefined}
    >
      {IN.has(props.state) && (
        <span class="status-icon" aria-hidden="true">
          <span class="icon icon-check"></span>
        </span>
      )}
      <div class="status-text">
        {props.heading !== undefined && <h2>{props.heading}</h2>}
        <p>{props.text}</p>
      </div>
      {props.action !== undefined && (
        <p class="status-action">
          <a href={props.action.href}>{props.action.label}</a>
        </p>
      )}
    </section>
  );
}
