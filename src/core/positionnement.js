// KOTONOHA 2.0 · test de positionnement (PX-02, 04 §15.1 ; F-B01). Domaine pur. Questions regroupées par compétence ; aucun retour
// question par question (RM-L02) ; « Je ne sais pas » toujours proposé et jamais écrit au journal comme un échec ; une compétence
// sans preuve est « non évaluée » ; à la sortie d'un test, la confiance est FAIBLE pour toute compétence (02 §12.6). Les items passent
// par `selectionner` en entraînement (Q-12) : l'application réelle n'en a aucun d'admis, le test n'y est donc jamais proposé.
// Non réalisé : l'estimation d'un niveau (« Estimation : N4 · peu de preuves »), car les seuils de décision ne sont pas décidés.
import { selectionner } from './selection-evaluation.js';

export const COMPETENCES = Object.freeze({ grammaire: 'Grammaire', vocabulaire: 'Vocabulaire', kanji: 'Kanji', lecture: 'Lecture', ecoute: 'Écoute' });
export const PAR_COMPETENCE = 3;
export const SEC_PAR_QUESTION = 30; // [Hyp] durée annoncée
export const MESSAGE_N4 = 'Ce test porte sur les niveaux N4 à N2. Si vous débutez, commencez par les kana, puis par le parcours N5.';

/** @param {any[]} banque items `{id, competence, statut, question, options, reponse, ...}` */
export function preparerPositionnement(banque, { graine = 0, parCompetence = PAR_COMPETENCE } = {}) {
  const sel = banque.length ? selectionner(banque, { mode: 'entrainement', n: banque.length, graine }) : null;
  const admis = sel ? sel.items : [];
  const items = [], sections = [];
  for (const [cle, libelle] of Object.entries(COMPETENCES)) {
    const part = admis.filter((i) => i.competence === cle).slice(0, parCompetence);
    if (part.length) { sections.push({ cle, libelle, nb: part.length }); items.push(...part); }
  }
  return { disponible: items.length > 0, items, sections, minutes: Math.max(1, Math.ceil((items.length * SEC_PAR_QUESTION) / 60)), rapport: sel?.rapport ?? null };
}

/** Déroulement du test : réponses sans retour, résultat par compétence. */
export function creerTest(items) {
  let i = 0;
  const rep = [];
  return {
    get total() { return items.length; },
    get index() { return i; },
    get courant() { return items[i] ?? null; },
    get fini() { return i >= items.length; },
    /** @param {number|null} choix index de l'option, ou null pour « Je ne sais pas » */
    repondre(choix) {
      const q = items[i];
      if (!q) throw new Error('test terminé');
      if (choix !== null && (!Number.isInteger(choix) || choix < 0 || choix >= q.options.length)) throw new RangeError('choix invalide');
      rep.push(choix); i++;
      return { juste: choix !== null && choix === q.reponse, nsp: choix === null };
    },
    resultat() {
      return Object.entries(COMPETENCES).map(([cle, libelle]) => {
        const idx = items.map((q, k) => (q.competence === cle ? k : -1)).filter((k) => k >= 0 && k < rep.length);
        const repondues = idx.filter((k) => rep[k] !== null), justes = repondues.filter((k) => rep[k] === items[k].reponse).length;
        const prevues = items.filter((q) => q.competence === cle).length;
        return { cle, libelle, prevues, repondues: repondues.length, nsp: idx.length - repondues.length, justes, confiance: repondues.length ? 'faible' : 'non-evaluee' };
      }).filter((c) => c.prevues > 0);
    },
  };
}
