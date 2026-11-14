# Changelog

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
