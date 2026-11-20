# RendezRoute

RendezRoute lets someone advertise a planned run, ride or hike: a date, a start, a route and a pace. They
share a link, guests answer with just a name, and only the people who are allowed to see the exact
start and route do. This app runs it inside Home Assistant.

> **Status:** the app runs on a real Home Assistant. It is not 1.0, so expect changes between
> versions and read the changelog before you update. Keep your Home Assistant backups encrypted (see
> below).

## Requirements

- **Home Assistant Supervisor 2026.10.4 or newer.** Older Supervisors let a signed-in client forge
  the headers the admin pages trust, so the app refuses to start on them and says why in its log.
  Home Assistant cannot enforce a minimum Supervisor version for an app, so this is checked by the
  app itself when it starts.
- **A Home Assistant administrator** to open the admin panel. Other users cannot.
- **A public https address** for the public site (see below). The app does not start with an http
  address.

## Set up

1. Open the **Configuration** tab and set **Public address** (`base_url`) to the https address your
   guests will use, for example `https://runs.example.org`. It is an origin: no path. Use a name of
   its own, not a path under your Home Assistant address, because links and Fediverse addresses are
   built from the root of this address. **Choose it once:** if you use federation, changing it later
   breaks the identities other servers know.
2. Set the **contact email** if you want place search and server-side map tiles: the services behind
   them require that you identify yourself. Without it those two stay off, and everything else works.
3. Start the app. The log should say that it is listening.
4. Make the public port reachable through https. The app listens on port **3000** (see the **Network**
   section; you can change the host port or switch it off). Put a reverse proxy in front that
   terminates https and forwards to that port. Common ways, none of them specific to this app:
   - a reverse proxy you already run (Nginx Proxy Manager, Caddy, Traefik) pointing at
     `http://<your Home Assistant host>:3000`;
   - a free name from DuckDNS with a Let's Encrypt certificate, and a port forward on your router
     to the proxy;
   - a Cloudflare Tunnel (or a similar tunnel) pointing at `http://<your Home Assistant host>:3000`,
     which needs no open port on your router.

   Whichever you choose, the https address must be the one you set as the public address. Do not
   forward port 3000 to the internet directly: the app speaks http only.

5. Open the admin pages with **Open Web UI** on the app's Info tab, or switch on **Show in sidebar** there to get a RendezRoute panel.

### Configuration

The Configuration tab always shows the options most people set first: the public address, instance
name, contact email, imprint and privacy links, the email server and the limits. An empty field means
"not set". The form does not check the email and link syntax of these fields; the app does when it
starts and names the setting in the log (for example CONTACT_EMAIL). The advanced options (single sign-on, ntfy, Telegram, map,
geocoder and weather addresses, `rating_min_participants`, the default map center and zoom (`default_map_center` such as `48.1374,11.5755`, `default_map_zoom` 2 to 12), Fediverse login servers, the email port) are hidden until you open
the **⋮** menu of the Configuration tab and choose **Show unused optional configuration options**.

The `palette` option sets the instance's default colours: `default` (blue), `mono` (black and
white), `bold` (white, black grid rules, signal red, square corners) or `archivo` (like `mono`,
in the Archivo Narrow typeface with bold headings). Visitors can override it
under Style in the menu. Light and dark mode work with each of them.

### Reverse proxy and `trust_proxy`

Turn **Trust the reverse proxy** (`trust_proxy`) on only when a reverse proxy or tunnel sits in
front of the app, sets the `X-Forwarded-For` header, and nobody can reach port 3000 without it. Then
the app can tell visitors apart for its rate limits. So that nobody can bypass the proxy, switch the
host port off (empty it in the **Network** section) and point the proxy at the app's internal host
name, shown on the Info tab (`<hash>-rendezroute:3000`); that works for a proxy that runs as another
Home Assistant app. Only then is `trust_proxy` safe. Leave it off while port 3000 is reachable
directly on your network, because then any visitor could choose the address the app sees, and rate
limits can be dodged. If you leave it off behind a proxy, all visitors share one limit and a busy
day can lock out guests.

## The admin pages

The admin pages (reports, invite links, deleting a plan) are only reachable through Home Assistant
(Ingress). They are not on the public port, there is no admin token, and no password to leak: Home
Assistant signs you in, and the app accepts only Home Assistant administrators. Home Assistant
shows the panel only to administrators and refuses other users before the request reaches the app;
the app checks again on its own (a second line of defence that normal users never see).

The admin forms work when you reach Home Assistant over plain http on your home network as well as
over https.

## Backups

The app stores its **database** in its data folder (`/data`) and its **keys** in its config folder
(`/config`): the key that encrypts names and messages, and the keys for notifications and
federation. Both folders are part of Home Assistant backups, so a backup holds everything needed to
restore, and also everything needed to read the data.

- **Use encrypted backups** and keep the encryption key of the backup safe. An unencrypted backup
  contains the key next to the database it protects.
- Restoring a backup restores the keys with the database. Never restore a database without its
  keys: the encrypted fields could not be read again.
- Uninstalling the app deletes its data folder (`/data`, the database) but keeps its config folder
  (`/config`, the keys), unless you tick **Also delete the app's configuration folder** in the uninstall dialog (the data folder is always deleted).
- This app uses **cold backups**: Home Assistant stops the app while it makes the backup, then
  starts it again. A database copied while it is being written can be damaged, so the short
  downtime is the safer choice. Plan automatic backups for a quiet hour.

## Privacy

RendezRoute collects as little as it can. It has its own privacy notice, written for the visitors
of your instance, at `/privacy` on your public address; it follows your settings. Two settings
matter most for what leaves your server:

- **Federation** is on by default. Public runs, rides and hikes can be followed from Mastodon and other
  Fediverse servers, which means data is sent to those servers. Turn **Federation (Fediverse)** off
  to stay entirely on your server.
- **Maps, place search and weather** call outside services (OpenStreetMap, Nominatim, Open-Meteo
  by default). Each has a switch, and the addresses can be changed. Picking a place on the map also
  asks the place-search service, through the app, for a name of the rounded point (about 1 km), and
  only while the area field is empty or still holds the earlier suggestion. When an exact point is
  set on the map and its description is empty, that exact point is sent, through the app, to the
  place-search service to suggest a description; the service does not learn who the user is. The
  app does not keep these lookups of exact points in memory.

You are responsible for your instance: if people other than you use it, add an imprint and a
privacy link in the options if the law where you live requires them.

## Security

Home Assistant shows an app's panel inside its own page, through Ingress, in an iframe that is
same-origin with Home Assistant and not sandboxed. A script injected into an Ingress page would
therefore run with the rights of the signed-in Home Assistant user, as if it were Home Assistant
itself. To be clear, a flaw like that in this app would be a risk to your Home Assistant account,
not only to this app.

That is why the app treats this seriously: it escapes everything it shows, sets a strict content
security policy of its own, never loads scripts from elsewhere, and opens the admin panel for Home
Assistant administrators only, so the exposure is limited to the people who already control the
house. Keep the app up to date, and install it only on a Home Assistant you would trust it with.

The app ships its own AppArmor profile, and it enforces it: the profile limits which files the app
may write (its `/data` and `/config` folders, temporary files, and a few system files such as the
Supervisor's socket), which programs it may start (only Node), which network families it may use,
and which capabilities it holds, and it blocks mounting, tracing other processes and raw sockets.
A learning-mode version of this profile ran on one device; the enforcing version is new and has not
run anywhere yet. If the app does not start or a feature fails after the update, restore the backup
Home Assistant offers before the update (restoring brings back version 0.11.0, whose profile only
logs; the store keeps offering 0.11.1 until a fixed version exists) and report it in an issue: the
error message in the app's log is enough, and with a host shell the `apparmor="DENIED"` lines too
(on Home Assistant OS: `journalctl _TRANSPORT="audit" -g 'apparmor="DENIED"'`), without secrets.
There is no setting to switch the profile off. Home Assistant loads the profile on install, update
and restore, and reloads it at every boot. The app asks for no extra capabilities beyond its start
as root: it starts as root only to read its options, ask the Supervisor for its version and hand
its folders to an unprivileged user, then continues without root.

## Known limits

- Home Assistant over plain http works for the admin forms. The public site needs https.
- The app is new, with no real-device history yet.
- Home Assistant's own sign-in is the only way into the admin pages. There is no way to give a
  non-administrator access.
- The admin pages are not reachable from outside Home Assistant, so report alert emails contain no
  link to them.

## Updates

Update only when the new version is offered in the Home Assistant store. The image of a new version
is published after the version number changes in this repository, so "Check for updates" can show
the update a short time before the image exists; if the update fails to download, wait and try
again. Read the **Changelog** tab before you update. The app makes an automatic database backup
before a database migration, and Home Assistant offers to back up the app before an update:
accept that.

The app uses the multi-architecture image `ghcr.io/cgtobi/rendezroute-ha`; the signed images for each
architecture also exist as separate packages (`aarch64-rendezroute-ha` and `amd64-rendezroute-ha`).

## Support

Report problems at <https://github.com/cgtobi/RendezRoute/issues>. Never paste your options or logs
that contain secrets there.
