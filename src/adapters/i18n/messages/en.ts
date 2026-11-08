// English UI strings (spec section 2: all UI strings externalized). The source catalog: German and
// French must have the same keys, placeholders and plural shapes (decision I31).
import type { Message, Plural } from "./message.ts";

export const en = {
  "layout.poweredBy": "Powered by {name}",
  "layout.devBanner": "Development mode: insecure settings are active. Not for production use.",
  "layout.privacy": "Privacy",
  "layout.imprint": "Imprint",
  "layout.language": "Language",
  "layout.change": "Change",
  "layout.units": "Units",
  "units.metric": "Metric (km)",
  "units.imperial": "Imperial (mi)",

  "privacy.title": "Privacy",
  "privacy.intro":
    "{instance} runs RendezRoute, open-source software for planning runs and rides. This notice is generated from this site’s settings and describes what the software does.",
  "privacy.contact": "Questions about your data:",
  "privacy.storedHeading": "What is stored",
  "privacy.storedPlans":
    "When you create a plan: your name, the plan details you enter and an optional route. Name, title, note, meeting area, time, distance and pace are visible to anyone with the link. The exact start and the route are shown only to you and people who join, and are stored encrypted.",
  "privacy.storedResponses":
    "When you respond: the name you give, your choice and the language of the page, for messages about the plan. Your name is stored encrypted and shown to the host, and to the other participants if you join.",
  "privacy.noTracking": "There are no accounts, no analytics and no advertising.",
  "privacy.durationHeading": "How long",
  "privacy.retention":
    "Each plan is deleted with all responses, names and its route on the date shown on the plan page: 1 to {days} days after the run, as the host chooses. The host can delete it earlier, and you can withdraw your response at any time. Deleted data is overwritten in the database.",
  "privacy.retentionLowered":
    "Plans created before this maximum was lowered may keep their longer period, up to {max} days.",
  "privacy.devices":
    "The link between your browser and your plans or responses is deleted {unlinkedDays} days after its last use once nothing is linked to it anymore, and in any case after {unusedDays} days without use.",
  "privacy.backups":
    "Automatic database backups made before software updates are deleted after {days} days.",
  "privacy.operatorHeading": "Who can access the data",
  "privacy.operator":
    "The operator of this site can technically access everything stored here, including encrypted data. Encryption protects data in leaked database backups when the key is kept separately, but not against the operator.",
  "privacy.cookiesHeading": "Cookies",
  "privacy.cookieDevice":
    "A device cookie, only once you create a plan, respond or open a private link: a random value that links this browser to them, kept for {days} days.",
  "privacy.cookieCsrf":
    "A session cookie that protects forms against forged submissions. Browsers delete it when you close them, unless they restore your previous session.",
  "privacy.cookiePreferences":
    "Language and units cookies, only when you choose a language or units at the bottom of a page, kept for {days} days.",
  "privacy.cookieOthers": "No other cookies, and none from other sites.",
  "privacy.servicesHeading": "Other services",
  "privacy.tiles":
    "Maps are loaded by your browser directly from {host}. That service sees your IP address and which map area you look at.",
  "privacy.tilesServer":
    "For link preview images, this server also loads map images of the rough meeting area; this sends nothing about you.",
  "privacy.geocoder":
    "Place search goes through this server to {host}. That service sees what you search for, but not who you are. Searches and their results are kept in this server’s memory for up to {days} days, so repeated searches need no new request.",
  "privacy.push":
    "If you turn on notifications, your browser’s push service (from Google, Mozilla, Apple or Microsoft) delivers them. The messages are encrypted; the service only sees that one was sent.",
  "privacy.location":
    "“Use my location” asks your browser for your position and only fills in the form; it is sent only when you submit the form.",
  "privacy.locationMap":
    "With maps on, the map then moves to your position, so your browser loads map images of that area from the map service.",
  "privacy.share": "WhatsApp and X are contacted only when you use their share links.",
  "privacy.previews":
    "When a plan link is shared in a chat app, the app fetches the plan’s title, time, meeting area, distance, pace and a preview image. Chat apps may keep this preview after the plan is deleted.",
  "privacy.logsHeading": "Logs and abuse protection",
  "privacy.logs":
    "The software logs which kind of page was requested and whether it worked, never names, private links, exact locations or IP addresses.",
  "privacy.rateLimits":
    "To prevent abuse, the server counts requests per IP address (for IPv6, per network) in memory only, for at most about an hour.",

  "home.intro": "Plan a run or ride, share the link, and see who joins. No account needed.",
  "home.cta": "Plan a run or ride",

  "error.csrf": "Your form expired or came from another site. Reload the page and try again.",
  "error.internal": "Something went wrong on our side. Please try again later.",
  "error.tooLarge": "This request is too large.",
  "error.busy": "The server is busy. Please try again in a few seconds.",
  "error.rateLimited": "Too many requests from your network. Please try again in a few minutes.",
  "error.badRequest": "The form could not be processed. Please reload the page and try again.",

  "activity.run": "Run",
  "activity.trail": "Trail run",
  "activity.ride": "Road ride",
  "activity.gravel": "Gravel ride",
  "activity.mtb": "Mountain bike ride",

  "drop.no_drop": "No-drop: we wait for everyone",
  "drop.drop": "Drop: keep up or continue on your own",

  "unit.minPerKm": "min/km",
  "unit.kmh": "km/h",
  "unit.km": "km",
  "unit.m": "m",

  "unit.minPerMi": "min/mi",
  "unit.mph": "mph",
  "unit.mi": "mi",
  "unit.ft": "ft",

  "form.heading": "Plan a run or ride",
  "form.errors": "Please check the fields marked below.",
  "form.posterName": "Your name",
  "form.posterNameHint": "Shown on the plan with a host badge.",
  "form.activity": "Activity",
  "form.title": "Title",
  "form.date": "Date",
  "form.time": "Start time",
  "form.timeZone": "Time zone",
  "form.areaLabel": "Meeting area",
  "form.areaLabelHint": "Shown to everyone, for example “Englischer Garten, north end”.",
  "form.publicHint":
    "Don't put the exact meeting point here; it's public. Use “Exact start” instead.",
  "form.exactStart": "Exact start (optional)",
  "form.exactStartHint": "Only you and people who join can see this.",
  "form.openModeWarning":
    "Anyone with the link who joins will see the exact start. Choose “Only people I accept” to decide who sees it.",
  "form.exactDescription": "Where exactly?",
  "form.coordinates": "Coordinates (optional)",
  "form.latitude": "Latitude",
  "form.longitude": "Longitude",
  "form.areaCoordinates": "Map point of the meeting area (optional)",
  "form.areaCoordinatesHint":
    "Shown to everyone, rounded to about 1 km. Not needed when the exact start has coordinates.",
  "map.search": "Find a place",
  "map.searchButton": "Search",
  "map.searchHint":
    "Search results and your location set the meeting area; tap the map for the exact start. Searches go through this site, so the search service does not see who you are.",
  "map.searchUnavailable": "Place search is not available right now.",
  "map.noResults": "No places found.",
  "map.locate": "Use my location",
  "map.pickLegend": "Tapping the map sets",
  "map.pickExact": "the exact start",
  "map.pickArea": "the meeting area",
  "map.pickLabel": "Map for choosing a point",
  "map.planLabel": "Map of the meeting area",
  "map.zoomIn": "Zoom in",
  "map.zoomOut": "Zoom out",
  "form.distance": "Distance ({unit}, optional)",
  "form.elevation": "Elevation gain ({unit}, optional)",
  "form.pace": "Pace or speed (optional)",
  "form.paceHint":
    "Runs: pace per km, for example 5:30 to 6:00. Rides: speed in km/h, for example 25 to 28.",
  "form.paceHintImperial":
    "Runs: pace per mile, for example 9:00 to 9:30. Rides: speed in mph, for example 15 to 18.",
  "form.paceFrom": "From",
  "form.paceTo": "To",
  "form.joinMode": "Who can join",
  "form.joinOpen": "Anyone with the link",
  "form.joinApproval": "Only people I accept",
  "form.joinModeHint":
    "With “Only people I accept”, people send a request and see the exact start only after you accept them.",
  "form.dropPolicy": "Group policy",
  "form.note": "Note (optional)",
  "form.colors": "Plan colors",
  "form.primaryColor": "Main color",
  "form.secondaryColor": "Accent color",
  "form.retention": "Delete the plan",
  "form.retentionDays": { one: "{count} day after the run", other: "{count} days after the run" },
  "form.submit": "Create plan",
  "form.gpx": "Route (GPX file, optional)",
  "form.gpxTrim": "Hide the start and end of the route",
  "form.gpxTrimHint":
    "Removes the route near where your recording started and ended, for example your home. Removed parts are never stored.",
  "form.gpxTrimOff": "Show the whole route",
  "form.gpxTrimMeters": "Hide {meters} m at each end",
  "form.gpxTrimKilometers": "Hide {km} km at each end",
  "form.gpxTrimMiles": "Hide about {miles} mi at each end",
  "form.gpxHint":
    "Fills in distance, elevation and the exact start. Only people who join can see and download the route. If the form shows an error, choose the file again.",

  "field.invalid": "This value is not valid.",
  "field.required": "Please fill this in.",
  "field.too_long": "This is too long.",
  "field.invalid_characters": "This contains characters that are not allowed.",
  "field.choice_invalid": "Please choose one of the options.",
  "field.datetime_invalid": "Please enter a valid date and time.",
  "field.starts_invalid": "Please enter a valid date and time.",
  "field.starts_in_past": "The start must be in the future.",
  "field.starts_beyond_horizon": "The start is too far in the future.",
  "field.timezone_invalid": "Please choose a time zone from the list.",
  "field.coordinates_invalid": "Please enter both latitude and longitude as decimal degrees.",
  "field.exact_start_too_long": "Please keep this under 200 characters.",
  "field.exact_start_empty": "Please describe the exact start or enter coordinates.",
  "field.number_invalid": "Please enter a number.",
  "field.out_of_range": "This number is out of range.",
  "field.pace_invalid": "Please enter pace as minutes:seconds, for example 5:30.",
  "field.speed_invalid": "Please enter speed as a whole number, for example 25.",
  "field.pace_out_of_range": "This pace or speed is out of range.",
  "field.pace_band_reversed": "The faster value must come first.",
  "field.color_invalid": "Please choose a color.",
  "field.retention_out_of_range": "Please choose one of the offered periods.",
  "field.retention_shorter_than_recap_window": "Please choose a longer period.",
  "field.route_too_large": "The file is larger than 5 MB.",
  "field.route_unsafe":
    "This file can't be read safely. Please export it again as a plain GPX file.",
  "field.route_unreadable": "This doesn't look like a GPX file.",
  "field.route_empty": "The file contains no track or route.",
  "field.route_too_many_points": "The route has more than 50,000 points.",
  "field.route_invalid": "The file contains invalid coordinates.",
  "field.route_too_long": "The route is longer than 1,000 km.",
  "field.route_trimmed_away":
    "Hiding the start and end would remove the whole route. Choose a shorter distance.",
  "field.name_taken_by_host": "That's the host's name. Please use a different one.",
  "field.name_taken_by_response": "Someone who responded already uses this name.",

  "links.heading": "Your plan is ready",
  "links.planLink": "Plan link: share this one",
  "links.hostLink": "Your host link: keep this private",
  "links.hostLinkWarning":
    "Save it now. It is shown only once, and anyone with it can manage your plan. This browser stays linked as host.",
  "links.open": "Open your plan",
  "links.deletion": "The plan and everything about it will be deleted on {date}.",

  "plan.gone": "This plan no longer exists.",
  "plan.host": "host",
  "plan.postedBy": "Posted by {name}",
  "plan.youAreHost": "You are the host of this plan.",
  "plan.when": "When",
  "preview.cancelled": "Cancelled: {title}",
  "plan.timeZone": "{zone} time",
  "plan.where": "Meeting area",
  "plan.distance": "Distance",
  "plan.elevation": "Elevation gain",
  "plan.pace": "Pace",
  "plan.speed": "Speed",
  "plan.group": "Group",
  "plan.exactStart": "Exact start",
  "plan.exactStartPrivate": "Only you and people who join can see this.",
  "plan.openStreetMap": "Open in OpenStreetMap",
  "plan.openMapsApp": "Open in maps app",
  "plan.deletion": "This plan will be deleted on {date}.",

  "plan.counts": "{participants} joined · {interested} interested",
  "plan.pendingRequests": {
    one: "{count} request is waiting for you.",
    other: "{count} requests are waiting for you.",
  },
  "plan.participants": "Who's coming",
  "plan.interestedPeople": "Interested",
  "plan.yourResponse": "Your response",
  "plan.manageResponse": "Change or withdraw",
  "plan.cancelled": "This plan was cancelled.",

  "status.interested": "Interested",
  "status.joined": "You're in",
  "status.requested": "Request pending",
  "status.notAnswered": "Not answered: the host did not decide before the start.",
  "status.rejected": "Not accepted for this plan.",
  "status.removed": "The host removed you from this plan.",

  "respond.heading": "Are you coming?",
  "respond.name": "Your name",
  "respond.nameHint": "The host sees it. If you join, other participants see it too.",
  "respond.openModeNote":
    "Anyone with the link who joins sees the exact start and who else is coming.",
  "respond.interested": "Interested",
  "respond.join": "I'm in",
  "respond.request": "Request to join",
  "respond.note": "Note to the host (optional)",
  "respond.noteHint": "Only the host sees it.",
  "respond.approvalNote":
    "The host decides who joins. Once accepted, you see the exact start and who else is coming.",
  "respond.closed": "Responses are closed for this plan.",
  "respond.blocked": "You can't respond to this plan.",

  "responded.heading": "Response saved",
  "responded.manageLink": "Your manage link: keep this private",
  "responded.manageLinkWarning":
    "Save it now. It is shown only once. With it you can change or withdraw your response from another device. This browser stays linked.",
  "responded.back": "Back to the plan",

  "manage.heading": "Your response to “{title}”",
  "manage.choice": "Your response",
  "manage.save": "Save changes",
  "manage.locked": "Responses are closed now. You can still change your name or withdraw.",
  "manage.withdraw": "Withdraw…",
  "manage.withdrawExplain": "This deletes your response and your name from this plan.",
  "manage.withdrawConfirm": "Withdraw and delete my response",
  "manage.back": "Back to the plan",

  "manageLink.heading": "Use this manage link on this device?",
  "manageLink.body": "This link lets you change or withdraw your response to “{title}”.",
  "manageLink.sharedWarning":
    "Only continue on your own device: anyone using this browser can then change or withdraw your response.",

  "share.heading": "Share",
  "share.native": "Share…",
  "share.copy": "Copy link",
  "share.copied": "Link copied.",
  "share.copyFailed": "Couldn’t copy. Please copy the link from the address bar.",

  "plan.managePlan": "Manage plan",
  "plan.route": "Route",
  "plan.downloadGpx": "Download GPX",

  "notify.accepted": "You’re in. The exact start is now on the plan page.",
  "notify.rejected": "Your request was not accepted for this plan.",
  "notify.removed": "The host removed you from this plan.",
  "notify.changed": "The plan was changed. Check the details.",
  "notify.cancelled": "The plan was cancelled.",
  "notify.deleted": "The plan was deleted by its host.",
  "notify.dayBefore": "Reminder: the plan is tomorrow.",
  "notify.startsToday": "Reminder: the plan is today.",
  "notify.deletionReminder": "This plan will be deleted soon. Save what you want to keep.",
  "notify.recapDeleted": "The host deleted the recap of this plan.",
  "notify.newResponse": "Someone responded to your plan.",
  "notify.newRequest": "Someone asked to join your plan.",
  "notify.withdrawn": "Someone withdrew their response.",

  "push.enable": "Notify me about this plan",
  "push.disable": "Turn off notifications",
  "push.on": "Notifications for this plan are on in this browser.",
  "push.blocked": "Notifications are blocked in this browser’s settings.",
  "push.failed": "Notifications could not be turned on. Please try again.",
  "push.hint": "Only news about this plan: changes, cancellation, your request and reminders.",
  "push.hostHint": "News about responses, requests and withdrawals.",

  "host.route": "Route",
  "host.routeNone": "No route yet.",
  "host.routePresent": "This plan has a route.",
  "host.routeUpload": "Upload route",
  "host.routeReplace": "Replace route",
  "host.routeRemove": "Remove route",
  "host.routeHint": "Distance and elevation are taken from the route.",

  "host.heading": "Manage your plan",
  "host.saved": "Changes saved.",
  "host.save": "Save changes",
  "host.retentionOnly":
    "The plan has started or was cancelled. You can still change when it is deleted.",
  "host.deletesNowWarning": "This will delete the plan now.",
  "host.deleteNow": "Delete the plan now",
  "host.people": "People",
  "host.participants": "Joined",
  "host.interested": "Interested",
  "host.removed": "Removed",
  "host.noPeople": "Nobody has responded yet.",
  "host.remove": "Remove",
  "host.restore": "Undo removal",
  "host.removeHint":
    "Removed people lose access to the exact start and can't respond again from the same device.",
  "host.requests": "Requests",
  "host.accept": "Accept",
  "host.reject": "Reject",
  "host.rejected": "Not accepted",
  "host.undoReject": "Undo rejection",
  "host.acceptPendingWarning": {
    one: "{count} pending request will be accepted.",
    other: "{count} pending requests will be accepted.",
  },
  "host.acceptPendingConfirm": "Save and accept them",
  "host.cancel": "Cancel plan…",
  "host.cancelExplain":
    "Cancelling is final. The plan stays visible with a “cancelled” banner until it is deleted. To run it after all, create a new plan.",
  "host.cancelConfirm": "Cancel this plan",
  "host.delete": "Delete plan…",
  "host.deleteHeading": "Delete “{title}”?",
  "host.deleteExplain": {
    zero: "This deletes the plan and its exact start, right away and for good. It cannot be undone.",
    one: "This deletes the plan, its exact start and its {count} response with the name, right away and for good. It cannot be undone.",
    other:
      "This deletes the plan, its exact start and all {count} responses with their names, right away and for good. It cannot be undone.",
  },
  "host.deleteConfirm": "Delete for good",
  "host.back": "Back to the plan",

  "hostLink.heading": "Use this host link on this device?",
  "hostLink.ogTitle": "Private link",
  "hostLink.ogDescription": "This is a private link. Please don't share it.",
  "hostLink.body": "This link lets you manage “{title}”.",
  "hostLink.sharedWarning":
    "Only continue on your own device: anyone using this browser can then manage the plan.",
  "hostLink.confirm": "Use on this device",
  "hostLink.invalid": "This link is not valid. It may have been replaced by a newer one.",
  "secretLink.confirm": "Use on this device",
} as const satisfies Readonly<Record<string, Message>>;

export type MessageKey = keyof typeof en;

/** A translation of the English catalog: same keys, and plurals where English has them. */
export type Messages = {
  readonly [K in MessageKey]: (typeof en)[K] extends string ? string : Plural;
};
