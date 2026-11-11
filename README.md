# RendezRoute

**RendezRoute** (from French _rendez-vous_ and _route_: "meet on the route") is a self-hosted web app where runners and cyclists post a planned run or ride, optionally with a route, so others can show interest or join. You share it with a link. Accounts are optional, and every plan is deleted automatically a few days after it happens.

> **Status:** v0.7 in development. Plans without accounts (create, share, join or request, cancel, delete), maps, place search and weather, Web Push and calendar feeds, recaps and ratings, templates, and "My data" export and deletion all work. New in 0.7: an instance admin page, reports, posting rules with invite links, and optional accounts through OIDC or a fediverse server, with claiming, account export and deletion, and accounts deleted after 12 months unused. English, German and French.

## Running it

RendezRoute runs as a single Docker container behind a reverse proxy that provides HTTPS. [`deploy/`](deploy/) has a Docker Compose example with [Caddy](https://caddyserver.com/):

1. Build the image (`docker build -t rendezroute .`) or use a published one, and set it in `deploy/compose.yaml`.
2. Replace `runs.example.org` and the email address in `deploy/compose.yaml` and `deploy/Caddyfile`.
3. Run `docker compose up -d` in `deploy/`.

Things to know before going live:

- **The encryption key** lives on its own volume (`/keys`). Back it up separately from the data volume: without it, encrypted data (exact start points, routes, names) cannot be read, and with it next to the data, a leaked backup is readable.
- **`TRUST_PROXY=true`** is needed behind the proxy, or every visitor shares one rate limit. Never set it when the app is reachable without the proxy.
- **Access logs** stay off in the proxy: private links carry tokens in their paths.
- **`CONTACT_EMAIL`** identifies the instance to map and place-search providers, as their policies require; without it, place search and map images in link previews are off.
- **Weather** comes from [Open-Meteo](https://open-meteo.com/), whose free API is for non-commercial use only and has a daily request limit. For commercial use, get an API plan or run your own Open-Meteo and set `WEATHER_URL`, or switch weather off with `WEATHER_ENABLED=false`.
- **Backups:** `docker compose exec rendezroute node dist/cli.js backup /data/manual-backups` copies the live database safely; copy it off the server together with the key volume, stored separately. Upgrades also back up the database before migrations (`/data/backups`, at most two, deleted after 7 days).
- **`ADMIN_TOKEN`** turns on the instance admin pages at `/admin`, where you log in with the token to find and delete any plan, handle reports and, with `POSTING_MODE=invite`, create and revoke invite links. It must be at least 32 characters (for example from `openssl rand -base64 32`); without it there are no admin pages.
- **`POSTING_MODE`** decides who may create plans: `anyone` (the default), `invite` (only browsers or accounts that opened an invite link from the admin page; needs `ADMIN_TOKEN`) or `logged_in` (needs OIDC or fediverse login).
- **`OIDC_ISSUER`, `OIDC_CLIENT_ID`** (and `OIDC_CLIENT_SECRET` for a confidential client, `OIDC_NAME` for the button) turn on login with an OpenID Connect provider such as Keycloak or Authelia; it may run on your local network. Register `https://<your domain>/login/oidc/callback` as the redirect URI.
- **`FEDIVERSE_LOGIN=true`** lets people log in with a Mastodon, GoToSocial, Akkoma or Pleroma account; `FEDIVERSE_LOGIN_SERVERS` (comma-separated domains) limits which servers may be used.
- **`SMTP_HOST`** and **`SMTP_FROM`** (the sender address) turn on email: people can get a plan's notifications by email after confirming their address, and with `CONTACT_EMAIL` and `ADMIN_TOKEN` you get an email for each new report. `SMTP_PORT` defaults to 587 with STARTTLS required; `SMTP_TLS=tls` uses TLS from the start (port 465 by default). Set `SMTP_USER` and `SMTP_PASSWORD` if your server needs a login.
- **`NTFY_URL`** (an [ntfy](https://ntfy.sh) server, your own or a public one) lets people get notifications in the ntfy app: the app makes a secret topic for each of them on that server. Set `NTFY_TOKEN` if the server needs a token to publish.
- **`TELEGRAM_BOT_TOKEN`** (a bot you create with [@BotFather](https://t.me/BotFather)) lets people get notifications from that bot in Telegram. The app reads the bot's messages itself, so no webhook or public URL is needed; set `TELEGRAM_API_URL` only for a local Bot API server.
- The generated privacy notice is at `/privacy`; set `PRIVACY_URL` and `IMPRINT_URL` to link your own pages.

## Development

Node 26 and npm. `npm ci`, then:

| Command         | What it does                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`   | Server with reload on port 3000; run `npm run build` first (browser scripts and fonts), and set `BASE_URL=http://localhost:3000 ALLOW_INSECURE_DEV=true DATA_DIR=$PWD/data` |
| `npm run check` | Format, lint, type check and unit/integration tests                                                                                                                         |
| `npm run build` | Browser bundles and the server build                                                                                                                                        |
| `npm run e2e`   | Browser tests against the Docker image with fake map, search, weather and login services (needs Docker)                                                                     |

`E2E_CHANNEL=chrome npm run e2e` uses an installed Chrome instead of Playwright's Chromium.

`npm run icons -- <folder>` rebuilds the logo and icons in `public/` from the Inkscape exports of the logo (`RendezRoute_AppIcon.svg`, `RendezRoute_icon.svg`).

## License

[GNU Affero General Public License v3.0](LICENSE)
