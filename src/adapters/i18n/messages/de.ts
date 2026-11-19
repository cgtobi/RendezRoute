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
  "layout.done": "Fertig",
  "form.where": "Wo",
  "form.hostingAs": "Du organisierst als {name}",
  "fold.exact": "Genauer Treffpunkt",
  "fold.exactNone": "Optional · nur Leute, die du annimmst, sehen ihn",
  "fold.exactNoneOpen": "Optional · alle, die zusagen, sehen ihn",
  "fold.exactSetOpen": "Festgelegt · alle, die zusagen, sehen ihn",
  "fold.exactSet": "Festgelegt · nur Leute, die du annimmst, sehen ihn",
  "fold.route": "Strecke, Tempo und Notiz",
  "fold.routeNone": "Keine Strecke",
  "fold.routeSet": "Strecke hinzugefügt",
  "fold.routeUnset": "Distanz und Tempo nicht angegeben",
  "fold.noteAdded": "Notiz hinzugefügt",
  "fold.noteNone": "keine Notiz",
  "fold.who": "Wer teilnehmen und es finden kann",
  "fold.joinAnyone": "alle mit dem Link",
  "fold.joinApproval": "nach deiner Freigabe",
  "fold.findLink": "nur per Link",
  "fold.findFollowers": "Follower",
  "fold.whoSummary": "Teilnehmen: {join} · Finden: {find}",
  "fold.whoPublic": "Öffentlich · Teilnehmen: {join} · Finden: alle",
  "fold.look": "Aussehen und Teilen",
  "fold.lookSummary": "Teilen-Buttons {buttons} · Farben {colors}",
  "fold.on": "an",
  "fold.off": "aus",
  "fold.colorsDefault": "Standard",
  "fold.colorsCustom": "eigene",
  "fold.after": "Nach dem Lauf",
  "fold.afterSummary": "Löschen nach {days} · {recap}",
  "fold.days": { one: "{count} Tag", other: "{count} Tagen" },
  "fold.recapDays": { one: "Rückblick {count} Tag", other: "Rückblick {count} Tage" },
  "fold.recapNone": "kein Rückblick",
  "layout.menu": "Menü",
  "layout.units": "Einheiten",
  "layout.theme": "Darstellung",
  "units.metric": "Metrisch (km)",
  "units.imperial": "Imperial (Meilen)",
  "theme.system": "System",
  "theme.light": "Hell",
  "theme.dark": "Dunkel",
  "layout.palette": "Stil",
  "palette.site": "Standard der Instanz",
  "palette.siteNamed": "Standard der Instanz ({palette})",
  "palette.default": "Standard",
  "palette.mono": "Mono",
  "palette.bold": "Bold",

  "privacy.title": "Datenschutz",
  "privacy.intro":
    "{instance} nutzt RendezRoute, eine Open-Source-Software zum Planen von Läufen, Ausfahrten und Wanderungen. Dieser Hinweis wird aus den Einstellungen dieser Website erzeugt und beschreibt, was die Software tut.",
  "privacy.contact": "Fragen zu deinen Daten:",
  "privacy.storedHeading": "Was gespeichert wird",
  "privacy.storedPlans":
    "Wenn du ein Treffen erstellst: dein Name, die Angaben zum Treffen und optional eine Route. Name, Titel, Notiz, Gebiet, Zeit, Distanz und Pace sieht jede Person mit dem Link. Den genauen Treffpunkt und die Route sehen nur du und alle, die zusagen; sie werden verschlüsselt gespeichert.",
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
    "Die Verknüpfung deines Browsers mit deinen Treffen oder Antworten wird {unlinkedDays} Tage nach der letzten Nutzung gelöscht, sobald nichts mehr damit verknüpft ist, und in jedem Fall nach {unusedDays} Tagen ohne Nutzung. Der Name deines letzten Treffens oder deiner letzten Vorlage füllt das Formular auf diesem Gerät wieder aus; dafür wird nichts weiter gespeichert.",
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
    "Cookies für Sprache, Einheiten, Darstellung (hell oder dunkel) und Stil (Farbpalette), nur wenn du im Menü eine Sprache, Einheiten, eine Darstellung oder einen Stil wählst, {days} Tage lang gespeichert.",
  "privacy.cookieAdmin":
    "Die Administration erhält nach der Anmeldung ein eigenes Login-Cookie, das {hours} Stunden gilt. Besucher:innen erhalten es nie.",
  "privacy.cookieOthers": "Keine anderen Cookies und keine von anderen Websites.",
  "privacy.servicesHeading": "Andere Dienste",
  "privacy.tiles":
    "Karten lädt dein Browser direkt von {host}. Dieser Dienst sieht deine IP-Adresse und welchen Kartenausschnitt du ansiehst.",
  "privacy.tilesServer":
    "Für Vorschaubilder von Links lädt dieser Server außerdem Kartenbilder des ungefähren Gebiets; dabei wird nichts über dich übermittelt.",
  "privacy.geocoder":
    "Die Ortssuche läuft über diesen Server zu {host}. Dieser Dienst sieht, wonach du suchst, aber nicht, wer du bist. Wenn du einen Ort auf der Karte wählst und das Gebiet leer ist oder noch den früheren Vorschlag enthält, wird der gerundete Punkt dieses Ortes (etwa 1 km) auf dem gleichen Weg an den Dienst geschickt, um einen Namen vorzuschlagen. Wenn du auf der Karte einen genauen Treffpunkt setzt und dessen Beschreibung leer ist oder noch den früheren Vorschlag enthält, wird dieser genaue Punkt ebenfalls über diesen Server an den Dienst geschickt, um eine Beschreibung wie eine Straße oder einen benannten Ort vorzuschlagen; der Dienst erfährt nicht, wer du bist. Suchanfragen und die Gebietsnamen bleiben bis zu {days} Tage im Arbeitsspeicher dieses Servers, damit Wiederholungen keine neue Anfrage brauchen; Anfragen mit genauen Punkten werden nicht im Arbeitsspeicher dieses Servers gehalten.",
  "privacy.push":
    "Wenn du Benachrichtigungen einschaltest, stellt der Push-Dienst deines Browsers (von Google, Mozilla, Apple oder Microsoft) sie zu. Die Nachrichten sind verschlüsselt; der Dienst sieht nur, dass eine verschickt wurde. Dafür speichert dieser Server die Push-Adresse und die Schlüssel deines Browsers verschlüsselt und löscht sie, wenn du Benachrichtigungen ausschaltest, oder mit dem Treffen oder deiner Antwort.",
  "privacy.weather":
    "Für die Wettervorhersage auf den Seiten der Treffen fragt dieser Server bei {host} nach dem ungefähren Gebiet und der Startzeit. Über dich wird nichts gesendet. Vorhersagen bleiben bis zu {minutes} Minuten im Speicher dieses Servers.",
  "privacy.calendar":
    "Wenn du einen Kalender-Link erstellst, ruft der Server deiner Kalender-App ihn ab. Dieser Server sieht die öffentlichen Angaben deiner Treffen und dass du darauf geantwortet hast.",
  "privacy.location":
    "„Meinen Standort finden“ auf der Karte fragt deinen Browser nach deiner Position, nur um die Karte zu verschieben; sie wird nicht an diesen Server gesendet, und es wird nichts ausgefüllt. „Zeigen, wo ich bin“ auf der Vollbildkarte eines Treffens zeigt deine Position nur auf deiner Karte; sie wird nicht an diesen Server gesendet und nicht gespeichert.",
  "privacy.locationMap":
    "Die Karte zeigt dann deine Gegend, sodass dein Browser Kartenbilder dieser Gegend vom Kartendienst lädt.",
  "privacy.share": "WhatsApp wird nur kontaktiert, wenn du den Teilen-Link benutzt.",
  "privacy.previews":
    "Wird ein Link zu einem Treffen in einer Chat-App geteilt, ruft die App Titel, Zeit, Gebiet, Distanz, Pace und ein Vorschaubild ab. Chat-Apps können diese Vorschau auch nach dem Löschen des Treffens behalten.",
  "privacy.logsHeading": "Protokolle und Schutz vor Missbrauch",
  "privacy.logs":
    "Die Software protokolliert, welche Art von Seite aufgerufen wurde und ob es geklappt hat, nie Namen, private Links, genaue Orte oder IP-Adressen.",
  "privacy.rateLimits":
    "Zum Schutz vor Missbrauch zählt der Server Anfragen pro IP-Adresse (bei IPv6 pro Netz), nur im Arbeitsspeicher und höchstens etwa eine Stunde lang.",

  "home.intro":
    "Plane einen Lauf, eine Ausfahrt oder eine Wanderung, teile den Link und sieh, wer mitkommt. Kein Konto nötig.",
  "home.cta": "Lauf, Ausfahrt oder Wanderung planen",

  "error.csrf":
    "Dein Formular ist abgelaufen oder kam von einer anderen Website. Lade die Seite neu und versuche es noch einmal.",
  "error.internal": "Bei uns ist etwas schiefgelaufen. Bitte versuche es später noch einmal.",
  "error.tooLarge": "Diese Anfrage ist zu groß.",
  "error.busy": "Der Server ist ausgelastet. Bitte versuche es in ein paar Sekunden noch einmal.",
  "error.rateLimited":
    "Zu viele Anfragen aus deinem Netzwerk. Bitte versuche es in ein paar Minuten noch einmal.",
  "error.notFound": "Diese Seite gibt es nicht.",
  "error.forbidden": "Du hast keinen Zugriff auf diese Seite.",
  "error.badRequest":
    "Das Formular konnte nicht verarbeitet werden. Bitte lade die Seite neu und versuche es noch einmal.",

  "activity.run": "Lauf",
  "activity.trail": "Traillauf",
  "activity.hike": "Wanderung",
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

  "form.heading": "Lauf, Ausfahrt oder Wanderung planen",
  "form.errors": "Bitte prüfe die markierten Felder.",
  "form.posterName": "Dein Name",
  "form.posterNameHint": "Steht beim Treffen, gekennzeichnet als Organisator:in.",
  "form.activity": "Aktivität",
  "form.title": "Titel",
  "form.defaultTitle": "Mein Treffen",
  "form.date": "Datum",
  "form.time": "Startzeit",
  "form.timeZone": "Zeitzone",
  "form.timeZoneLine": "Zeitzone:",
  "form.areaLabel": "Gebiet",
  "form.areaLabelHint": "Für alle sichtbar.",
  "form.areaLabelSuggested": "Vorschlag von der Karte. Ändere ihn, wenn du magst.",
  "form.publicHint":
    "Gib hier nicht den genauen Treffpunkt an, dieses Feld ist öffentlich. Dafür gibt es „Genauer Treffpunkt“.",
  "form.openModeWarning":
    "Alle mit dem Link, die zusagen, sehen den genauen Treffpunkt. Wähle „Nur, wen ich annehme“, um selbst zu entscheiden, wer ihn sieht.",
  "form.exactDescription": "Beschreibung des Treffpunkts",
  "form.exactDescriptionSuggested": "Vorschlag vom Kartenpunkt. Ändere ihn, wenn du magst.",
  "form.latitude": "Breitengrad",
  "form.longitude": "Längengrad",
  "form.areaCoordinates": "Kartenpunkt des Gebiets (optional)",
  "form.areaCoordinatesHint":
    "Für alle sichtbar, auf etwa 1 km gerundet. Nicht nötig, wenn der genaue Treffpunkt Koordinaten hat.",
  "map.searchButton": "Suchen",
  "map.searchHint":
    "Drücke Enter oder tippe auf die Lupe, um einen Ort zu finden; der gewählte legt das Gebiet fest.",
  "map.searchUnavailable": "Die Ortssuche ist gerade nicht verfügbar.",
  "map.noResults": "Keine Orte gefunden.",
  "map.findMe": "Meinen Standort finden",
  "map.pickLegend": "Tippen auf die Karte setzt",
  "map.modeArea": "Öffentliches Gebiet",
  "map.modeExact": "Genauer Start",
  "map.captionArea":
    "Tippe auf die Karte, um das öffentliche Gebiet (etwa 1 km) zu setzen. Alle sehen es.",
  "map.captionExact":
    "Tippe auf die Karte, um den genauen Start zu setzen. Nur wer teilnimmt, sieht ihn.",
  "map.captionAreaFollows":
    "Das öffentliche Gebiet folgt dem genauen Start (etwa 1 km darum). Entferne den genauen Punkt, um ein anderes Gebiet zu wählen.",
  "map.locateDenied": "Der Standortzugriff wurde verweigert",
  "map.locateUnavailable": "Deine Position ist nicht verfügbar",
  "map.areaSet": "Öffentliches Gebiet auf der Karte gesetzt",
  "map.areaNone": "Kein öffentliches Gebiet auf der Karte gesetzt",
  "map.areaRemove": "Entfernen",
  "map.exactSet": "Punkt auf der Karte gesetzt",
  "map.exactNone": "Kein Punkt auf der Karte gesetzt",
  "map.exactRemove": "Entfernen",
  "map.pickLabel": "Karte zum Auswählen eines Punkts",
  "map.planLabel": "Karte des Gebiets",
  "map.zoomIn": "Vergrößern",
  "map.zoomOut": "Verkleinern",
  "map.fullOpen": "Karte im Vollbild zeigen",
  "map.fullClose": "Vollbildkarte schließen",
  "map.showMe": "Zeigen, wo ich bin",
  "map.showMeDone": "Deine Position wird auf der Karte angezeigt.",
  "map.legend": "Legende",
  "map.fullLabel": "Vollbildkarte",
  "map.fullExactSet": "Genauer Start gesetzt",
  "map.fullAreaSet": "Öffentliches Gebiet gesetzt",
  "map.fullNone": "Noch kein Punkt gesetzt",
  "map.removePoint": "Punkt entfernen",
  "form.distance": "Distanz ({unit}, optional)",
  "form.elevation": "Höhenmeter ({unit}, optional)",
  "form.pace": "Pace oder Tempo (optional)",
  "form.paceHint":
    "Läufe: Pace pro km, zum Beispiel 5:30 bis 6:00. Wanderungen: zum Beispiel 12:00 bis 13:00. Radfahrten: Tempo in km/h, zum Beispiel 25 bis 28.",
  "form.paceHintImperial":
    "Läufe: Pace pro Meile, zum Beispiel 9:00 bis 9:30. Wanderungen: zum Beispiel 19:15 bis 21:00. Radfahrten: Tempo in mph, zum Beispiel 15 bis 18.",
  "form.paceFrom": "Von",
  "form.paceTo": "Bis",
  "form.shareButtons": "Teilen-Knöpfe auf der Seite des Treffens",
  "form.shareCopy": "Link kopieren",
  "form.shareNative": "Teilen-Menü des Geräts (auf Handys)",
  "form.shareWhatsApp": "WhatsApp",
  "form.shareButtonsHint":
    "Geteilt wird nur der Link zum Treffen. Wo das Gerät ein Teilen-Menü hat, ersetzt es den WhatsApp-Knopf.",
  "form.visibility": "Wer das Treffen finden kann",
  "form.visibilityLink": "Nur, wer den Link hat",
  "form.visibilityPublic": "Alle: gelistet unter „In der Nähe“ auf dieser Seite",
  "form.visibilityPublicHint":
    "Ein öffentliches Treffen können alle finden und sehen dann, was die Seite des Treffens allen zeigt: Titel, Name der Organisator:in, Datum und Uhrzeit, Gebiet, Aktivität, Distanz, Tempo und Notiz. Der genaue Treffpunkt, die Route und die Namen derer, die antworten, bleiben verborgen wie bei jedem Treffen.",
  "form.publicNeedsLogin": "Öffentliche Treffen brauchen ein Konto auf dieser Seite.",
  "form.publicLogIn": "Anmelden",
  "field.public_needs_login":
    "Öffentliche Treffen brauchen ein Konto auf dieser Seite: Melde dich an oder lass das Treffen bei denen mit dem Link.",
  "form.visibilityFollowers":
    "Follower:innen von {handle} im Fediverse (folgen kann dort jede:r) und alle mit dem Link",
  "form.visibilityFollowersNone":
    "Follower:innen im Fediverse (folgen kann dort jede:r) und alle mit dem Link",
  "form.visibilityPublicShared":
    "Alle: gelistet unter „In der Nähe“ auf dieser Seite und im Fediverse geteilt von {handle}",
  "form.visibilityPublicProfile": "Alle: im Fediverse geteilt von {handle}",
  "form.followersNeedsProfile":
    "Für Follower:innen brauchst du ein Fediverse-Profil, einmal eingerichtet auf der Kontoseite.",
  "form.followersSetUp": "Einrichten",
  "form.followersLogInSetUp": "Anmelden und Profil einrichten",
  "form.fediverseShared":
    "Dieses Treffen ist im Fediverse geteilt. Machst du es für weniger Leute auffindbar, wird es dort dauerhaft entfernt und nicht wieder geteilt; deine Follower:innen erreichen es dann nur noch über seinen Link.",
  "form.fediverseWithdrawn":
    "Dieses Treffen wurde aus dem Fediverse entfernt und wird dort nicht wieder geteilt.",
  "field.followers_needs_profile":
    "Für Follower:innen brauchst du dein Fediverse-Profil: Richte es auf der Kontoseite ein oder wähle eine andere Möglichkeit.",
  "field.handle_invalid": "Bitte nimm 1 bis 30 Kleinbuchstaben, Ziffern oder _.",
  "field.handle_reserved":
    "Dieser Name ist für die Seite selbst reserviert. Bitte wähle einen anderen.",
  "field.handle_taken":
    "Dieser Name ist vergeben oder war schon einmal in Gebrauch. Bitte wähle einen anderen.",
  "profile.heading": "Fediverse-Profil",
  "profile.intro":
    "Mit einem Profil finden dich Leute im Fediverse (zum Beispiel auf Mastodon) als @name@{host}, können dir folgen und sehen deine kommenden öffentlichen Treffen.",
  "profile.notice":
    "Wenn du es einschaltest, bist du im Fediverse auffindbar: Alle dort sehen deinen Anzeigenamen und deine kommenden öffentlichen Treffen, und ihre Server können Kopien behalten. Alle dort können dir ohne Nachfrage folgen, und Treffen für deine Follower:innen erreichen alle, die es tun. Der Name gehört dir dauerhaft: Er lässt sich nicht ändern, und sobald du das Profil ausschaltest, wird er stillgelegt und kann von niemandem mehr verwendet werden.",
  "profile.handle": "Dein Name im Fediverse",
  "profile.handleHint": "Kleinbuchstaben, Ziffern und _, bis zu 30.",
  "profile.turnOn": "Mein Fediverse-Profil einschalten",
  "profile.on": "Dein Fediverse-Profil ist {handle}.",
  "profile.view": "Ansehen",
  "profile.turnOff": "Mein Fediverse-Profil ausschalten…",
  "profile.turnOffExplain":
    "Beim Ausschalten wird {handle} dauerhaft stillgelegt: Niemand kann den Namen wieder verwenden, auch du nicht. Treffen für deine Follower:innen werden zu Treffen für alle mit dem Link, und deine Follower:innen erfahren, dass das Profil weg ist.",
  "profile.turnOffConfirm": "{handle} ausschalten und stilllegen",
  "profile.turnedOn": "Dein Fediverse-Profil ist eingeschaltet.",
  "profile.followers": {
    one: "1 Person im Fediverse folgt dir.",
    other: "{count} Personen im Fediverse folgen dir.",
  },
  "profile.turnedOff": {
    one: "Dein Fediverse-Profil ist ausgeschaltet. 1 Treffen für Follower:innen ist jetzt für alle mit dem Link.",
    other:
      "Dein Fediverse-Profil ist ausgeschaltet. {count} Treffen für Follower:innen sind jetzt für alle mit dem Link.",
  },
  "actorProfile.organises": "Organisiert Läufe, Ausfahrten und Wanderungen auf {instance}.",
  "actorProfile.upcoming": "Kommende öffentliche Treffen",
  "actorProfile.none": "Gerade keine kommenden öffentlichen Treffen.",
  "actorProfile.gone": "Dieses Fediverse-Profil wurde ausgeschaltet.",
  "privacy.profiles":
    "Wenn du ein Fediverse-Profil einschaltest, können alle im Fediverse den gewählten Namen, deinen Anzeigenamen und deine kommenden öffentlichen Treffen sehen, und andere Server können Kopien behalten. Seine Signaturschlüssel werden verschlüsselt gespeichert. Treffen für deine Follower:innen und öffentliche Treffen, gespeichert nach dem Einschalten, werden mit ihren öffentlichen Angaben an die Server deiner Follower:innen geschickt, die Kopien behalten können; Änderungen werden auch geschickt, und löschst du ein Treffen oder machst es für weniger Leute auffindbar, werden sie gebeten, es zu entfernen. Alle im Fediverse können ihm folgen: Adresse und Posteingänge einer Follower:in werden verschlüsselt gespeichert, bis sie nicht mehr folgt, ihr Konto gelöscht wird, das Profil ausgeschaltet wird oder diese Seite nicht mehr am Fediverse teilnimmt, und gezeigt wird nur, wie viele es sind. Nachrichten an Follower:innen warten mit den Adressen ihrer Posteingänge höchstens 12 Stunden in einer Warteschlange; die letzte, die sagt, dass das Profil weg ist, behält bis dahin den Signaturschlüssel, den sie braucht. Schaltest du es aus oder löschst du dein Konto, wird der Name stillgelegt: Nur ein verschlüsselter Prüfwert bleibt, damit er nie wieder verwendet wird.",
  "form.joinMode": "Wer teilnehmen kann",
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
    "Hat der Treffpunkt eine Stelle auf der Karte, wird die Route so gekürzt, dass sie dort beginnt, und dort endet, wenn sie zurückkommt. Jeder andere Start und jedes andere Ende, zum Beispiel deine Wohnung, wird um die hier gewählte Strecke ausgeblendet. Entferntes wird nie gespeichert.",
  "form.gpxTrimOnlyWithFile": "Gilt nur für eine oben gewählte Datei.",
  "form.gpxTrimOff": "Ganze Route zeigen",
  "form.gpxTrimMeters": "{meters} m an jedem Ende ausblenden",
  "form.gpxTrimKilometers": "{km} km an jedem Ende ausblenden",
  "form.gpxTrimMiles": "Etwa {miles} mi an jedem Ende ausblenden",
  "form.gpxHint":
    "Füllt Distanz, Höhenmeter und den genauen Treffpunkt aus. Nur wer zusagt, kann die Route sehen und herunterladen. Wenn das Formular einen Fehler zeigt, wähle die Datei noch einmal aus.",
  "form.gpxHintAdd":
    "Die Route wird beim Speichern hinzugefügt. Distanz und Höhenmeter richten sich dann nach ihr, außer du änderst sie hier ebenfalls. Nur wer zusagt, kann die Route sehen und herunterladen.",
  "form.gpxHintReplace":
    "Dieses Treffen hat eine Route. Eine hier gewählte Datei ersetzt sie beim Speichern. Distanz und Höhenmeter richten sich dann nach der neuen Route, außer du änderst sie hier ebenfalls.",
  "form.gpxChooseAgain":
    "Wähle die Datei noch einmal aus: Browser behalten eine gewählte Datei nicht, wenn die Seite neu geladen wird.",

  "field.invalid": "Dieser Wert ist ungültig.",
  "field.contribution_empty": "Schreib einen Kommentar oder füge einen Link hinzu.",
  "field.contribution_too_long": "Bitte höchstens {max} Zeichen.",
  "field.link_invalid": "Gib eine Webadresse ein, die mit https:// beginnt.",
  "field.link_too_long": "Dieser Link ist zu lang.",
  "field.required": "Bitte fülle dieses Feld aus.",
  "field.requiredHint": "Pflichtfeld",
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
  "field.route_rate_limited":
    "Zu viele Routendateien in kurzer Zeit. Es wurde nichts gespeichert: Versuche es später noch einmal.",
  "field.name_taken_by_host":
    "Diesen Namen verwendet die Organisator:in des Treffens. Bitte nimm einen anderen.",
  "field.name_taken_by_response": "Diesen Namen verwendet schon eine Person, die geantwortet hat.",

  "links.heading": "Dein Treffen ist bereit",
  "links.planLink": "Link zum Treffen: diesen teilen",
  "links.hostLink": "Dein Organisationslink: privat halten",
  "links.hostLinkWarning":
    "Speichere ihn jetzt. Er wird nur einmal angezeigt, und alle, die ihn haben, können dein Treffen verwalten. Dieser Browser bleibt als Organisator:in verknüpft.",
  "links.open": "Dein Treffen öffnen",
  "links.addDetails": "Route, Tempo und mehr hinzufügen",
  "links.deletion": "Das Treffen und alles dazu wird am {date} gelöscht.",

  "plan.gone": "Dieses Treffen gibt es nicht mehr.",
  "plan.public": "Öffentlich",
  "plan.followers": "Follower:innen",
  "plan.fediverseJoin":
    "Auf Mastodon kannst du der Organisator:in folgen, mitmachen kannst du aber nur auf dieser Seite.",
  "plan.fediverseJoinLogin":
    "Auf Mastodon kannst du der Organisator:in folgen, mitmachen kannst du aber nur auf dieser Seite: Melde dich mit deinem Fediverse-Konto an.",
  "plan.host": "Organisator:in",
  "plan.postedBy": "Eingestellt von {name}",
  "plan.youAreHost": "Du organisierst dieses Treffen.",
  "plan.when": "Wann",
  "preview.cancelled": "Abgesagt: {title}",
  "plan.timeZone": "Zeitzone {zone}",
  "note.start": "Beginn: {when}",
  "note.place": "Treffpunkt: {place}",
  "note.coordinates": "Koordinaten: {lat}, {lng}",
  "note.route": "Die Route hängt als GPX-Datei an.",
  "note.plan": "Seite des Treffens: {link}",
  "note.copies": "Dein Server kann Kopien dieser Nachricht behalten.",
  "recapNote.intro": "{author} hat im Rückblick geschrieben:",
  "recapNote.link": "Link: {link}",
  "recapNote.plan": "Seite des Treffens: {link}",
  "recapNote.copies": "Dein Server kann Kopien dieser Nachricht behalten.",
  "plan.where": "Gebiet",
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
    "Die Organisator:in entscheidet, wer teilnimmt. Sobald du angenommen bist, siehst du den genauen Treffpunkt und wer sonst noch kommt.",
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
  "weather.hint": "Für die Startzeit, in der Nähe des Gebiets.",
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

  "email.refuse": "Nicht du? Dann nichts an diese Adresse senden",
  "email.lastWhy": "Dieses Treffen gibt es nicht mehr, deshalb kommen keine weiteren E-Mails dazu.",
  "emailLink.refuse": "Keine E-Mails senden",
  "privacy.emailRateLimit":
    "Anfragen nach einem Bestätigungslink werden auch je E-Mail-Adresse gezählt, als Hash, der nur im Arbeitsspeicher liegt, damit niemand fremde Postfächer überfluten kann.",
  "email.accountOn": "E-Mails zu deinem Konto gehen an {address}.",
  "email.accountLabel": "E-Mail für dein Konto",
  "email.accountHint":
    "Für Hinweise zu deinem Konto, etwa eine Warnung, bevor ein ungenutztes Konto gelöscht wird. Zuerst schicken wir einen Link, um die Adresse zu bestätigen.",
  "email.useAccount": "{address} aus deinem Konto verwenden",
  "email.accountConfirmSubject": "E-Mails zu deinem Konto auf {instance} bestätigen",
  "email.accountHeading": "Dein Konto auf {instance}",
  "email.accountConfirmBody":
    "Jemand möchte an diese Adresse E-Mails zu einem Konto auf {instance} bekommen, etwa eine Warnung, bevor ein ungenutztes Konto gelöscht wird. Wenn du das warst, bestätige es mit dem Link unten. Wenn nicht, ignoriere diese E-Mail: Es wird nichts weiter gesendet.",
  "notice.expirySubject": "Dein Konto auf {instance} wird am {date} gelöscht",
  "notice.expiryBody":
    "Es wurde fast ein Jahr nicht genutzt. Um es zu behalten, nutze es vor dem {date}: Melde dich an oder öffne die Seite auf einem angemeldeten Gerät. Sonst wird es mit allem gelöscht, was ihm gehört.",
  "email.openAccount": "Konto öffnen",
  "email.accountWhy":
    "Du bekommst diese E-Mail, weil du diese Adresse deinem Konto auf {instance} hinzugefügt hast.",
  "email.newLinkSubject": "Dein neuer Link für „{title}“",
  "email.newLinkBody":
    "Hier ist dein neuer privater Link. Ältere Links funktionieren nicht mehr; Geräte, die sie schon nutzen, bleiben angemeldet.",
  "email.newLinkAction": "Mit dem neuen Link öffnen",
  "email.newLinkWhy":
    "Du bekommst diese E-Mail, weil du auf {instance} einen neuen Link angefordert hast.",
  "emailLink.accountConfirmBody": "E-Mails zu deinem Konto auf {instance} an {address} bekommen?",
  "emailLink.accountOffBody": "Keine E-Mails mehr zu deinem Konto auf {instance} an {address}?",
  "linkTools.emailLink": "Neuen Link per E-Mail senden",
  "linkTools.emailLinkHint":
    "Schickt einen neuen Link an {address}. Ältere Links funktionieren dann nicht mehr; Geräte, die sie schon nutzen, bleiben angemeldet.",
  "linkTools.emailed":
    "Wir haben einen neuen Link an {address} geschickt. Ältere Links funktionieren nicht mehr.",
  "linkTools.emailFailed":
    "Die E-Mail konnte nicht gesendet werden. Es hat sich nichts geändert; bitte versuche es später noch einmal.",
  "privacy.accountEmail":
    "Wenn du deinem Konto eine E-Mail-Adresse hinzufügst, wird sie verschlüsselt gespeichert, nur für E-Mails zum Konto (etwa die Warnung, bevor ein ungenutztes Konto gelöscht wird) und für Treffen genutzt, für die du sie auswählst, und mit dem Konto gelöscht.",
  "email.hostShared": "Alle, die dieses Treffen verwalten, sehen diese Adresse.",
  "channels.more": "Weitere Wege, benachrichtigt zu werden",
  "ntfy.label": "ntfy-App",
  "ntfy.hint":
    "Benachrichtigungen in der ntfy-App (Android, iPhone oder Browser), über {server}. Du brauchst dort kein Konto.",
  "ntfy.accountHint":
    "Hinweise zu deinem Konto, etwa eine Warnung, bevor ein ungenutztes Konto gelöscht wird, in der ntfy-App über {server}.",
  "ntfy.setUp": "ntfy einrichten",
  "ntfy.pending":
    "Abonniere dieses Thema in der ntfy-App und tippe dann auf die Nachricht, die wir geschickt haben, um zu bestätigen. Vorher wird nichts anderes gesendet.",
  "ntfy.open": "In ntfy öffnen",
  "ntfy.resend": "Nachricht noch einmal senden",
  "ntfy.on":
    "ntfy-Benachrichtigungen gehen an dieses Thema. Behalte es für dich: Wer es kennt, kann sie lesen.",
  "ntfy.off": "ntfy abschalten",
  "ntfy.turnOff": "ntfy abschalten",
  "ntfy.confirm": "Bestätigen",
  "ntfy.confirmTitle": "ntfy-Benachrichtigungen von {instance} bestätigen",
  "ntfy.confirmBody":
    "Tippe hier, um Benachrichtigungen zu „{title}“ zu bekommen. Wenn du das nicht wolltest, ignoriere es: Es wird nichts weiter gesendet.",
  "ntfy.accountConfirmBody":
    "Tippe hier, um Hinweise zu deinem Konto auf {instance} zu bekommen. Wenn du das nicht wolltest, ignoriere es: Es wird nichts weiter gesendet.",
  "ntfyLink.confirmHeading": "ntfy-Benachrichtigungen bestätigen",
  "ntfyLink.offHeading": "ntfy-Benachrichtigungen abschalten",
  "ntfyLink.confirmBody": "Benachrichtigungen zu „{title}“ in der ntfy-App bekommen?",
  "ntfyLink.accountConfirmBody":
    "Hinweise zu deinem Konto auf {instance} in der ntfy-App bekommen?",
  "ntfyLink.offBody": "Keine ntfy-Benachrichtigungen mehr zu „{title}“?",
  "ntfyLink.accountOffBody": "Keine ntfy-Hinweise mehr zu deinem Konto auf {instance}?",
  "ntfyLink.confirm": "Bestätigen",
  "ntfyLink.refuse": "Keine Benachrichtigungen senden",
  "ntfyLink.off": "ntfy abschalten",
  "ntfyLink.confirmed": "ntfy-Benachrichtigungen sind eingeschaltet.",
  "ntfyLink.turnedOff": "ntfy-Benachrichtigungen sind abgeschaltet.",
  "privacy.publicPlans":
    "Wer ein Treffen organisiert, kann es öffentlich machen. Dann finden es alle unter „In der Nähe“ und sehen, was die Seite des Treffens allen zeigt: Titel, Name der Organisator:in, Datum und Uhrzeit, Gebiet, Aktivität, Distanz, Tempo und Notiz. Der genaue Treffpunkt, die Route und die Namen derer, die antworten, bleiben verborgen wie bei jedem Treffen.",
  "privacy.publicPlansProfile":
    "Wer ein Treffen organisiert und ein Fediverse-Profil hat, kann es öffentlich machen. Dann finden es alle auf diesem Profil und im Fediverse und sehen, was die Seite des Treffens allen zeigt: Titel, Name der Organisator:in, Datum und Uhrzeit, Gebiet, Aktivität, Distanz, Tempo und Notiz. Der genaue Treffpunkt, die Route und die Namen derer, die antworten, bleiben verborgen wie bei jedem Treffen.",
  "privacy.ntfy":
    "Wenn du ntfy einschaltest, werden Benachrichtigungen an den ntfy-Server {server} unter einem zufälligen Thema gesendet, das die App erzeugt; wer das Thema kennt, kann sie lesen. Das Thema wird verschlüsselt gespeichert und mit deiner Antwort, dem Treffen oder dem Konto gelöscht.",
  "channelLink.invalid":
    "Dieser Link funktioniert nicht mehr. Die Benachrichtigungen sind vielleicht schon abgeschaltet, oder das Treffen gibt es nicht mehr.",
  "ntfy.hostShared":
    "Alle, die dieses Treffen verwalten, sehen dieses Thema und können seine Benachrichtigungen lesen.",
  "telegram.label": "Telegram",
  "telegram.hint":
    "Benachrichtigungen von unserem Bot in Telegram. Telegram erfährt den Titel des Treffens, was passiert ist, sowie Zeit und Ort.",
  "telegram.accountHint":
    "Hinweise zu deinem Konto, etwa eine Warnung, bevor ein ungenutztes Konto gelöscht wird, von unserem Bot in Telegram.",
  "telegram.connect": "Telegram verbinden",
  "telegram.pending": "Öffne den Bot in Telegram und tippe auf Start. Vorher wird nichts gesendet.",
  "telegram.unreachable":
    "Wartet auf Start, aber Telegram ist gerade nicht erreichbar. Versuch es später noch einmal.",
  "telegram.hostShared":
    "Alle, die dieses Treffen verwalten, sehen diesen Link; wer zuerst auf Start tippt, bekommt die Benachrichtigungen des Treffens.",
  "telegram.open": "Telegram öffnen",
  "telegram.onPage": "Telegram-Benachrichtigungen sind eingeschaltet.",
  "telegram.off": "Telegram abschalten",
  "telegram.turnOff": "Telegram abschalten",
  "telegram.on":
    "Benachrichtigungen zu „{title}“ sind eingeschaltet. Mit dem Knopf unten kannst du sie abschalten.",
  "telegram.accountOn":
    "Hinweise zu deinem Konto auf {instance} sind eingeschaltet. Mit dem Knopf unten kannst du sie abschalten.",
  "telegramLink.offHeading": "Telegram-Benachrichtigungen abschalten",
  "telegramLink.offBody": "Keine Telegram-Benachrichtigungen mehr zu „{title}“?",
  "telegramLink.accountOffBody": "Keine Telegram-Hinweise mehr zu deinem Konto auf {instance}?",
  "telegramLink.off": "Telegram abschalten",
  "telegramLink.turnedOff": "Telegram-Benachrichtigungen sind abgeschaltet.",
  "privacy.telegram":
    "Wenn du Telegram verbindest, gehen die Nachrichten des Bots (der Titel eines Treffens, was passiert ist, Zeit und Ort) über die Server von Telegram an deinen Chat. Die Nummer des Chats wird verschlüsselt gespeichert und mit deiner Antwort, dem Treffen oder dem Konto gelöscht.",
  "email.label": "E-Mail für Neuigkeiten zu diesem Treffen",
  "email.hint":
    "Zuerst schicken wir einen Link, um die Adresse zu bestätigen. Jede E-Mail enthält einen Link zum Abschalten.",
  "email.submit": "Bestätigungslink senden",
  "email.pending":
    "Öffne den Link, den wir an {address} geschickt haben, um sie zu bestätigen. Vorher wird nichts anderes gesendet.",
  "email.resend": "Link noch einmal senden",
  "email.on": "E-Mails zu diesem Treffen gehen an {address}.",
  "email.off": "E-Mails abschalten",
  "email.openPlan": "Treffen öffnen",
  "email.why":
    "Du bekommst diese E-Mail, weil du auf {instance} E-Mails zu „{title}“ eingeschaltet hast.",
  "email.turnOff": "Diese E-Mails abschalten",
  "email.confirmSubject": "E-Mails zu „{title}“ bestätigen",
  "email.confirmBody":
    "Jemand möchte an diese Adresse E-Mails zu diesem Treffen bekommen. Wenn du das warst, bestätige es mit dem Link unten. Wenn nicht, ignoriere diese E-Mail: Es wird nichts weiter gesendet.",
  "email.confirmAction": "Adresse bestätigen",
  "email.confirmWhy":
    "Du bekommst diese E-Mail, weil diese Adresse auf {instance} eingegeben wurde.",
  "email.reportSubject": "Neue Meldung auf {instance}",
  "email.reportBody": "Jemand hat ein Treffen gemeldet. Die Admin-Seite zeigt die Meldung.",
  "email.reportBodyNoLink":
    "Jemand hat ein Treffen gemeldet. Öffne die Admin-Seiten, um die Meldung zu sehen.",
  "email.reportAction": "Admin-Seite öffnen",
  "email.reportWhy":
    "Du bekommst diese E-Mail, weil diese Adresse die Kontaktadresse von {instance} ist.",
  "emailLink.confirmHeading": "E-Mail-Adresse bestätigen",
  "emailLink.confirmBody": "E-Mails zu „{title}“ an {address} bekommen?",
  "emailLink.confirm": "Adresse bestätigen",
  "emailLink.offHeading": "E-Mails abschalten",
  "emailLink.offBody": "Keine E-Mails mehr zu „{title}“ an {address}?",
  "emailLink.off": "E-Mails abschalten",
  "emailLink.confirmed": "Adresse bestätigt. Du bekommst E-Mails zu diesem Treffen.",
  "emailLink.turnedOff": "E-Mails zu diesem Treffen sind abgeschaltet.",
  "field.email_invalid": "Gib eine E-Mail-Adresse ein, zum Beispiel name@example.org.",
  "privacy.email":
    "Wenn du E-Mails zu einem Treffen einschaltest, wird deine Adresse verschlüsselt gespeichert, nur für diese E-Mails genutzt und mit deiner Antwort oder dem Treffen gelöscht. Jede E-Mail enthält einen Link zum Abschalten; vor deiner Bestätigung wird nichts gesendet.",
  "calendar.title": "Kalender-Abo",
  "calendar.intro":
    "Deine Kalender-App kann alle Treffen zeigen, die du in diesem Browser organisierst oder auf die du geantwortet hast. Sie aktualisiert sie selbst, wenn ein Treffen geändert, abgesagt oder gelöscht wird.",
  "calendar.contents":
    "Der Kalender enthält nur öffentliche Angaben: Titel, Zeit, Gebiet und den Link. Nie den genauen Treffpunkt, die Route oder Namen. Der Server deiner Kalender-App ruft ihn ab und sieht daher diese Angaben und dass du geantwortet hast.",
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

  "host.routeRemove": "Route entfernen",
  "host.routeRemoveOpen": "Route entfernen…",
  "host.routeRemoveExplain":
    "Die Route wird sofort für alle gelöscht. Distanz und Höhenmeter bleiben. Nicht gespeicherte Änderungen im Formular gehen verloren.",

  "host.heading": "Dein Treffen verwalten",
  "host.saved": "Änderungen gespeichert.",
  "host.save": "Änderungen speichern",
  "saveBar.unsaved": "Nicht gespeicherte Änderungen",
  "saveBar.discard": "Verwerfen",
  "saveBar.problems": { one: "{count} Problem zu beheben", other: "{count} Probleme zu beheben" },
  "saveBar.goTo": "Zu {field}",
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
  "template.repeatSharedFollowers":
    "Das neue Treffen geht an die Follower:innen von {handle} im Fediverse und an alle mit dem Link.",
  "template.repeatSharedPublic":
    "Das neue Treffen wird im Fediverse von {handle} geteilt, mit allen.",
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
  "template.adjustedVisibility":
    "Nur, wer den Link hat, kann es finden: Öffentliche Treffen brauchen ein Konto auf dieser Seite.",
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
  "privacy.ratings":
    "Nach einem Treffen können Teilnehmer:innen es mit Daumen hoch oder runter und einer optionalen Nachricht bewerten. Nur die Organisator:in sieht Bewertungen, wenn der Rückblick geschlossen ist und nur bei Treffen mit mindestens 3 Teilnehmer:innen; Nachrichten zeigen den Namen ihrer Verfasser:in. Bewertungen werden mit verschlüsselter Nachricht gespeichert und mit dem Treffen, der Antwort oder deinen Daten gelöscht.",
  "privacy.templates":
    "Wenn die Organisator:in „Als wiederholbare Vorlage behalten“ wählt oder eine Vorlage speichert, werden die Angaben des Treffens samt ihrem Namen als Vorlage behalten; nie seine Antworten, die Namen der Teilnehmer:innen, der Rückblick oder die Bewertungen. Genauer Treffpunkt und Route werden nur behalten, wenn die Organisator:in sie einschließt, und dann verschlüsselt. Eine Vorlage wird gelöscht, wenn sie 90 Tage lang weder wiederholt noch bearbeitet wurde.",
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
  "nearby.title": "In der Nähe",
  "nearby.intro": "Öffentliche Treffen auf dieser Seite in der Nähe eines Orts, den du wählst.",
  "nearby.placePrivacy":
    "Eine Stelle von der Karte oder dein Standort wird in deinem Browser vor dem Senden auf etwa 2 km gerundet. Ein eingetippter Ort geht an den Dienst für die Ortssuche und wird ebenso gerundet; ohne JavaScript steht er auch in der Adresse dieser einen Anfrage. Nichts davon wird hier gespeichert oder protokolliert.",
  "nearby.place": "Ort",
  "nearby.placeHint": "Eine Stadt, ein Viertel oder ein Park.",
  "nearby.locate": "Meinen Standort verwenden",
  "nearby.mapLabel": "Tippe auf die Karte, um um diese Stelle zu suchen",
  "nearby.atPoint": "Um die gewählte Stelle (auf etwa 2 km gerundet).",
  "nearby.radius": "Im Umkreis von",
  "nearby.from": "Erster Tag",
  "nearby.to": "Letzter Tag",
  "nearby.activity": "Aktivität",
  "nearby.anyActivity": "Alle",
  "nearby.distance": "Distanz ({unit})",
  "nearby.atLeast": "Mindestens",
  "nearby.atMost": "Höchstens",
  "nearby.pace": "Pace oder Tempo",
  "nearby.paceHint":
    "Wähle zuerst eine Aktivität: Minuten:Sekunden beim Laufen und Wandern (zum Beispiel 5:30), ein Tempo beim Radfahren.",
  "nearby.filters": "Weitere Filter: Umkreis, Tage, Aktivität, Distanz, Tempo",
  "nearby.search": "Suchen",
  "nearby.results": { one: "1 öffentliches Treffen", other: "{count} öffentliche Treffen" },
  "nearby.truncated": "Die ersten {count}, nach Beginn. Grenze die Suche ein, um weitere zu sehen.",
  "nearby.none":
    "Keine öffentlichen Treffen gefunden. Versuch einen größeren Umkreis oder andere Tage.",
  "nearby.close": "im Umkreis von 2 km",
  "nearby.away": "etwa {distance} entfernt",
  "nearby.placeNotFound":
    "Dieser Ort wurde nicht gefunden. Versuch einen anderen Namen, die Karte oder deinen Standort.",
  "nearby.placeUnavailable":
    "Orte lassen sich gerade nicht suchen. Nimm stattdessen die Karte oder deinen Standort.",
  "nearby.nothingPublic":
    "Treffen auf dieser Seite können nicht öffentlich sein, darum gibt es hier nichts zu finden.",
  "home.roleHost": "Du organisierst",
  "home.recent": "Zuletzt",
  "home.upcoming": "Demnächst",
  "home.nearby": "Öffentliche Treffen in der Nähe finden",
  "layout.nearby": "In der Nähe",
  "privacy.federation":
    "Diese Seite ist im Fediverse als @{host}@{host} dabei. Andere Server können die öffentlichen Angaben eines Treffens über seine Adresse abrufen, so wie alle mit dem Link sie sehen. Schickt ein Server dieser Seite eine Nachricht, ruft sie den öffentlichen Schlüssel dieses Servers ab, um die Signatur der Nachricht zu prüfen, und behält ihn bis zu {days} Tage. Alle im Fediverse können dieser Seite folgen: Adresse und Posteingänge einer Follower:in werden verschlüsselt gespeichert, bis sie nicht mehr folgt, ihr Konto gelöscht wird oder diese Seite nicht mehr am Fediverse teilnimmt, und gezeigt wird nur, wie viele es sind. Die Seite selbst teilt keine Treffen, nur Fediverse-Profile tun das. Wer im Fediverse ist, kann einem Treffen von seinem eigenen Server aus beitreten: Adresse und Posteingänge einer solchen Teilnehmer:in werden verschlüsselt gespeichert, bis sie austritt, ihr Konto gelöscht oder das Treffen gelöscht wird; bei jemandem, den die Gastgeber:in abgelehnt oder entfernt hat, bleiben sie als Sperre, bis das Treffen oder ihr Konto gelöscht wird. Der angezeigte Name stammt aus ihrem Profil, und die Gastgeber:in und die angenommenen Teilnehmenden können ihn sehen. Änderungen des Treffens gehen jeder Teilnehmer:in einzeln zu, solange sie dabei ist, seine Löschung allen, die beigetreten waren, und ihr Server kann Kopien behalten.",
  "privacy.federationNotes":
    "Wenn jemand im Fediverse einem Treffen beitritt und angenommen wird, bekommt diese Person den genauen Treffpunkt und die Route als Direktnachricht vom Akteur dieser Seite oder vom Profil der Organisator:in, und sonst niemand: den genauen Treffpunkt als Text, die Route als GPX-Datei hinter einem privaten Link, den alle öffnen können, die ihn haben, bis die Nachricht zurückgezogen wird. Sie wird zurückgezogen, wenn die Person austritt, entfernt oder das Treffen gelöscht wird; Änderungen von Treffpunkt, Zeit oder Route werden ihr erneut geschickt. Ihr Server kann Kopien behalten, die diese Seite nicht löschen kann.",
  "privacy.federationRecap":
    "Wenn Leute im Fediverse einem Treffen beigetreten sind, wird jeder Kommentar und jeder Link im Rückblick ihnen als Direktnachricht vom Akteur dieser Seite oder vom Profil der Organisator:in geschickt, unter dem Namen der Verfasser:in, wie ihn die Teilnehmenden sehen, und sonst niemandem; die Verfasser:in bekommt den eigenen nicht zurück. Wer vom Fediverse aus beigetreten ist, kann auf eine solche Nachricht privat antworten: Die Antwort wird zu einem Kommentar im Rückblick, den die Gastgeber:in und die Teilnehmenden unter dem für das Konto angezeigten Namen sehen, und gleichermaßen an die anderen Teilnehmenden im Fediverse weitergegeben. Änderungen werden erneut geschickt, und eine Nachricht wird zurückgezogen, wenn ihr Kommentar gelöscht oder ausgeblendet wird, wenn ihre Verfasser:in oder die Empfänger:in austritt oder entfernt wird oder wenn das Treffen abgesagt oder gelöscht wird; wer später beitritt, bekommt die neuesten 50 Kommentare. Ihr Server kann Kopien behalten, die diese Seite nicht löschen kann. Teilnehmende aus dem Fediverse gehören nicht zum Datenexport eines Kontos, der unverändert bleibt.",
  "privacy.federationReports":
    "Ein Server im Fediverse kann dieser Seite eine Meldung über ein Treffen schicken oder über eine Nachricht dieser Seite an die Leute dieses Servers. Sie erreicht die Instanzadministration wie jede andere Meldung, mit dem Text, den der andere Server geschickt hat, und, wenn sie eine dieser Nachrichten nennt, mit einer Kopie von deren Text und Link ohne die Verfasser:in. Diese Seite speichert nicht, wer oder welcher Server sie geschickt hat.",
  "fediverseDm.label": "Fediverse-Nachrichten",
  "fediverseDm.hint":
    "Hinweise zu deinem Konto, etwa eine Warnung, bevor ein ungenutztes Konto gelöscht wird, als Direktnachrichten von {instance} an dein Fediverse-Konto. Dein Server behält Direktnachrichten; hier kannst du das abschalten.",
  "fediverseDm.on":
    "Hinweise zu deinem Konto kommen als Direktnachrichten von {instance} zu dir. Dein Server behält sie.",
  "fediverseDm.turnOn": "Fediverse-Nachrichten einschalten",
  "fediverseDm.off": "Fediverse-Nachrichten abschalten",
  "fediverseDm.notFound":
    "Dieses Konto war gerade nicht erreichbar. Prüfe, ob der Server Nachrichten von anderen Servern annimmt, oder versuche es später noch einmal.",
  "fediverseDm.first":
    "Nachrichten von {instance} kommen jetzt als Direktnachrichten zu dir. Sie betreffen nur dein Konto, etwa eine Warnung, bevor ein ungenutztes Konto gelöscht wird.",
  "fediverseDm.keeps": "Dein Server behält Direktnachrichten; diese Seite kann sie nicht löschen.",
  "fediverseDm.turnOff": "Zum Abschalten öffne deine Kontoseite: {link}",
  "privacy.federationMessages":
    "Wenn du dich über das Fediverse anmeldest und auf deiner Kontoseite Fediverse-Nachrichten einschaltest, sucht diese Seite bei jedem Versand deine Fediverse-Adresse heraus und schickt dir eine Direktnachricht von ihrem Akteur: eine beim Einschalten, danach die Hinweise zu deinem Konto, etwa die Warnung, bevor ein ungenutztes Konto gelöscht wird. Dein Server behält Direktnachrichten, die diese Seite nicht löschen kann. Diese Seite speichert nur, dass der Schalter an ist, und die Sprache der Seite, die du benutzt hast, nicht deinen Akteur oder Posteingang; eine Nachricht, die noch zugestellt wird, liegt höchstens 12 Stunden verschlüsselt und wird mit deinem Konto gelöscht.",
  "fediverseDm.paused":
    "Fediverse-Nachrichten sind eingeschaltet, aber diese Seite sendet gerade keine. Hier kannst du sie abschalten.",
  "privacy.nearby":
    "„In der Nähe“ nutzt den Ort, von dem aus du suchst, nur für diese Suche. Eine Stelle von der Karte oder dein Standort wird von deinem Browser vor dem Senden auf etwa 2 km gerundet und vom Server noch einmal. Ein eingetippter Ort wird wie bei der Ortssuche oben nachgeschlagen, und die Suche geht von seiner gerundeten Stelle aus weiter; ohne JavaScript steht der eingetippte Ort in der Adresse dieser ersten Anfrage. Nichts davon wird gespeichert oder in die Protokolle dieser Seite geschrieben. Die gerundete Stelle steht in der Adresse der Ergebnisseite und kann so in deinem Browserverlauf und im Zugriffsprotokoll des Webservers vor dieser Seite bleiben.",
  "field.range_invalid": "Der letzte Tag liegt vor dem ersten.",
  "field.date_too_far": "Dieser Tag liegt weiter in der Zukunft, als ein Treffen sein kann.",
  "field.pace_needs_activity": "Wähle eine Aktivität, um nach Pace oder Tempo zu filtern.",
  "field.place_invalid": "Bitte gib 2 bis 100 Zeichen ein.",
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
  "myData.openPlan": "Plan öffnen",
  "myData.calendar": "Kalender-Abo",
  "myData.calendarOn": "Dieses Gerät hat ein Kalender-Abo.",
  "myData.calendarOff": "Dieses Gerät hat kein Kalender-Abo.",
  "myData.calendarManage": "Kalender-Abo verwalten",
  "myData.loggedIn": "Dieser Browser ist bei deinem Konto angemeldet.",
  "myData.accountManage": "Dein Konto",
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
  "myData.deleteKeepsAccount":
    "Dieser Browser ist bei einem Konto angemeldet. Das Konto selbst bleibt; dieser Browser wird nur abgemeldet.",
  "myData.deleteNoTemplates": "Von den gelöschten Treffen werden keine Vorlagen behalten.",
  "myData.deleteConfirm": "Alles endgültig löschen",
  "myData.back": "Zurück zu meinen Daten",
  "myData.deleted": "Deine Daten auf diesem Gerät wurden gelöscht.",
  "rating.heading": "Treffen bewerten",
  "rating.question": "Wie war es?",
  "rating.up": "War gut",
  "rating.down": "War nicht so gut",
  "rating.note": "Nachricht an die Organisator:in (optional)",
  "rating.submit": "Bewertung speichern",
  "rating.remove": "Meine Bewertung entfernen",
  "rating.yours": "Deine Bewertung:",
  "rating.closed": "Die Bewertung ist geschlossen.",
  "rating.notYetOpen": "Bewerten ist möglich, sobald das Treffen begonnen hat.",
  "rating.closedNow": "Die Bewertung für dieses Treffen ist geschlossen.",
  "rating.honesty":
    "Nur die Organisator:in sieht Bewertungen. In einer kleinen Gruppe kann sie erraten, wer bewertet hat. Nachrichten zeigen deinen Namen.",
  "rating.back": "Zurück zum Treffen",
  "rating.resultHeading": "Bewertungen",
  "rating.resultLater":
    "Teilnehmer:innen können das Treffen bewerten, solange der Rückblick offen ist. Das Ergebnis siehst du hier, sobald er geschlossen ist, bei Treffen mit mindestens 3 Teilnehmer:innen.",
  "rating.result": {
    zero: "Keine:r der {participants} Teilnehmer:innen hat bewertet.",
    one: "{count} von {participants} hat bewertet: {up} × gut, {down} × nicht so gut",
    other: "{count} von {participants} haben bewertet: {up} × gut, {down} × nicht so gut",
  },
  "rating.resultTooFew":
    "Bei Treffen mit weniger als 3 Teilnehmer:innen werden keine Bewertungen gezeigt.",
  "report.link": "Treffen melden",
  "report.heading": "„{title}“ melden",
  "report.intro":
    "Deine Meldung geht nur an die Administration dieser Instanz. Sie enthält nicht, wer sie geschickt hat, und wird mit dem Treffen gelöscht.",
  "report.reason": "Was stimmt nicht?",
  "report.reason.spam": "Spam oder Werbung",
  "report.reason.inappropriate": "Unangemessen oder beleidigend",
  "report.reason.unsafe": "Unsicher oder gefährlich",
  "report.reason.other": "Etwas anderes",
  "report.details": "Einzelheiten (optional)",
  "report.detailsHint": "Die Administration kann dir nicht antworten.",
  "report.attach": "Kommentare aus dem Rückblick anhängen (optional)",
  "report.attachHint":
    "Die Administration sieht den Rückblick nicht. Hake Kommentare oder Links an, um ihr eine Kopie zu schicken, ohne die Namen der Verfasser:innen.",
  "report.submit": "Meldung senden",
  "report.sent": "Danke. Deine Meldung wurde an die Administration geschickt.",
  "report.sentTitle": "Meldung gesendet",
  "report.back": "Zurück zum Treffen",
  "privacy.reports":
    "Meldungen: Wenn du ein Treffen meldest, erhält die Administration den Grund, deine Einzelheiten und Kopien der Kommentare aus dem Rückblick, die du anhängst, ohne die Namen der Verfasser:innen. Meldungen enthalten nicht, wer sie geschickt hat, und werden mit dem Treffen gelöscht.",
  "admin.openReports": {
    zero: "Keine offenen Meldungen",
    one: "{count} offene Meldung",
    other: "{count} offene Meldungen",
  },
  "admin.attached": "Angehängte Kommentare aus dem Rückblick, ohne Verfasser:innen:",
  "admin.reportNotFound":
    "Diese Meldung gibt es nicht mehr. Meldungen werden mit ihrem Treffen gelöscht.",
  "admin.resolve": "Als erledigt markieren",
  "admin.resolvedReports": {
    zero: "Keine erledigten Meldungen",
    one: "{count} erledigte Meldung",
    other: "{count} erledigte Meldungen",
  },
  "admin.title": "Instanz-Administration",
  "admin.loginHeading": "Anmeldung für die Administration",
  "admin.token": "Admin-Token",
  "admin.tokenHint": "Das ADMIN_TOKEN dieser Instanz.",
  "admin.login": "Anmelden",
  "admin.loginFailed": "Dieses Token stimmt nicht.",
  "admin.logout": "Abmelden",
  "admin.ingressDenied": "Benötigt Home Assistant 2026.10.4 oder neuer und ein Administratorkonto.",
  "admin.findPlan": "Treffen finden",
  "admin.findPlanHint": "Füge den Link oder die ID des Treffens ein.",
  "admin.findPlanSubmit": "Treffen finden",
  "admin.planNotFound": "Es gibt kein Treffen mit diesem Link oder dieser ID.",
  "admin.planHeading": "Treffen: {title}",
  "admin.planPublic": "Hier werden nur die öffentlichen Angaben des Treffens gezeigt.",
  "admin.postedBy": "Organisator:in: {name}",
  "admin.counts": "{participants} Teilnehmer:innen, {interested} interessiert",
  "admin.deleteExplain":
    "Löscht das Treffen für alle, sofort und endgültig. Wer bei einem bevorstehenden Treffen dabei ist, wird informiert. Es wird keine Vorlage behalten.",
  "admin.deleteConfirm": "Treffen endgültig löschen",
  "admin.deleted": "Das Treffen wurde gelöscht.",
  "admin.back": "Zurück zur Administration",
  "account.dataHeading": "In deinem Konto",
  "account.dataEmpty":
    "Noch nichts. Treffen und Antworten, die du angemeldet erstellst oder hierher übernimmst, erscheinen hier.",
  "account.deleteAt":
    "Wenn du dein Konto nicht nutzt, wird es am {date} gelöscht, mit allem, was darin ist.",
  "account.export": "Kontodaten exportieren (ZIP)",
  "account.deleteLink": "Konto löschen",
  "account.deleteHeading": "Dein Konto löschen?",
  "account.deleteItself": "das Konto selbst und sein Anzeigename",
  "account.mayPost":
    "Ein Einladungslink erlaubt deinem Konto, hier Treffen zu erstellen (seit {date}).",
  "account.deleteMayPost": "seine Erlaubnis, Treffen zu erstellen, aus einem Einladungslink",
  "account.deleteProfile":
    "sein Fediverse-Profil {handle}: Seine Follower:innen erfahren, dass es weg ist, und werden vergessen; der Name wird dauerhaft stillgelegt",
  "account.deleteLogsOut":
    "Browser, die bei ihm angemeldet sind, werden abgemeldet; was sie selbst haben, bleibt.",
  "account.deleteConfirm": "Konto endgültig löschen",
  "account.accountDeleted": "Dein Konto wurde gelöscht.",
  "account.back": "Zurück zu deinem Konto",
  "privacy.accountExpiry":
    "Konten, die {days} Tage lang nicht genutzt werden, werden mit allem, was darin ist, gelöscht.",
  "account.claimHeading": "In dein Konto übernehmen",
  "account.claimIntro":
    "Dieser Browser hat diese, außerhalb deines Kontos. In deinem Konto erreichen sie jedes Gerät, auf dem du angemeldet bist; dieser Browser hat sie dann nur noch, solange er angemeldet ist.",
  "account.claimPlans": {
    zero: "keine Treffen",
    one: "{count} Treffen, das du organisierst",
    other: "{count} Treffen, die du organisierst",
  },
  "account.claimResponses": {
    zero: "keine Antworten",
    one: "{count} Antwort auf ein Treffen",
    other: "{count} Antworten auf Treffen",
  },
  "account.claimTemplates": {
    zero: "keine Vorlagen",
    one: "{count} Vorlage",
    other: "{count} Vorlagen",
  },
  "account.claimSubmit": "In mein Konto übernehmen",
  "account.claimed": "In dein Konto übernommen.",
  "account.fediverseHeading": "Mit einem Fediverse-Konto anmelden",
  "account.fediverseServer": "Dein Server",
  "account.fediverseHint": "Zum Beispiel mastodon.social oder dein Handle wie @du@dein.server.",
  "account.fediverseHandleHint":
    "Wenn die Domain deines Handles nicht die Adresse deines Servers ist, gib die Adresse des Servers ein.",
  "account.fediverseServers": "Erlaubte Server: {servers}",
  "account.fediverseSubmit": "Weiter",
  "account.continue": "Weiter zu {server}",
  "account.continueText":
    "Melde dich dort an und erlaube den Zugriff. Danach kommst du hierher zurück.",
  "account.serverUnavailable":
    "Dieser Server ist nicht erreichbar oder lässt diese Instanz nicht für die Anmeldung zu. Bitte prüfe die Adresse oder versuch es später noch einmal.",
  "field.server_invalid": "Bitte gib die Adresse deines Servers ein, zum Beispiel mastodon.social.",
  "field.server_not_allowed": "Mit diesem Server kannst du dich hier nicht anmelden.",
  "privacy.fediverse":
    "Fediverse-Anmeldung: Wenn du dich mit einem Fediverse-Konto anmeldest, geht dein Browser zu deinem Server, wo diese Instanz für diese eine Anmeldung eine App einträgt. Sie darf die Angaben deines Kontos lesen, auch wem du folgst; sie wird nur genutzt, um zu erfahren, welches Konto du bist, und der Zugriff wird gleich danach zurückgegeben. Hier gespeichert, verschlüsselt: dein Server und deine Konto-ID, dein Handle und dein Anzeigename.",
  "layout.account": "Konto",
  "account.heading": "Dein Konto",
  "account.intro":
    "Anmelden ist freiwillig. Es verknüpft diesen Browser mit deinem Konto; du kannst dich jederzeit abmelden.",
  "account.loginWith": "Anmelden mit {name}",
  "account.linked": "Dieser Browser ist bei deinem Konto angemeldet.",
  "account.displayName": "Anzeigename",
  "account.displayNameHint":
    "Wird als dein Name eingetragen, wenn du einen Lauf, eine Ausfahrt oder eine Wanderung planst.",
  "account.save": "Speichern",
  "account.logout": "Abmelden",
  "account.logoutHint":
    "Meldet nur diesen Browser ab. Dein Konto und alles, was dieser Browser selbst hat, bleiben; Benachrichtigungen auf diesem Browser für die Treffen deines Kontos enden.",
  "account.loggedIn": "Du bist angemeldet.",
  "account.loggedOut": "Dieser Browser ist abgemeldet.",
  "account.renamed": "Dein Anzeigename wurde gespeichert.",
  "account.loginFailed":
    "Die Anmeldung hat nicht geklappt. Bitte starte sie in diesem Browser noch einmal.",
  "account.unavailable":
    "Der Anmeldedienst ist gerade nicht erreichbar. Bitte versuch es später noch einmal.",
  "account.tryAgain": "Zurück zur Anmeldung",
  "posting.loginHeading": "Anmeldung nötig",
  "posting.loginNeeded": "Auf dieser Instanz können nur angemeldete Menschen Treffen erstellen.",
  "posting.login": "Anmelden",
  "privacy.oidc":
    "Anmeldung mit {name} ({host}): Wenn du dich anmeldest, geht dein Browser zu {host}, das dieser Instanz mitteilt, welches Konto du benutzt hast. Hier gespeichert, verschlüsselt: die Kennung dieses Kontos und dein Anzeigename. Kein Passwort und keine Tokens werden aufbewahrt.",
  "privacy.cookieLogin":
    "Während du dich anmeldest, ein Anmelde-Cookie für höchstens {minutes} Minuten, damit nur dieser Browser die Anmeldung abschließen kann.",
  "posting.heading": "Einladung nötig",
  "posting.inviteNeeded":
    "Auf dieser Instanz können nur Menschen mit einem Einladungslink Treffen erstellen. Frag die Person, die sie betreibt, nach einem.",
  "posting.contact": "Kontakt:",
  "invite.heading": "Diese Einladung auf diesem Gerät verwenden?",
  "invite.body": "Mit diesem Einladungslink kannst du auf {instance} Treffen erstellen.",
  "invite.warning":
    "Mach nur auf deinem eigenen Gerät weiter: Alle, die diesen Browser nutzen, können danach hier Treffen erstellen.",
  "invite.invalid":
    "Dieser Einladungslink ist ungültig. Vielleicht ist er abgelaufen, aufgebraucht oder wurde widerrufen. Frag nach einem neuen.",
  "privacy.invites":
    "Einladungslinks: Nur Menschen mit einem Einladungslink können hier Treffen erstellen. Wenn du einen bestätigst, wird für diesen Browser vermerkt, dass er Treffen erstellen darf, und über welche Einladung. Das wird gelöscht, wenn du deine Daten auf diesem Gerät löschst, oder nach 12 Monaten ohne Nutzung.",
  "myData.browserHeading": "Dieser Browser",
  "myData.mayPost":
    "Ein Einladungslink erlaubt diesem Browser, hier Treffen zu erstellen (seit {date}).",
  "myData.deleteMayPost":
    "die Erlaubnis, Treffen zu erstellen, die ein Einladungslink diesem Browser gegeben hat",
  "field.date_invalid": "Bitte gib ein gültiges Datum ein.",
  "field.expiry_in_past": "Bitte wähle heute oder einen späteren Tag.",
  "admin.invites": "Einladungslinks",
  "admin.invitesHint":
    "Mit einem Einladungslink darf ein Browser auf dieser Instanz Treffen erstellen. Jeder Link wird nur einmal angezeigt, direkt nach dem Erstellen.",
  "admin.inviteExpiresOn": "Letzter Tag (optional)",
  "admin.inviteExpiresOnHint": "Der Link gilt bis zum Ende dieses Tages ({zone}).",
  "admin.inviteMaxUses": "Höchstzahl an Nutzungen (optional)",
  "admin.inviteMaxUsesHint": "Wie viele Browser den Link nutzen dürfen.",
  "admin.inviteCreate": "Einladungslink erstellen",
  "admin.noInvites": "Noch keine Einladungslinks.",
  "admin.inviteUsable": "Aktiv",
  "admin.inviteExpired": "Abgelaufen",
  "admin.inviteUsedUp": "Aufgebraucht",
  "admin.inviteRevoked": "Widerrufen",
  "admin.inviteCreatedOn": "erstellt am {date}",
  "admin.inviteLastDay": "letzter Tag {date}",
  "admin.inviteUsed": {
    zero: "noch nicht genutzt",
    one: "einmal genutzt",
    other: "{count}-mal genutzt",
  },
  "admin.inviteUses": "{uses} von {max} Nutzungen",
  "admin.inviteRevoke": "Widerrufen",
  "admin.inviteNotFound": "Diesen Einladungslink gibt es nicht.",
  "admin.inviteCreatedHeading": "Neuer Einladungslink",
  "admin.inviteCreated":
    "Hier ist der neue Einladungslink. Kopiere ihn jetzt: Er wird nur dieses eine Mal angezeigt.",
  "admin.inviteWarning":
    "Alle mit diesem Link können hier Treffen erstellen, bis er abläuft, aufgebraucht ist oder du ihn widerrufst.",
  // Beispiele im leeren Feld (Entscheidung D74), zur Prüfung durch Muttersprachler.
  "placeholder.areaLabel": "Englischer Garten, Nordende",
  "placeholder.areaSearch": "Ort suchen oder Namen eingeben",
  "placeholder.place": "z. B. Englischer Garten",
  "placeholder.findPlan": "https://…/p/…",
  "placeholder.distance": "10,5",
  "placeholder.elevation": "250",
  "placeholder.exactDescription": "Bank am Nordtor",
  "placeholder.note": "z. B. lockeres Tempo, danach Kaffee",
  "placeholder.displayName": "z. B. Sam",
  "placeholder.inviteMaxUses": "10",
  "placeholder.distanceFrom": "5",
  "placeholder.distanceTo": "20",
};
