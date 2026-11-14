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
  "layout.menu": "Menu",
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
  "privacy.cookieAdmin":
    "L’administration reçoit, après connexion, un cookie de connexion distinct valable {hours} heures. Les visiteur·euse·s ne le reçoivent jamais.",
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
  "privacy.share": "WhatsApp n’est contacté que si vous utilisez son lien de partage.",
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
  "error.notFound": "Cette page n’existe pas.",
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
  "form.shareButtons": "Boutons de partage sur la page de la sortie",
  "form.shareCopy": "Copier le lien",
  "form.shareNative": "Le menu de partage de l’appareil (sur téléphone)",
  "form.shareWhatsApp": "WhatsApp",
  "form.shareButtonsHint":
    "Seul le lien de la sortie est partagé. Là où l’appareil a un menu de partage, il remplace le bouton WhatsApp.",
  "form.visibility": "Qui peut trouver cette sortie",
  "form.visibilityLink": "Seulement les personnes ayant le lien",
  "form.visibilityPublic": "Tout le monde : listée dans « À proximité » sur ce site",
  "form.visibilityPublicHint":
    "Une sortie publique peut être trouvée par tout le monde, qui voit alors ce que la page de la sortie montre à tous : le titre, le nom de l’organisateur·rice, la date et l’heure, la zone de rendez-vous, l’activité, la distance, l’allure et la remarque. Le point de départ exact, le parcours et les noms des personnes qui répondent restent cachés, comme pour toute sortie.",
  "form.publicNeedsLogin": "Les sorties publiques demandent un compte sur ce site.",
  "form.publicLogIn": "Se connecter",
  "field.public_needs_login":
    "Les sorties publiques demandent un compte sur ce site : connectez-vous, ou réservez la sortie aux personnes ayant le lien.",
  "form.visibilityFollowers":
    "Les abonné·e·s de {handle} dans le fédivers (tout le monde peut s’y abonner), et les personnes ayant le lien",
  "form.visibilityFollowersNone":
    "Les abonné·e·s dans le fédivers (tout le monde peut s’y abonner), et les personnes ayant le lien",
  "form.visibilityPublicShared":
    "Tout le monde : listée dans « À proximité » sur ce site et partagée dans le fédivers par {handle}",
  "form.visibilityPublicProfile": "Tout le monde : partagée dans le fédivers par {handle}",
  "form.followersNeedsProfile":
    "Les abonné·e·s demandent un profil fédivers, à configurer une fois sur la page du compte.",
  "form.followersSetUp": "Le configurer",
  "form.followersLogInSetUp": "Se connecter et configurer un profil",
  "form.fediverseShared":
    "Cette sortie est partagée dans le fédivers. Si vous la rendez trouvable par moins de personnes, elle y est retirée pour de bon et n’est plus partagée ; vos abonné·e·s n’y accèdent alors que par son lien.",
  "form.fediverseWithdrawn": "Cette sortie a été retirée du fédivers et n’y est plus partagée.",
  "field.followers_needs_profile":
    "Les abonné·e·s demandent votre profil fédivers : configurez-le sur la page du compte, ou choisissez une autre option.",
  "field.handle_invalid": "Veuillez utiliser de 1 à 30 lettres minuscules, chiffres ou _.",
  "field.handle_reserved": "Ce nom est réservé au site lui-même. Veuillez en choisir un autre.",
  "field.handle_taken": "Ce nom est pris ou a déjà été utilisé. Veuillez en choisir un autre.",
  "profile.heading": "Profil fédivers",
  "profile.intro":
    "Avec un profil, les personnes du fédivers (par exemple sur Mastodon) vous trouvent sous @nom@{host}, peuvent vous suivre et voient vos prochaines sorties publiques.",
  "profile.notice":
    "En l’activant, vous devenez visible dans le fédivers : tout le monde peut y voir votre nom d’affichage et vos prochaines sorties publiques, et leurs serveurs peuvent en garder des copies. Tout le monde peut s’abonner à vous sans demander, et les sorties pour vos abonné·e·s atteignent toutes les personnes abonnées. Le nom vous appartient pour de bon : il ne peut pas être changé, et une fois le profil désactivé, il est retiré et personne ne peut plus l’utiliser.",
  "profile.handle": "Votre nom dans le fédivers",
  "profile.handleHint": "Lettres minuscules, chiffres et _, jusqu’à 30.",
  "profile.turnOn": "Activer mon profil fédivers",
  "profile.on": "Votre profil fédivers est {handle}.",
  "profile.view": "Le voir",
  "profile.turnOff": "Désactiver mon profil fédivers…",
  "profile.turnOffExplain":
    "Le désactiver retire {handle} pour de bon : personne ne peut plus l’utiliser, vous non plus. Les sorties pour vos abonné·e·s deviennent des sorties pour les personnes ayant le lien, et vos abonné·e·s apprennent que le profil a disparu.",
  "profile.turnOffConfirm": "Désactiver et retirer {handle}",
  "profile.turnedOn": "Votre profil fédivers est activé.",
  "profile.followers": {
    one: "1 personne du fédivers est abonnée à vous.",
    other: "{count} personnes du fédivers sont abonnées à vous.",
  },
  "profile.turnedOff": {
    one: "Votre profil fédivers est désactivé. 1 sortie pour les abonné·e·s est maintenant pour les personnes ayant le lien.",
    other:
      "Votre profil fédivers est désactivé. {count} sorties pour les abonné·e·s sont maintenant pour les personnes ayant le lien.",
  },
  "actorProfile.organises": "Organise des sorties à pied et à vélo sur {instance}.",
  "actorProfile.upcoming": "Prochaines sorties publiques",
  "actorProfile.none": "Pas de sortie publique à venir pour le moment.",
  "actorProfile.gone": "Ce profil fédivers a été désactivé.",
  "privacy.profiles":
    "Si vous activez un profil fédivers, le nom choisi, votre nom d’affichage et vos prochaines sorties publiques peuvent être vus par tout le monde dans le fédivers, et d’autres serveurs peuvent en garder des copies. Ses clés de signature sont stockées chiffrées. Les sorties pour vos abonné·e·s et les sorties publiques, enregistrées après l’activation, sont envoyées avec leurs informations publiques aux serveurs de vos abonné·e·s, qui peuvent en garder des copies ; les modifications aussi, et supprimer une sortie ou la rendre trouvable par moins de personnes leur demande de la retirer. Tout le monde dans le fédivers peut s’y abonner : l’adresse et les boîtes de réception d’une personne abonnée sont stockées chiffrées jusqu’à ce qu’elle se désabonne, que son compte soit supprimé, que le profil soit désactivé ou que ce site cesse de participer au fédivers, et seul leur nombre est affiché. Les messages aux abonné·e·s attendent dans une file avec l’adresse de leur boîte de réception pendant 12 heures au plus ; le dernier, qui annonce la disparition du profil, garde jusque-là la clé de signature dont il a besoin. Le désactiver, ou supprimer votre compte, retire le nom : seule une empreinte chiffrée en est gardée, pour qu’il ne soit jamais réutilisé.",
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
    "Si le point de rendez-vous a un emplacement sur la carte, le parcours est coupé pour commencer là, et pour y finir s’il y revient. Tout autre départ ou arrivée, par exemple votre domicile, est masqué sur la distance choisie ici. Ce qui est retiré n’est jamais enregistré.",
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
  "plan.public": "Publique",
  "plan.followers": "Abonné·e·s",
  "plan.fediverseJoin":
    "Sur Mastodon, vous pouvez suivre l’organisateur·rice, mais l’inscription se fait sur cette page.",
  "plan.fediverseJoinLogin":
    "Sur Mastodon, vous pouvez suivre l’organisateur·rice, mais l’inscription se fait sur cette page : connectez-vous avec votre compte du fédivers.",
  "plan.host": "organisateur·rice",
  "plan.postedBy": "Proposée par {name}",
  "plan.youAreHost": "Vous organisez cette sortie.",
  "plan.when": "Quand",
  "preview.cancelled": "Annulée : {title}",
  "plan.timeZone": "fuseau {zone}",
  "note.start": "Départ : {when}",
  "note.place": "Point de rendez-vous : {place}",
  "note.coordinates": "Coordonnées : {lat}, {lng}",
  "note.route": "Le parcours est joint en fichier GPX.",
  "note.plan": "Page de la sortie : {link}",
  "note.copies": "Votre serveur peut conserver des copies de ce message.",
  "recapNote.intro": "{author} a écrit dans le récapitulatif :",
  "recapNote.link": "Lien : {link}",
  "recapNote.plan": "Page de la sortie : {link}",
  "recapNote.copies": "Votre serveur peut conserver des copies de ce message.",
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

  "email.refuse": "Ce n’est pas vous ? Ne rien envoyer à cette adresse",
  "email.lastWhy":
    "Cette sortie n’existe plus, aucun autre e-mail ne sera donc envoyé à son sujet.",
  "emailLink.refuse": "Ne pas envoyer d’e-mails",
  "privacy.emailRateLimit":
    "Les demandes de lien de confirmation sont aussi comptées par adresse e-mail, sous forme d’empreinte gardée uniquement en mémoire, pour que personne ne puisse inonder la boîte d’autrui.",
  "email.accountOn": "Les e-mails sur votre compte vont à {address}.",
  "email.accountLabel": "E-mail pour votre compte",
  "email.accountHint":
    "Pour les avis sur votre compte, comme un avertissement avant la suppression d’un compte inutilisé. Nous envoyons d’abord un lien pour confirmer l’adresse.",
  "email.useAccount": "Utiliser {address} de votre compte",
  "email.accountConfirmSubject": "Confirmer les e-mails sur votre compte sur {instance}",
  "email.accountHeading": "Votre compte sur {instance}",
  "email.accountConfirmBody":
    "Quelqu’un a demandé des e-mails sur un compte sur {instance} à cette adresse, comme un avertissement avant la suppression d’un compte inutilisé. Si c’était vous, confirmez avec le lien ci-dessous. Sinon, ignorez cet e-mail : rien d’autre ne sera envoyé.",
  "notice.expirySubject": "Votre compte sur {instance} sera supprimé le {date}",
  "notice.expiryBody":
    "Il n’a pas été utilisé depuis presque un an. Pour le garder, utilisez-le avant le {date} : connectez-vous, ou ouvrez le site sur un appareil connecté. Sinon, il sera supprimé avec tout ce qui lui appartient.",
  "email.openAccount": "Ouvrir votre compte",
  "email.accountWhy":
    "Vous recevez cet e-mail parce que vous avez ajouté cette adresse à votre compte sur {instance}.",
  "email.newLinkSubject": "Votre nouveau lien pour « {title} »",
  "email.newLinkBody":
    "Voici votre nouveau lien privé. Les anciens liens ne fonctionnent plus ; les appareils qui les utilisent déjà restent connectés.",
  "email.newLinkAction": "Ouvrir avec le nouveau lien",
  "email.newLinkWhy":
    "Vous recevez cet e-mail parce que vous avez demandé un nouveau lien sur {instance}.",
  "emailLink.accountConfirmBody":
    "Recevoir les e-mails sur votre compte sur {instance} à {address} ?",
  "emailLink.accountOffBody": "Arrêter les e-mails sur votre compte sur {instance} à {address} ?",
  "linkTools.emailLink": "M’envoyer un nouveau lien par e-mail",
  "linkTools.emailLinkHint":
    "Envoie un nouveau lien à {address}. Les anciens liens ne fonctionneront plus ; les appareils qui les utilisent déjà restent connectés.",
  "linkTools.emailed":
    "Nous avons envoyé un nouveau lien à {address}. Les anciens liens ne fonctionnent plus.",
  "linkTools.emailFailed":
    "L’e-mail n’a pas pu être envoyé. Rien n’a changé ; veuillez réessayer plus tard.",
  "privacy.accountEmail":
    "Si vous ajoutez une adresse e-mail à votre compte, elle est stockée chiffrée, utilisée uniquement pour les e-mails sur le compte (comme l’avertissement avant la suppression d’un compte inutilisé) et pour les sorties pour lesquelles vous la choisissez, et supprimée avec le compte.",
  "email.hostShared": "Toutes les personnes qui gèrent cette sortie voient cette adresse.",
  "channels.more": "D’autres façons d’être notifié·e",
  "ntfy.label": "Application ntfy",
  "ntfy.hint":
    "Des notifications dans l’application ntfy (Android, iPhone ou navigateur), via {server}. Aucun compte n’y est nécessaire.",
  "ntfy.accountHint":
    "Les avis sur votre compte, comme un avertissement avant la suppression d’un compte inutilisé, dans l’application ntfy via {server}.",
  "ntfy.setUp": "Configurer ntfy",
  "ntfy.pending":
    "Dans l’application ntfy, abonnez-vous à ce sujet, puis touchez le message envoyé pour confirmer. Rien d’autre n’est envoyé avant.",
  "ntfy.open": "Ouvrir dans ntfy",
  "ntfy.resend": "Renvoyer le message",
  "ntfy.on":
    "Les notifications ntfy vont à ce sujet. Gardez-le pour vous : quiconque le connaît peut les lire.",
  "ntfy.off": "Désactiver ntfy",
  "ntfy.turnOff": "Désactiver ntfy",
  "ntfy.confirm": "Confirmer",
  "ntfy.confirmTitle": "Confirmer les notifications ntfy de {instance}",
  "ntfy.confirmBody":
    "Touchez ici pour recevoir les notifications sur « {title} ». Si vous ne les avez pas demandées, ignorez ce message : rien d’autre ne sera envoyé.",
  "ntfy.accountConfirmBody":
    "Touchez ici pour recevoir les avis sur votre compte sur {instance}. Si vous ne les avez pas demandés, ignorez ce message : rien d’autre ne sera envoyé.",
  "ntfyLink.confirmHeading": "Confirmer les notifications ntfy",
  "ntfyLink.offHeading": "Désactiver les notifications ntfy",
  "ntfyLink.confirmBody": "Recevoir les notifications sur « {title} » dans l’application ntfy ?",
  "ntfyLink.accountConfirmBody":
    "Recevoir les avis sur votre compte sur {instance} dans l’application ntfy ?",
  "ntfyLink.offBody": "Arrêter les notifications ntfy sur « {title} » ?",
  "ntfyLink.accountOffBody": "Arrêter les avis ntfy sur votre compte sur {instance} ?",
  "ntfyLink.confirm": "Confirmer",
  "ntfyLink.refuse": "Ne pas envoyer de notifications",
  "ntfyLink.off": "Désactiver ntfy",
  "ntfyLink.confirmed": "Les notifications ntfy sont activées.",
  "ntfyLink.turnedOff": "Les notifications ntfy sont désactivées.",
  "privacy.publicPlans":
    "Les organisateur·rice·s peuvent rendre une sortie publique. Tout le monde peut alors la trouver dans « À proximité » et voir ce que la page de la sortie montre à tous : le titre, le nom de l’organisateur·rice, la date et l’heure, la zone de rendez-vous, l’activité, la distance, l’allure et la remarque. Le point de départ exact, le parcours et les noms des personnes qui répondent restent cachés, comme pour toute sortie.",
  "privacy.publicPlansProfile":
    "Les organisateur·rice·s ayant un profil fédivers peuvent rendre une sortie publique. Tout le monde peut alors la trouver sur ce profil et dans le fédivers et voir ce que la page de la sortie montre à tous : le titre, le nom de l’organisateur·rice, la date et l’heure, la zone de rendez-vous, l’activité, la distance, l’allure et la remarque. Le point de départ exact, le parcours et les noms des personnes qui répondent restent cachés, comme pour toute sortie.",
  "privacy.ntfy":
    "Si vous activez ntfy, les notifications sont envoyées au serveur ntfy {server} sous un sujet aléatoire créé par l’application ; quiconque connaît le sujet peut les lire. Le sujet est stocké chiffré et supprimé avec votre réponse, la sortie ou le compte.",
  "channelLink.invalid":
    "Ce lien ne fonctionne plus. Les notifications sont peut-être déjà désactivées, ou la sortie n’existe plus.",
  "ntfy.hostShared":
    "Toutes les personnes qui gèrent cette sortie voient ce sujet et peuvent lire ses notifications.",
  "telegram.label": "Telegram",
  "telegram.hint":
    "Des notifications de notre bot dans Telegram. Telegram reçoit le titre de la sortie, ce qui s’est passé, ainsi que l’heure et le lieu.",
  "telegram.accountHint":
    "Les avis sur votre compte, comme un avertissement avant la suppression d’un compte inutilisé, de notre bot dans Telegram.",
  "telegram.connect": "Connecter Telegram",
  "telegram.pending": "Ouvrez le bot dans Telegram et touchez Démarrer. Rien n’est envoyé avant.",
  "telegram.unreachable":
    "En attente de Démarrer, mais Telegram est injoignable pour le moment. Réessayez plus tard.",
  "telegram.hostShared":
    "Toutes les personnes qui gèrent cette sortie voient ce lien ; la première qui touche Démarrer reçoit les notifications de la sortie.",
  "telegram.open": "Ouvrir Telegram",
  "telegram.onPage": "Les notifications Telegram sont activées.",
  "telegram.off": "Désactiver Telegram",
  "telegram.turnOff": "Désactiver Telegram",
  "telegram.on":
    "Les notifications sur « {title} » sont activées. Vous pouvez les désactiver avec le bouton ci-dessous.",
  "telegram.accountOn":
    "Les avis sur votre compte sur {instance} sont activés. Vous pouvez les désactiver avec le bouton ci-dessous.",
  "telegramLink.offHeading": "Désactiver les notifications Telegram",
  "telegramLink.offBody": "Arrêter les notifications Telegram sur « {title} » ?",
  "telegramLink.accountOffBody": "Arrêter les avis Telegram sur votre compte sur {instance} ?",
  "telegramLink.off": "Désactiver Telegram",
  "telegramLink.turnedOff": "Les notifications Telegram sont désactivées.",
  "privacy.telegram":
    "Si vous connectez Telegram, les messages du bot (le titre d’une sortie, ce qui s’est passé, l’heure et le lieu) passent par les serveurs de Telegram jusqu’à votre conversation. Le numéro de la conversation est stocké chiffré et supprimé avec votre réponse, la sortie ou le compte.",
  "email.label": "E-mail pour les nouvelles de cette sortie",
  "email.hint":
    "Nous envoyons d’abord un lien pour confirmer l’adresse. Chaque e-mail contient un lien pour les désactiver.",
  "email.submit": "Envoyer le lien de confirmation",
  "email.pending":
    "Ouvrez le lien envoyé à {address} pour la confirmer. Rien d’autre n’est envoyé avant.",
  "email.resend": "Renvoyer le lien",
  "email.on": "Les e-mails sur cette sortie vont à {address}.",
  "email.off": "Désactiver les e-mails",
  "email.openPlan": "Ouvrir la sortie",
  "email.why":
    "Vous recevez cet e-mail parce que vous avez activé les e-mails pour « {title} » sur {instance}.",
  "email.turnOff": "Désactiver ces e-mails",
  "email.confirmSubject": "Confirmer les e-mails sur « {title} »",
  "email.confirmBody":
    "Quelqu’un a demandé des e-mails sur cette sortie à cette adresse. Si c’était vous, confirmez avec le lien ci-dessous. Sinon, ignorez cet e-mail : rien d’autre ne sera envoyé.",
  "email.confirmAction": "Confirmer l’adresse",
  "email.confirmWhy":
    "Vous recevez cet e-mail parce que cette adresse a été saisie sur {instance}.",
  "email.reportSubject": "Nouveau signalement sur {instance}",
  "email.reportBody":
    "Quelqu’un a signalé une sortie. La page d’administration affiche le signalement.",
  "email.reportBodyNoLink":
    "Quelqu’un a signalé une sortie. Ouvrez les pages d’administration pour voir le signalement.",
  "email.reportAction": "Ouvrir la page d’administration",
  "email.reportWhy":
    "Vous recevez cet e-mail parce que cette adresse est l’adresse de contact de {instance}.",
  "emailLink.confirmHeading": "Confirmer votre adresse e-mail",
  "emailLink.confirmBody": "Recevoir les e-mails sur « {title} » à {address} ?",
  "emailLink.confirm": "Confirmer l’adresse",
  "emailLink.offHeading": "Désactiver les e-mails",
  "emailLink.offBody": "Arrêter les e-mails sur « {title} » à {address} ?",
  "emailLink.off": "Désactiver les e-mails",
  "emailLink.confirmed": "Adresse confirmée. Vous recevrez les e-mails sur cette sortie.",
  "emailLink.turnedOff": "Les e-mails sur cette sortie sont désactivés.",
  "field.email_invalid": "Saisissez une adresse e-mail, par exemple name@example.org.",
  "privacy.email":
    "Si vous activez les e-mails pour une sortie, votre adresse est stockée chiffrée, utilisée uniquement pour ces e-mails et supprimée avec votre réponse ou la sortie. Chaque e-mail contient un lien pour les désactiver ; rien n’est envoyé avant votre confirmation.",
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
  "template.repeatSharedFollowers":
    "La nouvelle sortie est envoyée aux abonné·e·s de {handle} dans le fédivers, et aux personnes ayant le lien.",
  "template.repeatSharedPublic":
    "La nouvelle sortie est partagée dans le fédivers par {handle}, avec tout le monde.",
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
  "template.adjustedVisibility":
    "Seules les personnes ayant le lien peuvent la trouver : les sorties publiques demandent un compte sur ce site.",
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
  "nearby.title": "À proximité",
  "nearby.intro": "Les sorties publiques de ce site près d’un lieu que vous choisissez.",
  "nearby.placePrivacy":
    "Un endroit choisi sur la carte ou votre position est arrondi à environ 2 km dans votre navigateur avant d’être envoyé. Un lieu saisi est transmis au service de recherche de lieux puis arrondi de la même façon ; sans JavaScript, il figure aussi dans l’adresse de cette requête. Rien n’en est enregistré ni journalisé ici.",
  "nearby.place": "Lieu",
  "nearby.placeHint": "Une ville, un quartier ou un parc.",
  "nearby.locate": "Utiliser ma position",
  "nearby.mapLabel": "Touchez la carte pour chercher autour de cet endroit",
  "nearby.atPoint": "Autour de l’endroit choisi (arrondi à environ 2 km).",
  "nearby.radius": "Dans un rayon de",
  "nearby.from": "Premier jour",
  "nearby.to": "Dernier jour",
  "nearby.activity": "Activité",
  "nearby.anyActivity": "Toutes",
  "nearby.distance": "Distance en {unit}",
  "nearby.atLeast": "Au moins",
  "nearby.atMost": "Au plus",
  "nearby.pace": "Allure ou vitesse",
  "nearby.paceHint":
    "Choisissez d’abord une activité : minutes et secondes pour la course (par exemple 5:30), une vitesse pour le vélo.",
  "nearby.filters": "Plus de filtres : rayon, jours, activité, distance, allure",
  "nearby.search": "Rechercher",
  "nearby.results": { one: "1 sortie publique", other: "{count} sorties publiques" },
  "nearby.truncated":
    "Les {count} premières, par début. Affinez la recherche pour en voir d’autres.",
  "nearby.none":
    "Aucune sortie publique ne correspond. Essayez un rayon plus grand ou d’autres jours.",
  "nearby.close": "à moins de 2 km",
  "nearby.away": "à environ {distance}",
  "nearby.placeNotFound":
    "Ce lieu est introuvable. Essayez un autre nom, la carte ou votre position.",
  "nearby.placeUnavailable":
    "Les lieux ne peuvent pas être recherchés pour le moment. Utilisez plutôt la carte ou votre position.",
  "nearby.nothingPublic":
    "Les sorties de ce site ne peuvent pas être publiques : il n’y a donc rien à trouver ici.",
  "home.nearby": "Trouver des sorties publiques à proximité",
  "layout.nearby": "À proximité",
  "privacy.federation":
    "Ce site participe au fédivers en tant que @{host}@{host}. D’autres serveurs peuvent récupérer les informations publiques d’une sortie par son adresse, comme toute personne ayant le lien peut les voir. Quand un serveur envoie un message à ce site, celui-ci récupère la clé publique de ce serveur pour vérifier la signature du message, et la conserve jusqu’à {days} jours. Tout le monde dans le fédivers peut s’abonner à ce site : l’adresse et les boîtes de réception d’une personne abonnée sont stockées chiffrées jusqu’à ce qu’elle se désabonne, que son compte soit supprimé ou que ce site cesse de participer au fédivers, et seul leur nombre est affiché. Le site lui-même ne partage aucune sortie : seuls les profils fédivers le font. Les personnes du fédivers peuvent rejoindre une sortie depuis leur propre serveur : l’adresse et les boîtes de réception d’une telle personne participante sont stockées chiffrées jusqu’à ce qu’elle parte, que son compte soit supprimé ou que la sortie soit supprimée ; pour une personne refusée ou retirée par l’organisateur ou l’organisatrice, elles restent comme blocage jusqu’à la suppression de la sortie ou de son compte. Le nom affiché vient de son profil, et l’organisateur ou l’organisatrice et les personnes acceptées peuvent le voir. Les modifications de la sortie sont envoyées à chaque personne séparément tant qu’elle est inscrite, et sa suppression à toutes celles qui ont rejoint, et leur serveur peut en garder des copies.",
  "privacy.federationNotes":
    "Quand une personne du fédivers rejoint une sortie et est acceptée, le point de départ exact et le parcours lui sont envoyés en message direct par l’acteur de ce site ou par le profil de l’organisateur ou de l’organisatrice, et à personne d’autre : le départ exact en texte, le parcours en fichier GPX derrière un lien privé que toute personne qui le détient peut ouvrir jusqu’au retrait du message. Le message est retiré quand la personne part, est retirée ou que la sortie est supprimée ; les modifications du départ exact, de l’heure ou du parcours lui sont renvoyées. Son serveur peut en garder des copies, que ce site ne peut pas supprimer.",
  "privacy.federationRecap":
    "Quand des personnes du fédivers ont rejoint une sortie, chaque commentaire ou lien ajouté à son récapitulatif leur est envoyé en message direct par l’acteur de ce site ou par le profil de l’organisateur ou de l’organisatrice, sous le nom de l’auteur ou de l’autrice tel que le voient les personnes inscrites, et à personne d’autre ; l’auteur ou l’autrice ne reçoit pas le sien. Une personne qui a rejoint depuis le fédivers peut répondre en privé à un tel message : la réponse devient un commentaire du récapitulatif, vu par l’organisateur ou l’organisatrice et les personnes inscrites sous le nom affiché pour son compte, et transmis de la même façon aux autres participants du fédivers. Les modifications sont renvoyées, et un message est retiré quand son commentaire est supprimé ou masqué, quand son auteur ou la personne à qui il a été envoyé part ou est retiré, ou quand la sortie est annulée ou supprimée ; une personne qui rejoint plus tard reçoit les 50 derniers commentaires. Son serveur peut en garder des copies, que ce site ne peut pas supprimer. Les participants du fédivers ne font pas partie de l’export des données d’un compte, qui reste inchangé.",
  "privacy.federationReports":
    "Un serveur du fédivers peut envoyer à ce site un signalement concernant une sortie ou l’un des messages de ce site adressés aux personnes de ce serveur. Il parvient à l’administration de l’instance comme n’importe quel autre signalement, avec le texte envoyé par l’autre serveur et, s’il désigne l’un de ces messages, une copie de son texte et de son lien sans l’auteur ni l’autrice. Ce site n’enregistre ni qui ni quel serveur l’a envoyé.",
  "fediverseDm.label": "Messages du fédivers",
  "fediverseDm.hint":
    "Les avis sur votre compte, comme un avertissement avant la suppression d’un compte inutilisé, en messages directs de {instance} à votre compte du fédivers. Votre serveur conserve les messages directs ; vous pouvez les désactiver ici.",
  "fediverseDm.on":
    "Les avis sur votre compte vous parviennent en messages directs de {instance}. Votre serveur les conserve.",
  "fediverseDm.turnOn": "Activer les messages du fédivers",
  "fediverseDm.off": "Désactiver les messages du fédivers",
  "fediverseDm.notFound":
    "Ce compte est injoignable pour le moment. Vérifiez que le serveur accepte les messages d’autres serveurs, ou réessayez plus tard.",
  "fediverseDm.first":
    "Les messages de {instance} vous parviennent désormais ici, en messages directs. Ils ne concernent que votre compte, comme un avertissement avant la suppression d’un compte inutilisé.",
  "fediverseDm.keeps":
    "Votre serveur conserve les messages directs ; ce site ne peut pas les supprimer.",
  "fediverseDm.turnOff": "Pour les désactiver, ouvrez la page de votre compte : {link}",
  "privacy.federationMessages":
    "Si vous vous connectez par le fédivers et activez les messages du fédivers sur la page de votre compte, ce site recherche votre adresse du fédivers à chaque envoi et vous envoie un message direct depuis son acteur : un à l’activation, puis les avis sur votre compte, comme l’avertissement avant la suppression d’un compte inutilisé. Votre serveur conserve les messages directs, que ce site ne peut pas supprimer. Ce site ne retient que le fait que l’option est activée et la langue de la page utilisée, pas votre acteur ni votre boîte de réception ; un message en attente de livraison est conservé chiffré 12 heures au plus et supprimé avec votre compte.",
  "fediverseDm.paused":
    "Les messages du fédivers sont activés, mais ce site n’en envoie aucun pour le moment. Vous pouvez les désactiver ici.",
  "privacy.nearby":
    "« À proximité » n’utilise le lieu d’où vous cherchez que pour cette recherche. Un endroit choisi sur la carte ou votre position est arrondi à environ 2 km par votre navigateur avant d’être envoyé, puis à nouveau par le serveur. Un lieu saisi est recherché comme pour la recherche de lieux ci-dessus, et la recherche continue depuis son endroit arrondi ; sans JavaScript, le lieu saisi figure dans l’adresse de cette première requête. Rien n’en est enregistré ni écrit dans les journaux de ce site. L’endroit arrondi figure dans l’adresse de la page de résultats et peut donc rester dans l’historique de votre navigateur et dans le journal d’accès du serveur web placé devant ce site.",
  "field.range_invalid": "Le dernier jour précède le premier.",
  "field.date_too_far": "Ce jour est plus loin qu’aucune sortie ne peut l’être.",
  "field.pace_needs_activity": "Choisissez une activité pour filtrer par allure ou vitesse.",
  "field.place_invalid": "Veuillez saisir de 2 à 100 caractères.",
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
  "myData.loggedIn": "Ce navigateur est connecté à votre compte.",
  "myData.accountManage": "Votre compte",
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
  "myData.deleteKeepsAccount":
    "Ce navigateur est connecté à un compte. Le compte lui-même reste ; ce navigateur est seulement déconnecté.",
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
  "report.link": "Signaler cette sortie",
  "report.heading": "Signaler « {title} »",
  "report.intro":
    "Votre signalement est envoyé uniquement à l’administration de cette instance. Il n’indique pas qui l’a envoyé et est supprimé avec la sortie.",
  "report.reason": "Quel est le problème ?",
  "report.reason.spam": "Spam ou publicité",
  "report.reason.inappropriate": "Inapproprié ou offensant",
  "report.reason.unsafe": "Risqué ou dangereux",
  "report.reason.other": "Autre chose",
  "report.details": "Précisions (facultatif)",
  "report.detailsHint": "L’administration ne peut pas vous répondre.",
  "report.attach": "Joindre des commentaires du récapitulatif (facultatif)",
  "report.attachHint":
    "L’administration ne voit pas le récapitulatif. Cochez des commentaires ou des liens pour lui en envoyer une copie, sans le nom de leurs auteur·rice·s.",
  "report.submit": "Envoyer le signalement",
  "report.sent": "Merci. Votre signalement a été envoyé à l’administration.",
  "report.sentTitle": "Signalement envoyé",
  "report.back": "Retour à la sortie",
  "privacy.reports":
    "Signalements : si vous signalez une sortie, l’administration reçoit le motif, vos précisions et une copie des commentaires du récapitulatif que vous joignez, sans le nom de leurs auteur·rice·s. Les signalements n’indiquent pas qui les a envoyés et sont supprimés avec la sortie.",
  "admin.openReports": {
    zero: "Aucun signalement ouvert",
    one: "{count} signalement ouvert",
    other: "{count} signalements ouverts",
  },
  "admin.attached": "Commentaires joints, sans leurs auteur·rice·s :",
  "admin.reportNotFound":
    "Ce signalement n’existe plus. Les signalements sont supprimés avec leur sortie.",
  "admin.resolve": "Marquer comme traité",
  "admin.resolvedReports": {
    zero: "Aucun signalement traité",
    one: "{count} signalement traité",
    other: "{count} signalements traités",
  },
  "admin.title": "Administration de l’instance",
  "admin.loginHeading": "Connexion à l’administration",
  "admin.token": "Jeton d’administration",
  "admin.tokenHint": "L’ADMIN_TOKEN de cette instance.",
  "admin.login": "Se connecter",
  "admin.loginFailed": "Ce jeton n’est pas le bon.",
  "admin.logout": "Se déconnecter",
  "admin.findPlan": "Trouver une sortie",
  "admin.findPlanHint": "Collez le lien ou l’identifiant de la sortie.",
  "admin.findPlanSubmit": "Trouver la sortie",
  "admin.planNotFound": "Aucune sortie ne correspond à ce lien ou à cet identifiant.",
  "admin.planHeading": "Sortie : {title}",
  "admin.planPublic": "Seules les informations publiques de la sortie sont affichées ici.",
  "admin.postedBy": "Organisateur·rice : {name}",
  "admin.counts": "{participants} participant·e·s, {interested} intéressé·e·s",
  "admin.deleteExplain":
    "Supprime la sortie pour tout le monde, immédiatement et définitivement. Les personnes encore inscrites à une sortie à venir sont prévenues. Aucun modèle n’est gardé.",
  "admin.deleteConfirm": "Supprimer définitivement la sortie",
  "admin.deleted": "La sortie a été supprimée.",
  "admin.back": "Retour à l’administration",
  "account.dataHeading": "Dans votre compte",
  "account.dataEmpty":
    "Rien pour l’instant. Les sorties et réponses que vous créez en étant connecté·e, ou que vous transférez ici, apparaissent ici.",
  "account.deleteAt":
    "Si vous n’utilisez pas votre compte, il sera supprimé le {date}, avec tout ce qu’il contient.",
  "account.export": "Exporter les données du compte (ZIP)",
  "account.deleteLink": "Supprimer le compte",
  "account.deleteHeading": "Supprimer votre compte ?",
  "account.deleteItself": "le compte lui-même et son nom affiché",
  "account.mayPost":
    "Un lien d’invitation permet à votre compte de créer des sorties ici (depuis le {date}).",
  "account.deleteMayPost":
    "son autorisation de créer des sorties, obtenue par un lien d’invitation",
  "account.deleteProfile":
    "son profil fédivers {handle} : ses abonné·e·s apprennent qu’il a disparu puis sont oublié·e·s, et le nom est retiré pour de bon",
  "account.deleteLogsOut":
    "Les navigateurs connectés à ce compte sont déconnectés ; ce qu’ils contiennent eux-mêmes reste.",
  "account.deleteConfirm": "Supprimer le compte définitivement",
  "account.accountDeleted": "Votre compte a été supprimé.",
  "account.back": "Retour à votre compte",
  "privacy.accountExpiry":
    "Les comptes inutilisés pendant {days} jours sont supprimés, avec tout ce qu’ils contiennent.",
  "account.claimHeading": "Transférer dans votre compte",
  "account.claimIntro":
    "Ce navigateur contient ceci, hors de votre compte. Dans votre compte, ces éléments sont accessibles depuis chaque appareil où vous êtes connecté·e ; ce navigateur ne les a alors plus que lorsqu’il est connecté.",
  "account.claimPlans": {
    zero: "aucune sortie",
    one: "{count} sortie que vous organisez",
    other: "{count} sorties que vous organisez",
  },
  "account.claimResponses": {
    zero: "aucune réponse",
    one: "{count} réponse à une sortie",
    other: "{count} réponses à des sorties",
  },
  "account.claimTemplates": {
    zero: "aucun modèle",
    one: "{count} modèle",
    other: "{count} modèles",
  },
  "account.claimSubmit": "Transférer dans mon compte",
  "account.claimed": "Transféré dans votre compte.",
  "account.fediverseHeading": "Se connecter avec un compte du fédivers",
  "account.fediverseServer": "Votre serveur",
  "account.fediverseHint":
    "Par exemple mastodon.social, ou votre identifiant comme @vous@votre.serveur.",
  "account.fediverseHandleHint":
    "Si le domaine de votre identifiant n’est pas l’adresse de votre serveur, saisissez l’adresse du serveur.",
  "account.fediverseServers": "Serveurs acceptés : {servers}",
  "account.fediverseSubmit": "Continuer",
  "account.continue": "Continuer vers {server}",
  "account.continueText":
    "Connectez-vous là-bas et autorisez l’accès. Vous reviendrez ensuite ici.",
  "account.serverUnavailable":
    "Ce serveur est injoignable ou n’accepte pas d’enregistrer cette instance pour la connexion. Veuillez vérifier l’adresse ou réessayer plus tard.",
  "field.server_invalid":
    "Veuillez saisir l’adresse de votre serveur, par exemple mastodon.social.",
  "field.server_not_allowed": "La connexion avec ce serveur n’est pas possible ici.",
  "privacy.fediverse":
    "Connexion avec le fédivers : lorsque vous vous connectez avec un compte du fédivers, votre navigateur passe par votre serveur, où cette instance enregistre une application pour cette seule connexion. Elle peut lire les informations de votre compte, y compris qui vous suivez ; elle sert uniquement à savoir quel compte est le vôtre, et l’accès est rendu juste après. Conservés ici, chiffrés : votre serveur et l’identifiant de votre compte, votre identifiant de fédivers et votre nom affiché.",
  "layout.account": "Compte",
  "account.heading": "Votre compte",
  "account.intro":
    "La connexion est facultative. Elle associe ce navigateur à votre compte ; vous pouvez vous déconnecter à tout moment.",
  "account.loginWith": "Se connecter avec {name}",
  "account.linked": "Ce navigateur est connecté à votre compte.",
  "account.displayName": "Nom affiché",
  "account.displayNameHint":
    "Rempli comme votre nom lorsque vous planifiez une course ou une sortie vélo.",
  "account.save": "Enregistrer",
  "account.logout": "Se déconnecter",
  "account.logoutHint":
    "Déconnecte uniquement ce navigateur. Votre compte, et tout ce que ce navigateur contient lui-même, restent ; les notifications de ce navigateur pour les sorties de votre compte s’arrêtent.",
  "account.loggedIn": "Vous êtes connecté·e.",
  "account.loggedOut": "Ce navigateur est déconnecté.",
  "account.renamed": "Votre nom affiché a été enregistré.",
  "account.loginFailed": "La connexion n’a pas abouti. Veuillez la recommencer dans ce navigateur.",
  "account.unavailable":
    "Le service de connexion est injoignable pour le moment. Veuillez réessayer plus tard.",
  "account.tryAgain": "Retour à la connexion",
  "posting.loginHeading": "Connexion nécessaire",
  "posting.loginNeeded":
    "Sur cette instance, seules les personnes connectées peuvent créer des sorties.",
  "posting.login": "Se connecter",
  "privacy.oidc":
    "Connexion avec {name} ({host}) : lorsque vous vous connectez, votre navigateur passe par {host}, qui indique à cette instance quel compte vous avez utilisé. Conservés ici, chiffrés : l’identifiant de ce compte et votre nom affiché. Aucun mot de passe ni jeton n’est conservé.",
  "privacy.cookieLogin":
    "Pendant la connexion, un cookie de connexion pendant au plus {minutes} minutes, pour que seul ce navigateur puisse la terminer.",
  "posting.heading": "Invitation nécessaire",
  "posting.inviteNeeded":
    "Sur cette instance, seules les personnes ayant un lien d’invitation peuvent créer des sorties. Demandez-en un à la personne qui la gère.",
  "posting.contact": "Contact :",
  "invite.heading": "Utiliser cette invitation sur cet appareil ?",
  "invite.body": "Ce lien d’invitation vous permet de créer des sorties sur {instance}.",
  "invite.warning":
    "Ne continuez que sur votre propre appareil : toute personne utilisant ce navigateur pourra ensuite créer des sorties ici.",
  "invite.invalid":
    "Ce lien d’invitation n’est pas valide. Il a peut-être expiré, été épuisé ou été révoqué. Demandez-en un nouveau.",
  "privacy.invites":
    "Liens d’invitation : seules les personnes ayant un lien d’invitation peuvent créer des sorties ici. Lorsque vous en confirmez un, ce navigateur est enregistré comme autorisé à créer des sorties, avec l’invitation utilisée. Cela est supprimé lorsque vous supprimez vos données sur cet appareil, ou après 12 mois sans utilisation.",
  "myData.browserHeading": "Ce navigateur",
  "myData.mayPost":
    "Un lien d’invitation permet à ce navigateur de créer des sorties ici (depuis le {date}).",
  "myData.deleteMayPost":
    "l’autorisation de créer des sorties qu’un lien d’invitation a donnée à ce navigateur",
  "field.date_invalid": "Veuillez saisir une date valide.",
  "field.expiry_in_past": "Veuillez choisir aujourd’hui ou un jour ultérieur.",
  "admin.invites": "Liens d’invitation",
  "admin.invitesHint":
    "Avec un lien d’invitation, un navigateur peut créer des sorties sur cette instance. Chaque lien n’est affiché qu’une fois, juste après sa création.",
  "admin.inviteExpiresOn": "Dernier jour (facultatif)",
  "admin.inviteExpiresOnHint": "Le lien fonctionne jusqu’à la fin de ce jour ({zone}).",
  "admin.inviteMaxUses": "Nombre maximal d’utilisations (facultatif)",
  "admin.inviteMaxUsesHint": "Combien de navigateurs peuvent utiliser le lien.",
  "admin.inviteCreate": "Créer un lien d’invitation",
  "admin.noInvites": "Aucun lien d’invitation pour l’instant.",
  "admin.inviteUsable": "Actif",
  "admin.inviteExpired": "Expiré",
  "admin.inviteUsedUp": "Épuisé",
  "admin.inviteRevoked": "Révoqué",
  "admin.inviteCreatedOn": "créé le {date}",
  "admin.inviteLastDay": "dernier jour : {date}",
  "admin.inviteUsed": {
    zero: "pas encore utilisé",
    one: "utilisé une fois",
    other: "utilisé {count} fois",
  },
  "admin.inviteUses": "{uses} utilisations sur {max}",
  "admin.inviteRevoke": "Révoquer",
  "admin.inviteNotFound": "Ce lien d’invitation n’existe pas.",
  "admin.inviteCreatedHeading": "Nouveau lien d’invitation",
  "admin.inviteCreated":
    "Voici le nouveau lien d’invitation. Copiez-le maintenant : il n’est affiché que cette fois.",
  "admin.inviteWarning":
    "Toute personne disposant de ce lien peut créer des sorties ici jusqu’à son expiration, son épuisement ou sa révocation.",
};
