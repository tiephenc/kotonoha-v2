// KOTONOHA 2.0 · enregistrement des réponses aux exercices (PH-4, 08 §6.2 ; 04 §15.2 : « chaque réponse est enregistrée avant le
// retour visuel »). Une réponse = UNE opération `answer` du journal, de la catégorie DC-2 : le type existe déjà (ops.js), aucun
// type nouveau n'est créé. Elle porte ses preuves en jetons courts (format, niveau de preuve PRV), jamais de texte libre.
// Sujet : une facette (`kf:<élément>#<FACETTE>`) quand l'item déclare `element` et `facette` ; c'est alors cette facette que le moteur
// de consolidation (core/consolidation.js) fait évoluer. Sinon l'item lui-même (`kc:<identifiant>`) : la réponse est conservée et
// comptée dans la vue dérivée (`view.learn`), mais n'alimente aucune facette. Les items V1 n'ont pas de facette (rattachement non
// décidé) : ils tombent dans ce second cas, sans qu'aucun rattachement soit inventé ici.
import { facetSubject } from '../core/consolidation.js';

/** Niveau de preuve par format (02 §12.1) : reconnaissance (PRV-2) ; question sur un texte, un audio ou une phrase à ordonner (PRV-3). [Hyp] */
export const PREUVE = Object.freeze({ qcm: { fmt: 'qcm', prv: 2 }, texte: { fmt: 'qcm-texte', prv: 3 }, ordonner: { fmt: 'ordonner', prv: 3 },
  // Écriture d'un kana : rappel productif depuis la lecture (PRV-4) ; copie d'un signe montré dans l'énoncé (PRV-3). [Hyp]
  trace: { fmt: 'trace', prv: 4 }, traceCopie: { fmt: 'trace-copie', prv: 3 } });

/** Format de preuve d'un item d'exercice. */
export const formatDe = (item) => (item.type === 'trace' ? (item.copie ? PREUVE.traceCopie : PREUVE.trace) : item.type === 'ordonner' ? PREUVE.ordonner : item.source === 'lecture' || item.source === 'ecoute' ? PREUVE.texte : PREUVE.qcm);

/** Sujet de l'opération pour un item. @param {{id: string, element?: string, facette?: string}} item */
export function sujetReponse(item) {
  if (item.element && item.facette) return facetSubject(`kc:${item.element}`, item.facette);
  return `kc:${item.id}`;
}

/**
 * Enregistre une réponse. Refuse (code `blocked`) tant que des actions précédentes ne sont ni enregistrées ni exportées (08 §10.7).
 * @param {any} journal @param {any} item @param {{ok: boolean, ms?: number, ctx?: string, aid?: 'partielle'|'decisive'}} r
 * @returns {Promise<{op: any, saved: boolean}>} `saved` faux : l'opération est dans le tampon, elle n'est pas perdue.
 */
export async function enregistrerReponse(journal, item, { ok, ms, ctx = 'pratique', aid }) {
  if (!journal.canStartActivity()) { const e = new Error('des actions précédentes ne sont pas encore enregistrées'); e.code = 'blocked'; throw e; }
  const { fmt, prv } = formatDe(item);
  const payload = { ok: ok === true, ctx, item: `kc:${item.id}`, fmt, prv };
  if (Number.isSafeInteger(ms) && ms >= 0) payload.ms = ms;
  if (aid === 'partielle' || aid === 'decisive') payload.aid = aid; // aide reçue (modèle montré avant de tracer) : une réussite aidée ne fait pas avancer la facette (RT-1)
  return journal.record('answer', sujetReponse(item), payload);
}
