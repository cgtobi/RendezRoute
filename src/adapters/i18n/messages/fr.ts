// French UI strings (decisions D15, I31): "vous", point médian ("participant·e·s"), « … » with
// no-break spaces (U+00A0) inside and a narrow no-break space (U+202F) before ; : ! ?. These
// spaces are invisible here; the catalog tests check them. Core terms follow the glossary in I31:
// plan → sortie, host → organisateur·rice. Needs a native-speaker review before release.
import type { Messages } from "./en.ts";

export const fr: Messages = {
  "layout.poweredBy": "Propulsé par {name}",
  "layout.devBanner":
    "Mode développement : des réglages non sécurisés sont actifs. Ne pas utiliser en production.",
  "layout.privacy": "Confidentialité",
  "layout.imprint": "Mentions légales",
  "layout.language": "Langue",
  "layout.change": "Changer",
  "layout.units": "Unités",
  "units.metric": "Métrique (km)",
  "units.imperial": "Impérial (miles)",

  "privacy.title": "Confidentialité",
  "privacy.intro":
    "{instance} utilise RendezRoute, un logiciel libre pour organiser des sorties course à pied et vélo. Cette notice est générée à partir des réglages de ce site et décrit ce que fait le logiciel.",
  "privacy.contact": "Questions sur vos données :",
  "privacy.storedHeading": "Ce qui est enregistré",
  "privacy.storedPlans":
    "Quand vous créez une sortie : votre nom, les informations de la sortie et un parcours facultatif. Le nom, le titre, la remarque, la zone de rendez-vous, l’heure, la distance et l’allure sont visibles par toute personne ayant le lien. Le point de départ exact et le parcours ne sont visibles que par vous et les personnes inscrites, et sont enregistrés chiffrés.",
  "privacy.storedResponses":
    "Quand vous répondez : le nom que vous indiquez, votre choix et la langue de la page, pour les messages concernant la sortie. Votre nom est enregistré chiffré et visible par l’organisateur·rice, ainsi que par les autres participant·e·s si vous vous inscrivez.",
  "privacy.noTracking": "Il n’y a ni comptes, ni mesure d’audience, ni publicité.",
  "privacy.durationHeading": "Durée de conservation",
  "privacy.retention":
    "Chaque sortie est supprimée avec toutes les réponses, tous les noms et son parcours à la date indiquée sur sa page, entre 1 et {days} jours après la sortie, selon le choix de l’organisateur·rice. L’organisateur·rice peut la supprimer plus tôt, et vous pouvez retirer votre réponse à tout moment. Les données supprimées sont écrasées dans la base de données.",
  "privacy.retentionLowered":
    "Les sorties créées avant que ce maximum soit abaissé peuvent garder leur durée plus longue, jusqu’à {max} jours.",
  "privacy.devices":
    "Le lien entre votre navigateur et vos sorties ou réponses est supprimé {unlinkedDays} jours après sa dernière utilisation dès que plus rien n’y est associé, et dans tous les cas après {unusedDays} jours sans utilisation.",
  "privacy.backups":
    "Les sauvegardes automatiques de la base faites avant les mises à jour du logiciel sont supprimées après {days} jours.",
  "privacy.operatorHeading": "Qui peut accéder aux données",
  "privacy.operator":
    "La personne qui exploite ce site peut techniquement accéder à tout ce qui y est enregistré, y compris aux données chiffrées. Le chiffrement protège les données en cas de fuite de sauvegardes de la base si la clé est conservée séparément, mais pas contre l’exploitant·e.",
  "privacy.cookiesHeading": "Cookies",
  "privacy.cookieDevice":
    "Un cookie d’appareil, seulement après avoir créé une sortie, répondu ou ouvert un lien privé : une valeur aléatoire qui associe ce navigateur à ces éléments, conservée {days} jours.",
  "privacy.cookieCsrf":
    "Un cookie de session qui protège les formulaires contre les envois falsifiés. Les navigateurs le suppriment à leur fermeture, sauf s’ils restaurent votre session précédente.",
  "privacy.cookiePreferences":
    "Des cookies de langue et d’unités, seulement si vous choisissez une langue ou des unités en bas d’une page, conservés {days} jours.",
  "privacy.cookieOthers": "Aucun autre cookie, et aucun cookie d’autres sites.",
  "privacy.servicesHeading": "Autres services",
  "privacy.tiles":
    "Les cartes sont chargées par votre navigateur directement depuis {host}. Ce service voit votre adresse IP et la zone de carte que vous consultez.",
  "privacy.tilesServer":
    "Pour les images d’aperçu des liens, ce serveur charge aussi des images de carte de la zone de rendez-vous approximative, sans rien transmettre vous concernant.",
  "privacy.geocoder":
    "La recherche de lieux passe par ce serveur vers {host}. Ce service voit ce que vous cherchez, mais pas qui vous êtes. Les recherches et leurs résultats restent jusqu’à {days} jours dans la mémoire de ce serveur, pour éviter de répéter les requêtes.",
  "privacy.push":
    "Si vous activez les notifications, le service push de votre navigateur (de Google, Mozilla, Apple ou Microsoft) les distribue. Les messages sont chiffrés ; le service voit seulement qu’un message a été envoyé.",
  "privacy.location":
    "« Utiliser ma position » demande votre position à votre navigateur et remplit seulement le formulaire, qui ne l’envoie que si vous le validez.",
  "privacy.locationMap":
    "Si les cartes sont activées, la carte se déplace ensuite vers votre position, et votre navigateur charge donc des images de cette zone depuis le service de cartes.",
  "privacy.share": "WhatsApp et X ne sont contactés que si vous utilisez leurs liens de partage.",
  "privacy.previews":
    "Quand le lien d’une sortie est partagé dans une messagerie, celle-ci récupère le titre, l’heure, la zone de rendez-vous, la distance, l’allure et une image d’aperçu. Les messageries peuvent conserver cet aperçu après la suppression de la sortie.",
  "privacy.logsHeading": "Journaux et protection contre les abus",
  "privacy.logs":
    "Le logiciel journalise le type de page demandée et le résultat, jamais de noms, de liens privés, de lieux exacts ni d’adresses IP.",
  "privacy.rateLimits":
    "Pour éviter les abus, le serveur compte les requêtes par adresse IP (par réseau pour IPv6), uniquement en mémoire et pendant environ une heure au plus.",

  "home.intro":
    "Planifiez une course ou une sortie vélo, partagez le lien et voyez qui vient. Aucun compte nécessaire.",
  "home.cta": "Planifier une sortie",

  "error.csrf":
    "Votre formulaire a expiré ou provient d’un autre site. Rechargez la page et réessayez.",
  "error.internal": "Un problème est survenu de notre côté. Veuillez réessayer plus tard.",
  "error.tooLarge": "Cette requête est trop volumineuse.",
  "error.busy": "Le serveur est occupé. Veuillez réessayer dans quelques secondes.",
  "error.rateLimited":
    "Trop de requêtes depuis votre réseau. Veuillez réessayer dans quelques minutes.",
  "error.badRequest":
    "Le formulaire n’a pas pu être traité. Veuillez recharger la page et réessayer.",

  "activity.run": "Course à pied",
  "activity.trail": "Trail",
  "activity.ride": "Sortie vélo de route",
  "activity.gravel": "Sortie gravel",
  "activity.mtb": "Sortie VTT",

  "drop.no_drop": "No-drop : on attend tout le monde",
  "drop.drop": "Drop : suivez le rythme ou continuez de votre côté",

  "unit.minPerKm": "min/km",
  "unit.kmh": "km/h",
  "unit.km": "km",
  "unit.m": "m",

  "unit.minPerMi": "min/mi",
  "unit.mph": "mph",
  "unit.mi": "mi",
  "unit.ft": "ft",

  "form.heading": "Planifier une course ou une sortie vélo",
  "form.errors": "Veuillez vérifier les champs signalés ci-dessous.",
  "form.posterName": "Votre nom",
  "form.posterNameHint": "Affiché sur la sortie avec un badge d’organisateur·rice.",
  "form.activity": "Activité",
  "form.title": "Titre",
  "form.date": "Date",
  "form.time": "Heure de départ",
  "form.timeZone": "Fuseau horaire",
  "form.areaLabel": "Zone de rendez-vous",
  "form.areaLabelHint":
    "Visible par tout le monde, par exemple « Parc de la Tête d’Or, entrée nord ».",
  "form.publicHint":
    "N’indiquez pas ici le point de rendez-vous exact, ce champ est public. Utilisez plutôt « Point de départ exact ».",
  "form.exactStart": "Point de départ exact (facultatif)",
  "form.exactStartHint": "Visible seulement par vous et les personnes inscrites.",
  "form.openModeWarning":
    "Toute personne ayant le lien et qui s’inscrit verra le point de départ exact. Choisissez « Seulement les personnes que j’accepte » pour décider qui le voit.",
  "form.exactDescription": "Où exactement ?",
  "form.coordinates": "Coordonnées (facultatif)",
  "form.latitude": "Latitude",
  "form.longitude": "Longitude",
  "form.areaCoordinates": "Point de la zone sur la carte (facultatif)",
  "form.areaCoordinatesHint":
    "Visible par tout le monde, arrondi à environ 1 km. Inutile si le point de départ exact a des coordonnées.",
  "map.search": "Chercher un lieu",
  "map.searchButton": "Chercher",
  "map.searchHint":
    "Les résultats de recherche et votre position définissent la zone de rendez-vous ; touchez la carte pour le point de départ exact. Les recherches passent par ce site, le service de recherche ne sait donc pas qui vous êtes.",
  "map.searchUnavailable": "La recherche de lieux n’est pas disponible pour le moment.",
  "map.noResults": "Aucun lieu trouvé.",
  "map.locate": "Utiliser ma position",
  "map.pickLegend": "Toucher la carte définit",
  "map.pickExact": "le point de départ exact",
  "map.pickArea": "la zone de rendez-vous",
  "map.pickLabel": "Carte pour choisir un point",
  "map.planLabel": "Carte de la zone de rendez-vous",
  "map.zoomIn": "Zoom avant",
  "map.zoomOut": "Zoom arrière",
  "form.distance": "Distance ({unit}, facultatif)",
  "form.elevation": "Dénivelé positif ({unit}, facultatif)",
  "form.pace": "Allure ou vitesse (facultatif)",
  "form.paceHint":
    "Course à pied : allure par km, par exemple 5:30 à 6:00. Vélo : vitesse en km/h, par exemple 25 à 28.",
  "form.paceHintImperial":
    "Course à pied : allure par mile, par exemple 9:00 à 9:30. Vélo : vitesse en mph, par exemple 15 à 18.",
  "form.paceFrom": "De",
  "form.paceTo": "À",
  "form.joinMode": "Qui peut participer",
  "form.joinOpen": "Toute personne ayant le lien",
  "form.joinApproval": "Seulement les personnes que j’accepte",
  "form.joinModeHint":
    "Avec « Seulement les personnes que j’accepte », les personnes envoient une demande et ne voient le point de départ exact qu’une fois acceptées.",
  "form.dropPolicy": "Règle du groupe",
  "form.note": "Remarque (facultatif)",
  "form.colors": "Couleurs de la sortie",
  "form.primaryColor": "Couleur principale",
  "form.secondaryColor": "Couleur d’accent",
  "form.retention": "Supprimer la sortie",
  "form.retentionDays": {
    one: "{count} jour après la sortie",
    other: "{count} jours après la sortie",
  },
  "form.submit": "Créer la sortie",
  "form.gpx": "Parcours (fichier GPX, facultatif)",
  "form.gpxTrim": "Masquer le début et la fin du parcours",
  "form.gpxTrimHint":
    "Retire le parcours autour du départ et de l’arrivée de votre enregistrement, par exemple votre domicile. Les parties retirées ne sont jamais enregistrées.",
  "form.gpxTrimOff": "Afficher tout le parcours",
  "form.gpxTrimMeters": "Masquer {meters} m à chaque extrémité",
  "form.gpxTrimKilometers": "Masquer {km} km à chaque extrémité",
  "form.gpxTrimMiles": "Masquer environ {miles} mi à chaque extrémité",
  "form.gpxHint":
    "Remplit la distance, le dénivelé et le point de départ exact. Seules les personnes inscrites peuvent voir et télécharger le parcours. Si le formulaire affiche une erreur, choisissez à nouveau le fichier.",

  "field.invalid": "Cette valeur n’est pas valide.",
  "field.required": "Veuillez remplir ce champ.",
  "field.too_long": "C’est trop long.",
  "field.invalid_characters": "Ce champ contient des caractères non autorisés.",
  "field.choice_invalid": "Veuillez choisir l’une des options.",
  "field.datetime_invalid": "Veuillez saisir une date et une heure valides.",
  "field.starts_invalid": "Veuillez saisir une date et une heure valides.",
  "field.starts_in_past": "Le départ doit être dans le futur.",
  "field.starts_beyond_horizon": "Le départ est trop loin dans le futur.",
  "field.timezone_invalid": "Veuillez choisir un fuseau horaire dans la liste.",
  "field.coordinates_invalid": "Veuillez saisir la latitude et la longitude en degrés décimaux.",
  "field.exact_start_too_long": "Veuillez rester sous 200 caractères.",
  "field.exact_start_empty": "Veuillez décrire le point de départ exact ou saisir des coordonnées.",
  "field.number_invalid": "Veuillez saisir un nombre.",
  "field.out_of_range": "Ce nombre est hors limites.",
  "field.pace_invalid": "Veuillez saisir l’allure en minutes et secondes, par exemple 5:30.",
  "field.speed_invalid": "Veuillez saisir la vitesse en nombre entier, par exemple 25.",
  "field.pace_out_of_range": "Cette allure ou vitesse est hors limites.",
  "field.pace_band_reversed": "La valeur la plus rapide doit venir en premier.",
  "field.color_invalid": "Veuillez choisir une couleur.",
  "field.retention_out_of_range": "Veuillez choisir l’une des durées proposées.",
  "field.retention_shorter_than_recap_window": "Veuillez choisir une durée plus longue.",
  "field.route_too_large": "Le fichier dépasse 5 Mo.",
  "field.route_unsafe":
    "Ce fichier ne peut pas être lu en toute sécurité. Veuillez l’exporter à nouveau en fichier GPX simple.",
  "field.route_unreadable": "Cela ne ressemble pas à un fichier GPX.",
  "field.route_empty": "Le fichier ne contient ni trace ni itinéraire.",
  "field.route_too_many_points": "Le parcours compte plus de 50 000 points.",
  "field.route_invalid": "Le fichier contient des coordonnées non valides.",
  "field.route_too_long": "Le parcours dépasse 1 000 km.",
  "field.route_trimmed_away":
    "Masquer le début et la fin supprimerait tout le parcours. Choisissez une distance plus courte.",
  "field.name_taken_by_host": "C’est le nom de l’organisateur·rice. Veuillez en choisir un autre.",
  "field.name_taken_by_response": "Une personne ayant répondu utilise déjà ce nom.",

  "links.heading": "Votre sortie est prête",
  "links.planLink": "Lien de la sortie : à partager",
  "links.hostLink": "Votre lien d’organisation : gardez-le privé",
  "links.hostLinkWarning":
    "Enregistrez-le maintenant. Il n’est affiché qu’une fois, et toute personne qui l’a peut gérer votre sortie. Ce navigateur reste associé en tant qu’organisateur·rice.",
  "links.open": "Ouvrir votre sortie",
  "links.deletion": "La sortie et tout ce qui la concerne seront supprimés le {date}.",

  "plan.gone": "Cette sortie n’existe plus.",
  "plan.host": "organisateur·rice",
  "plan.postedBy": "Proposée par {name}",
  "plan.youAreHost": "Vous organisez cette sortie.",
  "plan.when": "Quand",
  "preview.cancelled": "Annulée : {title}",
  "plan.timeZone": "fuseau {zone}",
  "plan.where": "Zone de rendez-vous",
  "plan.distance": "Distance",
  "plan.elevation": "Dénivelé positif",
  "plan.pace": "Allure",
  "plan.speed": "Vitesse",
  "plan.group": "Groupe",
  "plan.exactStart": "Point de départ exact",
  "plan.exactStartPrivate": "Visible seulement par vous et les personnes inscrites.",
  "plan.openStreetMap": "Ouvrir dans OpenStreetMap",
  "plan.openMapsApp": "Ouvrir dans l’app de cartes",
  "plan.deletion": "Cette sortie sera supprimée le {date}.",

  "plan.counts": "Inscrit·e·s : {participants} · Intéressé·e·s : {interested}",
  "plan.pendingRequests": {
    one: "{count} demande vous attend.",
    other: "{count} demandes vous attendent.",
  },
  "plan.participants": "Qui vient",
  "plan.interestedPeople": "Intéressé·e·s",
  "plan.yourResponse": "Votre réponse",
  "plan.manageResponse": "Modifier ou retirer",
  "plan.cancelled": "Cette sortie a été annulée.",

  "status.interested": "Intéressé·e",
  "status.joined": "Vous êtes inscrit·e",
  "status.requested": "Demande en attente",
  "status.notAnswered": "Sans réponse : l’organisateur·rice n’a pas décidé avant le départ.",
  "status.rejected": "Non accepté·e pour cette sortie.",
  "status.removed": "L’organisateur·rice vous a retiré·e de cette sortie.",

  "respond.heading": "Vous venez ?",
  "respond.name": "Votre nom",
  "respond.nameHint":
    "L’organisateur·rice le voit. Si vous vous inscrivez, les autres participant·e·s le voient aussi.",
  "respond.openModeNote":
    "Toute personne ayant le lien et qui s’inscrit voit le point de départ exact et qui d’autre vient.",
  "respond.interested": "Intéressé·e",
  "respond.join": "Je viens",
  "respond.request": "Demander à participer",
  "respond.note": "Message à l’organisateur·rice (facultatif)",
  "respond.noteHint": "Seul·e l’organisateur·rice le voit.",
  "respond.approvalNote":
    "L’organisateur·rice décide qui participe. Une fois accepté·e, vous voyez le point de départ exact et qui d’autre vient.",
  "respond.closed": "Les réponses sont closes pour cette sortie.",
  "respond.blocked": "Vous ne pouvez pas répondre à cette sortie.",

  "responded.heading": "Réponse enregistrée",
  "responded.manageLink": "Votre lien de gestion : gardez-le privé",
  "responded.manageLinkWarning":
    "Enregistrez-le maintenant. Il n’est affiché qu’une fois. Il vous permet de modifier ou de retirer votre réponse depuis un autre appareil. Ce navigateur reste associé.",
  "responded.back": "Retour à la sortie",

  "manage.heading": "Votre réponse à « {title} »",
  "manage.choice": "Votre réponse",
  "manage.save": "Enregistrer les modifications",
  "manage.locked":
    "Les réponses sont closes. Vous pouvez encore changer votre nom ou vous retirer.",
  "manage.withdraw": "Se retirer…",
  "manage.withdrawExplain": "Cela supprime votre réponse et votre nom de cette sortie.",
  "manage.withdrawConfirm": "Me retirer et supprimer ma réponse",
  "manage.back": "Retour à la sortie",

  "manageLink.heading": "Utiliser ce lien de gestion sur cet appareil ?",
  "manageLink.body": "Ce lien permet de modifier ou de retirer votre réponse à « {title} ».",
  "manageLink.sharedWarning":
    "Ne continuez que sur votre propre appareil : toute personne utilisant ce navigateur pourra ensuite modifier ou retirer votre réponse.",

  "share.heading": "Partager",
  "share.native": "Partager…",
  "share.copy": "Copier le lien",
  "share.copied": "Lien copié.",
  "share.copyFailed": "La copie a échoué. Veuillez copier le lien depuis la barre d’adresse.",

  "plan.managePlan": "Gérer la sortie",
  "plan.route": "Parcours",
  "plan.downloadGpx": "Télécharger le GPX",

  "notify.accepted":
    "Vous êtes inscrit·e. Le point de départ exact est maintenant sur la page de la sortie.",
  "notify.rejected": "Votre demande n’a pas été acceptée pour cette sortie.",
  "notify.removed": "L’organisateur·rice vous a retiré·e de cette sortie.",
  "notify.changed": "La sortie a été modifiée. Consultez les détails.",
  "notify.cancelled": "La sortie a été annulée.",
  "notify.deleted": "L’organisateur·rice a supprimé la sortie.",
  "notify.dayBefore": "Rappel : la sortie a lieu demain.",
  "notify.startsToday": "Rappel : la sortie a lieu aujourd’hui.",
  "notify.deletionReminder":
    "Cette sortie sera bientôt supprimée. Enregistrez ce que vous voulez garder.",
  "notify.recapDeleted": "L’organisateur·rice a supprimé le récapitulatif de cette sortie.",
  "notify.newResponse": "Quelqu’un a répondu à votre sortie.",
  "notify.newRequest": "Quelqu’un demande à rejoindre votre sortie.",
  "notify.withdrawn": "Quelqu’un a retiré sa réponse.",

  "push.enable": "M’avertir pour cette sortie",
  "push.disable": "Désactiver les notifications",
  "push.on": "Les notifications pour cette sortie sont activées dans ce navigateur.",
  "push.blocked": "Les notifications sont bloquées dans les réglages de ce navigateur.",
  "push.failed": "Impossible d’activer les notifications. Veuillez réessayer.",
  "push.hint":
    "Seulement les nouvelles de cette sortie : modifications, annulation, votre demande et rappels.",
  "push.hostHint": "Les nouvelles des réponses, des demandes et des retraits.",

  "host.route": "Parcours",
  "host.routeNone": "Pas encore de parcours.",
  "host.routePresent": "Cette sortie a un parcours.",
  "host.routeUpload": "Importer un parcours",
  "host.routeReplace": "Remplacer le parcours",
  "host.routeRemove": "Retirer le parcours",
  "host.routeHint": "La distance et le dénivelé sont repris du parcours.",

  "host.heading": "Gérer votre sortie",
  "host.saved": "Modifications enregistrées.",
  "host.save": "Enregistrer les modifications",
  "host.retentionOnly":
    "La sortie a commencé ou a été annulée. Vous pouvez encore changer la date de sa suppression.",
  "host.deletesNowWarning": "Cela supprimera la sortie immédiatement.",
  "host.deleteNow": "Supprimer la sortie maintenant",
  "host.people": "Personnes",
  "host.participants": "Inscrit·e·s",
  "host.interested": "Intéressé·e·s",
  "host.removed": "Retiré·e·s",
  "host.noPeople": "Personne n’a encore répondu.",
  "host.remove": "Retirer",
  "host.restore": "Annuler le retrait",
  "host.removeHint":
    "Les personnes retirées perdent l’accès au point de départ exact et ne peuvent plus répondre depuis le même appareil.",
  "host.requests": "Demandes",
  "host.accept": "Accepter",
  "host.reject": "Refuser",
  "host.rejected": "Non accepté·e·s",
  "host.undoReject": "Annuler le refus",
  "host.acceptPendingWarning": {
    one: "{count} demande en attente sera acceptée.",
    other: "{count} demandes en attente seront acceptées.",
  },
  "host.acceptPendingConfirm": "Enregistrer et les accepter",
  "host.cancel": "Annuler la sortie…",
  "host.cancelExplain":
    "L’annulation est définitive. La sortie reste visible avec la mention « annulée » jusqu’à sa suppression. Pour la faire quand même, créez une nouvelle sortie.",
  "host.cancelConfirm": "Annuler cette sortie",
  "host.delete": "Supprimer la sortie…",
  "host.deleteHeading": "Supprimer « {title} » ?",
  "host.deleteExplain": {
    zero: "Cela supprime immédiatement et définitivement la sortie et son point de départ exact. C’est irréversible.",
    one: "Cela supprime immédiatement et définitivement la sortie, son point de départ exact et {count} réponse avec le nom associé. C’est irréversible.",
    other:
      "Cela supprime immédiatement et définitivement la sortie, son point de départ exact et les {count} réponses avec les noms associés. C’est irréversible.",
  },
  "host.deleteConfirm": "Supprimer définitivement",
  "host.back": "Retour à la sortie",

  "hostLink.heading": "Utiliser ce lien d’organisation sur cet appareil ?",
  "hostLink.ogTitle": "Lien privé",
  "hostLink.ogDescription": "Ceci est un lien privé. Merci de ne pas le partager.",
  "hostLink.body": "Ce lien permet de gérer « {title} ».",
  "hostLink.sharedWarning":
    "Ne continuez que sur votre propre appareil : toute personne utilisant ce navigateur pourra ensuite gérer la sortie.",
  "hostLink.confirm": "Utiliser sur cet appareil",
  "hostLink.invalid": "Ce lien n’est pas valide. Il a peut-être été remplacé par un plus récent.",
  "secretLink.confirm": "Utiliser sur cet appareil",
};
