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
import * as m0012 from "./0012-used-form-nonces.ts";
import * as m0013 from "./0013-plan-ratings.ts";
import * as m0014 from "./0014-rating-tally.ts";
import * as m0015 from "./0015-reports.ts";
import * as m0016 from "./0016-invites.ts";
import * as m0017 from "./0017-identities.ts";
import * as m0018 from "./0018-identity-handles.ts";
import * as m0019 from "./0019-account-ownership.ts";
import * as m0020 from "./0020-channel-devices.ts";
import * as m0021 from "./0021-email-channels.ts";
import * as m0022 from "./0022-account-notices.ts";
import * as m0023 from "./0023-channel-kinds.ts";
import * as m0024 from "./0024-fedify-kv.ts";
import * as m0025 from "./0025-poster-actors.ts";
import * as m0026 from "./0026-followers.ts";
import * as m0027 from "./0027-plan-publications.ts";
import * as m0028 from "./0028-share-buttons.ts";
import * as m0029 from "./0029-remote-participants.ts";
import * as m0030 from "./0030-participant-notes.ts";

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
  "0012-used-form-nonces": m0012,
  "0013-plan-ratings": m0013,
  "0014-rating-tally": m0014,
  "0015-reports": m0015,
  "0016-invites": m0016,
  "0017-identities": m0017,
  "0018-identity-handles": m0018,
  "0019-account-ownership": m0019,
  "0020-channel-devices": m0020,
  "0021-email-channels": m0021,
  "0022-account-notices": m0022,
  "0023-channel-kinds": m0023,
  "0024-fedify-kv": m0024,
  "0025-poster-actors": m0025,
  "0026-followers": m0026,
  "0027-plan-publications": m0027,
  "0028-share-buttons": m0028,
  "0029-remote-participants": m0029,
  "0030-participant-notes": m0030,
};
