// German UI strings (decisions D15, I31): informal "du", gender colon ("Teilnehmer:innen"),
// „…“ quotes. Core terms follow the glossary in I31: plan → Treffen, host → Organisator:in.
import type { Messages } from "./en.ts";

export const de: Messages = {
  "layout.poweredBy": "Betrieben mit {name}",
  "layout.devBanner":
    "Entwicklungsmodus: Unsichere Einstellungen sind aktiv. Nicht für den Produktivbetrieb.",
  "layout.privacy": "Datenschutz",
  "layout.imprint": "Impressum",
  "layout.language": "Sprache",
  "layout.change": "Ändern",
  "layout.units": "Einheiten",
  "units.metric": "Metrisch (km)",
  "units.imperial": "Imperial (Meilen)",

  "privacy.title": "Datenschutz",
  "privacy.intro":
    "{instance} nutzt RendezRoute, eine Open-Source-Software zum Planen von Läufen und Ausfahrten. Dieser Hinweis wird aus den Einstellungen dieser Website erzeugt und beschreibt, was die Software tut.",
  "privacy.contact": "Fragen zu deinen Daten:",
  "privacy.storedHeading": "Was gespeichert wird",
  "privacy.storedPlans":
    "Wenn du ein Treffen erstellst: dein Name, die Angaben zum Treffen und optional eine Route. Name, Titel, Notiz, Treffgebiet, Zeit, Distanz und Pace sieht jede Person mit dem Link. Den genauen Treffpunkt und die Route sehen nur du und alle, die zusagen; sie werden verschlüsselt gespeichert.",
  "privacy.storedResponses":
    "Wenn du antwortest: der Name, den du angibst, deine Antwort und die Sprache der Seite, für Nachrichten zum Treffen. Dein Name wird verschlüsselt gespeichert; die Organisator:in sieht ihn und, wenn du zusagst, auch die anderen Teilnehmer:innen. Wenn du um Teilnahme bittest, wird deine optionale Nachricht an die Organisator:in ebenfalls verschlüsselt gespeichert, nur ihr gezeigt und gelöscht, sobald sie entschieden hat.",
  "privacy.storedRecap":
    "Nach einem Treffen können Teilnehmer:innen und die Organisator:in Kommentare und Links zum Rückblick hinzufügen. Sie werden verschlüsselt gespeichert, nur Teilnehmer:innen und der Organisator:in gezeigt und mit dem Treffen gelöscht. Links werden als einfache Links gezeigt; es wird nichts von ihnen geladen.",
  "privacy.noTracking": "Es gibt keine Konten, keine Analyse und keine Werbung.",
  "privacy.durationHeading": "Wie lange",
  "privacy.retention":
    "Jedes Treffen wird mit allen Antworten, Namen und seiner Route an dem Datum gelöscht, das auf der Seite des Treffens steht: 1 bis {days} Tage nach dem Treffen, wie die Organisator:in es wählt. Die Organisator:in kann es früher löschen, und du kannst deine Antwort jederzeit zurückziehen. Gelöschte Daten werden in der Datenbank überschrieben.",
  "privacy.retentionLowered":
    "Treffen, die erstellt wurden, bevor dieses Maximum gesenkt wurde, können ihren längeren Zeitraum behalten, höchstens {max} Tage.",
  "privacy.devices":
    "Die Verknüpfung deines Browsers mit deinen Treffen oder Antworten wird {unlinkedDays} Tage nach der letzten Nutzung gelöscht, sobald nichts mehr damit verknüpft ist, und in jedem Fall nach {unusedDays} Tagen ohne Nutzung.",
  "privacy.backups":
    "Automatische Datenbanksicherungen vor Software-Updates werden nach {days} Tagen gelöscht.",
  "privacy.operatorHeading": "Wer auf die Daten zugreifen kann",
  "privacy.operator":
    "Wer diese Website betreibt, kann technisch auf alles zugreifen, was hier gespeichert ist, auch auf verschlüsselte Daten. Die Verschlüsselung schützt Daten in geleakten Datenbanksicherungen, wenn der Schlüssel getrennt aufbewahrt wird, aber nicht vor den Betreiber:innen.",
  "privacy.cookiesHeading": "Cookies",
  "privacy.cookieDevice":
    "Ein Geräte-Cookie, erst wenn du ein Treffen erstellst, antwortest oder einen privaten Link öffnest: ein Zufallswert, der diesen Browser damit verknüpft, {days} Tage lang gespeichert.",
  "privacy.cookieCsrf":
    "Ein Sitzungs-Cookie, das Formulare vor gefälschten Absendungen schützt. Browser löschen es beim Schließen, außer sie stellen deine letzte Sitzung wieder her.",
  "privacy.cookiePreferences":
    "Cookies für Sprache und Einheiten, nur wenn du unten auf einer Seite eine Sprache oder Einheiten wählst, {days} Tage lang gespeichert.",
  "privacy.cookieOthers": "Keine anderen Cookies und keine von anderen Websites.",
  "privacy.servicesHeading": "Andere Dienste",
  "privacy.tiles":
    "Karten lädt dein Browser direkt von {host}. Dieser Dienst sieht deine IP-Adresse und welchen Kartenausschnitt du ansiehst.",
  "privacy.tilesServer":
    "Für Vorschaubilder von Links lädt dieser Server außerdem Kartenbilder des ungefähren Treffgebiets; dabei wird nichts über dich übermittelt.",
  "privacy.geocoder":
    "Die Ortssuche läuft über diesen Server zu {host}. Dieser Dienst sieht, wonach du suchst, aber nicht, wer du bist. Suchanfragen und Ergebnisse bleiben bis zu {days} Tage im Arbeitsspeicher dieses Servers, damit wiederholte Suchen keine neue Anfrage brauchen.",
  "privacy.push":
    "Wenn du Benachrichtigungen einschaltest, stellt der Push-Dienst deines Browsers (von Google, Mozilla, Apple oder Microsoft) sie zu. Die Nachrichten sind verschlüsselt; der Dienst sieht nur, dass eine verschickt wurde. Dafür speichert dieser Server die Push-Adresse und die Schlüssel deines Browsers verschlüsselt und löscht sie, wenn du Benachrichtigungen ausschaltest, oder mit dem Treffen oder deiner Antwort.",
  "privacy.weather":
    "Für die Wettervorhersage auf den Seiten der Treffen fragt dieser Server bei {host} nach dem ungefähren Treffgebiet und der Startzeit. Über dich wird nichts gesendet. Vorhersagen bleiben bis zu {minutes} Minuten im Speicher dieses Servers.",
  "privacy.calendar":
    "Wenn du einen Kalender-Link erstellst, ruft der Server deiner Kalender-App ihn ab. Dieser Server sieht die öffentlichen Angaben deiner Treffen und dass du darauf geantwortet hast.",
  "privacy.location":
    "„Meinen Standort verwenden“ fragt deinen Browser nach deiner Position und füllt nur das Formular aus; gesendet wird sie erst, wenn du das Formular abschickst.",
  "privacy.locationMap":
    "Bei eingeschalteten Karten springt die Karte danach zu deiner Position, sodass dein Browser Kartenbilder dieser Gegend vom Kartendienst lädt.",
  "privacy.share": "WhatsApp und X werden nur kontaktiert, wenn du ihre Teilen-Links benutzt.",
  "privacy.previews":
    "Wird ein Link zu einem Treffen in einer Chat-App geteilt, ruft die App Titel, Zeit, Treffgebiet, Distanz, Pace und ein Vorschaubild ab. Chat-Apps können diese Vorschau auch nach dem Löschen des Treffens behalten.",
  "privacy.logsHeading": "Protokolle und Schutz vor Missbrauch",
  "privacy.logs":
    "Die Software protokolliert, welche Art von Seite aufgerufen wurde und ob es geklappt hat, nie Namen, private Links, genaue Orte oder IP-Adressen.",
  "privacy.rateLimits":
    "Zum Schutz vor Missbrauch zählt der Server Anfragen pro IP-Adresse (bei IPv6 pro Netz), nur im Arbeitsspeicher und höchstens etwa eine Stunde lang.",

  "home.intro":
    "Plane einen Lauf oder eine Ausfahrt, teile den Link und sieh, wer mitkommt. Kein Konto nötig.",
  "home.cta": "Lauf oder Ausfahrt planen",

  "error.csrf":
    "Dein Formular ist abgelaufen oder kam von einer anderen Website. Lade die Seite neu und versuche es noch einmal.",
  "error.internal": "Bei uns ist etwas schiefgelaufen. Bitte versuche es später noch einmal.",
  "error.tooLarge": "Diese Anfrage ist zu groß.",
  "error.busy": "Der Server ist ausgelastet. Bitte versuche es in ein paar Sekunden noch einmal.",
  "error.rateLimited":
    "Zu viele Anfragen aus deinem Netzwerk. Bitte versuche es in ein paar Minuten noch einmal.",
  "error.badRequest":
    "Das Formular konnte nicht verarbeitet werden. Bitte lade die Seite neu und versuche es noch einmal.",

  "activity.run": "Lauf",
  "activity.trail": "Traillauf",
  "activity.ride": "Rennradausfahrt",
  "activity.gravel": "Gravelausfahrt",
  "activity.mtb": "Mountainbike-Tour",

  "drop.no_drop": "No-Drop: Wir warten auf alle",
  "drop.drop": "Drop: Wer nicht mithält, macht allein weiter",

  "unit.minPerKm": "min/km",
  "unit.kmh": "km/h",
  "unit.km": "km",
  "unit.m": "m",

  "unit.minPerMi": "min/mi",
  "unit.mph": "mph",
  "unit.mi": "mi",
  "unit.ft": "ft",
  "unit.celsius": "°C",
  "unit.fahrenheit": "°F",

  "form.heading": "Lauf oder Ausfahrt planen",
  "form.errors": "Bitte prüfe die markierten Felder.",
  "form.posterName": "Dein Name",
  "form.posterNameHint": "Steht beim Treffen, gekennzeichnet als Organisator:in.",
  "form.activity": "Aktivität",
  "form.title": "Titel",
  "form.date": "Datum",
  "form.time": "Startzeit",
  "form.timeZone": "Zeitzone",
  "form.areaLabel": "Treffgebiet",
  "form.areaLabelHint": "Für alle sichtbar, zum Beispiel „Englischer Garten, Nordende“.",
  "form.publicHint":
    "Gib hier nicht den genauen Treffpunkt an, dieses Feld ist öffentlich. Dafür gibt es „Genauer Treffpunkt“.",
  "form.exactStart": "Genauer Treffpunkt (optional)",
  "form.exactStartHint": "Nur du und alle, die zusagen, sehen ihn.",
  "form.openModeWarning":
    "Alle mit dem Link, die zusagen, sehen den genauen Treffpunkt. Wähle „Nur, wen ich annehme“, um selbst zu entscheiden, wer ihn sieht.",
  "form.exactDescription": "Wo genau?",
  "form.coordinates": "Koordinaten (optional)",
  "form.latitude": "Breitengrad",
  "form.longitude": "Längengrad",
  "form.areaCoordinates": "Kartenpunkt des Treffgebiets (optional)",
  "form.areaCoordinatesHint":
    "Für alle sichtbar, auf etwa 1 km gerundet. Nicht nötig, wenn der genaue Treffpunkt Koordinaten hat.",
  "map.search": "Ort suchen",
  "map.searchButton": "Suchen",
  "map.searchHint":
    "Suchergebnisse und dein Standort legen das Treffgebiet fest; tippe auf die Karte für den genauen Treffpunkt. Suchanfragen laufen über diese Website, der Suchdienst erfährt also nicht, wer du bist.",
  "map.searchUnavailable": "Die Ortssuche ist gerade nicht verfügbar.",
  "map.noResults": "Keine Orte gefunden.",
  "map.locate": "Meinen Standort verwenden",
  "map.pickLegend": "Tippen auf die Karte setzt",
  "map.pickExact": "den genauen Treffpunkt",
  "map.pickArea": "das Treffgebiet",
  "map.pickLabel": "Karte zum Auswählen eines Punkts",
  "map.planLabel": "Karte des Treffgebiets",
  "map.zoomIn": "Vergrößern",
  "map.zoomOut": "Verkleinern",
  "form.distance": "Distanz ({unit}, optional)",
  "form.elevation": "Höhenmeter ({unit}, optional)",
  "form.pace": "Pace oder Tempo (optional)",
  "form.paceHint":
    "Läufe: Pace pro km, zum Beispiel 5:30 bis 6:00. Radfahrten: Tempo in km/h, zum Beispiel 25 bis 28.",
  "form.paceHintImperial":
    "Läufe: Pace pro Meile, zum Beispiel 9:00 bis 9:30. Radfahrten: Tempo in mph, zum Beispiel 15 bis 18.",
  "form.paceFrom": "Von",
  "form.paceTo": "Bis",
  "form.joinMode": "Wer mitkommen kann",
  "form.joinOpen": "Alle mit dem Link",
  "form.joinApproval": "Nur, wen ich annehme",
  "form.joinModeHint":
    "Bei „Nur, wen ich annehme“ schicken Leute eine Anfrage und sehen den genauen Treffpunkt erst, wenn du sie annimmst.",
  "form.dropPolicy": "Gruppenregel",
  "form.note": "Notiz (optional)",
  "form.colors": "Farben des Treffens",
  "form.primaryColor": "Hauptfarbe",
  "form.secondaryColor": "Akzentfarbe",
  "form.retention": "Treffen löschen",
  "form.retentionDays": {
    one: "{count} Tag nach dem Treffen",
    other: "{count} Tage nach dem Treffen",
  },
  "form.recapWindow": "Rückblick",
  "form.recapWindowNow": "Keine neuen Kommentare oder Links",
  "form.recapWindow1d": "1 Tag nach dem Start offen",
  "form.recapWindow1w": "1 Woche nach dem Start offen",
  "form.recapWindowShortened":
    "Der Rückblick wurde gekürzt, damit er in die Aufbewahrungszeit passt: {window}.",
  "form.recapWindowHint":
    "Nach dem Treffen können Teilnehmer:innen so lange Kommentare und Links hinzufügen. Das geht nicht länger, als das Treffen aufbewahrt wird; eine längere Wahl wird passend gekürzt.",
  "form.submit": "Treffen erstellen",
  "form.gpx": "Route (GPX-Datei, optional)",
  "form.gpxTrim": "Anfang und Ende der Route ausblenden",
  "form.gpxTrimHint":
    "Entfernt die Route rund um Start und Ende deiner Aufzeichnung, zum Beispiel deine Wohnung. Entfernte Teile werden nie gespeichert.",
  "form.gpxTrimOff": "Ganze Route zeigen",
  "form.gpxTrimMeters": "{meters} m an jedem Ende ausblenden",
  "form.gpxTrimKilometers": "{km} km an jedem Ende ausblenden",
  "form.gpxTrimMiles": "Etwa {miles} mi an jedem Ende ausblenden",
  "form.gpxHint":
    "Füllt Distanz, Höhenmeter und den genauen Treffpunkt aus. Nur wer zusagt, kann die Route sehen und herunterladen. Wenn das Formular einen Fehler zeigt, wähle die Datei noch einmal aus.",

  "field.invalid": "Dieser Wert ist ungültig.",
  "field.contribution_empty": "Schreib einen Kommentar oder füge einen Link hinzu.",
  "field.contribution_too_long": "Bitte höchstens {max} Zeichen.",
  "field.link_invalid": "Gib eine Webadresse ein, die mit https:// beginnt.",
  "field.link_too_long": "Dieser Link ist zu lang.",
  "field.required": "Bitte fülle dieses Feld aus.",
  "field.too_long": "Das ist zu lang.",
  "field.invalid_characters": "Das enthält nicht erlaubte Zeichen.",
  "field.choice_invalid": "Bitte wähle eine der Optionen.",
  "field.datetime_invalid": "Bitte gib ein gültiges Datum und eine gültige Uhrzeit ein.",
  "field.starts_invalid": "Bitte gib ein gültiges Datum und eine gültige Uhrzeit ein.",
  "field.starts_in_past": "Der Start muss in der Zukunft liegen.",
  "field.starts_beyond_horizon": "Der Start liegt zu weit in der Zukunft.",
  "field.timezone_invalid": "Bitte wähle eine Zeitzone aus der Liste.",
  "field.coordinates_invalid": "Bitte gib Breiten- und Längengrad als Dezimalgrad ein.",
  "field.exact_start_too_long": "Bitte bleib unter 200 Zeichen.",
  "field.exact_start_empty": "Bitte beschreibe den genauen Treffpunkt oder gib Koordinaten ein.",
  "field.number_invalid": "Bitte gib eine Zahl ein.",
  "field.out_of_range": "Diese Zahl liegt außerhalb des erlaubten Bereichs.",
  "field.pace_invalid": "Bitte gib die Pace als Minuten:Sekunden ein, zum Beispiel 5:30.",
  "field.speed_invalid": "Bitte gib das Tempo als ganze Zahl ein, zum Beispiel 25.",
  "field.pace_out_of_range": "Diese Pace oder dieses Tempo liegt außerhalb des erlaubten Bereichs.",
  "field.pace_band_reversed": "Der schnellere Wert muss zuerst kommen.",
  "field.color_invalid": "Bitte wähle eine Farbe.",
  "field.retention_out_of_range": "Bitte wähle einen der angebotenen Zeiträume.",
  "field.retention_shorter_than_recap_window": "Bitte wähle einen längeren Zeitraum.",
  "field.route_too_large": "Die Datei ist größer als 5 MB.",
  "field.route_unsafe":
    "Diese Datei kann nicht sicher gelesen werden. Bitte exportiere sie noch einmal als einfache GPX-Datei.",
  "field.route_unreadable": "Das sieht nicht nach einer GPX-Datei aus.",
  "field.route_empty": "Die Datei enthält keinen Track und keine Route.",
  "field.route_too_many_points": "Die Route hat mehr als 50.000 Punkte.",
  "field.route_invalid": "Die Datei enthält ungültige Koordinaten.",
  "field.route_too_long": "Die Route ist länger als 1.000 km.",
  "field.route_trimmed_away":
    "Ohne Anfang und Ende bliebe nichts von der Route übrig. Wähle eine kürzere Strecke.",
  "field.name_taken_by_host":
    "Diesen Namen verwendet die Organisator:in des Treffens. Bitte nimm einen anderen.",
  "field.name_taken_by_response": "Diesen Namen verwendet schon eine Person, die geantwortet hat.",

  "links.heading": "Dein Treffen ist bereit",
  "links.planLink": "Link zum Treffen: diesen teilen",
  "links.hostLink": "Dein Organisationslink: privat halten",
  "links.hostLinkWarning":
    "Speichere ihn jetzt. Er wird nur einmal angezeigt, und alle, die ihn haben, können dein Treffen verwalten. Dieser Browser bleibt als Organisator:in verknüpft.",
  "links.open": "Dein Treffen öffnen",
  "links.deletion": "Das Treffen und alles dazu wird am {date} gelöscht.",

  "plan.gone": "Dieses Treffen gibt es nicht mehr.",
  "plan.host": "Organisator:in",
  "plan.postedBy": "Eingestellt von {name}",
  "plan.youAreHost": "Du organisierst dieses Treffen.",
  "plan.when": "Wann",
  "preview.cancelled": "Abgesagt: {title}",
  "plan.timeZone": "Zeitzone {zone}",
  "plan.where": "Treffgebiet",
  "plan.distance": "Distanz",
  "plan.elevation": "Höhenmeter",
  "plan.pace": "Pace",
  "plan.speed": "Tempo",
  "plan.group": "Gruppe",
  "plan.exactStart": "Genauer Treffpunkt",
  "plan.exactStartPrivate": "Nur du und alle, die zusagen, sehen das.",
  "plan.openStreetMap": "In OpenStreetMap öffnen",
  "plan.openMapsApp": "In Karten-App öffnen",
  "plan.deletion": "Dieses Treffen wird am {date} gelöscht.",

  "plan.counts": "{participants} dabei · {interested} interessiert",
  "plan.pendingRequests": {
    one: "{count} Anfrage wartet auf dich.",
    other: "{count} Anfragen warten auf dich.",
  },
  "plan.participants": "Wer kommt",
  "plan.interestedPeople": "Interessiert",
  "plan.yourResponse": "Deine Antwort",
  "plan.manageResponse": "Ändern oder zurückziehen",
  "plan.cancelled": "Dieses Treffen wurde abgesagt.",

  "status.interested": "Interessiert",
  "status.joined": "Du bist dabei",
  "status.requested": "Anfrage ausstehend",
  "status.notAnswered":
    "Nicht beantwortet: Die Organisator:in hat vor dem Start nicht entschieden.",
  "status.rejected": "Für dieses Treffen nicht angenommen.",
  "status.removed": "Du wurdest aus diesem Treffen entfernt.",

  "respond.heading": "Kommst du mit?",
  "respond.name": "Dein Name",
  "respond.nameHint":
    "Die Organisator:in sieht ihn. Wenn du zusagst, sehen ihn auch die anderen Teilnehmer:innen.",
  "respond.openModeNote":
    "Alle mit dem Link, die zusagen, sehen den genauen Treffpunkt und wer sonst noch kommt.",
  "respond.interested": "Interessiert",
  "respond.join": "Ich bin dabei",
  "respond.request": "Anfrage senden",
  "respond.note": "Nachricht an die Organisator:in (optional)",
  "respond.noteHint": "Nur die Organisator:in sieht sie.",
  "respond.approvalNote":
    "Die Organisator:in entscheidet, wer mitkommt. Sobald du angenommen bist, siehst du den genauen Treffpunkt und wer sonst noch kommt.",
  "respond.closed": "Für dieses Treffen sind keine Antworten mehr möglich.",
  "respond.blocked": "Du kannst auf dieses Treffen nicht antworten.",

  "responded.heading": "Antwort gespeichert",
  "responded.manageLink": "Dein Verwaltungslink: privat halten",
  "responded.manageLinkWarning":
    "Speichere ihn jetzt. Er wird nur einmal angezeigt. Damit kannst du deine Antwort auch von einem anderen Gerät aus ändern oder zurückziehen. Dieser Browser bleibt verknüpft.",
  "responded.back": "Zurück zum Treffen",

  "manage.heading": "Deine Antwort auf „{title}“",
  "manage.choice": "Deine Antwort",
  "manage.save": "Änderungen speichern",
  "manage.locked":
    "Antworten sind jetzt geschlossen. Du kannst noch deinen Namen ändern oder deine Antwort zurückziehen.",
  "manage.withdraw": "Zurückziehen…",
  "manage.withdrawExplain": "Damit werden deine Antwort und dein Name aus diesem Treffen gelöscht.",
  "manage.withdrawConfirm": "Zurückziehen und meine Antwort löschen",
  "manage.back": "Zurück zum Treffen",

  "manageLink.heading": "Diesen Verwaltungslink auf diesem Gerät verwenden?",
  "manageLink.body":
    "Mit diesem Link kannst du deine Antwort auf „{title}“ ändern oder zurückziehen.",
  "manageLink.sharedWarning":
    "Mach nur auf deinem eigenen Gerät weiter: Alle, die diesen Browser nutzen, können danach deine Antwort ändern oder zurückziehen.",

  "share.heading": "Teilen",
  "share.native": "Teilen…",
  "share.copy": "Link kopieren",
  "share.copied": "Link kopiert.",
  "share.copyFailed": "Kopieren hat nicht geklappt. Bitte kopiere den Link aus der Adresszeile.",

  "plan.managePlan": "Treffen verwalten",
  "plan.route": "Route",
  "plan.downloadGpx": "GPX herunterladen",
  "plan.addToCalendar": "Zum Kalender hinzufügen",
  "plan.subscribeCalendar": "Alle deine Treffen im Kalender abonnieren",
  "plan.weather": "Wettervorhersage",

  "notify.accepted": "Du bist dabei. Der genaue Treffpunkt steht jetzt beim Treffen.",
  "notify.rejected": "Deine Anfrage für dieses Treffen wurde nicht angenommen.",
  "notify.removed": "Du wurdest aus diesem Treffen entfernt.",
  "notify.changed": "Das Treffen wurde geändert. Sieh dir die Details an.",
  "notify.cancelled": "Das Treffen wurde abgesagt.",
  "notify.deleted": "Die Organisator:in hat das Treffen gelöscht.",
  "notify.dayBefore": "Erinnerung: Das Treffen ist morgen.",
  "notify.startsToday": "Erinnerung: Das Treffen ist heute.",
  "notify.deletionReminder":
    "Dieses Treffen wird bald gelöscht. Sichere, was du behalten möchtest.",
  "notify.recapDeleted": "Die Organisator:in hat den Rückblick dieses Treffens gelöscht.",
  "notify.newResponse": "Jemand hat auf dein Treffen geantwortet.",
  "notify.newRequest": "Jemand möchte bei deinem Treffen mitmachen.",
  "notify.withdrawn": "Jemand hat die Antwort zurückgezogen.",

  "weather.clear": "Klar",
  "weather.mainlyClear": "Überwiegend klar",
  "weather.partlyCloudy": "Teilweise bewölkt",
  "weather.overcast": "Bedeckt",
  "weather.fog": "Nebel",
  "weather.drizzle": "Nieselregen",
  "weather.rain": "Regen",
  "weather.snow": "Schnee",
  "weather.rainShowers": "Regenschauer",
  "weather.snowShowers": "Schneeschauer",
  "weather.thunderstorm": "Gewitter",
  "weather.rainChance": "Regenwahrscheinlichkeit {percent}",
  "weather.wind": "Wind {speed}",
  "weather.hint": "Für die Startzeit, in der Nähe des Treffgebiets.",
  "weather.source": "Wetterdaten:",

  "recap.heading": "Rückblick",
  "recap.tookPlace": {
    one: "Dieses Treffen hat stattgefunden. {count} Person war dabei.",
    other: "Dieses Treffen hat stattgefunden. {count} Personen waren dabei.",
  },
  "recap.private": "Das sehen nur Leute, die bei diesem Treffen dabei waren.",
  "recap.openUntil": "Offen für Kommentare und Links bis {date}.",
  "recap.closed": "Geschlossen für neue Kommentare und Links.",
  "recap.empty": "Noch keine Kommentare oder Links.",
  "recap.add": "Zum Rückblick hinzufügen",
  "recap.body": "Kommentar",
  "recap.link": "Link",
  "recap.linkHint":
    "Zum Beispiel deine Aktivität oder Fotos. Wird als einfacher Link gezeigt, es wird nichts davon geladen.",
  "recap.submit": "Hinzufügen",
  "recap.edit": "Bearbeiten",
  "recap.delete": "Löschen",
  "recap.hide": "Ausblenden",
  "recap.show": "Wieder zeigen",
  "recap.hidden": "Von der Organisator:in ausgeblendet: Nur du und die Organisator:in seht das.",
  "recap.hiddenForHost": "Für Teilnehmer:innen ausgeblendet.",
  "recap.editHeading": "Kommentar bearbeiten",
  "recap.save": "Speichern",
  "recap.back": "Zurück zum Treffen",
  "recap.limit":
    "Du hast die Grenze von {count} Kommentaren und Links für dieses Treffen erreicht.",
  "recap.closedNow": "Der Rückblick ist für neue Kommentare und Links geschlossen.",

  "push.enable": "Benachrichtige mich zu diesem Treffen",
  "push.disable": "Benachrichtigungen ausschalten",
  "push.on": "Benachrichtigungen zu diesem Treffen sind in diesem Browser an.",
  "push.blocked": "Benachrichtigungen sind in den Einstellungen dieses Browsers blockiert.",
  "push.failed":
    "Benachrichtigungen konnten nicht eingeschaltet werden. Bitte versuche es noch einmal.",
  "push.hint":
    "Nur Neuigkeiten zu diesem Treffen: Änderungen, Absage, deine Anfrage und Erinnerungen.",
  "push.hostHint": "Neuigkeiten zu Antworten, Anfragen und zurückgezogenen Antworten.",

  "calendar.title": "Kalender-Abo",
  "calendar.intro":
    "Deine Kalender-App kann alle Treffen zeigen, die du in diesem Browser organisierst oder auf die du geantwortet hast. Sie aktualisiert sie selbst, wenn ein Treffen geändert, abgesagt oder gelöscht wird.",
  "calendar.contents":
    "Der Kalender enthält nur öffentliche Angaben: Titel, Zeit, Treffgebiet und den Link. Nie den genauen Treffpunkt, die Route oder Namen. Der Server deiner Kalender-App ruft ihn ab und sieht daher diese Angaben und dass du geantwortet hast.",
  "calendar.create": "Kalender-Link erstellen",
  "calendar.active": "Dieser Browser hat einen Kalender-Link.",
  "calendar.renew": "Neuen Link erstellen",
  "calendar.renewHint":
    "Der alte Link funktioniert dann nicht mehr. Nutze das, wenn du den Link verloren oder versehentlich geteilt hast.",
  "calendar.nothingYet":
    "Erstelle zuerst in diesem Browser ein Treffen oder antworte auf eins. Der Kalender-Link zeigt diese Treffen.",
  "calendar.stop": "Kalender-Link beenden",
  "calendar.linkHeading": "Dein Kalender-Link",
  "calendar.subscribe": "In deiner Kalender-App abonnieren",
  "calendar.copy": "Oder füge diese Adresse in deiner Kalender-App hinzu:",
  "calendar.linkWarning":
    "Dieser Link wird nur einmal angezeigt. Wer ihn hat, sieht die öffentlichen Angaben deiner Treffen. Halte ihn also privat.",
  "calendar.expiry":
    "Der Link funktioniert, solange du diese Seite ab und zu in diesem Browser öffnest. Aktualisierungen in deinem Kalender zählen nicht: Öffnest du die Seite in diesem Browser {days} Tage lang nicht, werden die Daten dieses Browsers gelöscht und der Link mit ihnen.",
  "calendar.yourPlan": "{title} (dein Treffen)",
  "calendar.cancelled": "Abgesagt: {title}",
  "calendar.deletionEntry": "„{title}“ wird heute gelöscht",
  "calendar.exactStart": "Genauer Treffpunkt: {start}",

  "host.route": "Route",
  "host.routeNone": "Noch keine Route.",
  "host.routePresent": "Dieses Treffen hat eine Route.",
  "host.routeUpload": "Route hochladen",
  "host.routeReplace": "Route ersetzen",
  "host.routeRemove": "Route entfernen",
  "host.routeHint": "Distanz und Höhenmeter werden aus der Route übernommen.",

  "host.heading": "Dein Treffen verwalten",
  "host.saved": "Änderungen gespeichert.",
  "host.save": "Änderungen speichern",
  "host.retentionOnly":
    "Das Treffen hat begonnen oder wurde abgesagt. Du kannst noch ändern, wann es gelöscht wird.",
  "host.deletesNowWarning": "Damit wird das Treffen sofort gelöscht.",
  "host.deleteNow": "Treffen jetzt löschen",
  "host.people": "Personen",
  "host.participants": "Dabei",
  "host.interested": "Interessiert",
  "host.removed": "Entfernt",
  "host.noPeople": "Bisher hat niemand geantwortet.",
  "host.remove": "Entfernen",
  "host.restore": "Entfernen rückgängig machen",
  "host.removeHint":
    "Entfernte Personen sehen den genauen Treffpunkt nicht mehr und können vom selben Gerät aus nicht erneut antworten.",
  "host.requests": "Anfragen",
  "host.accept": "Annehmen",
  "host.reject": "Ablehnen",
  "host.rejected": "Nicht angenommen",
  "host.undoReject": "Ablehnung rückgängig machen",
  "host.acceptPendingWarning": {
    one: "{count} offene Anfrage wird angenommen.",
    other: "{count} offene Anfragen werden angenommen.",
  },
  "host.acceptPendingConfirm": "Speichern und annehmen",
  "host.cancel": "Treffen absagen…",
  "host.cancelExplain":
    "Eine Absage ist endgültig. Das Treffen bleibt mit dem Hinweis „abgesagt“ sichtbar, bis es gelöscht wird. Wenn es doch stattfindet, erstelle ein neues Treffen.",
  "host.cancelConfirm": "Dieses Treffen absagen",
  "host.delete": "Treffen löschen…",
  "host.recap": "Rückblick",
  "host.recapWindowHint":
    "Nach dem Start zählt eine Änderung ab jetzt. Vorhandene Kommentare und Links bleiben.",
  "host.recapDelete": "Rückblick löschen",
  "host.recapDeleteExplain": {
    one: "Damit wird der {count} Kommentar oder Link im Rückblick für alle gelöscht. Teilnehmer:innen mit eingeschalteten Benachrichtigungen erfahren es.",
    other:
      "Damit werden alle {count} Kommentare und Links im Rückblick für alle gelöscht. Teilnehmer:innen mit eingeschalteten Benachrichtigungen erfahren es.",
  },
  "host.recapDeleteConfirm": "Rückblick löschen",
  "host.deleteHeading": "„{title}“ löschen?",
  "host.deleteExplain": {
    zero: "Damit werden das Treffen und sein genauer Treffpunkt sofort und endgültig gelöscht. Das lässt sich nicht rückgängig machen.",
    one: "Damit werden das Treffen, sein genauer Treffpunkt und {count} Antwort mit Namen sofort und endgültig gelöscht. Das lässt sich nicht rückgängig machen.",
    other:
      "Damit werden das Treffen, sein genauer Treffpunkt und alle {count} Antworten mit Namen sofort und endgültig gelöscht. Das lässt sich nicht rückgängig machen.",
  },
  "host.deleteConfirm": "Endgültig löschen",
  "host.back": "Zurück zum Treffen",

  "hostLink.heading": "Diesen Organisationslink auf diesem Gerät verwenden?",
  "hostLink.ogTitle": "Privater Link",
  "hostLink.ogDescription": "Das ist ein privater Link. Bitte teile ihn nicht.",
  "hostLink.body": "Mit diesem Link kannst du „{title}“ verwalten.",
  "hostLink.sharedWarning":
    "Mach nur auf deinem eigenen Gerät weiter: Alle, die diesen Browser nutzen, können danach das Treffen verwalten.",
  "hostLink.confirm": "Auf diesem Gerät verwenden",
  "hostLink.invalid": "Dieser Link ist ungültig. Vielleicht wurde er durch einen neueren ersetzt.",
  "secretLink.confirm": "Auf diesem Gerät verwenden",
  "form.template": "Später wiederholen",
  "form.keepAsTemplate": "Als wiederholbare Vorlage behalten",
  "form.templateIncludePrivate": "Genauen Treffpunkt und Route einschließen",
  "form.templateHint":
    "Wenn das Treffen gelöscht wird, bleiben seine Angaben 90 Tage lang als Vorlage, verknüpft mit den Geräten, auf denen du es organisierst, damit du es an einem neuen Datum wiederholen kannst. Antworten, Namen der Teilnehmer:innen und der Rückblick werden nie behalten.",
  "home.templates": "Deine Vorlagen",
  "host.deleteKeepsTemplate":
    "Seine Angaben bleiben als wiederholbare Vorlage, verknüpft mit den Geräten, auf denen du es organisierst.",
  "host.saveTemplate": "Als Vorlage speichern",
  "host.saveTemplateExplain":
    "Speichert die Angaben dieses Treffens als Vorlage mit eigenem privatem Link, damit du es an einem neuen Datum wiederholen kannst. Antworten, Namen und der Rückblick sind nicht enthalten.",
  "host.saveTemplateConfirm": "Vorlage speichern",
  "template.label": "Vorlage",
  "template.startTime": "Beginnt um {time} ({zone})",
  "template.includesExactStart": "Mit genauem Treffpunkt",
  "template.includesRoute": "Mit Route",
  "template.expires":
    "Wird am {date} gelöscht, wenn du sie bis dahin nicht wiederholst oder bearbeitest.",
  "template.repeatHeading": "Wiederholen",
  "template.repeatHint":
    "Erstellt aus dieser Vorlage ein neues Treffen mit neuen Links und ohne Antworten.",
  "template.repeatSubmit": "Treffen erstellen",
  "template.edit": "Vorlage bearbeiten",
  "template.editHeading": "Vorlage bearbeiten",
  "template.back": "Zurück zur Vorlage",
  "template.save": "Vorlage speichern",
  "template.saved": "Vorlage gespeichert.",
  "template.removeRoute": "Route entfernen",
  "template.delete": "Vorlage löschen",
  "template.deleteExplain":
    "Damit werden die Vorlage und ihr Link endgültig gelöscht. Treffen, die daraus erstellt wurden, bleiben.",
  "template.deleteConfirm": "Vorlage endgültig löschen",
  "template.gone": "Diese Vorlage gibt es nicht, oder dieses Gerät ist nicht mit ihr verknüpft.",
  "template.needsEdit":
    "Einige Einstellungen passen nicht mehr zu den Regeln dieser Seite. Bitte ändere sie und wiederhole die Vorlage dann.",
  "template.adjusted":
    "Einige Einstellungen wurden an die aktuellen Regeln dieser Seite angepasst:",
  "template.adjustedRetention": {
    one: "Wird {count} Tag nach dem Treffen gelöscht statt nach {from} Tagen.",
    other: "Wird {count} Tage nach dem Treffen gelöscht statt nach {from} Tagen.",
  },
  "template.adjustedRecapWindow": "Rückblick: „{to}“ statt „{from}“.",
  "template.savedHeading": "Vorlage gespeichert",
  "template.savedBody":
    "„{title}“ ist als Vorlage gespeichert. Du kannst es an einem neuen Datum wiederholen.",
  "template.link": "Dein Vorlagenlink: privat halten",
  "template.linkWarning":
    "Speichere ihn jetzt. Er wird nur einmal angezeigt, und alle, die ihn haben, können die Vorlage wiederholen, ändern oder löschen. Dieser Browser bleibt mit ihr verknüpft.",
  "template.open": "Vorlage öffnen",
  "templateLink.heading": "Diesen Vorlagenlink auf diesem Gerät verwenden?",
  "templateLink.body":
    "Mit diesem Link kannst du die Vorlage „{title}“ wiederholen, ändern oder löschen.",
  "templateLink.sharedWarning":
    "Mach nur auf deinem eigenen Gerät weiter: Alle, die diesen Browser nutzen, können danach die Vorlage verwenden.",
  "privacy.myData":
    "Alles, was mit deinem Browser verknüpft ist, kannst du jederzeit selbst ansehen, exportieren und löschen:",
  "privacy.templates":
    "Wenn die Organisator:in „Als wiederholbare Vorlage behalten“ wählt oder eine Vorlage speichert, werden die Angaben des Treffens samt ihrem Namen als Vorlage behalten; nie seine Antworten, die Namen der Teilnehmer:innen oder der Rückblick. Genauer Treffpunkt und Route werden nur behalten, wenn die Organisator:in sie einschließt, und dann verschlüsselt. Eine Vorlage wird gelöscht, wenn sie 90 Tage lang weder wiederholt noch bearbeitet wurde.",
  "linkTools.heading": "Privater Link",
  "linkTools.explain":
    "Link verloren, oder hat ihn vielleicht jemand anderes? Ein neuer Link ersetzt den alten, und Geräte, die ihn schon nutzen, bleiben angemeldet.",
  "linkTools.newLink": "Neuen Link erstellen",
  "linkTools.signOut": "Alle anderen Geräte abmelden",
  "linkTools.signOutExplain":
    "Alle anderen Geräte, die diesen Link nutzen, verlieren den Zugang; dieses Gerät behält ihn. Wenn der Link in falsche Hände geraten ist, erstelle auch einen neuen.",
  "linkTools.signOutNotifications":
    "Benachrichtigungen werden auf allen Geräten ausgeschaltet, auch auf diesem; du kannst sie hier wieder einschalten.",
  "linkTools.signOutConfirm": "Andere Geräte abmelden",
  "linkTools.signedOut": {
    zero: "Es war kein anderes Gerät angemeldet.",
    one: "{count} anderes Gerät wurde abgemeldet.",
    other: "{count} andere Geräte wurden abgemeldet.",
  },
  "linkTools.newHeading": "Dein neuer Link",
  "linkTools.oldLinkStopped": "Der alte Link funktioniert nicht mehr.",
  "linkTools.alreadyIssued":
    "Dieser Link wurde schon angezeigt, daher hat sich nichts geändert. Wenn du ihn nicht gespeichert hast, erstelle einen neuen.",
  "linkTools.back": "Zurück",
  "layout.myData": "Meine Daten",
  "export.plan": "Dieses Treffen exportieren (ZIP)",
  "export.template": "Diese Vorlage exportieren (ZIP)",
  "export.response": "Meine Antwort exportieren (ZIP)",
  "export.recapHeading": "Deine Beiträge zum Rückblick: {title}",
  "export.hiddenByHost": "Von der Organisator:in ausgeblendet",
  "myData.heading": "Meine Daten auf diesem Gerät",
  "myData.intro":
    "Alles, womit dieser Browser verknüpft ist. Du kannst Benachrichtigungen ein- und ausschalten, einen privaten Link ersetzen, andere Geräte abmelden und alles exportieren oder löschen.",
  "myData.empty": "Mit diesem Gerät ist nichts verknüpft.",
  "myData.hosted": "Treffen, die du organisierst",
  "myData.responses": "Deine Antworten",
  "myData.templates": "Deine Vorlagen",
  "myData.cancelled": "abgesagt",
  "myData.export": "Exportieren (ZIP)",
  "myData.calendar": "Kalender-Abo",
  "myData.calendarOn": "Dieses Gerät hat ein Kalender-Abo.",
  "myData.calendarOff": "Dieses Gerät hat kein Kalender-Abo.",
  "myData.calendarManage": "Kalender-Abo verwalten",
  "myData.exportHeading": "Exportieren oder löschen",
  "myData.exportHint":
    "Der Export ist eine ZIP-Datei mit deinen Treffen, Antworten und Vorlagen: die Angaben als data.json, Kalenderdateien, Routen als GPX und deine eigenen Beiträge zum Rückblick. Andere Personen erscheinen nur mit ihrem Namen.",
  "myData.exportAll": "Alles exportieren (ZIP)",
  "myData.delete": "Meine Daten löschen",
  "myData.deleteHeading": "Alles auf diesem Gerät löschen?",
  "myData.deleteExplain": "Damit wird sofort und endgültig gelöscht:",
  "myData.deletePlans": {
    one: "{count} Treffen, das du organisierst, für alle; wer bei einem bevorstehenden Treffen dabei ist, wird informiert",
    other:
      "{count} Treffen, die du organisierst, für alle; wer bei einem bevorstehenden Treffen dabei ist, wird informiert",
  },
  "myData.deleteResponses": {
    one: "{count} Antwort, als hättest du sie zurückgezogen",
    other: "{count} Antworten, als hättest du sie zurückgezogen",
  },
  "myData.deleteTemplates": { one: "{count} Vorlage", other: "{count} Vorlagen" },
  "myData.deleteFeed": "das Kalender-Abo",
  "myData.deleteDevice": "die Verknüpfung dieses Browsers mit allem",
  "myData.deleteNoTemplates": "Von den gelöschten Treffen werden keine Vorlagen behalten.",
  "myData.deleteConfirm": "Alles endgültig löschen",
  "myData.back": "Zurück zu meinen Daten",
  "myData.deleted": "Deine Daten auf diesem Gerät wurden gelöscht.",
};
