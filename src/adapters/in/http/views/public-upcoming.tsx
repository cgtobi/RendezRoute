// The upcoming public plans on the home page (spec 7 Nearby): rows as in Nearby, without the
// viewer's distance; nothing at all when there are none.
import type { PublicUpcomingItem } from "../../../../application/public-upcoming.ts";
import type { Units } from "../../../../domain/units.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { itemWhen } from "./format.ts";
import { Item, ItemList } from "./item.tsx";
import { PlanMetrics } from "./plan-metrics.tsx";

export function PublicUpcoming(props: {
  t: Translate;
  /** Message key of the group heading. */
  heading: "home.upcoming" | "home.recent";
  items: readonly PublicUpcomingItem[];
  units: Units;
  language: string;
}) {
  const { t, units, language } = props;
  return (
    <ItemList
      heading={t(props.heading)}
      level={2}
      items={props.items}
      item={(item) => (
        <Item
          href={`/p/${item.planId}`}
          title={item.title}
          meta={[
            t(`activity.${item.activity}`),
            itemWhen(t, { ...item, status: "active" }, language),
            item.areaLabel,
          ].join(" · ")}
        >
          <PlanMetrics t={t} details={item} units={units} language={language} />
        </Item>
      )}
    />
  );
}
