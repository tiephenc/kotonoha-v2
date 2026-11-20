// KOTONOHA 2.0 · Pause (écran de pause du Focus) : transitions étude → pause → reprise. Domaine pur, au-dessus de
// core/focus.js : aucun accès au DOM, au stockage ni à l'horloge (l'heure est passée en millisecondes).
// Aucune note, aucune série, aucun historique : la pause ne retient rien (D-34, PR-07). L'état est celui du Focus
// (même enregistrement) : on le fait évoluer, on n'en crée pas un second.
import * as F from './focus.js';

const MIN = 60_000;
export const PROLONGATION_MIN = 5;
export const PAUSE_MAX_MIN = F.PAUSE_TOTALE_MAX_MIN;
const fige = (o) => Object.freeze(o);

/** Vrai quand l'écran de pause a quelque chose à montrer : pause en cours (ou suspendue) ou terminée. */
export const enPause = (e) => e.phase === 'brk' || e.phase === 'bdone';

/** Lance la pause après un bloc terminé. Dans tout autre état, l'état est rendu tel quel. */
export const entrer = (e, maintenant) => F.lancerPause(e, maintenant);

/**
 * Rallonge la pause de `minutes` (entières, au moins 1). Pause en cours ou suspendue : le temps restant et la durée
 * totale augmentent, rien d'autre ne bouge. Pause terminée : une nouvelle pause de `minutes` commence. Autre état,
 * ou durée totale qui dépasserait 120 minutes : état rendu tel quel.
 */
export function prolonger(e, minutes, maintenant) {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 1) return e;
  const x = F.synchroniser(e, maintenant).etat;
  const plus = m * MIN;
  if (x.phase === 'bdone') return fige({ ...x, phase: 'brk', totalMs: plus, finMs: maintenant + plus, resteMs: null });
  if (x.phase !== 'brk' || x.totalMs + plus > PAUSE_MAX_MIN * MIN) return x;
  if (F.enSuspens(x)) return fige({ ...x, totalMs: x.totalMs + plus, resteMs: x.resteMs + plus });
  return fige({ ...x, totalMs: x.totalMs + plus, finMs: x.finMs + plus });
}

/** Peut-on encore rallonger la pause d'au moins une minute ? (L'interface s'en sert pour griser la commande.) */
export const peutProlonger = (e) => e.phase === 'bdone' || (e.phase === 'brk' && e.totalMs + MIN <= PAUSE_MAX_MIN * MIN);

/**
 * Quitte la pause pour étudier : un nouveau bloc de travail commence (écourter une pause en cours, ou reprendre après
 * une pause terminée ou un bloc terminé). Au repos ou en plein bloc de travail : état rendu tel quel.
 */
export function reprendreEtude(e, maintenant) {
  const x = F.synchroniser(e, maintenant).etat;
  if (x.phase === 'brk') return F.passer(x, maintenant);
  if (x.phase === 'bdone' || x.phase === 'wdone') return F.demarrer(x, maintenant);
  return x;
}

/** Ce que l'écran de pause doit montrer : 'aucune' (repos), 'travail', 'a-lancer', 'en-cours', 'suspendue', 'terminee'. */
export function situation(e) {
  switch (e.phase) {
    case 'work': return 'travail';
    case 'wdone': return 'a-lancer';
    case 'brk': return F.enSuspens(e) ? 'suspendue' : 'en-cours';
    case 'bdone': return 'terminee';
    default: return 'aucune';
  }
}
