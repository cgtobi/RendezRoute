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
    "Quand vous répondez : le nom que vous indiquez, votre choix et la langue de la page, pour les messages concernant la sortie. Votre nom est enregistré chiffré et visible par l’organisateur·rice, ainsi que par les autres participant·e·s si vous vous inscrivez. Si vous demandez à participer, votre message facultatif à l’organisateur·rice est aussi enregistré chiffré, visible seulement par l’organisateur·rice et supprimé dès sa décision.",
  "privacy.storedRecap":
    "Après une sortie, les participant·e·s et l’organisateur·rice peuvent ajouter des commentaires et des liens à son récapitulatif. Ils sont enregistrés chiffrés, visibles uniquement par les participant·e·s et l’organisateur·rice, et supprimés avec la sortie. Les liens sont affichés comme simples liens ; rien n’est chargé depuis ceux-ci.",
  "privacy.noTracking": "Il n’y a ni comptes, ni mesure d’audience, ni publicité.",
  "privacy.durationHeading": "Durée de conservation",
  "privacy.retention":
    "Chaque sortie est supprimée avec toutes les réponses, tous les noms et son parcours à la date indiquée sur sa page, entre 1 et {days} jours après la sortie, selon le choix de l’organisateur·rice. L’organisateur·rice peut la supprimer plus tôt, et vous pouvez retirer votre réponse à tout moment. Les données supprimées sont écrasées dans la base de données.",
  "privacy.retentionLowered":
    "Les sorties créées avant que ce maximum soit abaissé peuvent garder leur durée plus longue, jusqu’à {max} jours.",
  "privacy.devices":
    "Le lien entre votre navigateur et vos sorties ou réponses est supprimé {unlinkedDays} jours après sa dernière utilisation dès que plus rien n’y est associé, et dans tous les cas après {unusedDays} jours sans utilisation.",
  "privacy.backups":
    "Les sauvegardes automatiques de la base faites avant les mises à jour du logiciel sont supprimées après {days} jours.",
  "privacy.operatorHeading": "Qui peut accéder aux données",
  "privacy.operator":
    "La personne qui exploite ce site peut techniquement accéder à tout ce qui y est enregistré, y compris aux données chiffrées. Le chiffrement protège les données en cas de fuite de sauvegardes de la base si la clé est conservée séparément, mais pas contre l’exploitant·e.",
  "privacy.cookiesHeading": "Cookies",
  "privacy.cookieDevice":
    "Un cookie d’appareil, seulement après avoir créé une sortie, répondu ou ouvert un lien privé : une valeur aléatoire qui associe ce navigateur à ces éléments, conservée {days} jours.",
  "privacy.cookieCsrf":
    "Un cookie de session qui protège les formulaires contre les envois falsifiés. Les navigateurs le suppriment à leur fermeture, sauf s’ils restaurent votre session précédente.",
  "privacy.cookiePreferences":
    "Des cookies de langue et d’unités, seulement si vous choisissez une langue ou des unités en bas d’une page, conservés {days} jours.",
  "privacy.cookieOthers": "Aucun autre cookie, et aucun cookie d’autres sites.",
  "privacy.servicesHeading": "Autres services",
  "privacy.tiles":
    "Les cartes sont chargées par votre navigateur directement depuis {host}. Ce service voit votre adresse IP et la zone de carte que vous consultez.",
  "privacy.tilesServer":
    "Pour les images d’aperçu des liens, ce serveur charge aussi des images de carte de la zone de rendez-vous approximative, sans rien transmettre vous concernant.",
  "privacy.geocoder":
    "La recherche de lieux passe par ce serveur vers {host}. Ce service voit ce que vous cherchez, mais pas qui vous êtes. Les recherches et leurs résultats restent jusqu’à {days} jours dans la mémoire de ce serveur, pour éviter de répéter les requêtes.",
  "privacy.push":
    "Si vous activez les notifications, le service push de votre navigateur (de Google, Mozilla, Apple ou Microsoft) les distribue. Les messages sont chiffrés ; le service voit seulement qu’un message a été envoyé. Pour les envoyer, ce serveur enregistre l’adresse push et les clés de votre navigateur, chiffrées, et les supprime quand vous désactivez les notifications, ou avec la sortie ou votre réponse.",
  "privacy.weather":
    "Pour les prévisions météo sur les pages des sorties, ce serveur interroge {host} sur la zone de rendez-vous approximative et l’heure de départ. Rien vous concernant n’est envoyé. Les prévisions restent jusqu’à {minutes} minutes dans la mémoire de ce serveur.",
  "privacy.calendar":
    "Si vous créez un lien de calendrier, le serveur de votre application de calendrier le récupère. Ce serveur voit les informations publiques de vos sorties et que vous y avez répondu.",
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
  "unit.celsius": "°C",
  "unit.fahrenheit": "°F",

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
  "form.recapWindow": "Récapitulatif",
  "form.recapWindowNow": "Pas de nouveaux commentaires ni liens",
  "form.recapWindow1d": "Ouvert 1 jour après le départ",
  "form.recapWindow1w": "Ouvert 1 semaine après le départ",
  "form.recapWindowShortened":
    "Le récapitulatif a été raccourci pour tenir dans la durée de conservation : {window}.",
  "form.recapWindowHint":
    "Après la sortie, les participant·e·s peuvent ajouter des commentaires et des liens pendant cette durée. Elle ne peut pas dépasser la durée de conservation de la sortie ; un choix plus long est raccourci.",
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
  "field.contribution_empty": "Écrivez un commentaire ou ajoutez un lien.",
  "field.contribution_too_long": "{max} caractères au maximum, s’il vous plaît.",
  "field.link_invalid": "Saisissez une adresse web complète, commençant par https.",
  "field.link_too_long": "Ce lien est trop long.",
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
  "plan.addToCalendar": "Ajouter au calendrier",
  "plan.subscribeCalendar": "Abonner votre calendrier à toutes vos sorties",
  "plan.weather": "Prévisions météo",

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

  "weather.clear": "Ciel dégagé",
  "weather.mainlyClear": "Plutôt dégagé",
  "weather.partlyCloudy": "Partiellement nuageux",
  "weather.overcast": "Couvert",
  "weather.fog": "Brouillard",
  "weather.drizzle": "Bruine",
  "weather.rain": "Pluie",
  "weather.snow": "Neige",
  "weather.rainShowers": "Averses de pluie",
  "weather.snowShowers": "Averses de neige",
  "weather.thunderstorm": "Orage",
  "weather.rainChance": "{percent} de risque de pluie",
  "weather.wind": "vent {speed}",
  "weather.hint": "Pour l’heure de départ, près de la zone de rendez-vous.",
  "weather.source": "Données météo :",

  "recap.heading": "Récapitulatif",
  "recap.tookPlace": {
    one: "Cette sortie a eu lieu. {count} personne y a participé.",
    other: "Cette sortie a eu lieu. {count} personnes y ont participé.",
  },
  "recap.private": "Seules les personnes inscrites à cette sortie voient ceci.",
  "recap.openUntil": "Ouvert aux commentaires et aux liens jusqu’au {date}.",
  "recap.closed": "Fermé aux nouveaux commentaires et liens.",
  "recap.empty": "Pas encore de commentaires ni de liens.",
  "recap.add": "Ajouter au récapitulatif",
  "recap.body": "Commentaire",
  "recap.link": "Lien",
  "recap.linkHint":
    "Par exemple votre activité ou vos photos. Affiché comme simple lien, rien n’est chargé depuis celui-ci.",
  "recap.submit": "Ajouter",
  "recap.edit": "Modifier",
  "recap.delete": "Supprimer",
  "recap.hide": "Masquer",
  "recap.show": "Afficher à nouveau",
  "recap.hidden": "Masqué par l’organisateur·rice : seul·e·s vous et l’organisateur·rice le voyez.",
  "recap.hiddenForHost": "Masqué pour les participant·e·s.",
  "recap.editHeading": "Modifier votre commentaire",
  "recap.save": "Enregistrer",
  "recap.back": "Retour à la sortie",
  "recap.limit": "Vous avez atteint la limite de {count} commentaires et liens pour cette sortie.",
  "recap.closedNow": "Le récapitulatif est fermé aux nouveaux commentaires et liens.",

  "push.enable": "M’avertir pour cette sortie",
  "push.disable": "Désactiver les notifications",
  "push.on": "Les notifications pour cette sortie sont activées dans ce navigateur.",
  "push.blocked": "Les notifications sont bloquées dans les réglages de ce navigateur.",
  "push.failed": "Impossible d’activer les notifications. Veuillez réessayer.",
  "push.hint":
    "Seulement les nouvelles de cette sortie : modifications, annulation, votre demande et rappels.",
  "push.hostHint": "Les nouvelles des réponses, des demandes et des retraits.",

  "calendar.title": "Abonnement de calendrier",
  "calendar.intro":
    "Votre application de calendrier peut afficher toutes les sorties que vous organisez ou auxquelles vous avez répondu dans ce navigateur. Elle les met à jour d’elle-même quand une sortie est modifiée, annulée ou supprimée.",
  "calendar.contents":
    "Le calendrier ne contient que des informations publiques : titre, heure, zone de rendez-vous et lien. Jamais le point de départ exact, le parcours ni le nom de quiconque. Le serveur de votre application de calendrier le récupère et voit donc ces informations et que vous avez répondu.",
  "calendar.create": "Créer le lien de calendrier",
  "calendar.active": "Ce navigateur a un lien de calendrier.",
  "calendar.renew": "Obtenir un nouveau lien",
  "calendar.renewHint":
    "L’ancien lien cesse alors de fonctionner. Utilisez cette option si vous avez perdu le lien ou l’avez partagé par erreur.",
  "calendar.nothingYet":
    "Créez d’abord une sortie ou répondez à une sortie dans ce navigateur. Le lien de calendrier affiche ces sorties.",
  "calendar.stop": "Arrêter le lien de calendrier",
  "calendar.linkHeading": "Votre lien de calendrier",
  "calendar.subscribe": "S’abonner dans votre application de calendrier",
  "calendar.copy": "Ou ajoutez cette adresse dans votre application de calendrier :",
  "calendar.linkWarning":
    "Ce lien n’est affiché qu’une seule fois. Toute personne qui l’a voit les informations publiques de vos sorties ; gardez-le privé.",
  "calendar.expiry":
    "Le lien fonctionne tant que vous ouvrez ce site de temps en temps dans ce navigateur. Les mises à jour de votre calendrier ne comptent pas : si vous n’ouvrez pas le site dans ce navigateur pendant {days} jours, les données de ce navigateur sont supprimées, lien compris.",
  "calendar.yourPlan": "{title} (votre sortie)",
  "calendar.cancelled": "Annulée : {title}",
  "calendar.deletionEntry": "« {title} » sera supprimée aujourd’hui",
  "calendar.exactStart": "Point de départ exact : {start}",

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
  "host.recap": "Récapitulatif",
  "host.recapWindowHint":
    "Après le départ, une modification compte à partir de maintenant. Les commentaires et liens existants restent.",
  "host.recapDelete": "Supprimer le récapitulatif",
  "host.recapDeleteExplain": {
    one: "Cela supprime le {count} commentaire ou lien du récapitulatif, pour tout le monde. Les participant·e·s qui ont activé les notifications sont prévenu·e·s.",
    other:
      "Cela supprime les {count} commentaires et liens du récapitulatif, pour tout le monde. Les participant·e·s qui ont activé les notifications sont prévenu·e·s.",
  },
  "host.recapDeleteConfirm": "Supprimer le récapitulatif",
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
  "form.template": "Répéter plus tard",
  "form.keepAsTemplate": "Garder comme modèle réutilisable",
  "form.templateIncludePrivate": "Inclure le point de départ exact et le parcours",
  "form.templateHint":
    "Quand la sortie est supprimée, ses informations restent 90 jours comme modèle, associé aux appareils sur lesquels vous l’organisez, pour que vous puissiez la répéter à une nouvelle date. Les réponses, les noms des participant·e·s et le récapitulatif ne sont jamais gardés.",
  "home.templates": "Vos modèles",
  "host.deleteKeepsTemplate":
    "Ses informations restent comme modèle réutilisable, associé aux appareils sur lesquels vous l’organisez.",
  "host.saveTemplate": "Enregistrer comme modèle",
  "host.saveTemplateExplain":
    "Enregistre les informations de cette sortie comme modèle, avec son propre lien privé, pour la répéter à une nouvelle date. Les réponses, les noms et le récapitulatif ne sont pas inclus.",
  "host.saveTemplateConfirm": "Enregistrer le modèle",
  "template.label": "Modèle",
  "template.startTime": "Départ à {time} ({zone})",
  "template.includesExactStart": "Avec le point de départ exact",
  "template.includesRoute": "Avec le parcours",
  "template.expires": "Supprimé le {date}, sauf si vous le répétez ou le modifiez d’ici là.",
  "template.repeatHeading": "Répéter",
  "template.repeatHint":
    "Crée une nouvelle sortie à partir de ce modèle, avec de nouveaux liens et sans réponses.",
  "template.repeatSubmit": "Créer la sortie",
  "template.edit": "Modifier le modèle",
  "template.editHeading": "Modifier le modèle",
  "template.back": "Retour au modèle",
  "template.save": "Enregistrer le modèle",
  "template.saved": "Modèle enregistré.",
  "template.removeRoute": "Retirer le parcours",
  "template.delete": "Supprimer le modèle",
  "template.deleteExplain":
    "Cela supprime définitivement le modèle et son lien. Les sorties créées à partir de lui restent.",
  "template.deleteConfirm": "Supprimer définitivement le modèle",
  "template.gone": "Ce modèle n’existe pas, ou cet appareil n’y est pas associé.",
  "template.needsEdit":
    "Certains réglages ne respectent plus les règles de ce site. Veuillez les modifier, puis répéter le modèle.",
  "template.adjusted": "Certains réglages ont été adaptés aux règles actuelles de ce site :",
  "template.adjustedRetention": {
    one: "Supprimée {count} jour après la sortie au lieu de {from} jours.",
    other: "Supprimée {count} jours après la sortie au lieu de {from} jours.",
  },
  "template.adjustedRecapWindow": "Récapitulatif : « {to} » au lieu de « {from} ».",
  "template.savedHeading": "Modèle enregistré",
  "template.savedBody":
    "« {title} » est enregistré comme modèle. Vous pouvez le répéter à une nouvelle date.",
  "template.link": "Votre lien de modèle : gardez-le privé",
  "template.linkWarning":
    "Enregistrez-le maintenant. Il n’est affiché qu’une fois, et toute personne qui l’a peut répéter, modifier ou supprimer le modèle. Ce navigateur y reste associé.",
  "template.open": "Ouvrir le modèle",
  "templateLink.heading": "Utiliser ce lien de modèle sur cet appareil ?",
  "templateLink.body":
    "Ce lien vous permet de répéter, modifier ou supprimer le modèle « {title} ».",
  "templateLink.sharedWarning":
    "Ne continuez que sur votre propre appareil : toute personne utilisant ce navigateur pourra ensuite utiliser le modèle.",
  "privacy.myData":
    "Vous pouvez à tout moment consulter, exporter et supprimer vous-même tout ce qui est associé à votre navigateur :",
  "privacy.ratings":
    "Après une sortie, les participant·e·s peuvent l’évaluer d’un pouce levé ou baissé, avec un message facultatif. Seul·e l’organisateur·rice voit les évaluations, une fois le récapitulatif clos et seulement pour les sorties d’au moins 3 participant·e·s ; les messages affichent le nom de leur auteur·rice. Les évaluations sont enregistrées avec le message chiffré et supprimées avec la sortie, la réponse ou vos données.",
  "privacy.templates":
    "Si l’organisateur·rice choisit « Garder comme modèle réutilisable » ou enregistre un modèle, les informations de la sortie, y compris le nom de l’organisateur·rice, sont gardées comme modèle, jamais ses réponses, les noms des participant·e·s, son récapitulatif ni ses évaluations. Le point de départ exact et le parcours ne sont gardés que si l’organisateur·rice les inclut, et alors chiffrés. Un modèle est supprimé après 90 jours sans être répété ni modifié.",
  "linkTools.heading": "Lien privé",
  "linkTools.explain":
    "Vous avez perdu votre lien privé, ou quelqu’un d’autre l’a peut-être ? Un nouveau lien remplace l’ancien, et les appareils qui l’utilisent déjà restent connectés.",
  "linkTools.newLink": "Obtenir un nouveau lien",
  "linkTools.signOut": "Déconnecter tous les autres appareils",
  "linkTools.signOutExplain":
    "Tous les autres appareils qui utilisent ce lien perdent l’accès, cet appareil le garde. Si le lien a circulé, obtenez aussi un nouveau lien.",
  "linkTools.signOutNotifications":
    "Les notifications sont désactivées sur tous les appareils, celui-ci compris ; vous pouvez les réactiver ici.",
  "linkTools.signOutConfirm": "Déconnecter les autres appareils",
  "linkTools.signedOut": {
    zero: "Aucun autre appareil n’était connecté.",
    one: "{count} autre appareil a été déconnecté.",
    other: "{count} autres appareils ont été déconnectés.",
  },
  "linkTools.newHeading": "Votre nouveau lien",
  "linkTools.oldLinkStopped": "L’ancien lien ne fonctionne plus.",
  "linkTools.alreadyIssued":
    "Ce lien a déjà été affiché, rien n’a donc changé. Si vous ne l’avez pas enregistré, obtenez-en un nouveau.",
  "linkTools.back": "Retour",
  "layout.myData": "Mes données",
  "export.plan": "Exporter cette sortie (ZIP)",
  "export.template": "Exporter ce modèle (ZIP)",
  "export.response": "Exporter ma réponse (ZIP)",
  "export.recapHeading": "Vos contributions au récapitulatif : {title}",
  "export.hiddenByHost": "Masqué par l’organisateur·rice",
  "myData.heading": "Mes données sur cet appareil",
  "myData.intro":
    "Tout ce à quoi ce navigateur est associé. Vous pouvez activer ou désactiver les notifications, remplacer un lien privé, déconnecter les autres appareils, tout exporter ou tout supprimer.",
  "myData.empty": "Rien n’est associé à cet appareil.",
  "myData.hosted": "Sorties que vous organisez",
  "myData.responses": "Vos réponses",
  "myData.templates": "Vos modèles",
  "myData.cancelled": "annulée",
  "myData.export": "Exporter (ZIP)",
  "myData.calendar": "Abonnement d’agenda",
  "myData.calendarOn": "Cet appareil a un abonnement d’agenda.",
  "myData.calendarOff": "Cet appareil n’a pas d’abonnement d’agenda.",
  "myData.calendarManage": "Gérer l’abonnement d’agenda",
  "myData.exportHeading": "Exporter ou supprimer",
  "myData.exportHint":
    "L’export est un fichier ZIP avec vos sorties, réponses et modèles : les informations dans data.json, des fichiers d’agenda, les parcours en GPX et vos propres contributions au récapitulatif. Les autres personnes n’apparaissent que par leur nom.",
  "myData.exportAll": "Tout exporter (ZIP)",
  "myData.delete": "Supprimer mes données",
  "myData.deleteHeading": "Tout supprimer sur cet appareil ?",
  "myData.deleteExplain": "Cela supprime immédiatement et définitivement :",
  "myData.deletePlans": {
    one: "{count} sortie que vous organisez, pour tout le monde ; les personnes encore inscrites à une sortie à venir sont prévenues",
    other:
      "{count} sorties que vous organisez, pour tout le monde ; les personnes encore inscrites à une sortie à venir sont prévenues",
  },
  "myData.deleteResponses": {
    one: "{count} réponse, comme si vous l’aviez retirée",
    other: "{count} réponses, comme si vous les aviez retirées",
  },
  "myData.deleteTemplates": { one: "{count} modèle", other: "{count} modèles" },
  "myData.deleteFeed": "l’abonnement d’agenda",
  "myData.deleteDevice": "l’association de ce navigateur à tout cela",
  "myData.deleteNoTemplates": "Aucun modèle n’est gardé des sorties supprimées.",
  "myData.deleteConfirm": "Tout supprimer définitivement",
  "myData.back": "Retour à mes données",
  "myData.deleted": "Vos données sur cet appareil ont été supprimées.",
  "rating.heading": "Évaluer la sortie",
  "rating.question": "Comment ça s’est passé ?",
  "rating.up": "Bien passé",
  "rating.down": "Pas très bien passé",
  "rating.note": "Message à l’organisateur·rice (facultatif)",
  "rating.submit": "Enregistrer l’évaluation",
  "rating.remove": "Retirer mon évaluation",
  "rating.yours": "Votre évaluation :",
  "rating.closed": "L’évaluation est close.",
  "rating.notYetOpen": "L’évaluation ouvre une fois la sortie commencée.",
  "rating.closedNow": "L’évaluation de cette sortie est close.",
  "rating.honesty":
    "Seul·e l’organisateur·rice voit les évaluations et, dans un petit groupe, peut deviner qui en a donné une. Les messages affichent votre nom.",
  "rating.back": "Retour à la sortie",
  "rating.resultHeading": "Évaluations",
  "rating.resultLater":
    "Les participant·e·s peuvent évaluer la sortie tant que le récapitulatif est ouvert. Vous voyez le résultat ici une fois qu’il est clos, pour les sorties d’au moins 3 participant·e·s.",
  "rating.result": {
    zero: "Aucun·e des {participants} participant·e·s n’a évalué la sortie.",
    one: "{count} sur {participants} a évalué : {up} bien, {down} pas bien",
    other: "{count} sur {participants} ont évalué : {up} bien, {down} pas bien",
  },
  "rating.resultTooFew": "Les sorties de moins de 3 participant·e·s n’affichent pas d’évaluations.",
};
