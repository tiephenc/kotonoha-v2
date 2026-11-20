// KOTONOHA 2.0 · exercices d'entraînement d'une leçon (PH-4). Domaine pur.
// RÈGLE IMPÉRATIVE (registre 11 §9.5) : tout exercice non noté passe par `selectionner(..., { mode: 'entrainement' })`.
// Les contenus estimés (`estime-v1` compris) forment au plus 10 % des items ; le corpus V1 étant entièrement `estime-v1`,
// aucun item V1 n'est servi aujourd'hui. Ce module n'offre aucun moyen de contourner ce plafond.
import { selectionner } from './selection-evaluation.js';

export const NB_EXERCICES = 5;
export const ETIQUETTE_PERSONNEL = 'Niveau estimé, non certifié';
export const MESSAGE_INDISPONIBLE = 'Exercices indisponibles pour l’instant : aucun contenu de ce niveau n’a de niveau vérifié par deux repères indépendants.';

/** Items d'entraînement d'une leçon du catalogue : quiz, questions de lecture et d'écoute. Statut : celui de la leçon. */
export function poolDeLecon(l) {
  const base = { statut: l.statutNiveau, niveau: l.niveau, lecon: l.numero };
  const pool = l.quiz.map((q) => ({ ...base, id: q.loc, source: 'quiz', question: q.question, options: q.options, reponse: q.reponse, explication: q.explication }));
  for (const [cle, bloc] of [['lecture', l.lecture], ['ecoute', l.ecoute]]) {
    (bloc?.qs ?? []).forEach((q, i) => pool.push({ ...base, id: `${bloc.loc}#q${i}`, source: cle, question: q.q, options: q.o, reponse: q.a, explication: q.w }));
  }
  return pool;
}

/** Phrases à reconstituer (SORT de la V1, « ordonner » du catalogue) : items `type: 'ordonner'`, segments dans l'ordre juste. */
export function poolOrdonner(l) {
  const base = { statut: l.statutNiveau, niveau: l.niveau, lecon: l.numero };
  const traduction = new Map(l.grammaire.flatMap((g) => g.exemples).map((e) => [e.loc, e.fr]));
  return (l.ordonner ?? []).map((o) => ({ ...base, id: o.loc, source: 'ordonner', type: 'ordonner', segments: o.segments,
    question: 'Remettez les éléments dans l’ordre pour former la phrase.', explication: traduction.has(o.exemple) ? `Traduction : ${traduction.get(o.exemple)}` : '' }));
}

/** Questions des unités de méthode : textes d'entraînement (unité de lecture) et écoutes d'entraînement. Aucune question n'est inventée. */
export function poolSpecial(l) {
  const base = { statut: l.statutNiveau, niveau: l.niveau, lecon: l.numero }, c = l.champs ?? {}, pool = [];
  (c.texts ?? []).forEach((t, i) => (t.qs ?? []).forEach((q, j) => pool.push({ ...base, id: `${l.loc}#t${i}q${j}`, source: 'lecture', question: q.q, options: q.o, reponse: q.a, explication: q.w })));
  (c.items ?? []).forEach((it, i) => pool.push({ ...base, id: `${l.loc}#i${i}`, source: c.kind === 'pratique' ? (it.sk || 'pratique') : 'ecoute', question: it.q, options: it.o, reponse: it.a, explication: it.w }));
  return pool;
}

/** Tout ce qui s'exerce dans une leçon : quiz, lecture, écoute, phrases à ordonner, unités de méthode. */
export const poolComplet = (l) => [...poolDeLecon(l), ...poolOrdonner(l), ...poolSpecial(l)];

/** @returns {{items: any[], rapport: any, disponible: boolean, motif: string|null}} */
/** Rattache un item V1 à une facette de compréhension propre (un item, un élément) : ses réponses alimentent la répétition espacée. Marque `perso`. */
export const rattacherPerso = (it) => ({ ...it, perso: true, element: it.id.replace(/#/g, '~'), facette: 'G-COMP' });

/** @param {{n?: number, graine?: any, personnel?: boolean}} o `personnel` : étude personnelle activée par l'apprenant (mode `personnel`, sans plafond ; les contenus estimés y sont étiquetés). */
export function preparer(pool, { n = NB_EXERCICES, graine = 0, personnel = false } = {}) {
  const r = selectionner(pool, { mode: personnel ? 'personnel' : 'entrainement', n, graine });
  // Seuls les contenus estimés sont rattachés (et étiquetés) en étude personnelle ; un item vérifié garde sa facette et son étiquette.
  if (personnel) r.items = r.items.map((it) => (it.statut === 'verifie' ? it : rattacherPerso(it)));
  return { items: r.items, rapport: r.rapport, disponible: r.items.length > 0, motif: r.rapport.motif };
}

/** Juste ? QCM : index de l'option ; phrase à ordonner : positions d'affichage (`ordre` mélangé) dont les segments, mis bout à bout, redonnent la phrase. */
function estJuste(q, choix) {
  if (q.type === 'trace') return choix?.reussi === true;
  if (q.type !== 'ordonner') return choix === q.reponse;
  const affiche = (q.ordre ?? q.segments.map((_, k) => k)).map((k) => q.segments[k]);
  return choix.map((p) => affiche[p]).join('\u0000') === q.segments.join('\u0000');
}

/** Déroulement d'une série : une question à la fois, retour expliqué, résumé. */
export function creerSession(items) {
  let i = 0;
  const reponses = [];
  return {
    get total() { return items.length; },
    get index() { return i; },
    get courant() { return items[i] ?? null; },
    get fini() { return i >= items.length; },
    get repondue() { return reponses.length > i; },
    /** La réponse serait-elle juste ? Sans l'enregistrer (la validation du choix est celle de `repondre`). */
    evaluer(choix) {
      const q = items[i];
      if (!q) throw new Error('aucune question en attente de réponse');
      if (q.type === 'trace') { if (typeof choix?.reussi !== 'boolean') throw new RangeError('choix invalide'); return choix.reussi; }
      if (q.type === 'ordonner') {
        const n = q.segments.length;
        if (!Array.isArray(choix) || choix.length !== n || new Set(choix).size !== n || !choix.every((p) => Number.isInteger(p) && p >= 0 && p < n)) throw new RangeError('choix invalide');
        return estJuste(q, choix);
      }
      if (!Number.isInteger(choix) || choix < 0 || choix >= q.options.length) throw new RangeError('choix invalide');
      return choix === q.reponse;
    },
    /** Enregistre le choix (index d'option) pour la question courante ; une seule réponse par question. */
    repondre(choix) {
      const q = items[i];
      if (!q || reponses.length > i) throw new Error('aucune question en attente de réponse');
      if (q.type === 'trace') { if (typeof choix?.reussi !== 'boolean') throw new RangeError('choix invalide'); reponses.push(choix); return { juste: choix.reussi, bonne: null, explication: q.explication }; }
      if (q.type === 'ordonner') {
        // choix : positions d'affichage prises dans l'ordre ; juste si le texte reconstitué est celui de la phrase
        const n = q.segments.length;
        if (!Array.isArray(choix) || choix.length !== n || new Set(choix).size !== n || !choix.every((p) => Number.isInteger(p) && p >= 0 && p < n)) throw new RangeError('choix invalide');
        reponses.push(choix);
        return { juste: estJuste(q, choix), bonne: q.segments, explication: q.explication };
      }
      if (!Number.isInteger(choix) || choix < 0 || choix >= q.options.length) throw new RangeError('choix invalide');
      reponses.push(choix);
      return { juste: choix === q.reponse, bonne: q.reponse, explication: q.explication };
    },
    suivante() { if (reponses.length <= i) throw new Error('répondez avant de continuer'); i++; },
    /** Résumé des seules questions répondues (arrêt volontaire d'une série). */
    resumePartiel() {
      const detail = items.slice(0, reponses.length).map((q, k) => ({ id: q.id, juste: estJuste(q, reponses[k]), choix: reponses[k] }));
      return { total: detail.length, justes: detail.filter((d) => d.juste).length, detail };
    },
    resume() {
      const detail = items.map((q, k) => ({ id: q.id, juste: k < reponses.length && estJuste(q, reponses[k]), choix: reponses[k] ?? null }));
      return { total: items.length, justes: detail.filter((d) => d.juste).length, detail };
    },
  };
}
