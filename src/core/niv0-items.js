// KOTONOHA 2.0 · NIV-0 : cibles d'items de reconnaissance des kana, pour core/generation-items.js. Domaine pur.
// Deux sens : kana → lecture (« どれが「シ」の lecture ? ») et lecture → kana. Les distracteurs viennent par paliers :
// confusions déclarées, puis voisins de la table (même rangée, même petit caractère), puis même type, puis le reste.
import { genererBanque } from './generation-items.js';
import { HORS_NIVEAU } from './statut-niveau.js';

/** Groupes de signes proches (confusions classiques). Un caractère peut figurer dans plusieurs groupes. */
export const CONFUSABLES = Object.freeze({
  hiragana: Object.freeze(['ぬめ', 'わねれ', 'はほ', 'るろ', 'さき', 'いり', 'こに', 'あお', 'まよ', 'ちさ', 'めぬの', 'けはほ', 'おあ', 'ふう', 'らう', 'ぱばは', 'ぴびひ', 'ぷぶふ', 'ぺべへ', 'ぽぼほ', 'がか', 'ざさ', 'だた']),
  katakana: Object.freeze(['シツ', 'ソン', 'クケタ', 'ウワフ', 'ヌス', 'コユ', 'ノメ', 'ミシ', 'アマヤ', 'ナメ', 'ラフ', 'チテ', 'トヒ', 'ヲラ', 'ンリ', 'ツン', 'ソシ', 'ワクヲ']),
});

const lecturable = (e) => typeof e.romanisation === 'string' && e.romanisation !== '';

/** Entrées de reconnaissance : celles qui ont une romanisation propre (ni petits caractères, ni ー). */
export function entreesLisibles(doc) { return doc.entrees.filter(lecturable); }

/** Un item NIV-0 est hors-niveau : jamais estimé, jamais certifié, jamais d'un niveau JLPT (décision D2). */
const horsNiveau = (items) => items.map((it) => ({ ...it, statut: HORS_NIVEAU, niveau: null }));

/** Voisins d'une entrée, par paliers de proximité (liste d'objets entrée). */
function paliers(e, pool, groupes) {
  const memeEcriture = pool.filter((x) => x.id !== e.id && x.ecriture === e.ecriture);
  const confus = groupes[e.ecriture].filter((g) => [...g].includes(e.caractere)).flatMap((g) => [...g]).filter((c) => c !== e.caractere);
  const declares = memeEcriture.filter((x) => confus.includes(x.caractere));
  const finale = [...e.caractere].at(-1);
  const voisins = memeEcriture.filter((x) => x.rangee === e.rangee || (e.type === 'yoon' && [...x.caractere].at(-1) === finale));
  const memeType = memeEcriture.filter((x) => x.type === e.type);
  return [['confusion de signes proches', declares], ['même rangée ou même petit caractère', voisins], ['même type', memeType], ['autre kana', memeEcriture]];
}

/**
 * Cibles pour `genererBanque`.
 * - sens 'lecture' : énoncé = le kana, réponse = sa romanisation ; distracteurs = romanisations de kana proches,
 *   jamais égales à la réponse (ぢ et じ partagent « ji » : aucune ne peut être le distracteur de l'autre).
 * - sens 'kana' : énoncé = la romanisation, réponse = le kana ; seules les entrées non `secondaire` sont des cibles
 *   (を, ぢ, づ… partagent leur romanisation avec une autre : la question aurait deux réponses) ; les distracteurs
 *   de même romanisation que la clé sont exclus.
 * @param {{entrees: object[]}} doc contenu de kana.json
 * @param {'lecture'|'kana'} sens
 * @param {{ecriture?: 'hiragana'|'katakana', jusquA?: number}} [o] restreindre à une écriture ; `jusquA` : ne retenir que les signes
 *   du parcours déjà introduits (`ordre` ≤ jusquA), cibles comme distracteurs : un signe confondable n'apparaît qu'une fois introduit.
 */
export function ciblesKana(doc, sens, { ecriture, jusquA } = {}) {
  if (sens !== 'lecture' && sens !== 'kana') throw new Error(`sens inconnu : ${sens}`);
  if (jusquA !== undefined && !Number.isInteger(jusquA)) throw new Error('jusquA doit être un entier');
  // Hors parcours (ぢゃ, ゎ…) : jamais cible ni distracteur ; `jusquA` borne en plus aux signes déjà introduits.
  const pool = entreesLisibles(doc).filter((e) => e.parcours !== false && (jusquA === undefined || (Number.isInteger(e.ordre) && e.ordre <= jusquA)));
  const groupes = CONFUSABLES;
  const retenues = pool.filter((e) => (!ecriture || e.ecriture === ecriture) && (sens === 'lecture' || !e.secondaire));
  return retenues.map((e) => {
    const sansHomophone = (x) => x.romanisation !== e.romanisation;
    const ps = paliers(e, pool, groupes);
    if (sens === 'lecture') {
      return { id: `niv0:item:lecture:${e.id.slice(5)}`, enonce: e.caractere, reponse: e.romanisation,
        candidats: ps.map(([raison, l]) => ({ raison, valeurs: [...new Set(l.filter(sansHomophone).map((x) => x.romanisation))] })), extra: { cible: e.id, sens } };
    }
    return { id: `niv0:item:kana:${e.id.slice(5)}`, enonce: `« ${e.romanisation} » en ${e.ecriture}`, reponse: e.caractere,
      candidats: ps.map(([raison, l]) => ({ raison, valeurs: l.filter(sansHomophone).map((x) => x.caractere) })), extra: { cible: e.id, sens } };
  });
}

/** Banque NIV-0 complète d'un sens et d'une écriture (ou des deux), déterministe pour une graine. */
export function banqueKana(doc, sens, { graine, n = 4, ecriture, jusquA } = {}) {
  return horsNiveau(genererBanque({ cibles: ciblesKana(doc, sens, { ecriture, jusquA }), n, graine }));
}

/** Mots des paires minimales, à plat, avec leur paire et leur partenaire. */
export function motsDesPaires(motsDoc) {
  return motsDoc.paires.flatMap((p) => p.mots.map((m, i) => ({ ...m, paire: p.id, partenaire: p.mots[1 - i], theme: p.theme, etape: p.etape })));
}

/**
 * Cibles de reconnaissance sur les mots à longueur de voyelle ou tenue de consonne (paires minimales).
 * - sens 'lecture' : mot en kana → romanisation Hepburn (macron). Distracteurs : la paire minimale, puis des voisins plausibles.
 * - sens 'kana' : romanisation → mot en kana (retour). Distracteurs : la paire minimale, puis des voisins plausibles.
 * Toute forme correcte possible (`equivalentes` : autre graphie romanisée du même kana ; `kanaEquivalents` : autre graphie kana de la même lecture) est soit la clé, soit
 * ABSENTE des options : elle est retirée des distracteurs, qui ne sont jamais une autre graphie de la clé.
 */
export function ciblesMots(motsDoc, sens) {
  if (sens !== 'lecture' && sens !== 'kana') throw new Error(`sens inconnu : ${sens}`);
  return motsDesPaires(motsDoc).map((m) => {
    const cle = m.id.slice('niv0:mot:'.length);
    if (sens === 'lecture') {
      const interdit = new Set([m.romanisation, ...m.equivalentes]);
      const ok = (l) => l.filter((v) => !interdit.has(v));
      return { id: `niv0:item:mot-lecture:${cle}`, enonce: m.kana, reponse: m.romanisation,
        candidats: [{ raison: 'paire minimale', valeurs: ok([m.partenaire.romanisation]) }, { raison: 'voisin plausible', valeurs: ok(m.distracteursLecture) }],
        extra: { cible: m.id, paire: m.paire, theme: m.theme, sens: 'mot-lecture', origine: 'nouveau', aRelire: 'AC-2' } };
    }
    const interdit = new Set([m.kana, ...m.kanaEquivalents]);
    const ok = (l) => l.filter((v) => !interdit.has(v));
    return { id: `niv0:item:mot-kana:${cle}`, enonce: `« ${m.romanisation} » en kana`, reponse: m.kana,
      candidats: [{ raison: 'paire minimale', valeurs: ok([m.partenaire.kana]) }, { raison: 'voisin plausible', valeurs: ok(m.distracteursKana) }],
      extra: { cible: m.id, paire: m.paire, theme: m.theme, sens: 'mot-kana', origine: 'nouveau', aRelire: 'AC-2' } };
  });
}

/** Banque des paires minimales, déterministe pour une graine ; items hors-niveau, contenu nouveau à relire. */
export function banqueMots(motsDoc, sens, { graine, n = 4 } = {}) {
  return horsNiveau(genererBanque({ cibles: ciblesMots(motsDoc, sens), n, graine }));
}
