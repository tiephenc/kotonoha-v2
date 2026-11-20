// KOTONOHA 2.0 · validation affichée pour chaque élément (Q-12, M2-03). Deux sources, en ajout seul :
// 1. les surcouches de lot contrôlé (AC-0 à AC-4, `controles/AC-<lot>.json`), qui priment ;
// 2. les rapports AC-0 des niveaux ouverts (`controles/AC0-N4.json`, `AC0-N3.json`, `AC0-N2.json`), contrôle automatique seul, pour les éléments hors lot.
// Si une source manque, ses éléments restent « extrait sans contrôle de contenu ». « Validé par un humain » n'existe pas.
import { tableValidation, SANS_CONTROLE } from '../../core/catalogue.js';

/** Lots contrôlés servis avec le catalogue (liste fermée : un lot non listé n'est pas lu). */
export const LOTS_CONTROLES = Object.freeze(['N4-L1', 'N3-L1']);
/** Rapports AC-0 par niveau, lus pour les éléments hors lot contrôlé. */
export const RAPPORTS_AC0 = Object.freeze(['N4', 'N3', 'N2']);

/**
 * Transforme le rapport AC-0 (bloquants et signalements par élément) en surcouche à passe unique AC-0 :
 * `erreur` s'il y a un défaut bloquant, `incertain` pour un signalement, sinon `conforme` (= aucun défaut détecté).
 * @param {any} rapport @param {Set<string>} [exclus] éléments déjà couverts par un lot contrôlé
 */
export function surcoucheDepuisAc0(rapport, exclus = new Set()) {
  const elements = {};
  for (const [loc, e] of Object.entries(rapport.elements ?? {})) {
    if (exclus.has(loc)) continue;
    elements[loc] = { resultat: e.bloquants?.length ? 'erreur' : e.signalements?.length ? 'incertain' : 'conforme', passes: ['AC-0'] };
  }
  return { lot: rapport.lot ?? 'AC0-N4', date: rapport.date ?? '2026-11-15', elements };
}

const lireJson = async (f, url) => { const r = await f(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`); return r.json(); };

/** @param {string} base adresse du dossier v2/donnees/ @param {typeof fetch} [f] */
export async function chargerValidation(base, f = globalThis.fetch) {
  const surcouches = [];
  for (const lot of LOTS_CONTROLES) {
    try { surcouches.push(await lireJson(f, new URL(`controles/AC-${lot}.json`, base))); } catch { /* lot absent : ses éléments retombent sur AC-0 */ }
  }
  const couverts = new Set(surcouches.flatMap((s) => Object.keys(s.elements)));
  for (const n of RAPPORTS_AC0) {
    try { surcouches.push(surcoucheDepuisAc0(await lireJson(f, new URL(`controles/AC0-${n}.json`, base)), couverts)); } catch { /* rapport absent : ses éléments restent sans contrôle */ }
  }
  try { return tableValidation(surcouches); } catch { return { de: () => SANS_CONTROLE, taille: 0 }; }
}
