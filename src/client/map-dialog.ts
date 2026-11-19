// The full-screen map (ADR 008): a native modal <dialog> (top layer, focus trap, Escape, inert
// page), not the Fullscreen API. Each page map has a <template data-map-dialog="..."> next to it,
// holding the dialog's labels only; an icon on the page map clones it into <body> (outside every
// form), opens it and builds a second Leaflet map there from the PAGE map's data attributes. On
// close everything built here is taken down again and the focus goes back to the icon.
import L from "leaflet";
import { createMap, tileLayer } from "./tiles.ts";

/** What the per-map setup gets: the open dialog, its map, and the dialog's lifetime. */
export interface MapDialogSession {
  readonly dialog: HTMLDialogElement;
  readonly map: L.Map;
  /** Aborted on close: listeners registered with it go, late callbacks check it and do nothing. */
  readonly signal: AbortSignal;
  /** Runs on close, before the map is removed (so it can still read the map's view). */
  readonly onClose: (cleanup: () => void) => void;
}

export type MapDialogSetup = (session: MapDialogSession) => void;

/** Browsers without a modal <dialog> (iOS before 15.4) get no full-screen icon at all. */
export function dialogSupported(): boolean {
  return (
    typeof HTMLDialogElement === "function" &&
    typeof HTMLDialogElement.prototype.showModal === "function"
  );
}

export interface IconControlOptions {
  position: L.ControlPosition;
  /** The icon's name: `icon icon-NAME` from public/icons/. */
  icon: string;
  /** The button's class, for the CSS (`map-expand`, `map-close`). */
  className: string;
  label: string;
  onClick: () => void;
}

/**
 * A 48 px icon button as a Leaflet control, in the zoom buttons' bar look. Taps and wheel turns on
 * it never reach the map, so pressing it never sets a point or zooms.
 */
export function addIconControl(map: L.Map, options: IconControlOptions): HTMLButtonElement {
  const button = L.DomUtil.create("button", options.className);
  button.type = "button";
  button.title = options.label;
  button.setAttribute("aria-label", options.label);
  L.DomUtil.create("span", `icon icon-${options.icon}`, button).setAttribute("aria-hidden", "true");
  const control = new L.Control({ position: options.position });
  control.onAdd = () => {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    container.append(button);
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };
  L.DomEvent.on(button, "click", options.onClick);
  control.addTo(map);
  return button;
}

/** What opening a full-screen map needs. */
export interface MapDialogRequest {
  /** The `<template data-map-dialog>` next to the page map. */
  template: HTMLTemplateElement;
  /** The page map's element (or its picker): tiles, attribution and zoom titles come from it. */
  settings: HTMLElement;
  /** The page map: the dialog opens on its centre and zoom unless the setup says otherwise. */
  pageMap: L.Map;
  /** Gets the focus back on close. */
  opener: HTMLElement;
  setup: MapDialogSetup;
}

/**
 * The full-screen icon on a page map (top right). Without a modal <dialog> nothing is added.
 * Returns the button, if any.
 */
export function addExpandControl(
  pageMap: L.Map,
  template: HTMLTemplateElement,
  settings: HTMLElement,
  setup: MapDialogSetup,
): HTMLButtonElement | undefined {
  if (!dialogSupported()) return undefined;
  const button = addIconControl(pageMap, {
    position: "topright",
    icon: "expand",
    className: "map-expand",
    label: template.dataset.openLabel ?? "Show the map full screen",
    onClick: () => {
      openMapDialog({ template, settings, pageMap, opener: button, setup });
    },
  });
  return button;
}

/**
 * Opens the full-screen map: clone the template into <body>, `showModal()`, and only then build the
 * map (Leaflet needs the final size). Returns the session, or undefined when one is open already
 * or the template is not a map dialog.
 */
export function openMapDialog(request: MapDialogRequest): MapDialogSession | undefined {
  if (document.querySelector("dialog.map-dialog[open]") !== null) return undefined;
  const dialog = document.importNode(request.template.content, true).querySelector("dialog");
  const element = dialog?.querySelector<HTMLElement>(".map-dialog-map");
  if (dialog === null || dialog === undefined || element === null || element === undefined) {
    return undefined;
  }
  // showModal() needs the dialog in the document; if it still throws, nothing is left behind.
  document.body.append(dialog);
  try {
    dialog.showModal();
  } catch {
    dialog.remove();
    return undefined;
  }

  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  let map: L.Map | undefined;
  let observer: ResizeObserver | undefined;
  let frame = 0;

  // Done, Close, Escape and Android's back all end here.
  dialog.addEventListener(
    "close",
    () => {
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch {
          // One failing cleanup must not keep the dialog in the page.
        }
      }
      controller.abort();
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      map?.remove();
      dialog.remove();
      // The icon may be gone (the page map rebuilt meanwhile): then the page map takes the focus.
      if (request.opener.isConnected) request.opener.focus();
      else request.pageMap.getContainer().focus();
    },
    { once: true },
  );

  try {
    map = createMap(element, request.settings, { scrollWheelZoom: true });
    // showModal() focused the map element (autofocus) before Leaflet was there, and Leaflet's
    // keyboard handler only starts listening on a focus event: without this, the arrow keys and
    // +/- would do nothing until the focus left the map and came back.
    if (document.activeElement === element) element.dispatchEvent(new FocusEvent("focus"));
    // The page map's view for a start; the setup may set another before any tile is asked for.
    map.setView(request.pageMap.getCenter(), request.pageMap.getZoom(), { animate: false });
    const label = dialog.dataset.closeLabel ?? "Close full-screen map";
    addIconControl(map, {
      position: "topright",
      icon: "close",
      className: "map-close",
      label,
      onClick: () => dialog.close(),
    });
    for (const button of dialog.querySelectorAll("[data-map-dialog-close]")) {
      button.addEventListener("click", () => dialog.close(), { signal: controller.signal });
    }

    // Rotation, the iOS toolbar changing 100dvh, a desktop window resize: one invalidateSize per
    // frame at most. Leaflet's own window resize tracking stays on.
    const built = map;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => {
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          built.invalidateSize({ pan: false });
        });
      });
      observer.observe(element);
    }

    const session: MapDialogSession = {
      dialog,
      map: built,
      signal: controller.signal,
      onClose: (cleanup) => {
        cleanups.push(cleanup);
      },
    };
    request.setup(session);
    // Only now, at the view the setup chose: no tile batch for a view that is left at once.
    tileLayer(request.settings).addTo(built);
    return session;
  } catch {
    // A map that cannot be built leaves the page as it was.
    dialog.close();
    return undefined;
  }
}
