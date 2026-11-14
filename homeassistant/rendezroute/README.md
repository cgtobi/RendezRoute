# RendezRoute for Home Assistant

Advertise a planned run or ride, share a link, and let others join, without an account for guests.
RendezRoute is a small, self-hosted app: the person who plans a run or ride shares a link, guests
answer with a name, and the exact start and route are shown only to people who are allowed to see
them.

This app runs RendezRoute inside Home Assistant:

- the **admin pages** (reports, invite links) open from the app's Info tab (**Open Web UI**), or as
  a panel in the Home Assistant sidebar if you switch on **Show in sidebar** there, for Home
  Assistant administrators only, with no extra password;
- the **public site** is served on port 3000, which you put behind your own https address;
- all settings are in the app's **Configuration** tab.

**Experimental:** this is the first release of the app and it has not yet been tested on real Home
Assistant devices. Read the **Documentation** tab before you install it.

Needs Home Assistant Supervisor 2026.10.4 or newer.
