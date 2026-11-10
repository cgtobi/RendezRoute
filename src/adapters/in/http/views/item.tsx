// A plan or template in a list (design decision D27): its title, a muted line saying when or what
// it is, then what can be done with it.
import type { Child } from "hono/jsx";

export function Item(props: { href: string; title: string; meta?: Child; children?: Child }) {
  return (
    <li class="item">
      <a class="item-title" href={props.href}>
        {props.title}
      </a>
      {props.meta !== undefined && <p class="item-meta">{props.meta}</p>}
      {props.children}
    </li>
  );
}

/**
 * A titled list of items, or nothing when it is empty: a page's own section (h2), or a part of
 * one (h3).
 */
export function ItemList<T>(props: {
  heading: string;
  level: 2 | 3;
  items: readonly T[];
  item: (item: T) => Child;
}) {
  if (props.items.length === 0) return null;
  const list = <ul class="items">{props.items.map(props.item)}</ul>;
  return props.level === 2 ? (
    <section>
      <h2>{props.heading}</h2>
      {list}
    </section>
  ) : (
    <>
      <h3>{props.heading}</h3>
      {list}
    </>
  );
}
