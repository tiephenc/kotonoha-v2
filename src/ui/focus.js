// KOTONOHA 2.0 · Focus (F-M09) : composant du minuteur. Module ES autonome : il ne dépend que du domaine
// (core/focus.js) et des classes CSS du design system (jetons.css, composants.css, composants-2.css, focus.css).
//
// Règles tenues ici :
//  - aucun son sans action : une ambiance ne démarre que sur un appui de l'apprenant, le carillon et les
//    notifications sont désactivés par défaut et ne s'activent que sur un appui ;
//  - D-34 et PR-07 : ni compteur de blocs, ni série, ni score, ni message qui culpabilise ;
//  - D-85 et T-A11Y-06 : aucune animation en boucle ; la barre de progression change par paliers, sans transition ;
//  - l'heure vient de `opts.maintenant` ; l'affichage se recalcule sur l'heure de fin, pas sur des ticks ;
//  - persistance (clé « kotonoha2.focus.v1 ») : l'état du minuteur et les réglages survivent au rechargement. Au
//    chargement, rien ne sonne et aucune permission n'est demandée : les ambiances ne sont pas restaurées, le carillon
//    et les notifications ne le sont que comme réglages (la permission, elle, n'est jamais redemandée).
//  - cycle de vie : `monterFocus` rend `detruire()`, à appeler au démontage de la vue (voir LISEZMOI-V2, § 11).
import * as F from '../core/focus.js';
import { sonnerCarillon } from './carillon.js';
import { lireMasque, ecrireMasque } from './pause-prefs.js';

/** Ambiances de la V1 (dossier sons/), crédits et licences repris tels quels. */
export const AMBIANCES = Object.freeze([
  { id: 'pluie', titre: 'Pluie', fichier: 'rain', credit: 'alex36917 (Freesound n° 524605), édition Porrumentzio', licence: 'CC BY', url: 'https://freesound.org/people/alex36917/sounds/524605/' },
  { id: 'orage', titre: 'Orage', fichier: 'storm', credit: 'Digifish music (Freesound n° 41739), édition Porrumentzio', licence: 'CC BY', url: 'https://freesound.org/people/digifishmusic/sounds/41739/' },
  { id: 'riviere', titre: 'Rivière', fichier: 'stream', credit: 'gluckose (Freesound n° 333987)', licence: 'CC0', url: 'https://freesound.org/people/gluckose/sounds/333987/' },
  { id: 'vagues', titre: 'Vagues', fichier: 'waves', credit: 'Luftrum (Freesound n° 48412), édition Porrumentzio', licence: 'CC BY', url: 'https://freesound.org/people/Luftrum/sounds/48412/' },
  { id: 'vent', titre: 'Vent', fichier: 'wind', credit: 'felix.blume (Freesound n° 217506), édition Porrumentzio', licence: 'CC0', url: 'https://freesound.org/people/felix.blume/sounds/217506/' },
  { id: 'oiseaux', titre: 'Oiseaux', fichier: 'birds', credit: 'kvgarlic (Freesound n° 156826), édition Porrumentzio', licence: 'CC0', url: 'https://freesound.org/people/kvgarlic/sounds/156826/' },
  { id: 'nuit', titre: 'Nuit d’été', fichier: 'summer-night', credit: 'Lisa Redfern (SoundBible n° 2083)', licence: 'domaine public', url: 'https://soundbible.com/2083-Crickets-Chirping-At-Night.html' },
  { id: 'feu', titre: 'Feu de bois', fichier: 'fireplace', credit: 'ezwa (SoundBible n° 1543)', licence: 'domaine public', url: 'https://soundbible.com/1543-Fireplace.html' },
  { id: 'cafe', titre: 'Café', fichier: 'coffee-shop', credit: 'stephan (SoundBible n° 1664)', licence: 'domaine public', url: 'https://soundbible.com/1664-Restaurant-Ambiance.html' },
].map(Object.freeze));

const NBSP = ' '; // U+00A0, espace insécable

/** Vue Focus pour la coquille de l'application : route et titre (le h1 de la vue appartient à la coquille). */
export const VUE_FOCUS = Object.freeze({ route: '#/focus', titre: 'Focus' });
export const CLE_STOCKAGE = 'kotonoha2.focus.v1';

/** Libellés par phase : ton sobre, jamais de reproche. */
export const TEXTES = Object.freeze({
  phase: { idle: 'Prêt quand vous l’êtes', work: 'Concentration', wdone: 'Bloc terminé', brk: 'Pause', bdone: 'Pause terminée' },
  suspendu: { work: 'Concentration en pause', brk: 'Pause suspendue' },
  aide: {
    idle: (e) => `Un bloc de ${e.travailMin} minutes, puis ${e.pauseMin} minutes de pause.`,
    work: () => 'Une seule chose à la fois.',
    wdone: (e) => `Étirez-vous, buvez un peu d’eau${NBSP}: ${e.pauseMin} minutes pour vous.`,
    brk: () => 'Respirez. Le prochain bloc commencera quand vous le déciderez.',
    bdone: () => 'Reprenez quand vous voulez.',
  },
  annonce: {
    debutTravail: (e) => `Bloc commencé, ${e.travailMin} minutes.`,
    debutPause: (e) => `Pause commencée, ${e.pauseMin} minutes.`,
    pause: 'Minuteur en pause.',
    reprise: 'Minuteur repris.',
    arret: 'Minuteur arrêté.',
    finTravail: 'Bloc terminé. Une pause vous attend quand vous voulez.',
    finPause: 'Pause terminée. Reprenez quand vous voulez.',
  },
  // Reprise après rechargement ou veille : constat unique, ton neutre, aucune mention de reproche.
  reprise: {
    illisible: `Les réglages enregistrés étaient illisibles${NBSP}: le minuteur repart de zéro.`,
    fin: (phase, ms) => {
      const m = Math.floor(Math.max(0, ms) / 60_000);
      const quand = m < 1 ? 'à l’instant' : m < 120 ? `il y a ${m}${NBSP}min` : `il y a ${Math.floor(m / 60)}${NBSP}h`;
      return `${phase === 'work' ? 'Bloc terminé' : 'Pause terminée'} ${quand}.`;
    },
  },
});

const h = (tag, attrs = {}, ...enfants) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; el.setAttribute(k, v === true ? '' : String(v)); }
  el.append(...enfants);
  return el;
};

/**
 * @param {HTMLElement} racine Élément qui recevra le composant.
 * @param {Object} [opts]
 * @param {() => number} [opts.maintenant] Horloge en ms (défaut : Date.now).
 * @param {string} [opts.baseSons] Dossier des mp3 (défaut : ../sons/).
 * @param {(url: string) => HTMLAudioElement} [opts.creerAudio]
 * @param {() => AudioContext} [opts.creerContexteAudio]
 * @param {typeof Notification} [opts.Notification]
 * @param {() => boolean} [opts.masque] Vrai si l'onglet est en arrière-plan (défaut : document.hidden).
 * @param {string} [opts.prefixe] Préfixe des identifiants (défaut : foc).
 * @param {import('../core/focus.js').EtatFocus} [opts.etat] État initial (prioritaire sur l'état enregistré ; les réglages enregistrés restent appliqués).
 * @param {{getItem: Function, setItem: Function, removeItem: Function}|null} [opts.stockage] Stockage clé/valeur (défaut : localStorage ; null : aucune persistance).
 * @param {string} [opts.cleStockage] Clé d'enregistrement (défaut : kotonoha2.focus.v1).
 * @param {(() => void)|null} [opts.ouvrirPause] Ouvre l'écran de pause (coquille) : appelé quand la pause commence ici, et par le bouton « Écran de pause ». Absent : pas d'écran de pause (page autonome).
 * @returns {{etat: Function, synchroniser: Function, detruire: Function, sonsActifs: Function, reprise: Function}}
 */
export function monterFocus(racine, opts = {}) {
  const maintenant = opts.maintenant || (() => Date.now());
  const baseSons = opts.baseSons ?? '../sons/';
  const creerAudio = opts.creerAudio || ((url) => new Audio(url));
  const creerContexte = opts.creerContexteAudio || (() => { const C = globalThis.AudioContext || globalThis.webkitAudioContext; return C ? new C() : null; });
  const Notif = 'Notification' in opts ? opts.Notification : globalThis.Notification;
  const masque = opts.masque || (() => document.hidden);
  const p = opts.prefixe || 'foc';
  const id = (s) => `${p}-${s}`;

  const cle = opts.cleStockage || CLE_STOCKAGE;
  const stockage = (() => { if ('stockage' in opts) return opts.stockage; try { return globalThis.localStorage ?? null; } catch (e) { return null; } })();
  let dernierEnreg = null; // dernier texte enregistré : une écriture seulement quand quelque chose change

  let etat = opts.etat || F.creer();
  let minuteur = null, detruit = false;
  let volume = 0.6, arretFin = true, carillonOn = false, notifOn = false;
  /** @type {Map<string, HTMLAudioElement>} */
  const sons = new Map();
  let contexte = null;

  // ------------------------------------------------------------------ structure
  const titre = h('h2', { id: id('titre') }, 'Minuteur de concentration');
  const phase = h('p', { class: 'foc-phase', id: id('phase') });
  const temps = h('p', { class: 'foc-temps', id: id('temps'), role: 'timer', 'aria-live': 'off', 'aria-label': 'Temps restant' });
  const rempli = h('div', { class: 'foc-barre-rempli' });
  const barre = h('div', { class: 'foc-barre', 'aria-hidden': 'true' }, rempli);
  const aide = h('p', { class: 'foc-aide', id: id('aide') });
  const principal = h('button', { type: 'button', class: 'btn btn-principal', id: id('principal') });
  const suite = h('button', { type: 'button', class: 'btn btn-secondaire', id: id('suite') });
  const stop = h('button', { type: 'button', class: 'btn btn-discret', id: id('arreter') }, 'Arrêter');
  const masquer = h('button', { type: 'button', class: 'btn btn-discret', id: id('masquer-temps'), 'aria-pressed': 'false' }, 'Masquer le temps');
  const poserMasque = (m) => { masquer.setAttribute('aria-pressed', String(m)); masquer.textContent = m ? 'Afficher le temps' : 'Masquer le temps'; temps.classList.toggle('kds-masque', m); };
  masquer.addEventListener('click', () => { const m = masquer.getAttribute('aria-pressed') !== 'true'; poserMasque(m); ecrireMasque(stockage, m); });
  const boutonPause = h('button', { type: 'button', class: 'btn btn-secondaire', id: id('ecran-pause'), hidden: true }, 'Écran de pause');
  if (opts.ouvrirPause) boutonPause.addEventListener('click', () => opts.ouvrirPause());
  const commandes = h('div', { class: 'foc-commandes', role: 'group', 'aria-label': 'Commandes du minuteur' }, principal, suite, boutonPause, stop, masquer);
  const annonce = h('p', { class: 'foc-annonce', id: id('annonce'), role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const message = h('p', { class: 'foc-message', id: id('message'), role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

  // Durées
  const radios = F.PRESETS.map((pr, i) => {
    const input = h('input', { class: 'chk-input', type: 'radio', name: id('preset'), id: id('preset-' + i), value: String(i) });
    const label = h('label', { class: 'chk chk-radio' }, input, h('span', { class: 'chk-boite', 'aria-hidden': 'true' }), h('span', { class: 'chk-texte' }, `${pr.travailMin}${NBSP}min de travail, ${pr.pauseMin}${NBSP}min de pause`));
    return { input, label, pr };
  });
  const saisie = (cle, libelle, b) => {
    const input = h('input', { class: 'fld-input foc-nombre', type: 'number', id: id(cle), min: b.min, max: b.max, step: 1, inputmode: 'numeric' });
    return { input, champ: h('div', { class: 'fld' }, h('label', { class: 'fld-label', for: id(cle) }, `${libelle} (${b.min} à ${b.max}${NBSP}min)`), input) };
  };
  const sT = saisie('travail', 'Durée du bloc', F.BORNES.travail), sP = saisie('pause', 'Durée de la pause', F.BORNES.pause);
  const aideDurees = h('p', { class: 'fld-aide', id: id('aide-durees') }, 'Les durées se règlent entre deux blocs. Ces durées sont des conventions, sans effet démontré sur la concentration : le préréglage 90/15 et les blocs de plus de 50 minutes n’ont pas de fondement expérimental.');
  const durees = h('fieldset', { class: 'chk-groupe foc-groupe', id: id('durees') },
    h('legend', { class: 'fld-label' }, 'Durées'), ...radios.map((r) => r.label), sT.champ, sP.champ, aideDurees);

  // Interrupteur (role=switch), même rendu que le design system
  const interrupteur = (cle, libelle, aideTxt, onChange) => {
    const bouton = h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': 'false', id: id(cle), 'aria-describedby': id(cle + '-aide') },
      h('span', { class: 'sw-texte' }, libelle), h('span', { class: 'sw-piste', 'aria-hidden': 'true' }, h('span', { class: 'sw-curseur' })), h('span', { class: 'sw-etat', 'aria-hidden': 'true' }, 'Désactivé'));
    const set = (on) => { bouton.setAttribute('aria-checked', on ? 'true' : 'false'); bouton.querySelector('.sw-etat').textContent = on ? 'Activé' : 'Désactivé'; };
    bouton.addEventListener('click', () => { if (bouton.getAttribute('aria-disabled') === 'true') return; onChange(bouton.getAttribute('aria-checked') !== 'true'); });
    return { bouton, set, bloc: h('div', { class: 'foc-interrupteur' }, bouton, h('p', { class: 'fld-aide', id: id(cle + '-aide') }, aideTxt)) };
  };
  const swCarillon = interrupteur('carillon', 'Carillon à la fin', 'Un court son à la fin d’un bloc ou d’une pause. Désactivé par défaut. Seulement quand la page Focus est affichée et le navigateur ouvert ; sur téléphone, un écran verrouillé suspend le minuteur.', (on) => regCarillon(on));
  const swNotif = interrupteur('notification', 'Notification du navigateur', 'Seulement si l’onglet est en arrière-plan, et seulement si vous l’autorisez. Seulement quand la page Focus est affichée et le navigateur ouvert ; sur téléphone, un écran verrouillé suspend le minuteur.', (on) => regNotif(on));
  if (!Notif) { swNotif.bouton.setAttribute('aria-disabled', 'true'); swNotif.bloc.querySelector('.fld-aide').textContent = 'Indisponible dans ce navigateur.'; }
  const alertes = h('fieldset', { class: 'foc-groupe' }, h('legend', { class: 'fld-label' }, 'À la fin d’un bloc'), swCarillon.bloc, swNotif.bloc);

  // Ambiances
  const boutonsAmb = AMBIANCES.map((a) => h('button', { type: 'button', class: 'btn btn-secondaire foc-amb', 'aria-pressed': 'false', 'data-ambiance': a.id }, a.titre));
  const vol = h('input', { type: 'range', class: 'foc-volume', id: id('volume'), min: 0, max: 1, step: 0.05, value: volume, 'aria-describedby': id('volume-valeur') });
  const volSortie = h('output', { id: id('volume-valeur'), class: 'foc-volume-valeur', for: id('volume') });
  const chkFin = h('input', { class: 'chk-input', type: 'checkbox', id: id('arret-fin'), checked: true });
  const ambiances = h('fieldset', { class: 'foc-groupe foc-ambiances' },
    h('legend', { class: 'fld-label' }, 'Ambiances sonores'),
    h('p', { class: 'fld-aide' }, 'Rien ne joue tant que vous n’en choisissez pas une. Chaque bouton lance ou arrête son ambiance.'),
    h('div', { class: 'foc-amb-liste' }, ...boutonsAmb),
    h('div', { class: 'fld' }, h('label', { class: 'fld-label', for: id('volume') }, 'Volume des ambiances'), h('div', { class: 'foc-volume-ligne' }, vol, volSortie)),
    h('label', { class: 'chk chk-case' }, chkFin, h('span', { class: 'chk-boite', 'aria-hidden': 'true' }), h('span', { class: 'chk-texte' }, 'Arrêter les ambiances à la fin d’un bloc')));

  const credits = h('details', { class: 'foc-credits' }, h('summary', {}, 'Crédits des sons'),
    h('ul', {}, ...AMBIANCES.map((a) => h('li', {}, `${a.titre}${NBSP}: ${a.credit}, ${a.licence}. `, h('a', { class: 'lnk', href: a.url, target: '_blank', rel: 'noopener noreferrer' }, 'Source', h('span', { class: 'kds-masque' }, ` de l’ambiance ${a.titre} (nouvel onglet)`))))));

  const cadran = h('div', { class: 'foc-cadran' }, phase, temps, barre, aide, commandes, annonce);
  const reglages = h('div', { class: 'foc-reglages' }, durees, alertes, ambiances, message, credits);
  const section = h('section', { class: 'foc', 'aria-labelledby': id('titre') }, titre, h('div', { class: 'foc-grille' }, cadran, reglages));
  racine.replaceChildren(section);

  // ------------------------------------------------------------------ rendu
  const dire = (txt) => { annonce.replaceChildren(h('span', {}, txt)); };
  const informer = (txt) => { message.replaceChildren(h('span', {}, txt)); };
  // resume() et close() renvoient des promesses : un rejet (contexte fermé pendant une reprise, Firefox) n'est pas une erreur
  const sansRejet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };
  const maj = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };

  function libelles() {
    const { phase: ph } = etat, susp = F.enSuspens(etat);
    const prin = ph === 'idle' || ph === 'bdone' ? 'Commencer un bloc' : ph === 'wdone' ? 'Lancer la pause' : susp ? 'Reprendre' : 'Mettre en pause';
    const suiv = ph === 'work' ? 'Terminer le bloc' : ph === 'brk' ? 'Passer la pause' : ph === 'wdone' ? 'Enchaîner un bloc' : null;
    return { prin, suiv };
  }
  function rendre() {
    const a0 = document.activeElement; // le navigateur peut retirer le focus dès qu'un élément est masqué
    const n = maintenant(), ph = etat.phase, susp = F.enSuspens(etat);
    section.dataset.phase = ph; section.dataset.suspendu = susp ? 'oui' : 'non';
    const long = ph === 'work' || ph === 'brk';
    const lib = susp ? TEXTES.suspendu[ph] : TEXTES.phase[ph];
    const jp = ph === 'work' ? '集中' : ph === 'brk' ? '休憩' : null;
    const nouveau = (jp ? jp + ' · ' : '') + lib;
    if (phase.textContent !== nouveau) phase.replaceChildren(...(jp ? [h('span', { lang: 'ja' }, jp), ` · ${lib}`] : [lib]));
    maj(temps, F.formater(F.restantMs(etat, n)));
    const pr = F.progression(etat, n);
    rempli.style.setProperty('--foc-p', String(Math.round(pr * 1000) / 1000));
    maj(aide, TEXTES.aide[ph](etat));
    const { prin, suiv } = libelles();
    maj(principal, prin);
    suite.hidden = suiv === null; if (suiv) maj(suite, suiv);
    stop.hidden = ph === 'idle';
    boutonPause.hidden = !(opts.ouvrirPause && (ph === 'brk' || ph === 'bdone'));
    // Durées : modifiables seulement hors bloc
    for (const r of radios) { r.input.disabled = long; r.input.checked = r.pr.travailMin === etat.travailMin && r.pr.pauseMin === etat.pauseMin; }
    for (const [s, v] of [[sT, etat.travailMin], [sP, etat.pauseMin]]) { s.input.disabled = long; if (document.activeElement !== s.input) s.input.value = String(v); }
    aideDurees.hidden = !long;
    // Focus jamais perdu : si l'élément actif vient d'être masqué, il passe au bouton principal
    if (a0 && a0 !== document.body && racine.contains(a0) && (a0.hidden || a0.disabled || document.activeElement === document.body || document.activeElement === null)) principal.focus();
    volSortie.textContent = `${Math.round(volume * 100)}${NBSP}%`;
    vol.setAttribute('aria-valuetext', `${Math.round(volume * 100)}${NBSP}%`);
    sauver();
  }

  // ------------------------------------------------------------------ persistance
  function sauver() {
    if (detruit || !stockage) return;
    const texte = F.serialiser(etat, { arretFin, carillon: carillonOn, notification: notifOn, volume });
    if (texte === dernierEnreg) return;
    try { stockage.setItem(cle, texte); dernierEnreg = texte; } catch (e) { /* stockage plein ou refusé : le minuteur continue sans mémoire */ }
  }

  // ------------------------------------------------------------------ temps
  function planifier() {
    clearTimeout(minuteur); minuteur = null;
    if (detruit) return;
    const d = F.delaiAffichage(etat, maintenant());
    if (d === null) return;
    minuteur = setTimeout(avancer, Math.max(0, d));
  }
  function avancer() {
    if (detruit) return;
    const r = F.synchroniser(etat, maintenant());
    etat = r.etat;
    for (const ev of r.evenements) finDeBloc(ev);
    rendre(); planifier();
  }
  function finDeBloc(ev) {
    dire(ev.phase === 'work' ? TEXTES.annonce.finTravail : TEXTES.annonce.finPause);
    if (ev.phase === 'work' && arretFin) arreterSons();
    if (carillonOn) jouerCarillon();
    if (notifOn) notifier(ev.phase === 'work' ? 'Bloc terminé.' : 'Pause terminée.');
  }
  // Commandes : l'heure de fin éventuellement dépassée est d'abord constatée et annoncée. Si le bloc vient de se terminer,
  // la commande n'est pas appliquée : le bouton que l'apprenant a vu n'est plus celui qu'il croyait presser.
  const commande = (fn, texte) => () => {
    const r = F.synchroniser(etat, maintenant()); etat = r.etat; for (const ev of r.evenements) finDeBloc(ev);
    if (r.evenements.length) { rendre(); planifier(); return; }
    const avant = etat; etat = fn(etat, maintenant());
    if (etat !== avant && texte) { const t = typeof texte === 'function' ? texte(avant, etat) : texte; if (t) dire(t); }
    rendre(); planifier();
    if (opts.ouvrirPause && avant.phase === 'wdone' && etat.phase === 'brk') opts.ouvrirPause();
  };
  const surPrincipal = commande((e, n) => {
    if (F.enCours(e)) return F.pause(e, n);
    if (F.enSuspens(e)) return F.reprendre(e, n);
    if (e.phase === 'wdone') return F.lancerPause(e, n);
    return F.demarrer(e, n);
  }, (a, b) => b.phase === 'brk' && a.phase === 'wdone' ? TEXTES.annonce.debutPause(b) : b.phase === 'work' && a.phase !== 'work' ? TEXTES.annonce.debutTravail(b) : F.enSuspens(b) ? TEXTES.annonce.pause : TEXTES.annonce.reprise);
  const surSuite = commande((e, n) => (e.phase === 'wdone' ? F.demarrer(e, n) : F.passer(e, n)), (a, b) => (b.phase === 'work' ? TEXTES.annonce.debutTravail(b) : b.phase === 'wdone' ? 'Bloc terminé.' : null));
  const surArret = () => { commande((e) => F.arreter(e), TEXTES.annonce.arret)(); arreterSons(); };
  // Geste de l'apprenant : le contexte audio du carillon restauré après rechargement se crée ici, pas sans geste.
  const preparerCarillon = () => { if (!carillonOn) return; try { contexte = contexte || creerContexte(); if (contexte && contexte.state === 'suspended') sansRejet(contexte.resume()); } catch (e) { contexte = null; } };
  principal.addEventListener('click', () => { preparerCarillon(); surPrincipal(); });
  suite.addEventListener('click', () => { preparerCarillon(); surSuite(); });
  stop.addEventListener('click', surArret);

  // Durées
  const appliquerDurees = (t, pa) => { const avant = etat; etat = F.regler(etat, t, pa); if (etat !== avant) rendre(); };
  radios.forEach((r) => r.input.addEventListener('change', () => { if (r.input.checked) appliquerDurees(r.pr.travailMin, r.pr.pauseMin); }));
  const surSaisie = () => { appliquerDurees(sT.input.value, sP.input.value); rendre(); sT.input.value = String(etat.travailMin); sP.input.value = String(etat.pauseMin); };
  sT.input.addEventListener('change', surSaisie); sP.input.addEventListener('change', surSaisie);

  // Reprise après veille ou retour sur l'onglet : tout se recalcule sur l'heure de fin.
  const surVisible = () => { if (!document.hidden) avancer(); };
  document.addEventListener('visibilitychange', surVisible);
  globalThis.addEventListener('pageshow', avancer);
  globalThis.addEventListener('focus', avancer);

  // ------------------------------------------------------------------ sons
  function jouerAmbiance(a) {
    const audio = creerAudio(`${baseSons}${a.fichier}.mp3`);
    audio.loop = true; audio.volume = volume;
    sons.set(a.id, audio);
    let r; try { r = audio.play(); } catch (e) { r = Promise.reject(e); }
    if (r && typeof r.catch === 'function') r.catch(() => { if (sons.get(a.id) === audio) { arreterSon(a.id); informer(`L’ambiance « ${a.titre} » n’a pas pu être lue.`); } });
  }
  function arreterSon(cle) {
    const audio = sons.get(cle); sons.delete(cle);
    const b = boutonsAmb.find((x) => x.dataset.ambiance === cle); if (b) b.setAttribute('aria-pressed', 'false');
    if (!audio) return;
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* déjà libéré */ }
  }
  function arreterSons() { for (const cle of [...sons.keys()]) arreterSon(cle); }
  boutonsAmb.forEach((b, i) => b.addEventListener('click', () => {
    const a = AMBIANCES[i];
    if (sons.has(a.id)) { arreterSon(a.id); return; }
    b.setAttribute('aria-pressed', 'true');
    jouerAmbiance(a);
  }));
  vol.addEventListener('input', () => { volume = Number(vol.value); for (const au of sons.values()) au.volume = volume; rendre(); });
  chkFin.addEventListener('change', () => { arretFin = chkFin.checked; sauver(); });

  function regCarillon(on) {
    if (on) {
      try { contexte = contexte || creerContexte(); if (contexte && contexte.state === 'suspended') sansRejet(contexte.resume()); } catch (e) { contexte = null; }
      if (!contexte) { informer('Le carillon n’est pas disponible dans ce navigateur.'); return; }
    }
    carillonOn = on; swCarillon.set(on); sauver();
  }
  function jouerCarillon() {
    try { contexte = contexte || creerContexte(); } catch (e) { contexte = null; } // après un rechargement, le contexte n'est créé qu'à la première fin de bloc
    sonnerCarillon(contexte, volume);
  }

  async function regNotif(on) {
    if (!on) { notifOn = false; swNotif.set(false); sauver(); return; }
    if (!Notif) { informer('Les notifications ne sont pas disponibles dans ce navigateur.'); return; }
    let perm = Notif.permission;
    if (perm === 'default') { try { perm = await Notif.requestPermission(); } catch (e) { perm = 'denied'; } }
    if (detruit) return;
    if (perm === 'granted') { notifOn = true; swNotif.set(true); informer('Notification activée pour ce minuteur.'); sauver(); }
    else { notifOn = false; swNotif.set(false); informer('Les notifications sont bloquées : elles se règlent dans les paramètres du navigateur.'); }
  }
  function notifier(corps) {
    try { if (Notif && Notif.permission === 'granted' && masque()) new Notif('KOTONOHA · Focus', { body: corps, tag: 'kotonoha-focus' }); } catch (e) { /* sans effet */ }
  }

  // ------------------------------------------------------------------ cycle de vie
  function detruire() {
    if (detruit) return;
    detruit = true; clearTimeout(minuteur); minuteur = null;
    document.removeEventListener('visibilitychange', surVisible);
    globalThis.removeEventListener('pageshow', avancer); globalThis.removeEventListener('focus', avancer);
    arreterSons();
    if (contexte) { try { sansRejet(contexte.close()); } catch (e) { /* déjà fermé */ } contexte = null; }
    carillonOn = false; notifOn = false;
    if (section.parentNode === racine) racine.replaceChildren();
  }

  // ------------------------------------------------------------------ reprise (rechargement, veille)
  // Lecture stricte de l'enregistrement. Rien ne sonne : une fin constatée ici n'appelle ni carillon, ni notification,
  // ni arrêt d'ambiance (il n'y en a pas) ; elle est seulement annoncée, une fois. L'état terminé est enregistré
  // aussitôt par rendre() : un rechargement suivant ne la constate plus.
  let reprise = null;
  if (stockage) {
    let brut = null; try { brut = stockage.getItem(cle); } catch (e) { /* stockage inaccessible */ }
    const lu = F.lire(brut, maintenant());
    if (lu.statut === 'invalide') {
      try { stockage.removeItem(cle); } catch (e) { /* sans effet */ }
      informer(TEXTES.reprise.illisible);
    } else if (lu.statut === 'ok') {
      arretFin = lu.reglages.arretFin; chkFin.checked = arretFin;
      volume = lu.reglages.volume; vol.value = String(volume);
      if (lu.reglages.carillon) { carillonOn = true; swCarillon.set(true); }
      if (lu.reglages.notification && Notif && Notif.permission === 'granted') { notifOn = true; swNotif.set(true); }
      if (!opts.etat) {
        etat = lu.etat;
        const ev = lu.evenements[0];
        if (ev) { reprise = Object.freeze({ phase: ev.phase, retardMs: ev.retardMs }); dire(TEXTES.reprise.fin(ev.phase, ev.retardMs)); }
      }
    }
  }

  if (lireMasque(stockage)) poserMasque(true);
  rendre(); planifier();
  return Object.freeze({ etat: () => etat, synchroniser: avancer, detruire, sonsActifs: () => [...sons.keys()], reprise: () => reprise });
}
