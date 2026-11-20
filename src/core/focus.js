// KOTONOHA 2.0 · Focus (F-M09) : machine d'états du minuteur. Domaine pur (07 §4.1) : aucun accès au DOM, au stockage,
// au réseau, ni à l'horloge. Toute fonction qui dépend du temps reçoit l'heure en millisecondes (`maintenant`).
//
// Phases : « idle » (au repos), « work » (bloc de travail), « wdone » (bloc terminé, pause à lancer),
// « brk » (pause), « bdone » (pause terminée). Il n'y a ni série, ni score, ni total : cette machine ne retient
// rien de ce qui s'est passé avant (D-34, PR-07).
//
// Reprise après veille : l'état garde l'heure de fin (`finMs`), jamais un nombre de ticks. Le reste affiché est
// toujours `finMs - maintenant`, borné ; un onglet suspendu ou un appareil en veille ne fausse donc rien.
// Un délai écoulé pendant la veille ne déclenche qu'une seule fin de bloc : jamais de rattrapage de cycles.

/** @typedef {'idle'|'work'|'wdone'|'brk'|'bdone'} Phase */
/**
 * @typedef {Object} EtatFocus
 * @property {Phase} phase
 * @property {number} travailMin Durée d'un bloc de travail, en minutes entières.
 * @property {number} pauseMin Durée d'une pause, en minutes entières.
 * @property {number} totalMs Durée du bloc en cours (0 hors bloc).
 * @property {number|null} finMs Heure de fin tant que le bloc court ; null sinon.
 * @property {number|null} resteMs Temps restant quand le bloc est suspendu ; null sinon.
 */
/** @typedef {{type: 'fin', phase: 'work'|'brk', retardMs: number}} EvenementFocus */

const MIN = 60_000;
export const BORNES = Object.freeze({ travail: Object.freeze({ min: 5, max: 180 }), pause: Object.freeze({ min: 1, max: 60 }) });
export const DUREES_DEFAUT = Object.freeze({ travailMin: 50, pauseMin: 10 });
/** Durées proposées (reprises de la V1 : 50/10, 25/5, 90/15). */
export const PRESETS = Object.freeze([[50, 10], [25, 5], [90, 15]].map(([travailMin, pauseMin]) => Object.freeze({ travailMin, pauseMin })));

const borne = (v, min, max, defaut) => {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (v === null || !Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const fige = (o) => Object.freeze(o);
const heure = (m) => { if (typeof m !== 'number' || !Number.isFinite(m)) throw new TypeError('heure invalide'); return m; };

/** Ramène deux durées saisies à des entiers dans les bornes ; une valeur illisible prend la valeur par défaut. */
export function normaliserDurees(travailMin, pauseMin) {
  return { travailMin: borne(travailMin, BORNES.travail.min, BORNES.travail.max, DUREES_DEFAUT.travailMin), pauseMin: borne(pauseMin, BORNES.pause.min, BORNES.pause.max, DUREES_DEFAUT.pauseMin) };
}

/** @returns {EtatFocus} */
export function creer(durees = {}) {
  const d = normaliserDurees(durees.travailMin, durees.pauseMin);
  return fige({ phase: 'idle', ...d, totalMs: 0, finMs: null, resteMs: null });
}

export const estActif = (e) => e.phase === 'work' || e.phase === 'brk';
export const enCours = (e) => estActif(e) && e.finMs !== null;
export const enSuspens = (e) => estActif(e) && e.resteMs !== null;

const bloc = (e, phase, maintenant) => {
  const totalMs = (phase === 'work' ? e.travailMin : e.pauseMin) * MIN;
  return fige({ ...e, phase, totalMs, finMs: maintenant + totalMs, resteMs: null });
};

/**
 * Applique le temps écoulé : si l'heure de fin est atteinte, le bloc se termine (une seule fois, même après une
 * longue veille). Renvoie le nouvel état et les évènements à annoncer.
 * @returns {{etat: EtatFocus, evenements: EvenementFocus[]}}
 */
export function synchroniser(e, maintenant) {
  heure(maintenant);
  if (enCours(e) && e.finMs <= maintenant) {
    const fin = /** @type {'work'|'brk'} */ (e.phase);
    return { etat: fige({ ...e, phase: fin === 'work' ? 'wdone' : 'bdone', totalMs: 0, finMs: null, resteMs: null }), evenements: [{ type: 'fin', phase: fin, retardMs: maintenant - e.finMs }] };
  }
  return { etat: e, evenements: [] };
}
const maj = (e, maintenant) => synchroniser(e, maintenant).etat;

/** Règle les durées. Sans effet pendant un bloc (en cours ou suspendu) : l'état est rendu tel quel. */
export function regler(e, travailMin, pauseMin) {
  if (estActif(e)) return e;
  return fige({ ...e, ...normaliserDurees(travailMin, pauseMin) });
}

/** Démarre un bloc de travail (depuis le repos, après un bloc ou après une pause). Sans effet pendant un bloc. */
export function demarrer(e, maintenant) {
  heure(maintenant);
  const x = maj(e, maintenant);
  return estActif(x) ? x : bloc(x, 'work', maintenant);
}

/** Lance la pause, seulement après un bloc de travail terminé. */
export function lancerPause(e, maintenant) {
  heure(maintenant);
  const x = maj(e, maintenant);
  return x.phase === 'wdone' ? bloc(x, 'brk', maintenant) : x;
}

/** Suspend le bloc en cours ; le reste est figé. */
export function pause(e, maintenant) {
  heure(maintenant);
  const x = maj(e, maintenant);
  if (!enCours(x)) return x;
  const resteMs = Math.min(x.totalMs, Math.max(0, x.finMs - maintenant));
  return fige({ ...x, finMs: null, resteMs });
}

/** Reprend un bloc suspendu : la nouvelle heure de fin est calculée à partir du reste figé. */
export function reprendre(e, maintenant) {
  heure(maintenant);
  const x = maj(e, maintenant);
  if (!enSuspens(x)) return x;
  return fige({ ...x, finMs: maintenant + x.resteMs, resteMs: null });
}

/**
 * Passe à la suite sans attendre : un bloc de travail devient « terminé » (la pause reste à lancer),
 * une pause cède la place à un nouveau bloc de travail.
 */
export function passer(e, maintenant) {
  heure(maintenant);
  const x = maj(e, maintenant);
  if (x.phase === 'work') return fige({ ...x, phase: 'wdone', totalMs: 0, finMs: null, resteMs: null });
  if (x.phase === 'brk') return bloc(x, 'work', maintenant);
  return x;
}

/** Arrête tout et revient au repos, durées conservées. Rien n'est retenu de ce qui précède. */
export function arreter(e) {
  return fige({ phase: 'idle', travailMin: e.travailMin, pauseMin: e.pauseMin, totalMs: 0, finMs: null, resteMs: null });
}

/** Temps restant, en ms. Hors bloc : la durée du prochain bloc proposé. Borné entre 0 et la durée du bloc. */
export function restantMs(e, maintenant) {
  heure(maintenant);
  if (enSuspens(e)) return e.resteMs;
  if (enCours(e)) return Math.min(e.totalMs, Math.max(0, e.finMs - maintenant));
  return (e.phase === 'wdone' ? e.pauseMin : e.travailMin) * MIN;
}

/** Part écoulée du bloc, entre 0 et 1 (1 quand un bloc vient de se terminer). */
export function progression(e, maintenant) {
  if (!estActif(e)) return e.phase === 'wdone' || e.phase === 'bdone' ? 1 : 0;
  return (e.totalMs - restantMs(e, maintenant)) / e.totalMs;
}

/** Délai, en ms, avant que l'affichage en secondes change (0 si le bloc est fini ; null si rien ne court). */
export function delaiAffichage(e, maintenant) {
  if (!enCours(e)) return null;
  const r = restantMs(e, maintenant);
  if (r <= 0) return 0;
  return r - (Math.ceil(r / 1000) - 1) * 1000;
}

/** « MM:SS » (les minutes peuvent dépasser 59 : « 90:00 »). Les secondes sont arrondies par excès. */
export function formater(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// ---------------------------------------------------------------------------------------------------------------
// Persistance (PH-7, lot 2) : sérialisation et lecture stricte de l'état et des réglages. Domaine pur : le stockage
// lui-même (clé, lecture, écriture) appartient à l'interface. Une donnée illisible, incohérente ou hors bornes n'est
// jamais corrigée au jugé : la lecture rend l'état de repos et le dit (`statut: 'invalide'`), sans exception.

export const VERSION_STOCKAGE = 1;
export const TAILLE_MAX_STOCKAGE = 2000;
/** Une pause prolongée (écran de pause, core/pause.js) peut dépasser le préréglage : durée totale en minutes entières, 120 au plus. */
export const PAUSE_TOTALE_MAX_MIN = 120;
/** Réglages hors durées : arrêt des ambiances en fin de bloc, carillon, notification, volume (0 à 1). */
export const REGLAGES_DEFAUT = Object.freeze({ arretFin: true, carillon: false, notification: false, volume: 0.6 });
const PHASES = ['idle', 'work', 'wdone', 'brk', 'bdone'];
const entier = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const fini = (v) => typeof v === 'number' && Number.isFinite(v);
const objet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Texte JSON à stocker. Ne contient que l'état de la machine et les réglages : aucun historique (D-34). */
export function serialiser(etat, reglages = REGLAGES_DEFAUT) {
  const { phase, travailMin, pauseMin, totalMs, finMs, resteMs } = etat;
  const { arretFin, carillon, notification, volume } = { ...REGLAGES_DEFAUT, ...reglages };
  return JSON.stringify({ v: VERSION_STOCKAGE, etat: { phase, travailMin, pauseMin, totalMs, finMs, resteMs }, reglages: { arretFin, carillon, notification, volume } });
}

/** @returns {string|null} la raison du refus, ou null si l'enregistrement est cohérent. */
function incoherence(o) {
  if (!objet(o) || o.v !== VERSION_STOCKAGE || !objet(o.etat) || !objet(o.reglages)) return 'forme ou version';
  const e = o.etat, r = o.reglages;
  if (!PHASES.includes(e.phase)) return 'phase';
  if (!entier(e.travailMin, BORNES.travail.min, BORNES.travail.max) || !entier(e.pauseMin, BORNES.pause.min, BORNES.pause.max)) return 'durées hors bornes';
  if (typeof r.arretFin !== 'boolean' || typeof r.carillon !== 'boolean' || typeof r.notification !== 'boolean') return 'réglage';
  if (!fini(r.volume) || r.volume < 0 || r.volume > 1) return 'volume';
  if (e.phase !== 'work' && e.phase !== 'brk') {
    return e.totalMs === 0 && e.finMs === null && e.resteMs === null ? null : 'champs de bloc hors bloc';
  }
  if (e.phase === 'work' ? e.totalMs !== e.travailMin * MIN : !(Number.isInteger(e.totalMs / MIN) && e.totalMs >= MIN && e.totalMs <= PAUSE_TOTALE_MAX_MIN * MIN)) return 'durée du bloc';
  if ((e.finMs === null) === (e.resteMs === null)) return 'ni en cours ni suspendu';
  if (e.finMs !== null && !fini(e.finMs)) return 'heure de fin';
  if (e.resteMs !== null && !(fini(e.resteMs) && e.resteMs >= 0 && e.resteMs <= e.totalMs)) return 'reste';
  return null;
}

/**
 * Lit un enregistrement et le ramène à l'heure `maintenant`.
 * - `vide` : rien de stocké ; `invalide` : illisible ou incohérent (état de repos, réglages par défaut, `raison`) ;
 *   `ok` : état et réglages restaurés.
 * - Un bloc dont l'heure de fin est passée est terminé ici, une seule fois : `evenements` porte la fin et son retard.
 *   L'appelant enregistre aussitôt l'état rendu : la fin ne sera donc plus jamais constatée au rechargement suivant.
 * - Horloge reculée : une heure de fin plus lointaine que la durée du bloc est ramenée à `maintenant + totalMs`
 *   (`horlogeReculee`), le reste affiché ne dépasse donc jamais la durée du bloc.
 * @returns {{statut: 'vide'|'invalide'|'ok', raison: string|null, etat: EtatFocus, reglages: typeof REGLAGES_DEFAUT, evenements: EvenementFocus[], horlogeReculee: boolean}}
 */
export function lire(brut, maintenant) {
  heure(maintenant);
  const repos = (statut, raison) => ({ statut, raison, etat: creer(), reglages: REGLAGES_DEFAUT, evenements: [], horlogeReculee: false });
  if (brut === null || brut === undefined) return repos('vide', null);
  if (typeof brut !== 'string') return repos('invalide', 'type');
  if (brut.length > TAILLE_MAX_STOCKAGE) return repos('invalide', 'taille');
  let o;
  try { o = JSON.parse(brut); } catch { return repos('invalide', 'JSON'); }
  const raison = incoherence(o);
  if (raison) return repos('invalide', raison);
  const { phase, travailMin, pauseMin, totalMs, finMs, resteMs } = o.etat;
  const { arretFin, carillon, notification, volume } = o.reglages;
  let etat = fige({ phase, travailMin, pauseMin, totalMs, finMs, resteMs });
  let horlogeReculee = false;
  if (etat.finMs !== null && etat.finMs > maintenant + etat.totalMs) { etat = fige({ ...etat, finMs: maintenant + etat.totalMs }); horlogeReculee = true; }
  const r = synchroniser(etat, maintenant);
  return { statut: 'ok', raison: null, etat: r.etat, reglages: fige({ arretFin, carillon, notification, volume }), evenements: r.evenements, horlogeReculee };
}
