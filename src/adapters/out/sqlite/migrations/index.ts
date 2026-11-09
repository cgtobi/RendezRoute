import type { Migration } from "kysely/migration";
import * as m0001 from "./0001-instance-meta.ts";
import * as m0002 from "./0002-plans-and-devices.ts";
import * as m0003 from "./0003-responses.ts";
import * as m0004 from "./0004-routes.ts";
import * as m0005 from "./0005-plan-previews.ts";
import * as m0006 from "./0006-job-queue.ts";
import * as m0007 from "./0007-notification-channels.ts";
import * as m0008 from "./0008-sent-reminders.ts";
import * as m0009 from "./0009-calendar-feeds.ts";
import * as m0010 from "./0010-recap-contributions.ts";
import * as m0011 from "./0011-plan-templates.ts";

/** Statically imported so migrations work identically from src/ and dist/. Keys sort in order. */
export const migrations: Readonly<Record<string, Migration>> = {
  "0001-instance-meta": m0001,
  "0002-plans-and-devices": m0002,
  "0003-responses": m0003,
  "0004-routes": m0004,
  "0005-plan-previews": m0005,
  "0006-job-queue": m0006,
  "0007-notification-channels": m0007,
  "0008-sent-reminders": m0008,
  "0009-calendar-feeds": m0009,
  "0010-recap-contributions": m0010,
  "0011-plan-templates": m0011,
};
