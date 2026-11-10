// The way back to the plan, first on every page about it (design decision D27).

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <p class="back-link">
      <a href={href}>
        <span class="icon icon-back" aria-hidden="true"></span>
        {label}
      </a>
    </p>
  );
}
