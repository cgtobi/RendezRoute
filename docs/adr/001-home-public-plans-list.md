# 001 Public plans list on the home page

## Decision (user, 2026-11-18)

Below the "Find public plans nearby" link on `/`, list upcoming public plans, **soonest start first**
(the user first said "newest to oldest", then chose soonest first), without a location filter.

## Rules

- Shown only when `config.nearbyEnabled` is true (plans cannot be public otherwise). Render nothing
  (no heading, no empty text) when there are no plans.
- Same selection as Nearby: `visibility = public`, status active, starts at or after now, within the
  plan horizon. No bounding box, no radius, no viewer point.
- At most 10 rows (constant in the application layer), no paging, no "truncated" note.
- Each row: title, activity, start time in the plan's time zone, public area label, distance, pace,
  elevation gain if Nearby shows it; linking to `/p/{id}`. NO distance-from-viewer. Never the exact
  start, description, coordinates, names or route (same `NearbyItem` fields minus `awayKm` and
  `distanceMeters` from viewer; reuse the Nearby row component where it fits).
- Heading text new i18n key (en/de/fr), e.g. "Coming up" / "Demnächst" / "À venir".
- Cache: when templates exist or the list is non-empty, home sends `cache-control: private,
  no-store`; a non-empty list also sends `x-robots-tag: noindex`, as Nearby does. Do not add
  public caching. The list is empty when Nearby would list nothing (login required and none
  offered).

## Recent plans (follow-up, user yes)

- A separate group below "Coming up", heading key `home.recent` ("Recently" / "Zuletzt" /
  "Récemment"): public, active plans with a public area point that started within the last 7 days
  (`starts_at >= now - 7d` and `< now`), newest first (`starts_at` desc, then `id`), at most 5
  (`MAX_RECENT`). Same row and privacy rules. Not rendered when empty. Gated like the rest
  (`nearbyEnabled`, `nothingPublic`).
- Port `findPublicRecent(from, until, limit)`; use case `listPublicRecent`.
- Cache: `private, no-store` and `x-robots-tag: noindex` when either group is non-empty.

## Layers (hexagonal)

- `src/application/ports.ts`: new `PlanRepository.findPublicUpcoming(from, until, limit)` ordered by
  `starts_at` then `id`; implement in `src/adapters/out/sqlite/plans.ts` (next to `findPublicIn`) and
  `test/fakes/repositories.ts`.
- `src/application/`: small use case `listPublicUpcoming` returning the row type (reuse `NearbyItem`
  shape without viewer distance; domain stays pure). Must apply the same filters as
  `matchesNearby` for visibility, active status and having a public area point (the label is never null; the point is the real rule).
- `src/adapters/in/http/app.tsx` (`app.get("/")`): load it only if `config.nearbyEnabled`, pass to
  the home view; view below the Nearby link and above `TemplateList`.
- i18n: `src/adapters/i18n/messages/{en,de,fr}.ts`.

## Tests

- Application test: order (soonest first), excludes link-only, cancelled, past, over limit 10.
- HTTP test next to `test/adapters/http/nearby.test.ts`: home lists public plans; absent link-only
  plan, exact coordinates, joiner names, route; hidden when Nearby is off; nothing rendered when none.
- Privacy: the home page must never contain what Nearby already hides (extend the existing
  assertions pattern at nearby.test.ts:35-55).
- Update any e2e/home assertions only if they break.
