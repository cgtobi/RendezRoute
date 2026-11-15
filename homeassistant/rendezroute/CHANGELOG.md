# Changelog

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
