// KOTONOHA 2.0 · séance de révision (PX-04, 04 §15.3 ; 02 §11.7). Domaine pur. Les éléments dus viennent du moteur de consolidation
// (états de facettes dérivés du journal, échéances FSRS), jamais d'un compteur stocké. Un item n'est servi que s'il est admis par
// `selectionner(..., { mode: 'entrainement' })` (Q-12, registre 11 §9.5) : aucun contournement, ni plafond relevé ni statut ajouté.
// L'application réelle n'a aucune banque d'items à facettes (le corpus V1 n'en porte pas) : elle n'a donc jamais rien à réviser.
import { consolidate, plan, pickItem, parseFacet, scheduled, facetSubject } from './consolidation.js';
import { selectionner } from './selection-evaluation.js';

/** Budget de la séance, en secondes, et durée d'une révision (02 §11.7). [Hyp] : provisoires, à régler par l'apprenant (PH-5). */
export const BUDGET_SEC = 900;
export const SEC_PAR_REVISION = 20;
export const MESSAGE_VIDE = 'Rien à réviser pour l’instant.';
/** Reprises (02 §11.6 : un élément jamais réussi est réenseigné, pas révisé) servies au plus par séance. [Hyp] provisoire. */
export const MAX_REPRISES = 10;

/** Facette jamais réussie dont la dernière réponse est un échec antérieur au jour donné : à réenseigner. */
export const aReprendre = (r, jour) => (r.state === 'M0' || r.state === 'M1') && r.history.at(-1)?.ev === 'echec-avant' && r.history.at(-1).day < jour;

/** Jour civil local (jours depuis 1970 selon le fuseau de l'appareil). @param {number} t */
export const jourLocal = (t) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 864e5);
/** Date lisible d'un jour civil. @param {number} jour */
export const dateDuJour = (jour) => new Date(jour * 864e5).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * @param {{derived: any, banque?: any[], maintenant: number, budgetSec?: number, graine?: number|string}} o
 *   `banque` : items à facettes `{id, element, facette, statut, question, options, reponse, ...}`.
 * @returns {{etat: 'vide'|'a-reviser'|'indisponible', file: {subject: string, facette: string, item: any, reprise?: boolean}[], dues: number, reprises: number, reportees: number,
 *   sansContenu: number, minutes: number, prochaine: number|null, anomalies: string[], rapport: any}}
 */
export function preparerRevision({ derived, banque = [], maintenant, budgetSec = BUDGET_SEC, graine = 0, personnel = false }) {
  const jour = jourLocal(maintenant);
  const { facets, anomalies } = consolidate(derived, { dayOf: jourLocal });
  const p = plan(facets, jour, { budgetSec });
  // Q-12 : seuls les items admis par la sélection en entraînement peuvent être servis.
  const sel = banque.length ? selectionner(banque, { mode: personnel ? 'personnel' : 'entrainement', n: banque.length, graine }) : null;
  const admis = sel ? sel.items : [];
  const file = []; let sansContenu = 0;
  const itemPour = (subject) => pickItem(facets[subject], admis.filter((i) => i.element && i.facette && facetSubject(`kc:${i.element}`, i.facette) === subject).map((i) => `kc:${i.id}`));
  for (const row of p.due) {
    const f = parseFacet(row.subject), choisi = itemPour(row.subject);
    if (!choisi) { sansContenu++; continue; }
    file.push({ subject: row.subject, facette: f.facet, item: admis.find((i) => `kc:${i.id}` === choisi) });
  }
  // Reprises : après les révisions dues, les éléments manqués au premier passage (le lendemain au plus tôt, pour qu'un rappel ne soit pas une copie de la correction).
  let reprises = 0;
  for (const r of Object.values(facets).filter((x) => aReprendre(x, jour)).sort((a, b) => a.history.at(-1).day - b.history.at(-1).day || (a.subject < b.subject ? -1 : 1))) {
    if (reprises >= MAX_REPRISES) break;
    const choisi = itemPour(r.subject);
    if (!choisi) continue;
    file.push({ subject: r.subject, facette: r.facet, item: admis.find((i) => `kc:${i.id}` === choisi), reprise: true });
    reprises++;
  }
  const prochaines = Object.values(facets).filter((r) => scheduled(r) && r.due > jour).map((r) => r.due);
  const prochaine = prochaines.length ? Math.min(...prochaines) : null;
  const dues = p.due.length + p.deferred.length;
  const etat = file.length ? 'a-reviser' : dues > 0 ? 'indisponible' : 'vide';
  return { etat, file, dues, reprises, reportees: p.deferred.length, sansContenu, minutes: Math.max(1, Math.ceil((file.length * SEC_PAR_REVISION) / 60)), prochaine, anomalies, rapport: sel?.rapport ?? null };
}
