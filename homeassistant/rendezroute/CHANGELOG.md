# Changelog

## 0.12.0

- The plan form is shorter. Optional parts are folded away, each with a one-line summary: route,
  pace and note; who can join and find it; look and sharing; after the run.
- The title is the big editable heading, with a pencil. It starts as "My plan" (in your language),
  selected on the first tap. The start time offers 15-minute steps and starts at the next quarter hour.
- The meeting area can be set on the map. A switch chooses between the public area (the default)
  and the exact start. "Find my location" only moves the map to your device and sends nothing. The
  chosen point shows as a line with "Remove".
- Privacy: when the meeting-area field is empty, its name is suggested from the map. For this the
  rounded point (about 1 km, never the exact start) is sent through the app to the place-search
  service, if a geocoder is on.
- The map opens on the region of the browser's time zone, or on the new advanced options **Default
  map center** (`default_map_center`, for example `48.1374,11.5755`) and **Default map zoom**
  (`default_map_zoom`, 2 to 12).
- The menu is now a button in the header. Language, units and a new theme (system, light, dark)
  apply at once.
- On the plan page the share row is now at the end.
- The "Your plan is ready" page offers "Add route, pace and more".
- The host name is filled in again from this device's last plan or template.
- Nothing needs to be configured for this update.

## 0.11.1

- The AppArmor profile now enforces instead of only logging. It limits what the app may do:
  files are read-only except `/data`, `/config`, the temporary folders and a few system files such
  as the Supervisor's socket, no new programs can be
  started, and mounting, tracing other processes, raw and packet sockets and writes under
  `/proc/sys` are blocked.
- A learning-mode version of this profile ran on one device; the enforcing version is new and has
  not run anywhere yet. If the app does not start or a feature fails after this update, restore
  the backup Home Assistant offers before the update (this brings back 0.11.0, whose profile only
  logs) and please report it in an issue with the error message from the app's log (and, if you
  have a host shell, the `apparmor="DENIED"` lines of the audit log). There is no setting to
  switch the profile off.
- If the Supervisor's socket cannot be reached at start, the app asks the Supervisor's TCP API instead
  (one retry, with the same version check) and says so in its log.

## 0.11.0

- The app now ships its own AppArmor profile, in learning mode: a few things are blocked outright
  (mounting, tracing other processes, raw sockets, writes under `/proc/sys` and to the app's own
  files) and everything else is only logged, so for ordinary access it is not stricter than
  Docker's default yet.
- Home Assistant loads the profile when you install or update the app.

## 0.10.1

- The common options (contact email, imprint and privacy links, email server settings) are now
  always visible in the configuration form. The others (single sign-on, ntfy, Telegram, map and
  service addresses, Fediverse login servers, email port) are shown through **⋮ → Show unused
  optional configuration options**.
- The form no longer checks the email and link syntax of these fields; the app does at start and
  names the setting in the log (for example CONTACT_EMAIL). An empty field means "not set".
- Date and time inputs on the create form no longer overflow the screen on phones.
- The footer menu's language and unit rows stay on one line on phones.

## 0.10.0

First release of the RendezRoute Home Assistant app. It is experimental: it has been tested in
containers and in automated tests, but not yet on real Home Assistant devices.

- RendezRoute itself: plan a run or ride with a route, share a link, and let guests answer without
  an account. Public listings, calendar feeds and federation through the Fediverse, which is on by default (turn it off in the options).
- The admin pages (moderation, invite links, reports) are served through Ingress, for Home
  Assistant administrators only. There is no admin token. Open the admin pages with **Open Web UI** on the app's Info tab, or switch on **Show in sidebar** there to get a RendezRoute panel.
- The public site listens on port 3000. Put an https reverse proxy in front of it and set the
  public address in the app's options.
- The database lives in the app's data folder; the encryption and federation keys live in the app's
  config folder. Both are part of Home Assistant backups: use encrypted backups. Backups are cold:
  the app stops while it is backed up.
- Needs Home Assistant Supervisor 2026.10.4 or newer.
