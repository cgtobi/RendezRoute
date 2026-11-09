// The three kinds of secret link (spec 3.2): where each lives and leads, and its texts. Shared by
// the confirm-then-link routes and the "Get a new link" / "Sign out all other devices" routes.
import type { LinkKind } from "../../../../application/links.ts";
import {
  confirmHostLink,
  confirmManageLink,
  confirmTemplateLink,
  openHostLink,
  openManageLink,
  openTemplateLink,
} from "../../../../application/secret-links.ts";
import type { MessageKey } from "../../../i18n/messages/en.ts";

export interface LinkKindSettings {
  /** The secret link's path prefix, followed by the token. */
  secretPath: "/a" | "/m" | "/t";
  open: typeof openHostLink;
  confirm: typeof confirmHostLink;
  /** Where a linked device lands, by plan or template ID. */
  landing: (id: string) => string;
  /** The page with "Get a new link" and "Sign out all other devices", as a route pattern. */
  toolsPage: string;
  /** The confirmation page's texts. */
  confirmTexts: { heading: MessageKey; body: MessageKey; warning: MessageKey };
  /** How a newly issued link is labelled and what it warns. */
  newLinkTexts: { label: MessageKey; warning: MessageKey };
}

export const LINK_KINDS: Readonly<Record<LinkKind, LinkKindSettings>> = {
  host: {
    secretPath: "/a",
    open: openHostLink,
    confirm: confirmHostLink,
    landing: (planId) => `/p/${planId}`,
    toolsPage: "/p/:id/host",
    confirmTexts: {
      heading: "hostLink.heading",
      body: "hostLink.body",
      warning: "hostLink.sharedWarning",
    },
    newLinkTexts: { label: "links.hostLink", warning: "links.hostLinkWarning" },
  },
  manage: {
    secretPath: "/m",
    open: openManageLink,
    confirm: confirmManageLink,
    landing: (planId) => `/p/${planId}/me`,
    toolsPage: "/p/:id/me",
    confirmTexts: {
      heading: "manageLink.heading",
      body: "manageLink.body",
      warning: "manageLink.sharedWarning",
    },
    newLinkTexts: { label: "responded.manageLink", warning: "responded.manageLinkWarning" },
  },
  template: {
    secretPath: "/t",
    open: openTemplateLink,
    confirm: confirmTemplateLink,
    landing: (templateId) => `/templates/${templateId}`,
    toolsPage: "/templates/:id",
    confirmTexts: {
      heading: "templateLink.heading",
      body: "templateLink.body",
      warning: "templateLink.sharedWarning",
    },
    newLinkTexts: { label: "template.link", warning: "template.linkWarning" },
  },
};

export const linkKinds = () => Object.entries(LINK_KINDS) as [LinkKind, LinkKindSettings][];
