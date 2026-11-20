// KOTONOHA 2.0 · Q-12 : sélection des items d'une évaluation selon le statut de niveau.
// Fonction pure et déterministe (graine) ; les items reçus ne sont jamais modifiés.
//
// Règles appliquées (décisions de l'utilisateur) :
//  8. Examen noté ou simulation fidèle du JLPT : `verifie` seulement. Jamais de complétion par des estimés.
//  9. Entraînement non noté : TOUS les statuts estimés (`estime-v1`, `estime-un-repere`, `estime-editorial-nouveau`)
//     forment un seul compteur, au plus 10 % des items retenus, arrondi vers le bas ; chaque item estimé est
//     identifié dans le rapport. `verifie` n'est pas compté ; `non-disponible` n'est jamais retenu.
// 10. `non-disponible` n'est jamais retenu, dans aucun mode.
// 12. `hors-niveau` (décision D2, 2026-11-18) : TOUJOURS refusé en examen noté ou simulation JLPT ; admis en entraînement,
//     où il n'est PAS compté comme estimé (le plafond de 10 % et les statuts plafonnés sont inchangés) ; un item
//     `hors-niveau` qui porte un niveau ou une mention certifiée est écarté dans tous les modes.
//  6. Le statut est lu dans `item.statut`, jamais déduit du niveau ; un statut inconnu ou fusionné est écarté.
//
// Décision du 2026-11-15 (registre 11 §9.5) : `estime-v1` entre dans le plafond. Le plafond et les statuts plafonnés
// sont fixes : aucune option ne permet d'en retirer un statut ni d'élever la part.
import { STATUSES, ESTIMATED, HORS_NIVEAU } from './statut-niveau.js';

/** Statuts qui alimentent le plafond unique : tous les statuts estimés. */
export const PLAFONNES = ESTIMATED;
/** Part maximale des contenus estimés en entraînement non noté. */
export const PLAFOND = 0.10;
export const RAISONS = Object.freeze({
  doublon: 'identifiant déjà présent : seule la première occurrence est examinée',
  'statut-inconnu': 'statut absent, inconnu ou fusionné avec un niveau : écarté par prudence',
  'non-disponible': 'niveau non établi : jamais introduit dans une évaluation',
  'examen-niveau-estime': 'examen noté : seuls les niveaux vérifiés sont admis',
  'examen-hors-niveau': 'examen noté ou simulation JLPT : un item hors-niveau est toujours refusé',
  'hors-niveau-incoherent': 'item hors-niveau portant un niveau JLPT ou une mention certifiée : écarté dans tous les modes',
  'plafond-atteint':'entraînement : plafond des contenus estimés atteint',
  'non-tire': 'admissible, non tiré (nombre demandé atteint)',
});

/** Graine (nombre ou texte) -> générateur pseudo-aléatoire reproductible (FNV-1a puis mulberry32). */
function rng(graine) {
  let h = 0x811c9dc5;
  for (const c of String(graine)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Mélange déterministe, indépendant de l'ordre d'entrée (tri par identifiant d'abord). */
function melanger(items, graine) {
  const a = [...items].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)), r = rng(graine);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Nombre maximal d'items plafonnés pour un total donné (arrondi vers le bas, tolérance flottante). */
export const maxPlafonnes = (total, plafond) => Math.floor(plafond * total + 1e-9);

/**
 * Mode `personnel` (L21-A, étude personnelle activée par l'apprenant) : admet les estimés sans plafond, jamais `non-disponible`, jamais en examen ;
 * l'appelant d'un examen passe par `selectionnerExamen`, qui le refuse. Le plafond de 10 % de l'entraînement n'est pas modifié.
 * @param {{id: string, statut: string}[]} items
 * @param {{mode: 'examen'|'entrainement'|'personnel', n: number, graine?: number|string}} o
 */
export function selectionner(items, { mode, n, graine = 0, ...autres } = {}) {
  const inconnues = Object.keys(autres);
  if (inconnues.length) throw new Error(`option inconnue : ${inconnues.join(', ')} (le plafond de 10 % porte sur tous les statuts estimés et n'est pas réglable)`);
  const plafond = PLAFOND;
  if (mode !== 'examen' && mode !== 'entrainement' && mode !== 'personnel') throw new Error(`mode invalide : ${mode}`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`nombre demandé invalide : ${n}`);
  const plafonnes = new Set(PLAFONNES);

  const exclusions = [], vus = new Set(), admissibles = [];
  const exclure = (it, raison) => exclusions.push({ id: it.id, statut: it.statut ?? null, raison });
  for (const it of items) {
    if (typeof it?.id !== 'string' || !it.id) throw new Error('item sans identifiant : traçabilité impossible');
    if (vus.has(it.id)) { exclure(it, 'doublon'); continue; }
    vus.add(it.id);
    if (!STATUSES.includes(it.statut)) exclure(it, 'statut-inconnu');
    else if (it.statut === 'non-disponible') exclure(it, 'non-disponible');
    else if (it.statut === HORS_NIVEAU && (it.niveau != null || it.niveauAffiche != null || it.certifie === true)) exclure(it, 'hors-niveau-incoherent');
    else if (it.statut === HORS_NIVEAU && mode === 'examen') exclure(it, 'examen-hors-niveau');
    else if (mode === 'examen' && it.statut !== 'verifie') exclure(it, 'examen-niveau-estime');
    else admissibles.push(it);
  }

  const ordre = melanger(admissibles, graine), retenus = [];
  let motif = null, plafondApplique = null;
  if (mode === 'examen' || mode === 'personnel') {
    for (const it of ordre) (retenus.length < n ? retenus.push(it) : exclure(it, 'non-tire'));
    if (retenus.length < n) motif = mode === 'personnel' ? `étude personnelle : ${retenus.length} item(s) disponible(s) pour ${n} demandé(s)` : `examen incomplet : ${retenus.length} item(s) de niveau vérifié disponible(s) pour ${n} demandé(s) ; aucun item estimé n’est ajouté`;
  } else {
    const nbP = ordre.filter((it) => plafonnes.has(it.statut)).length, nbL = ordre.length - nbP;
    // Total atteignable le plus grand tel que les plafonnés restent <= plafond du total retenu.
    let total = Math.min(nbL, n);
    for (let c = 1; c <= Math.min(nbP, n); c++) {
      const t = Math.min(nbL, n - c) + c;
      if (c <= maxPlafonnes(t, plafond) && t > total) total = t;
    }
    plafondApplique = Math.min(nbP, maxPlafonnes(total, plafond));
    let pris = 0;
    for (const it of ordre) {
      if (plafonnes.has(it.statut) && pris >= plafondApplique) exclure(it, 'plafond-atteint');
      else if (retenus.length >= total) exclure(it, 'non-tire');
      else { retenus.push(it); if (plafonnes.has(it.statut)) pris++; }
    }
    if (retenus.length < n) motif = `entraînement incomplet : ${retenus.length} item(s) retenu(s) pour ${n} demandé(s) ; plafond de ${Math.round(plafond * 100)} % sur ${[...plafonnes].join(', ') || 'aucun statut'}`;
  }

  const parStatut = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const it of retenus) parStatut[it.statut]++;
  const estimes = retenus.filter((it) => ESTIMATED.includes(it.statut));
  const nbPlafonnes = retenus.filter((it) => plafonnes.has(it.statut)).length;
  exclusions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.raison < b.raison ? -1 : a.raison > b.raison ? 1 : 0));
  const parRaison = {};
  for (const e of exclusions) parRaison[e.raison] = (parRaison[e.raison] || 0) + 1;
  return {
    items: retenus,
    rapport: {
      mode, demande: n, retenus: retenus.length, complet: retenus.length === n, motif, graine,
      statutsPlafonnes: [...plafonnes], plafond: mode === 'entrainement' ? plafond : null, plafondApplique,
      parStatut,
      partEstimee: retenus.length ? estimes.length / retenus.length : 0,
      partPlafonnee: retenus.length ? nbPlafonnes / retenus.length : 0,
      itemsEstimes: estimes.map((it) => ({ id: it.id, statut: it.statut, plafonne: plafonnes.has(it.statut) })),
      exclusions, parRaison,
    },
  };
}

/** Sélection pour un examen noté ou une simulation : le mode `personnel` y est refusé, sans exception. */
export function selectionnerExamen(items, o = {}) {
  if (o.mode !== undefined && o.mode !== 'examen') throw new Error(`un examen n'accepte que des items de niveau vérifié : mode ${o.mode} refusé`);
  return selectionner(items, { ...o, mode: 'examen' });
}
