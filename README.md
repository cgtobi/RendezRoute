# RendezRoute

**RendezRoute** (from French _rendez-vous_ and _route_: "meet on the route") is a self-hosted web app where runners and cyclists post a planned run or ride, optionally with a route, so others can show interest or join. You share it with a link. Accounts are optional, and every plan is deleted automatically a few days after it happens.

> **Status:** v0.1 in development: create, share, join, cancel and delete plans, in English, German and French.

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
- The generated privacy notice is at `/privacy`; set `PRIVACY_URL` and `IMPRINT_URL` to link your own pages.

## Development

Node 26 and npm. `npm ci`, then:

| Command         | What it does                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`   | Server with reload; needs `BASE_URL=http://localhost:3000 ALLOW_INSECURE_DEV=true`      |
| `npm run check` | Format, lint, type check and unit/integration tests                                     |
| `npm run build` | Browser bundles and the server build                                                    |
| `npm run e2e`   | Browser tests against the Docker image with fake map and search services (needs Docker) |

`E2E_CHANNEL=chrome npm run e2e` uses an installed Chrome instead of Playwright's Chromium.

## License

[GNU Affero General Public License v3.0](LICENSE)
