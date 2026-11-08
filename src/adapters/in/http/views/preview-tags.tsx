// Open Graph and Twitter tags of the plan page (spec 5 feature 3). Same for every requester.
import type { PlanPreview } from "../../../../application/plan-views.ts";
import { localeOf } from "../../../i18n/i18n.ts";
import { previewDescription, previewText } from "./preview-text.ts";

export const PREVIEW_SIZE = { width: 1200, height: 630 } as const;

export function PreviewTags({
  preview,
  baseUrl,
  siteName,
}: {
  preview: PlanPreview;
  baseUrl: URL;
  siteName: string;
}) {
  const text = previewText(preview);
  const url = new URL(`/p/${preview.id}`, baseUrl).href;
  const image = new URL(`/p/${preview.id}/og.png?v=${preview.version}`, baseUrl).href;
  return (
    <>
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:title" content={text.title} />
      <meta property="og:description" content={previewDescription(text)} />
      <meta property="og:url" content={url} />
      <meta property="og:locale" content={localeOf(text.language).replace("-", "_")} />
      <meta property="og:image" content={image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content={String(PREVIEW_SIZE.width)} />
      <meta property="og:image:height" content={String(PREVIEW_SIZE.height)} />
      <meta property="og:image:alt" content={text.title} />
      <meta name="twitter:card" content="summary_large_image" />
    </>
  );
}
