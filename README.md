# RendezRoute

Plan a run or ride, share a link, and let others join. Self-hosted, with optional accounts.

**RendezRoute** (from French _rendez-vous_ and _route_: "meet on the route") is a self-hosted web
app where runners and cyclists post a planned run or ride, optionally with a route, so others can
show interest or join. You share it with a link. Accounts are optional, and every plan is deleted
automatically a few days after it happens.

RendezRoute is a pre-release.

Contents: [What it does](#what-it-does) · [Quick start](#quick-start) ·
[Before going live](#before-going-live) · [Settings](#settings) ·
[On Home Assistant](#on-home-assistant) · [Development](#development) · [License](#license)

## What it does

- Plans without accounts: create, share, join or request, cancel, delete.
- Joining by request and approval, if the poster wants it.
- The route and the exact start are shown only to people who join.
- Optional accounts through OpenID Connect (OIDC) or a fediverse server.
- Notifications by email, ntfy, Telegram and Web Push, and calendar feeds.
- Public plans and a Nearby page to find them.
- The fediverse: follow a poster, join from other servers, recaps and reports over federation.
- Link-only by default; plans are deleted days after they happen.
- English, German and French.

## Quick start

RendezRoute runs as a single Docker container behind a reverse proxy that provides HTTPS.
[`deploy/`](deploy/) has a Docker Compose example with [Caddy](https://caddyserver.com/).

1. Build the image with `docker build -t rendezroute .`; there is no published image yet.
2. Set the image's name as `image` in [`deploy/compose.yaml`](deploy/compose.yaml):

   ```yaml
   services:
     rendezroute:
       image: rendezroute
   ```

3. Replace `runs.example.org` and the email address in `deploy/compose.yaml` and
   [`deploy/Caddyfile`](deploy/Caddyfile).
4. Run `docker compose up -d` in `deploy/`.

## Before going live

- **Encryption key:** it lives on its own volume (`/keys`). Back it up separately from the data
  volume: without it, encrypted data (exact starts, routes, names) cannot be read, and with it next
  to the data, a leaked backup is readable.
- **`TRUST_PROXY=true`** is needed behind the proxy, or every visitor shares one rate limit. Never
  set it when the app is reachable without the proxy (the exception is the admin port, see
  [Admin](#admin)).
- **Access logs** stay off in the proxy: private links carry tokens in their paths.
- **`CONTACT_EMAIL`** identifies the instance to map and place-search providers, as their policies
  require. Without it, place search and map images in link previews are off.
- **Weather** comes from [Open-Meteo](https://open-meteo.com/), whose free API is for
  non-commercial use only and has a daily request limit. For commercial use, get an API plan or run
  your own and set `WEATHER_URL`, or switch weather off with `WEATHER_ENABLED=false`.
- **Backups:** `docker compose exec rendezroute node dist/cli.js backup /data/manual-backups`
  copies the live database safely. Copy it off the server together with the key volume, stored
  separately. Upgrades also back up the database before migrations (`/data/backups`, at most two,
  deleted after 7 days).
- **Admin pages:** with `ADMIN_TOKEN` they are at `/admin`. Limit them to your own addresses in the
  proxy: [`deploy/Caddyfile`](deploy/Caddyfile) has a commented rule for it (see [Admin](#admin)).
- **Federation:** it is on by default. It has been tested against fake servers, not yet by hand
  against real ones, so set `FEDERATION_ENABLED=false` if you do not want to be among the first.
- **Keep your domain:** once the instance has been in the fediverse, `BASE_URL` must not change,
  since other servers know its actors and plans by their addresses. A new domain is a new instance
  to them.

## Settings

Settings are environment variables. Only `BASE_URL` is required. Defaults are in parentheses.
Booleans are `true` or `false`.

### Core

These addresses must be https unless `ALLOW_INSECURE_DEV=true`: `BASE_URL`, `OIDC_ISSUER`,
`NTFY_URL`, `TELEGRAM_API_URL` and the map, place-search and weather addresses. The development
switch also allows private networks.

| Setting               | What it does (default)                    |
| --------------------- | ----------------------------------------- |
| `BASE_URL`            | Public https address, no path (required)  |
| `INSTANCE_NAME`       | Name of the instance (`RendezRoute`)      |
| `DATA_DIR`            | Absolute path of the data (`/data`)       |
| `ENCRYPTION_KEY_FILE` | Absolute path of the key file (see below) |
| `TRUST_PROXY`         | Trust the proxy headers (`false`)         |
| `CONTACT_EMAIL`       | Identifies you to providers (unset)       |
| `IMPRINT_URL`         | Link to your imprint page (unset)         |
| `PRIVACY_URL`         | Link to your own privacy page (unset)     |
| `DEFAULT_TIMEZONE`    | IANA time zone (`UTC`)                    |
| `ALLOW_INSECURE_DEV`  | Development only: allow http (`false`)    |

- `BASE_URL` has no path, query or credentials. `INSTANCE_NAME` is 1 to 60 characters.
- `DEFAULT_TIMEZONE` is such as `Europe/Berlin`.
- `PRIVACY_URL` unset: the generated page at `/privacy` is used.
- `ENCRYPTION_KEY_FILE` defaults to `/keys/field.key` when `/keys` is a mounted volume, otherwise
  to `keys/field.key` in `DATA_DIR`. The VAPID and federation keys live in the same directory. Back
  the directory up separately from the data (see [Before going live](#before-going-live)): a key
  file inside the data directory is readable from a leaked data backup.
- `TRUST_PROXY` is needed behind the proxy, or every visitor shares one rate limit. Never set it
  when the app is reachable without the proxy. The one exception is the admin port, see
  [Admin](#admin).

### Limits

| Setting                 | What it does (default)                 |
| ----------------------- | -------------------------------------- |
| `MAX_RETENTION_DAYS`    | Longest time plans are kept (`30`)     |
| `MAX_PLAN_HORIZON_DAYS` | How far ahead a plan may start (`180`) |

Both are in days and can only be lowered: 1 to 30 and 1 to 180.

### Maps and services

| Setting              | What it does (default)              |
| -------------------- | ----------------------------------- |
| `MAPS_ENABLED`       | Show maps (`true`)                  |
| `MAP_TILE_URL`       | Tile address (OpenStreetMap)        |
| `MAP_ATTRIBUTION`    | Attribution on maps (OpenStreetMap) |
| `DEFAULT_MAP_CENTER` | Where the form map opens (unset)    |
| `DEFAULT_MAP_ZOOM`   | Zoom at that center, 2 to 12 (`6`)  |
| `GEOCODER_ENABLED`   | Place search (`true`)               |
| `GEOCODER_URL`       | Place search server (Nominatim)     |
| `WEATHER_ENABLED`    | Show weather (`true`)               |
| `WEATHER_URL`        | Weather API (Open-Meteo)            |

- `MAP_TILE_URL` has `{z}`, `{x}` and `{y}`, and may use `{s}` in its first host name label only.
- `MAP_ATTRIBUTION` must not be empty while maps are on.
- `DEFAULT_MAP_CENTER` is latitude and longitude, such as `48.1374,11.5755`: where the map of the
  plan form opens until a place is set. `DEFAULT_MAP_ZOOM` applies only together with it. Unset:
  the map opens on the centre of the visitor's browser time zone at zoom 6, or on Berlin at zoom 6
  when that zone has no entry (such as `UTC`).
- `GEOCODER_ENABLED` also needs `CONTACT_EMAIL`.
- The defaults are OpenStreetMap, `https://nominatim.openstreetmap.org` (OpenStreetMap Nominatim)
  and `https://api.open-meteo.com`.

### Accounts and login

| Setting                   | What it does (default)                    |
| ------------------------- | ----------------------------------------- |
| `OIDC_ISSUER`             | OpenID Connect provider (unset)           |
| `OIDC_CLIENT_ID`          | Client ID at the provider (unset)         |
| `OIDC_CLIENT_SECRET`      | Secret of the client (unset)              |
| `OIDC_NAME`               | Login button name (issuer's host)         |
| `FEDIVERSE_LOGIN`         | Log in with a fediverse account (`false`) |
| `FEDIVERSE_LOGIN_SERVERS` | Allowed server domains (any)              |

- `OIDC_ISSUER` and `OIDC_CLIENT_ID` need each other.
- Without `OIDC_CLIENT_SECRET`, PKCE is used. With it, the client is confidential.
- `OIDC_NAME` is up to 40 characters.
- `FEDIVERSE_LOGIN` lets people log in with a Mastodon, GoToSocial, Akkoma or Pleroma account.
- `FEDIVERSE_LOGIN_SERVERS` is a comma-separated list of domains and needs `FEDIVERSE_LOGIN=true`.

OIDC works with providers such as Keycloak or Authelia, which may run on your local network.
Register `https://<your domain>/login/oidc/callback` as the redirect URI.

### Posting and public plans

| Setting                 | What it does (default)                    |
| ----------------------- | ----------------------------------------- |
| `POSTING_MODE`          | Who may create plans (`anyone`)           |
| `PUBLIC_REQUIRES_LOGIN` | Only account plans may be public (`true`) |
| `NEARBY_ENABLED`        | The Nearby page at `/nearby` (`true`)     |

- `POSTING_MODE` is `anyone`, `invite` or `logged_in`.
- `invite`: only browsers or accounts that opened an invite link from the admin page may post. It
  needs `ADMIN_TOKEN` or `ADMIN_INGRESS`.
- `logged_in`: needs OIDC or fediverse login.
- Public plans are findable by anyone in Nearby. With `PUBLIC_REQUIRES_LOGIN=true` and no OIDC or
  fediverse login, plans stay link-only. Set it to `false` to let anyone make a plan public.
- While `NEARBY_ENABLED` is `false`, plans cannot be made public, since they would be listed
  nowhere.

<details>
<summary>What Nearby stores and logs</summary>

Anyone can find public plans near a place. The searcher's place is rounded to about 2 km and
neither stored nor logged by the app. The rounded point is in the page address, so a reverse proxy
that logs full URLs keeps it (a typed place too, for its first request, when the browser runs no
JavaScript).

</details>

### Notifications

| Setting              | What it does (default)                 |
| -------------------- | -------------------------------------- |
| `SMTP_HOST`          | Mail server; turns email on (unset)    |
| `SMTP_FROM`          | Sender address (unset)                 |
| `SMTP_PORT`          | Mail server port (`587`)               |
| `SMTP_TLS`           | `starttls` or `tls` (`starttls`)       |
| `SMTP_USER`          | Login name (unset)                     |
| `SMTP_PASSWORD`      | Login password (unset)                 |
| `NTFY_URL`           | [ntfy](https://ntfy.sh) server (unset) |
| `NTFY_TOKEN`         | Token for publishing (unset)           |
| `TELEGRAM_BOT_TOKEN` | Bot from @BotFather (unset)            |
| `TELEGRAM_API_URL`   | Bot API server (Telegram's own)        |

- Email: `SMTP_HOST` needs `SMTP_FROM`, and the other `SMTP_*` settings need `SMTP_HOST`.
  `SMTP_USER` and `SMTP_PASSWORD` are set together. `SMTP_PORT` is `465` with `SMTP_TLS=tls`.
  People get a plan's notifications after confirming their address. With `CONTACT_EMAIL` and an
  admin you also get an email for each new report.
- ntfy: `NTFY_URL` is your own server or a public one. `NTFY_TOKEN` needs `NTFY_URL`; set it if the
  server needs a token. The app makes a secret topic for each person on that server.
- Telegram: `TELEGRAM_BOT_TOKEN` is from [@BotFather](https://t.me/BotFather). The app reads the
  bot's messages itself, so no webhook or public URL is needed. `TELEGRAM_API_URL` needs
  `TELEGRAM_BOT_TOKEN` and is only for a local Bot API server (default
  `https://api.telegram.org`).
- Every channel is confirmed before first use and can be turned off from every message.

### Federation

| Setting              | What it does (default)             |
| -------------------- | ---------------------------------- |
| `FEDERATION_ENABLED` | Join the fediverse (on; see below) |

<details>
<summary>What federation does, and what to know before using it</summary>

With federation on, the instance has an instance actor (`@your.host@your.host`) and WebFinger, and
ActivityPub clients can read plans with their public details only. People with an account can turn
on a fediverse profile that others can follow, which sends their plans for followers and their
public plans to those followers. People on other servers can join plans from there and get the
exact start and route as private direct messages. Their reports reach the admin pages (kept only
with an admin), and people who log in through the fediverse can get account notices as direct
messages. The signing keys are created in the key directory on first start.

Set it to `false` to keep the instance to the web: no actors, WebFinger or inboxes, nothing sent,
and followers are forgotten. Plans that were already sent stay on other servers as they were.

Until it has been tried against real servers, set it to `false` for real use if you do not want to
be among the first. Mastodon servers in authorized-fetch ("secure") mode and servers whose handle's
domain differs from their web domain cannot receive the direct messages of fediverse login.

**Keep your domain:** once the instance has been in the fediverse, `BASE_URL` must not change, since
other servers know its actors and plans by their addresses. A new domain is a new instance to them.

</details>

### Admin

| Setting         | What it does (default)                  |
| --------------- | --------------------------------------- |
| `ADMIN_TOKEN`   | Turns on `/admin` (unset)               |
| `ADMIN_PORT`    | Admin pages on a second port (unset)    |
| `ADMIN_BIND`    | Address of the admin port (`127.0.0.1`) |
| `ADMIN_URL`     | Origin of the admin pages (unset)       |
| `ADMIN_INGRESS` | Home Assistant app only (`false`)       |

- `ADMIN_TOKEN` is at least 32 characters.
- `ADMIN_PORT` is 1 to 65535, not 3000. It needs `ADMIN_TOKEN` or `ADMIN_INGRESS`.
- `ADMIN_BIND`, `ADMIN_URL` and `ADMIN_INGRESS` need `ADMIN_PORT`. `ADMIN_INGRESS` also needs an
  explicit `ADMIN_BIND` and excludes `ADMIN_TOKEN`.
- `ADMIN_INGRESS` signs in through Ingress instead of a token. Details are in the Ingress block
  below.

Only for `ADMIN_INGRESS` (the Ingress block below also covers `ADMIN_INGRESS_SKIP_VERSION_CHECK`,
for tests and development only):

| Setting              | What it does (default)               |
| -------------------- | ------------------------------------ |
| `ADMIN_INGRESS_PEER` | IP of the Supervisor (`172.30.32.2`) |
| `SUPERVISOR_URL`     | Supervisor API (`http://supervisor`) |
| `SUPERVISOR_SOCKET`  | Supervisor's unix socket (unset)     |

`ADMIN_INGRESS_PEER` and `SUPERVISOR_URL` need `ADMIN_INGRESS`. `SUPERVISOR_SOCKET` is an absolute
path and is ignored without it.

The admin pages are where you log in with the token to find and delete any plan, handle reports
and, with `POSTING_MODE=invite`, create and revoke invite links. Use a token from, for example,
`openssl rand -base64 32`. Without `ADMIN_TOKEN` (or `ADMIN_INGRESS`) there are no admin pages.
Incoming fediverse reports are kept only with an admin.

**Limit `/admin` to your own addresses** in the proxy if you can.
[`deploy/Caddyfile`](deploy/Caddyfile) has a commented rule for it. It limits who can reach the
pages only, since logging in still needs the token.

<details>
<summary>The proxy rule for /admin, and why it needs TRUST_PROXY</summary>

The commented rule answers 404 on `/admin` and `/admin/*` to everyone but the addresses or VPN
range you list: uncomment it and replace the example addresses. It needs `TRUST_PROXY=true` (set in
[`deploy/compose.yaml`](deploy/compose.yaml)): without it every visitor shares one admin-login rate
limit (5 attempts, then 10 an hour, every attempt counting), so anyone could lock you out of the
login for up to about an hour. Caddy must also see the visitors' real addresses; check from outside
the list that `/admin` answers 404.

</details>

<details>
<summary>Admin on its own port: ADMIN_PORT, ADMIN_BIND and ADMIN_URL</summary>

`ADMIN_PORT` serves the admin pages on a second port instead of on the public one. It needs
`ADMIN_TOKEN` (or `ADMIN_INGRESS`); unset, nothing changes. With it set, `/admin` and `/admin/*`
answer 404 on the public port like any unknown path, the public report form and invite pages stay
there, and the second port serves only the admin pages (no plans, no federation; its `/` redirects
to `/admin/`).

`ADMIN_BIND` is the address it listens on: an IP address or host name, which binds only its first
address. The default `127.0.0.1` means only the machine itself reaches it.

`ADMIN_URL` is the origin where your browser reaches the admin pages, such as
`https://admin.example.org`. It makes the report alert email link to it (without it that email
names no link), and browsers must then post to the admin pages from exactly that origin (posts
without an `Origin` header still pass on `Sec-Fetch-Site` `none` or absent, as on the public app).
Without it they must come from the host in the request's `Host` header. **Set `ADMIN_URL` whenever
you can**: it also blocks DNS rebinding through that `Host` fallback. Without it, a malicious web
page could lock you out of the login for about an hour, or, with `TRUST_PROXY=true`, send its own
`X-Forwarded-For` to guess without the rate limit, which is hopeless against a 32-character token.
`ADMIN_URL` must be `https`, except for `localhost`, loopback addresses (`127.0.0.0/8`, `::1`) and
private-network IP addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`,
link-local `169.254.0.0/16`), where no certificate can be had. `ALLOW_INSECURE_DEV=true` allows any
http origin.

**A second port is not cookie isolation** (browsers share cookies between ports of one host), so
the admin port has its own cookie names (`rr-admin-split`, `rr-admin-csrf`) and its own CSRF key.
Cookies of the public port never act on it, and the other way round. Its cookies are `Secure` when
`ADMIN_URL` is an `https` origin, otherwise only when the request arrived over HTTPS (with
`TRUST_PROXY=true` the proxy's `X-Forwarded-Proto` counts), so an SSH tunnel to `localhost` or a
LAN address works over plain HTTP.

**With `TRUST_PROXY=true`, the `X-Forwarded-For` and `X-Forwarded-Proto` headers of an admin port
reached without the proxy (SSH tunnel, LAN) are chosen by the client**, so there the login rate
limit and the `Secure` rule can be misled. The token still protects the pages.

- **Bare install** (no container): the default bind `127.0.0.1` is right. Reach it with
  `ssh -L 3001:localhost:3001 yourserver` and open `http://localhost:3001/admin/`.
- **Docker:** set `ADMIN_BIND=0.0.0.0` inside the container so Docker can reach it, and publish the
  port on `127.0.0.1` of the host only (the commented `ports: - "127.0.0.1:3001:3001"` in
  [`deploy/compose.yaml`](deploy/compose.yaml)), then tunnel as above. Or give the admin host its
  own Caddy site block (proxying to `rendezroute:3001`, limited to your VPN or addresses) and set
  `ADMIN_URL` to it.
- **Never publish the admin port to the internet unprotected:** it has only the token, like
  `/admin` on the public port. The proxy rule above remains the alternative if you prefer one port.

</details>

<details>
<summary>Admin through Home Assistant Ingress: ADMIN_INGRESS and its helpers</summary>

`ADMIN_INGRESS=true` is for the Home Assistant app only; other setups use `ADMIN_TOKEN`. It lets
Home Assistant sign the admin in through Ingress instead of a token, and is mutually exclusive with
`ADMIN_TOKEN` (setting both is an error). It needs `ADMIN_PORT` and an explicit `ADMIN_BIND` (the
Supervisor connects from outside the container).

Only a connection from `ADMIN_INGRESS_PEER` (default `172.30.32.2`, the Supervisor; an IPv4 or IPv6
address, read from the TCP connection and never from a header) whose `X-Remote-User-Groups` header
names `system-admin` and that carries an `X-Remote-User-Id` gets in. Every other request gets a 403:
a plain-text one from any other peer, and from the Supervisor without the admin group (or without
the user id) an explanatory page that names what Home Assistant needs (its `/static` files load for
it). There is no login page and no cookie. Forms carry a token bound to the Home Assistant user (and
valid for today and yesterday, UTC), so the admin works over plain http on a LAN too. When a browser
sends `Sec-Fetch-Site` or `Origin` they must also say same-origin (`Origin: null`, which Home
Assistant's no-referrer policy produces, is accepted together with a valid token).

At start-up the app asks the Supervisor for its version, either over TCP (`SUPERVISOR_URL`, default
`http://supervisor`, with the `SUPERVISOR_TOKEN` that Home Assistant puts in an app's environment)
or over a unix socket without any token (`SUPERVISOR_SOCKET`, an absolute path such as
`/run/supervisor/api/supervisor.sock`). The socket and the URL exclude each other (setting both
with `ADMIN_INGRESS` is an error). Home Assistant sets the socket itself for apps, so without
`ADMIN_INGRESS` it is ignored, and with it the socket is used and `SUPERVISOR_TOKEN` is not. For the
Home Assistant app none of this needs to be set: its start step asks the Supervisor as root, before
it gives up root.

Either way the app refuses to start below **2026.10.4**, because older Supervisors let a signed-in
client forge the identity headers. `ADMIN_INGRESS_SKIP_VERSION_CHECK=true` skips the check (tests
and development only). `POSTING_MODE=invite` and reports work as with `ADMIN_TOKEN`; the report
alert email has no link unless `ADMIN_URL` is set.

</details>

### Home Assistant app

In the Home Assistant app the options are set in its Configuration tab: see
[On Home Assistant](#on-home-assistant).

## On Home Assistant

RendezRoute is available as a Home Assistant app (formerly add-on) for **Home Assistant OS**
installations. Home Assistant has deprecated the Supervised and Core installation types and has not
supported them since 2025.12. The settings are in the app's Configuration tab, and the admin pages
are a panel inside Home Assistant.

**The app is new and has not been tested on real hardware yet.** Its image,
`ghcr.io/cgtobi/rendezroute-ha`, is published by the repository owner for each release tag. Until
the owner has published the version you install, installing fails with a download error.

1. In Home Assistant open **Settings > Apps > Install app** (named Add-ons in older versions:
   **Settings > Add-ons > Add-on Store**), open the menu at the top right, choose **Repositories**
   and add `https://github.com/cgtobi/RendezRoute`. Or open
   [this link](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fcgtobi%2FRendezRoute)
   (My Home Assistant) and confirm.
2. Install **RendezRoute** from the list that appears, open its **Configuration** tab and set
   `base_url`: the public https address, for example `https://runs.example.org`. It needs a host
   name of its own.
3. Start the app and put an https reverse proxy, a DuckDNS name with a certificate, or a Cloudflare
   Tunnel in front of port 3000.
4. Open the admin pages with **Open Web UI** on the app's Info tab, or switch on **Show in
   sidebar** there to get a RendezRoute panel. They are for Home Assistant administrators only,
   with no token.

Requirements:

- Home Assistant Supervisor **2026.10.4 or newer**, and a Home Assistant administrator.
- A public https address of its own, through your own reverse proxy or tunnel.
- **Encrypted** Home Assistant backups: the encryption keys are in the app's config folder next to
  the database, and both are in the backup.

The app's [documentation](homeassistant/rendezroute/DOCS.md) (also its Documentation tab) covers
setup, `trust_proxy`, backups, privacy, security and known limits in detail.

For the other kinds of Home Assistant installation:

- **Home Assistant Container** (Home Assistant itself runs as a Docker container you manage): there
  are no apps. Run RendezRoute as a second container on the same host, as in
  [`deploy/compose.yaml`](deploy/compose.yaml). If you already reach Home Assistant from outside
  through a reverse proxy or a Cloudflare Tunnel, add RendezRoute to it instead of the Caddy
  service in the example.
- **Home Assistant Core** (a Python installation without Docker or the Supervisor): there are no
  apps either. Run RendezRoute on the same machine with Docker, or on another one.

Either way RendezRoute needs its own host name with HTTPS (for example `runs.example.org` next to
`home.example.org`), not a path under Home Assistant's: links, the fediverse and WebFinger use
addresses at the root of `BASE_URL`. With the Docker setups above, keep its data and key volumes in
your backups, the key volume separately as described above. In the Home Assistant app one
**encrypted** Home Assistant backup holds both the database and the keys, so there is no separate
key volume to handle.

## Development

Node 26 and npm. Install with `npm ci`, then:

| Command         | What it does                         |
| --------------- | ------------------------------------ |
| `npm run dev`   | Server with reload on port 3000      |
| `npm run check` | Format, lint, types and tests        |
| `npm run build` | Browser bundles and the server build |
| `npm run e2e`   | Browser tests in Docker              |

- Run `npm run build` before `npm run dev` (browser scripts and fonts), and start it with
  `BASE_URL=http://localhost:3000 ALLOW_INSECURE_DEV=true DATA_DIR=$PWD/data`.
- `npm run e2e` uses fake map, search, weather and login services. `E2E_CHANNEL=chrome npm run e2e`
  uses an installed Chrome instead of Playwright's Chromium.
- The `webkit iPhone` project of `npm run e2e` needs WebKit once: `npx playwright install webkit`.
- `npm run css:snapshot:write` and `npm run css:snapshot:compare` store and check the computed
  styles of `/styleguide` (all projects, light and dark, 320 and 390 px) under the git-ignored
  `.css-snapshots/current` (`CSS_SNAPSHOT_DIR` for another folder). Take one before a CSS refactor
  and compare after; details in `e2e/css-snapshot.spec.ts`.
- `npm run icons -- <folder>` rebuilds the logo and icons in `public/` from the Inkscape exports of
  the logo (`RendezRoute_AppIcon.svg`, `RendezRoute_icon.svg`).

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
