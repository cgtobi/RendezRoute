# Changelog

## 0.18.12

- On the Nearby page the map now zooms in to your area, sized to the selected search radius, when you use your location or a place is found. Before, it stayed on the world view. The map shows the position rounded to about 2 km, as before.

## 0.18.11

- Fix: the map on the Nearby page showed OpenStreetMap's "Access blocked" tile. The page asks browsers not to send a referrer, and OpenStreetMap refuses tiles without one. Map tiles now always send the site's address (and nothing more), as OpenStreetMap's tile policy requires.
- The map credit now links "OpenStreetMap" to its copyright page.

## 0.18.10

- Privacy: the privacy page now says that "Find my location" and "Show where I am" make your browser load map images of the area around you from the map service, which can tell from them roughly where you are. The position itself still never reaches this server.

## 0.18.9

- Privacy: the ratings a host sees now count only the people who could rate. People who joined from another server cannot rate, so they no longer count towards the minimum or the "of N" in "2 of 3 rated"; with one web participant and two from another server the host used to see that one person's rating.
- New setting `RATING_MIN_PARTICIPANTS` (Home Assistant option `rating_min_participants`): how many people who can rate a plan needs before the host sees its ratings, 2 to 50, default 3. Results already stored keep their count but are compared with the current setting.

## 0.18.8

- Security: "Move into my account" now shows what it will move first: the plans, answers and templates made on this browser, with a warning that they may not be yours, and asks you to confirm. This protects the plans of whoever uses the browser from being taken by someone else who logs in there.
- Security: the limits on creating plans, answering, sending email, Nearby and place search now also apply to a whole IPv6 network (a /48), so one network cannot multiply them. The limit on email to one address can no longer be pushed out by other traffic.

## 0.18.7

- The menu now has a "Calendar" entry, so the calendar subscription page can be reached from every page.

## 0.18.6

- Security: a calendar feed made on a browser no longer picks up the plans of an account that logs in on that browser later. A feed now lists an account's plans only while the account it was made under is still logged in. Feeds you made while logged in and want to keep with your account's plans need to be turned on again once.
- Security: logging in as a different account on a browser that was never logged out no longer leaves the earlier account's push notifications on that browser.
- The email and ntfy settings now say who can see them: everyone who has the plan's host link, or your manage link.

## 0.18.5

- New look "Archivo": the mono look set in the narrow Archivo Narrow font, with bold headings. Choose it in the Style menu, or set the `palette` option to `archivo` to make it the default. Its font is only loaded for people who use it. The preview card of shared plans follows it too.

## 0.18.4

- The preview card that chat apps show for a shared plan now follows the instance's look (the `palette` option): the colours, and for "bold" the square corners and black borders. Cached previews are replaced when the option changes.

## 0.18.3

- Security: a crafted GPX file could keep the server busy for a very long time while it was checked. The check now takes the same short time for any file, and rejects files with unfinished comments, tags or processing instructions.
- The app now sends a "Strict-Transport-Security" header when its address starts with https, and tells shared caches not to store its pages.

## 0.18.2

- The plans on the home page ("Coming up" and "Recently") now open the plan's page, as everyone sees it, instead of the edit or response page. Hosts still reach "Manage plan" from there, and people who joined reach their response.
- On "My data" each plan has an "Open plan" link next to its export.

## 0.18.1

- Closing a full-screen map right after zooming no longer causes an error in the browser console.

## 0.18.0

- Every map can now be opened full screen. A button in the top right corner of the plan map, of the
  map on the plan form and of the Nearby map opens it, and the same spot closes it again (so does
  Escape, and focus goes back to the button). On the plan map it shows the same public area, and for
  people who joined and the host the exact start and the route, as the page does, with a key. Nothing
  new is sent: the full-screen view uses what the page already shows you.
- On the plan map the full-screen view has "Show where I am". It shows your position and its accuracy
  on the map, only in your browser: it is not sent anywhere and not stored.
- On the plan form the full-screen map has its own switch between the public area and the exact
  start, a "Done" button and "Remove point". The Nearby map has a place search and "Use my location".
  Your changes go to the same fields as on the page, so the "Unsaved changes" bar reacts.
- The map buttons "Use my location" and "Find my location" are no longer disabled when your browser
  refuses: they stay in place and say why. Taps on a repeated copy of the world map in Nearby no
  longer produce a longitude over 180.
- The option "Public listings need login" is now called "Public plans need an account" and says
  what it does: only people with an account may make a plan public, and Nearby lists nothing
  without a login. With no login set up, turn it off to allow public plans (also in German and
  French).
- Nothing else needs to be configured for this update.

## 0.17.0

- Colour palettes. The new `palette` option (`PALETTE`) sets the colours of the site: `default`,
  `mono` (black and white, with round buttons) or `bold` (a poster look with square corners and
  heavy rules). Visitors can pick their own under **Style** in the menu, like the language, and
  **Site default** brings back your setting. The choice is stored in a cookie in their browser, and
  light, dark and system still work with each palette. The admin pages keep the default colours.
  In `bold`, plan and manage pages use the plan's own colour for the header, links and the logo, and
  other pages are black.
- The "Save changes" button on a plan's manage page now stays at the bottom of the screen while the
  form has unsaved changes. Next to it are "Unsaved changes" and "Discard". After an error it shows
  how many problems there are and links to the first one. Without JavaScript the page works as before.
- The route file is now chosen in the same form and saved with "Save changes". Before, "Replace
  route" reloaded the page and dropped changes you had not saved. If the file is not usable, nothing
  is saved and the form shows the error. The route is cut at the meeting point you are saving.
  Distance and elevation you changed in the same save are kept, and otherwise they follow the route.
  Browsers do not keep a chosen file when a page is shown again, so choose it again after an error.
  "Remove route…" is a separate action with a confirmation.
- A route file is now sent to `/p/{id}/host` (up to 5.5 MB), and the old address `/p/{id}/host/route`
  no longer exists. If you run a reverse proxy with a small request-size limit (nginx allows 1 MB by
  default), allow at least 6 MB there.
- Fixed: for plans in miles and feet, the distance and elevation taken from a route file were read as
  miles and feet instead of kilometres and metres.
- Nothing else needs to be configured for this update.

## 0.16.0

- Plans can now be a hike, besides a run, trail run, ride, gravel ride or mountain bike ride. Hikes
  use a pace per kilometre (or mile) like runs, and the form, Nearby filter and texts say "run, ride
  or hike" (also in German and French).
- The database is updated once on start: the list of activities in it now includes hikes. Your
  existing plans and templates are not changed.
- Nothing needs to be configured for this update.

## 0.15.0

- The home page now lists your own plans, not public ones. This replaces the public list that 0.14.0
  added. "Coming up" shows up to ten of your plans that have not started, soonest first, and
  "Recently" shows up to five from the last seven days, newest first. Each row has the title, the
  day and time, and what you are to the plan: you host it, you are in, you asked to join, or you are
  interested. A plan you host opens its host page, and one you answered opens your own page for it.
- Only plans of this browser, or of the account you are logged in with, are listed. Plans where you
  were declined or removed, and cancelled plans, are left out. Nothing is listed for a browser that
  has no plans. The exact start, names, route and notes are never shown here.
- Plans that were public are no longer shown on the home page, only in Nearby. The choice when
  creating a plan reads "Anyone: listed in Nearby on this site" again (also in German and French).
- When your browser has used the site, the home page is not stored by caches.
- Nothing needs to be configured for this update.

## 0.14.0

- The home page now lists public plans below "Find public plans nearby". "Coming up" shows the next
  ten, soonest first. "Recently" shows up to five that started in the last seven days, newest first.
  Each row shows what Nearby shows, without the distance: title, activity, start time, area and
  pace. Never the exact start, the route, names or notes. Nothing is shown when there are no public
  plans, when Nearby is off (`nearby_enabled`), or when plans cannot be public because logging in is
  required but not set up.
- Plans that were already public now also appear on the home page. The choice when creating a plan
  now reads "Anyone: listed on the home page and in Nearby on this site" (also in German and
  French).
- When the home page lists plans it is not stored by caches and not indexed by search engines, as
  with Nearby.
- The app is no longer marked experimental in Home Assistant, and its documentation says that it
  runs on a real Home Assistant.
- Nothing needs to be configured for this update. To keep plans off the home page, turn off
  **Nearby** (`nearby_enabled`).

## 0.13.0

- Text fields are now a line with a grey example text, not a box. An empty required field shows a
  red "Required" under it, and a field that cannot be edited looks disabled. A focused field shows
  a thicker line instead of a blue frame.
- The meeting area field is now called "Area", and the place search is part of it: type a name, or
  press Enter or the magnifier to search for a place. A result fills the name and sets the public
  area on the map. Nothing is sent while you type. "Where exactly?" is now "Description of the
  meeting point".
- Privacy: when you set the exact meeting point on the map and its description is empty, the exact
  point is now sent through the app to the place-search service, to suggest a description (a place
  or a road name, never a house number). Until now only the rounded point (about 1 km) left the
  app, and only for the area name. The app does not keep or log these lookups. The service does not
  learn who you are. There is no separate switch: turn off **Look up place names**
  (`geocoder_enabled`) to send nothing.
- The time zone line now reads "Time zone: Europe/Berlin · Change". The fold "Who can join and find
  it" shows its summary only while it is closed, and all folds look alike. The search button and the
  "Remove" buttons on the map are small icons.
- Date and time fields show a focus ring in Safari too. In high-contrast modes the field lines now
  use the system colours: grey at rest, the highlight colour when focused or invalid.
- The route upload on the host page no longer looks required. Pressing Upload without a file says
  "Choose a GPX file." The route itself is optional.
- Style sheets and scripts now carry a version in their address, so a changed look shows after an
  update without a hard reload.
- Nothing needs to be configured for this update.

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
