"""Validates the Home Assistant app folder with the Supervisor's own schemas (decision D57).

    PYTHONPATH=<supervisor checkout> python scripts/validate-ha-app.py [repository root]

It needs the Supervisor's dependencies (its requirements.txt, Python 3.14) installed and its
checkout on PYTHONPATH: the CI job `home-assistant-schema` sets both up at a pinned commit. It
checks, with the code the Supervisor itself runs:

  * homeassistant/rendezroute/config.yaml against SCHEMA_APP_CONFIG,
  * homeassistant/rendezroute/translations/*.yaml against SCHEMA_APP_TRANSLATIONS,
  * repository.yaml against SCHEMA_REPOSITORY_CONFIG,
  * that `image` carries no tag (the Supervisor appends the version),
  * that the option defaults (plus a base_url, the one required option) satisfy the app's own
    options schema, which is what the Supervisor validates /data/options.json against.

Every failure is printed, then the exit status is 1.
"""

import pathlib
import sys

import voluptuous as vol
import yaml
from voluptuous.humanize import humanize_error

try:
    from supervisor.apps.options import AppOptions
    from supervisor.apps.validate import SCHEMA_APP_CONFIG, SCHEMA_APP_TRANSLATIONS
    from supervisor.store.validate import SCHEMA_REPOSITORY_CONFIG
except ImportError as error:
    sys.exit(f"Cannot import the Supervisor ({error}): put its checkout on PYTHONPATH.")

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
app = root / "homeassistant" / "rendezroute"
failures: list[str] = []


def load(path: pathlib.Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def check(label: str, schema, data) -> None:
    try:
        schema(data)
    except vol.Invalid as error:
        failures.append(f"{label}: {humanize_error(data, error)}")
        print(f"FAIL {label}")
    else:
        print(f"ok   {label}")


config = load(app / "config.yaml")
check("homeassistant/rendezroute/config.yaml", SCHEMA_APP_CONFIG, config)

for translation in sorted((app / "translations").glob("*.y*ml")):
    check(
        f"homeassistant/rendezroute/translations/{translation.name}",
        SCHEMA_APP_TRANSLATIONS,
        load(translation),
    )

check("repository.yaml", SCHEMA_REPOSITORY_CONFIG, load(root / "repository.yaml"))

image = str(config.get("image", ""))
if image.rsplit("/", 1)[-1].count(":") > 0 or "@" in image:
    failures.append(f"image {image!r} has a tag or digest: the Supervisor appends the version")
    print("FAIL image has no tag")
else:
    print("ok   image has no tag")

# The defaults as the Supervisor would store them for a user who only filled in base_url.
try:
    options = AppOptions(None, config["schema"], "rendezroute", "rendezroute")
    options({**config["options"], "base_url": "https://runs.example.org"})
except Exception as error:  # the Supervisor raises its own types; any of them is a failure here
    failures.append(f"the option defaults do not satisfy the schema: {error}")
    print("FAIL option defaults satisfy the schema")
else:
    print("ok   option defaults satisfy the schema")

if failures:
    print("\nThe app folder does not pass the Supervisor's validation:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("\nThe app folder passes the Supervisor's validation.")
