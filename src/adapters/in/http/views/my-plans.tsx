// The visitor's own plans on the home page: what they host and answered, as rows. Nothing at all
// when there are none; never more than the plan's title, start and the person's own part in it.
import type { MyPlanItem, MyPlans as MyPlansList } from "../../../../application/my-plans.ts";
import type { Translate } from "../../../i18n/i18n.ts";
import { itemWhen } from "./format.ts";
import { Item, ItemList } from "./item.tsx";

export function MyPlans(props: { t: Translate; plans: MyPlansList; language: string }) {
  const { t, language } = props;
  const row = (item: MyPlanItem) => (
    <Item
      href={`/p/${item.planId}`}
      title={item.title}
      meta={[
        itemWhen(t, { ...item, status: "active" }, language),
        item.role === "host" ? t("home.roleHost") : t(`status.${item.role}`),
      ].join(" · ")}
    />
  );
  return (
    <>
      <ItemList heading={t("home.upcoming")} level={2} items={props.plans.upcoming} item={row} />
      <ItemList heading={t("home.recent")} level={2} items={props.plans.recent} item={row} />
    </>
  );
}
