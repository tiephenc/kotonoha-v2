// KOTONOHA 2.0 · écran de pause du Focus : composant autonome (comme ui/focus.js). Il lit l'état du Focus dans le même
// enregistrement (« kotonoha2.focus.v1 »), le fait évoluer par le domaine (core/pause.js) et le réécrit : la pause
// survit donc au rechargement, et le minuteur du Focus reprend là où l'écran l'a laissé.
//
// Règles tenues ici (KOTONOHA_PAUSES_ET_MINIJEUX.md, D-34, PR-07) :
//  - aucun contenu scolaire, aucun score, aucune série, aucun historique, aucune récompense ;
//  - aucun son sans geste : une ambiance ne démarre que sur un appui ; le carillon de fin n'existe que si l'apprenant l'a
//    activé dans le Focus (réglage lu, jamais modifié ici) ;
//  - la fin de la pause est annoncée, jamais imposée : l'écran reste là jusqu'à « Reprendre l'étude » ;
//  - mouvement : le cercle du souffle change de taille par transition ; sans mouvement (préférence système ou
//    réglage `data-mouvement="reduit"`), seul le texte change.
//  - cycle de vie : `monterPause` rend `detruire()`, à appeler au démontage de la vue.
import * as F from '../core/focus.js';
import * as P from '../core/pause.js';
import { AMBIANCES, CLE_STOCKAGE } from './focus.js';
import { sonnerCarillon } from './carillon.js';
import { lireMasque, ecrireMasque } from './pause-prefs.js';
import { monterJeu, TEXTES_JEUX, ORDRE_JEUX } from './pause-jeux.js';

const NBSP = ' '; // espace insécable
export const VUE_PAUSE = Object.freeze({ route: '#/pause', titre: 'Pause' });
export const RETOUR_DEFAUT = '#/parcours';
export const SOUFFLE = Object.freeze({ inspireMs: 4000, expireMs: 6000 });

export const TEXTES = Object.freeze({
  statut: {
    aucune: 'Aucune pause en cours.',
    travail: 'Un bloc de concentration est en cours.',
    'a-lancer': 'Bloc terminé. La pause commence quand vous le décidez.',
    'en-cours': 'Pause en cours. Rien d’autre à faire.',
    suspendue: 'Pause suspendue.',
    terminee: 'Pause terminée. Reprenez quand vous voulez.',
  },
  annonce: {
    fin: 'Pause terminée. Reprenez quand vous voulez.', debut: 'Pause commencée.',
    prolongee: (m) => `Pause prolongée de ${m}${NBSP}minutes.`, suspendue: 'Temps suspendu.', repris: 'Temps repris.',
    illisible: `Les réglages enregistrés étaient illisibles${NBSP}: rien n’est en cours.`,
  },
  etirements: [`Épaules${NBSP}: montez-les vers les oreilles, relâchez, trois fois.`, `Nuque${NBSP}: inclinez doucement la tête d’un côté, puis de l’autre, sans forcer.`, `Poignets${NBSP}: ouvrez et fermez les mains, faites quelques cercles.`, `Dos${NBSP}: levez-vous si vous le pouvez, et étirez les bras vers le haut.`],
});

const h = (tag, attrs = {}, ...enfants) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; el.setAttribute(k, v === true ? '' : String(v)); }
  el.append(...enfants);
  return el;
};

/**
 * @param {HTMLElement} racine
 * @param {Object} [opts]
 * @param {() => number} [opts.maintenant] Horloge en ms (défaut : Date.now).
 * @param {string} [opts.retour] Adresse où « Reprendre l'étude » ramène (défaut : #/parcours).
 * @param {(adresse: string) => void} [opts.surRetour] Navigation vers l'adresse de retour (défaut : location.hash = adresse).
 * @param {(() => void)|null} [opts.surMinuteur] Ouvre le minuteur Focus (lien « Réglages du minuteur »).
 * @param {string} [opts.baseSons] Dossier des mp3 (défaut : ../sons/).
 * @param {(url: string) => HTMLAudioElement} [opts.creerAudio]
 * @param {() => AudioContext} [opts.creerContexteAudio]
 * @param {string} [opts.prefixe] Préfixe des identifiants (défaut : pz).
 * @param {{getItem: Function, setItem: Function}|null} [opts.stockage] Stockage (défaut : localStorage ; null : aucune persistance).
 * @param {string} [opts.cleStockage]
 */
export function monterPause(racine, opts = {}) {
  const maintenant = opts.maintenant || (() => Date.now());
  const retour = typeof opts.retour === 'string' && /^#\//.test(opts.retour) ? opts.retour : RETOUR_DEFAUT;
  const surRetour = opts.surRetour || ((a) => { location.hash = a; });
  const baseSons = opts.baseSons ?? '../sons/';
  const creerAudio = opts.creerAudio || ((url) => new Audio(url));
  const creerContexte = opts.creerContexteAudio || (() => { const C = globalThis.AudioContext || globalThis.webkitAudioContext; return C ? new C() : null; });
  const p = opts.prefixe || 'pz';
  const id = (s) => `${p}-${s}`;
  const cle = opts.cleStockage || CLE_STOCKAGE;
  const stockage = (() => { if ('stockage' in opts) return opts.stockage; try { return globalThis.localStorage ?? null; } catch (e) { return null; } })();

  let etat = F.creer(), reglages = F.REGLAGES_DEFAUT, dernierEnreg = null, detruit = false, minuteur = null, contexte = null;
  let reprise = null, illisible = false;
  /** @type {Map<string, HTMLAudioElement>} */
  const sons = new Map();
  let souffle = { actif: false, etape: 'repos', fil: null };
  /** Micro-activités à scène (Canvas) : montées au premier affichage, conservées ensuite jusqu'au démontage. */
  const jeux = new Map(), toiles = new Map(), creerJeu = opts.creerJeu || monterJeu;

  // ------------------------------------------------------------------ lecture de l'état du Focus
  if (stockage) {
    let brut = null; try { brut = stockage.getItem(cle); } catch (e) { /* stockage inaccessible */ }
    const lu = F.lire(brut, maintenant());
    if (lu.statut === 'ok') {
      etat = lu.etat; reglages = lu.reglages;
      const ev = lu.evenements[0];
      if (ev) reprise = Object.freeze({ phase: ev.phase, retardMs: ev.retardMs });
    } else if (lu.statut === 'invalide') illisible = true;
  }
  function sauver() {
    if (detruit || !stockage) return;
    const texte = F.serialiser(etat, reglages);
    if (texte === dernierEnreg) return;
    try { stockage.setItem(cle, texte); dernierEnreg = texte; } catch (e) { /* refusé : la pause continue sans mémoire */ }
  }

  // ------------------------------------------------------------------ structure
  const titre = h('h2', { id: id('titre'), class: 'pz-titre' }, h('span', { lang: 'ja' }, '休憩'), ' · Pause');
  const statut = h('p', { class: 'pz-statut', id: id('statut') });
  const temps = h('p', { class: 'pz-temps', id: id('temps'), role: 'timer', 'aria-live': 'off', 'aria-label': 'Temps de pause restant' });
  const annonce = h('p', { class: 'pz-annonce', id: id('annonce'), role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

  const btnReprendre = h('button', { type: 'button', class: 'btn btn-principal', id: id('reprendre') });
  const btnCommencer = h('button', { type: 'button', class: 'btn btn-principal', id: id('commencer') }, 'Commencer la pause');
  const btnProlonger = h('button', { type: 'button', class: 'btn btn-secondaire', id: id('prolonger') });
  const btnSuspendre = h('button', { type: 'button', class: 'btn btn-discret', id: id('suspendre') });
  const btnMasquer = h('button', { type: 'button', class: 'btn btn-discret', id: id('masquer-temps'), 'aria-pressed': 'false' }, 'Masquer le temps');
  const commandes = h('div', { class: 'pz-commandes', role: 'group', 'aria-label': 'Commandes de la pause' }, btnCommencer, btnReprendre, btnProlonger, btnSuspendre, btnMasquer);

  // Activités : toutes facultatives, aucune n'est lancée d'office.
  const rond = h('div', { class: 'pz-rond', 'data-etape': 'repos', 'aria-hidden': 'true' });
  const texteSouffle = h('p', { class: 'pz-souffle-texte', id: id('souffle-texte') }, 'Prêt');
  const btnSouffle = h('button', { type: 'button', class: 'btn btn-secondaire', id: id('souffle-bouton'), 'aria-pressed': 'false' }, 'Commencer à respirer');
  const panneauSouffle = h('div', { class: 'pz-panneau', id: id('panneau-souffle'), hidden: true },
    h('p', { class: 'pz-consigne' }, `Inspirez par le nez pendant quatre secondes, expirez lentement pendant six. Ce n’est pas un exercice médical${NBSP}: arrêtez quand vous voulez.`),
    h('div', { class: 'pz-souffle' }, rond, texteSouffle), btnSouffle);
  const panneauLoin = h('div', { class: 'pz-panneau', id: id('panneau-loin'), hidden: true },
    h('p', { class: 'pz-consigne' }, 'Levez les yeux de l’écran. Regardez le plus loin possible, par une fenêtre si vous en avez une, pendant une trentaine de secondes. Clignez des yeux plusieurs fois, sans effort.'));
  const panneauCorps = h('div', { class: 'pz-panneau', id: id('panneau-corps'), hidden: true },
    h('p', { class: 'pz-consigne' }, 'Quelques gestes, sans forcer ; ce sont des suggestions, pas un exercice médical.'),
    h('ul', { class: 'pz-liste' }, ...TEXTES.etirements.map((t) => h('li', {}, t))));
  const boutonsAmb = AMBIANCES.map((a) => h('button', { type: 'button', class: 'btn btn-secondaire pz-amb', 'aria-pressed': 'false', 'data-ambiance': a.id }, a.titre));
  const panneauAmb = h('div', { class: 'pz-panneau', id: id('panneau-ambiance'), hidden: true },
    h('p', { class: 'pz-consigne' }, 'Rien ne joue tant que vous n’en choisissez pas une. Chaque bouton lance ou arrête son ambiance ; le volume est celui du minuteur.'),
    h('div', { class: 'pz-amb-liste' }, ...boutonsAmb));
  const panneauxJeux = ORDRE_JEUX.map((cl) => {
    const T = TEXTES_JEUX[cl];
    const toile = h('canvas', { class: 'pz-toile', id: id('toile-' + cl), tabindex: '0', role: 'img', 'aria-label': T.description, 'aria-describedby': id('consigne-' + cl), width: '320', height: '240' });
    toiles.set(cl, toile);
    const bouton = (txt, cle, f) => { const b = h('button', { type: 'button', class: 'btn btn-discret', id: id(cle + '-' + cl) }, txt); b.addEventListener('click', f); return b; };
    const boutons = [];
    if (T.auto) boutons.push(bouton(T.auto, 'auto', () => jeux.get(cl)?.auto()));
    if (T.effacer) boutons.push(bouton(T.effacer, 'effacer', () => jeux.get(cl)?.effacer()));
    return h('div', { class: 'pz-panneau', id: id('panneau-' + cl), hidden: true }, h('p', { class: 'pz-consigne', id: id('consigne-' + cl) }, T.consigne), toile, ...(boutons.length ? [h('div', { class: 'pz-jeu-commandes' }, ...boutons)] : []));
  });
  const ACTIVITES = [['souffle', 'Respirer', panneauSouffle], ['loin', 'Regarder au loin', panneauLoin], ['corps', 'Se détendre le corps', panneauCorps], ...ORDRE_JEUX.map((cl, i) => [cl, TEXTES_JEUX[cl].libelle, panneauxJeux[i]]), ['ambiance', 'Ambiance sonore', panneauAmb]];
  const boutonsAct = ACTIVITES.map(([cl, lib]) => h('button', { type: 'button', class: 'btn btn-secondaire pz-act', 'aria-pressed': 'false', 'aria-controls': id('panneau-' + cl), 'data-activite': cl }, lib));
  const activites = h('section', { class: 'pz-activites', 'aria-labelledby': id('act-titre') },
    h('h3', { id: id('act-titre'), class: 'pz-sous-titre' }, 'Si l’envie vous prend'),
    h('p', { class: 'pz-consigne' }, `Ou ne faites rien${NBSP}: c’est une pause.`),
    h('div', { class: 'pz-act-liste', role: 'group', 'aria-labelledby': id('act-titre') }, ...boutonsAct),
    ...ACTIVITES.map((a) => a[2]));
  const lienMinuteur = opts.surMinuteur ? h('p', { class: 'pz-lien' }, h('a', { class: 'lnk', href: '#/focus', id: id('lien-minuteur') }, 'Réglages du minuteur')) : null;
  if (lienMinuteur) lienMinuteur.firstChild.addEventListener('click', (e) => { e.preventDefault(); quitterSons(); for (const j of jeux.values()) j.masquer(); opts.surMinuteur(); });

  const section = h('section', { class: 'pz', 'aria-labelledby': id('titre') },
    titre, h('div', { class: 'pz-centre' }, statut, temps, commandes, annonce), activites, ...(lienMinuteur ? [lienMinuteur] : []));
  racine.replaceChildren(section);

  // ------------------------------------------------------------------ rendu
  const maj = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
  const dire = (txt) => { annonce.replaceChildren(h('span', {}, txt)); };
  const poserMasque = (m) => { btnMasquer.setAttribute('aria-pressed', String(m)); maj(btnMasquer, m ? 'Afficher le temps' : 'Masquer le temps'); temps.classList.toggle('kds-masque', m); };

  function rendre() {
    const a0 = document.activeElement;
    const sit = P.situation(etat), n = maintenant();
    section.dataset.situation = sit;
    maj(statut, TEXTES.statut[sit]);
    const enPause = sit === 'en-cours' || sit === 'suspendue' || sit === 'terminee';
    temps.hidden = !enPause;
    maj(temps, sit === 'terminee' ? F.formater(0) : F.formater(F.restantMs(etat, n)));
    btnCommencer.hidden = sit !== 'a-lancer';
    maj(btnReprendre, sit === 'travail' || sit === 'aucune' ? 'Retour à l’étude' : 'Reprendre l’étude');
    btnReprendre.classList.toggle('btn-principal', sit !== 'a-lancer'); btnReprendre.classList.toggle('btn-secondaire', sit === 'a-lancer');
    btnProlonger.hidden = !enPause;
    maj(btnProlonger, sit === 'terminee' ? `Encore ${P.PROLONGATION_MIN}${NBSP}minutes` : `Prolonger de ${P.PROLONGATION_MIN}${NBSP}minutes`);
    btnProlonger.disabled = !P.peutProlonger(etat);
    btnSuspendre.hidden = !(sit === 'en-cours' || sit === 'suspendue');
    maj(btnSuspendre, sit === 'suspendue' ? 'Reprendre le temps' : 'Suspendre le temps');
    btnMasquer.hidden = !enPause;
    activites.hidden = !(enPause || sit === 'a-lancer');
    if (a0 && a0 !== document.body && racine.contains(a0) && (a0.hidden || a0.disabled || document.activeElement === document.body || document.activeElement === null)) btnReprendre.focus();
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
    if (r.evenements.some((e) => e.phase === 'brk')) {
      dire(TEXTES.annonce.fin);
      arreterSouffle(); fermerActivite(); // à la fin de la pause, plus rien ne bouge ni ne sonne ; l'écran reste jusqu'à la reprise
      if (reglages.carillon) { try { contexte = contexte || creerContexte(); } catch (e) { contexte = null; } sonnerCarillon(contexte, reglages.volume); }
    } else if (r.evenements.length) dire('Bloc terminé.');
    if (r.evenements.length) sauver();
    rendre(); planifier();
  }
  /** Commande de l'apprenant : si la pause vient de finir, la fin est constatée et la commande n'est pas appliquée (le bouton vu n'est plus le bon). */
  const commande = (fn, texte) => () => {
    const avant = etat;
    if (F.synchroniser(avant, maintenant()).evenements.length) { avancer(); return; }
    etat = fn(avant, maintenant());
    if (etat !== avant) { sauver(); if (texte) dire(typeof texte === 'function' ? texte(avant, etat) : texte); }
    rendre(); planifier();
  };
  btnCommencer.addEventListener('click', commande((e, n) => P.entrer(e, n), TEXTES.annonce.debut));
  btnProlonger.addEventListener('click', commande((e, n) => P.prolonger(e, P.PROLONGATION_MIN, n), TEXTES.annonce.prolongee(P.PROLONGATION_MIN)));
  btnSuspendre.addEventListener('click', commande((e, n) => (F.enSuspens(e) ? F.reprendre(e, n) : F.pause(e, n)), (a, b) => (F.enSuspens(b) ? TEXTES.annonce.suspendue : TEXTES.annonce.repris)));
  btnMasquer.addEventListener('click', () => { const m = btnMasquer.getAttribute('aria-pressed') !== 'true'; poserMasque(m); ecrireMasque(stockage, m); });
  btnReprendre.addEventListener('click', () => {
    etat = P.reprendreEtude(etat, maintenant()); sauver();
    quitterSons(); arreterSouffle(); for (const j of jeux.values()) j.masquer();
    surRetour(retour);
  });

  const surVisible = () => { if (!document.hidden) avancer(); };
  document.addEventListener('visibilitychange', surVisible);
  globalThis.addEventListener('pageshow', avancer);
  globalThis.addEventListener('focus', avancer);

  // ------------------------------------------------------------------ activités
  function choisirActivite(cl) {
    const deja = boutonsAct.find((b) => b.dataset.activite === cl).getAttribute('aria-pressed') === 'true';
    boutonsAct.forEach((b) => b.setAttribute('aria-pressed', String(!deja && b.dataset.activite === cl)));
    ACTIVITES.forEach(([c, , pan]) => { pan.hidden = deja || c !== cl; });
    if (cl !== 'souffle' || deja) arreterSouffle();
    for (const j of ORDRE_JEUX) { if (!deja && j === cl) { if (!jeux.has(j)) jeux.set(j, creerJeu(j, toiles.get(j))); jeux.get(j).afficher(); } else jeux.get(j)?.masquer(); }
  }
  /** Referme l'activité ouverte (son état de scène est conservé) ; le focus revient sur son bouton s'il était dans le panneau. */
  function fermerActivite() {
    const ouvert = boutonsAct.find((b) => b.getAttribute('aria-pressed') === 'true'); if (!ouvert) return;
    const pan = ACTIVITES.find((a) => a[0] === ouvert.dataset.activite)[2], dedans = pan.contains(document.activeElement);
    choisirActivite(ouvert.dataset.activite); quitterSons(); if (dedans) ouvert.focus();
  }
  activites.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); fermerActivite(); } });
  boutonsAct.forEach((b) => b.addEventListener('click', () => {
    const cl = b.dataset.activite;
    if (cl !== 'ambiance') quitterSons(); // changer d'activité n'abandonne pas une ambiance sauf pour une activité sans son
    choisirActivite(cl);
  }));

  // Souffle : 4 s d'inspiration, 6 s d'expiration, en boucle jusqu'à l'arrêt ; une seule minuterie, effacée à l'arrêt et au démontage.
  function etapeSouffle(e) {
    souffle.etape = e;
    rond.dataset.etape = e;
    rond.style.setProperty('--pz-duree', e === 'inspire' ? `${SOUFFLE.inspireMs}ms` : e === 'expire' ? `${SOUFFLE.expireMs}ms` : '0ms');
    maj(texteSouffle, e === 'inspire' ? 'Inspirez' : e === 'expire' ? 'Expirez' : 'Prêt');
  }
  function cycleSouffle() {
    if (!souffle.actif || detruit) return;
    etapeSouffle('inspire');
    souffle.fil = setTimeout(() => { if (!souffle.actif || detruit) return; etapeSouffle('expire'); souffle.fil = setTimeout(cycleSouffle, SOUFFLE.expireMs); }, SOUFFLE.inspireMs);
  }
  function arreterSouffle() {
    clearTimeout(souffle.fil); souffle = { actif: false, etape: 'repos', fil: null };
    btnSouffle.setAttribute('aria-pressed', 'false'); maj(btnSouffle, 'Commencer à respirer');
    etapeSouffle('repos');
  }
  btnSouffle.addEventListener('click', () => {
    if (souffle.actif) { arreterSouffle(); return; }
    souffle.actif = true; btnSouffle.setAttribute('aria-pressed', 'true'); maj(btnSouffle, 'Arrêter');
    cycleSouffle();
  });

  // Ambiances : même dossier et mêmes crédits que le minuteur ; démarrage seulement sur un appui.
  function arreterSon(c) {
    const audio = sons.get(c); sons.delete(c);
    const b = boutonsAmb.find((x) => x.dataset.ambiance === c); if (b) b.setAttribute('aria-pressed', 'false');
    if (!audio) return;
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) { /* déjà libéré */ }
  }
  function quitterSons() { for (const c of [...sons.keys()]) arreterSon(c); }
  boutonsAmb.forEach((b, i) => b.addEventListener('click', () => {
    const a = AMBIANCES[i];
    if (sons.has(a.id)) { arreterSon(a.id); return; }
    b.setAttribute('aria-pressed', 'true');
    const audio = creerAudio(`${baseSons}${a.fichier}.mp3`);
    audio.loop = true; audio.volume = reglages.volume; sons.set(a.id, audio);
    let r; try { r = audio.play(); } catch (e) { r = Promise.reject(e); }
    if (r && typeof r.catch === 'function') r.catch(() => { if (sons.get(a.id) === audio) { arreterSon(a.id); dire(`L’ambiance « ${a.titre} » n’a pas pu être lue.`); } });
  }));

  // ------------------------------------------------------------------ cycle de vie
  function detruire() {
    if (detruit) return;
    detruit = true; clearTimeout(minuteur); minuteur = null; clearTimeout(souffle.fil);
    document.removeEventListener('visibilitychange', surVisible);
    globalThis.removeEventListener('pageshow', avancer); globalThis.removeEventListener('focus', avancer);
    quitterSons(); for (const j of jeux.values()) j.detruire(); jeux.clear();
    if (contexte) { try { const r = contexte.close(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* déjà fermé */ } contexte = null; }
    if (section.parentNode === racine) racine.replaceChildren();
  }

  // Reprise après rechargement ou veille : une fin constatée ici est seulement annoncée, sans carillon, et enregistrée aussitôt (jamais redite).
  if (lireMasque(stockage)) poserMasque(true);
  if (illisible) dire(TEXTES.annonce.illisible);
  else if (reprise && reprise.phase === 'brk') dire(TEXTES.annonce.fin);
  if (reprise) sauver();
  rendre(); planifier();
  return Object.freeze({ etat: () => etat, synchroniser: avancer, detruire, sonsActifs: () => [...sons.keys()], reprise: () => reprise, souffleActif: () => souffle.actif, jeux: () => new Map([...jeux].map(([k, j]) => [k, j.etat()])) });
}
