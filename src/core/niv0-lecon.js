// KOTONOHA 2.0 · NIV-0 : logique pure des leçons de kana (PH-6, L21-C). Aucune E/S, aucun DOM, aucune horloge.
// Un groupe du parcours (kana.json, `parcours.groupes`) = une leçon : présentation des signes, puis reconnaissance dans les deux sens.
// Les distracteurs sont bornés aux signes déjà introduits (`jusquA` = plus grand `ordre` du groupe). Items hors-niveau, jamais notés.
import { ciblesKana, ciblesMots, CONFUSABLES } from './niv0-items.js';
import { genererBanque, melanger, generateur } from './generation-items.js';
import { HORS_NIVEAU } from './statut-niveau.js';

/** [Hyp] Seuil provisoire : un groupe est terminé à 90 % de réussite (P-30 non décidée). */
export const SEUIL_GROUPE = 0.9;
export const LIBELLE_HORS_NIVEAU = 'Hors échelle JLPT, sans niveau attribué';
/** Nombre de questions d'une série sur les paires minimales. */
export const NB_QUESTIONS_LONGUEURS = 8;

const ETATS = Object.freeze({ nonCommence: 'non-commencee', enCours: 'en-cours', termine: 'terminee' });
export { ETATS as ETATS_GROUPE };

/** Sujet de la préférence qui marque un groupe terminé (ops.js : `^[a-z][a-z0-9._-]{0,63}$`). */
export const sujetGroupe = (id) => `kana.${id}`;

/** Groupes du parcours dans l'ordre, avec leurs entrées, leur écriture et leur étape. */
export function groupesParcours(doc) {
  const parId = new Map(doc.entrees.map((e) => [e.id, e]));
  const etapes = new Map(doc.parcours.etapes.map((e) => [e.id, e]));
  return doc.parcours.groupes.map((g, i) => {
    const signes = g.signes.map((id) => {
      const e = parId.get(id);
      if (!e) throw new Error(`signe inconnu : ${id}`);
      return e;
    });
    const et = etapes.get(g.etape);
    return { id: g.id, numero: i + 1, etape: g.etape, titreEtape: et?.titre ?? g.etape, ecriture: signes[0].ecriture, signes, ordreMax: Math.max(...signes.map((s) => s.ordre)) };
  });
}

/** Clé du sujet de journal d'un item de reconnaissance : `kc:<id d'item>`. */
const cleItem = (sens, entreeId) => `kc:niv0:item:${sens}:${entreeId.slice(5)}`;

/** Sujets de journal d'un groupe (les deux sens). */
export function sujetsDuGroupe(groupe) {
  return groupe.signes.flatMap((s) => [cleItem('lecture', s.id), cleItem('kana', s.id)]);
}

/** État d'un groupe : terminé si la préférence le dit, en cours si une réponse du groupe est au journal. @param {{prefs: object, learn: object}} view */
export function etatGroupe(groupe, view) {
  if (view.prefs?.[sujetGroupe(groupe.id)]?.v === 'termine') return ETATS.termine;
  const learn = view.learn ?? {};
  return sujetsDuGroupe(groupe).some((k) => learn[k]?.n > 0) ? ETATS.enCours : ETATS.nonCommence;
}

/** Réussite suffisante pour déclarer le groupe terminé. */
export const groupeReussi = (justes, total) => total > 0 && justes / total >= SEUIL_GROUPE;

/** Signes proches d'un signe (même écriture), à signaler dans la présentation. */
export function confondables(entree) {
  const gs = CONFUSABLES[entree.ecriture] ?? [];
  return [...new Set(gs.filter((g) => [...g].includes(entree.caractere)).flatMap((g) => [...g]).filter((c) => c !== entree.caractere))];
}

const nomEcriture = { hiragana: 'hiragana', katakana: 'katakana' };

/** Banque d'un item à choix → item d'exercice de la V2 (`question`, `reponse` = index de la clé). */
function enExercice(it, question, explication) {
  return { id: it.id, question, options: it.options, reponse: it.cle, explication, statut: HORS_NIVEAU, niveau: null, source: 'kana' };
}

/** Banque (au moins 2 options), en réduisant `n` quand les signes déjà vus sont peu nombreux. */
function banqueAdaptee(cibles, graine, nMax = 4) {
  let derniere = null;
  for (let n = nMax; n >= 2; n--) {
    try { return genererBanque({ cibles, n, graine }); } catch (e) { derniere = e; }
  }
  throw derniere;
}

/**
 * Questions d'un groupe : chaque signe lisible, kana → lecture et lecture → kana, distracteurs limités aux signes déjà vus.
 * Déterministe pour une graine. Les signes sans lecture propre (petits caractères, ー) ne sont pas interrogés.
 * @returns {object[]} items prêts pour `creerSession` (ordre mélangé)
 */
export function itemsDuGroupe(doc, groupe, graine) {
  const ids = new Set(groupe.signes.map((s) => s.id));
  const parId = new Map(doc.entrees.map((e) => [e.id, e]));
  const out = [];
  for (const sens of ['lecture', 'kana']) {
    const cibles = ciblesKana(doc, sens, { ecriture: groupe.ecriture, jusquA: groupe.ordreMax }).filter((c) => ids.has(c.extra.cible));
    if (!cibles.length) continue;
    for (const it of banqueAdaptee(cibles, `${graine}|${groupe.id}|${sens}`)) {
      const e = parId.get(it.extra.cible);
      if (sens === 'lecture') out.push(enExercice(it, `Comment se lit « ${e.caractere} » ?`, `« ${e.caractere} » se lit « ${e.romanisation} » (à peu près « ${e.lectureFr} » en français).`));
      else out.push(enExercice(it, `Quel signe (${nomEcriture[e.ecriture]}) se lit « ${e.romanisation} » ?`, `« ${e.caractere} » se lit « ${e.romanisation} » (à peu près « ${e.lectureFr} » en français).`));
    }
  }
  return melanger(out, generateur(`${graine}|${groupe.id}|ordre`));
}

/** Série sur les paires minimales : `NB_QUESTIONS_LONGUEURS` questions tirées dans les deux sens. */
export function itemsLongueurs(motsDoc, graine) {
  const parCible = new Map(motsDoc.paires.flatMap((p) => p.mots.map((m) => [m.id, m])));
  const tous = [];
  for (const sens of ['lecture', 'kana']) {
    const cibles = ciblesMots(motsDoc, sens);
    for (const it of genererBanque({ cibles, n: 4, graine: `${graine}|longueurs|${sens}` })) {
      const m = parCible.get(it.extra.cible);
      const question = sens === 'lecture' ? `Comment se lit « ${m.kana} » ?` : `Quel mot se lit « ${m.romanisation} » ?`;
      tous.push(enExercice(it, question, `« ${m.kana} » se lit « ${m.romanisation} » : ${m.sens}.`));
    }
  }
  return melanger(tous, generateur(`${graine}|longueurs|tirage`)).slice(0, NB_QUESTIONS_LONGUEURS);
}
