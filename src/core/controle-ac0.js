// KOTONOHA 2.0 · contrôle AC-0 (rapport V5 §5.4) : contrôles automatiques QC de 03 §6 applicables au corpus V1 repris.
// Domaine pur. Le contrôle ne corrige rien : il classe chaque constat en « bloquant » ou « signalement » et liste les
// contrôles non applicables à un contenu repris (séquences, audio, graphe de prérequis : structures V2 pas encore produites).
import { segmenterFurigana, sansFurigana, elementsDeLecon } from './catalogue.js';

/** Contrôles exécutés, non applicables, et leur effet (03 §6). */
export const QC = Object.freeze({
  executes: Object.freeze({
    'QC-01': 'bloquant', // champs obligatoires présents
    'QC-02': 'bloquant', // furigana bien formés
    'QC-03': 'signalement', // lecture compatible avec JMdict (JMV)
    'QC-04': 'bloquant', // recto sans la réponse
    'QC-06': 'bloquant', // distracteurs distincts de la réponse
    'QC-10': 'bloquant', // provenance et droits présents
    'QC-11': 'bloquant', // unicité (mot + lecture, kanji, localisateur)
    'QC-13': 'signalement', // typographie française
  }),
  nonApplicables: Object.freeze({
    'QC-05': 'variantes de réponse ouverte : aucun item ouvert dans les unités standard ; les remises en ordre V1 ne déclarent pas de variantes (défaut du moteur V1 connu, rapport V5 §5.1), traité par le moteur V2',
    'QC-07': 'objectifs de leçon V2 (02 §3.3) non encore rédigés',
    'QC-08': 'réemploi mesuré sur des séquences V2 non encore produites',
    'QC-09': 'niveau des éléments employés : exige une liste de référence par niveau (D-55), indisponible',
    'QC-12': 'graphe des prérequis V2 non encore produit',
    'QC-14': 'registre homogène : non automatisé de façon fiable ; reporté à AC-1 et AC-2 (grille)',
    'QC-15': 'aucun support modifié : corpus repris tel quel',
    'QC-16': 'audio : la V1 n\'a que la synthèse vocale ; aucun objet audio',
    'QC-17': 'gabarit SQ des séquences V2 non encore produit',
  }),
});

const NBSP = /[  ]/;
/** Constats de typographie française sur un texte en français (QC-13). */
export function typographie(s) {
  const out = [];
  for (const m of s.matchAll(/(.)([:;?!])/g)) {
    const avant = m[1];
    if (avant === ' ' || (!NBSP.test(avant) && /[\p{L}\p{N})»]/u.test(avant))) out.push(`« ${m[2]} » sans espace insécable avant`);
  }
  if (/"[^"]*"/.test(s)) out.push('guillemets droits au lieu de « »');
  return [...new Set(out)];
}

// Champs de provenance et sous-éléments contrôlés à part : exclus des textes de contenu.
const HORS_CONTENU = new Set(['loc', 'origine', 'fondement', 'droits', 'exemples', 'ordonner', 'grammaire']);
const textes = (el) => {
  const out = []; const visit = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!HORS_CONTENU.has(k)) visit(x); };
  visit(el); return out;
};
const japonais = (s) => /[぀-ヿ㐀-鿿]/u.test(s);

/**
 * Exécute AC-0 sur une liste de leçons. `lecturesConnues` : Map expression → Set(lectures) (JMV), pour QC-03.
 * @returns {{ denominateur: number, elements: Record<string, { famille: string, bloquants: string[], signalements: string[] }>, totaux: object }}
 */
export function ac0(lecons, lecturesConnues) {
  const elements = {}; const vus = { loc: new Set(), mot: new Map(), kanji: new Map() };
  for (const l of lecons) for (const { famille, loc, el } of elementsDeLecon(l)) {
    const b = [], s = [];
    // QC-11 : unicité.
    if (vus.loc.has(loc)) b.push('QC-11 : localisateur en double'); vus.loc.add(loc);
    // QC-10 : provenance et droits.
    if (el.origine !== 'repris' || !el.fondement || !el.droits) b.push('QC-10 : provenance ou droits absents');
    // QC-01 : champs obligatoires par famille.
    const requis = { grammaire: ['motif', 'forme', 'sens', 'explication'], exemple: ['jp', 'fr'], vocabulaire: ['mot', 'lecture', 'sens'], kanji: ['caractere', 'sens'], quiz: ['question', 'options', 'explication'], lecture: ['title', 'paras', 'qs'], ecoute: ['title', 'lines', 'qs'] }[famille];
    for (const f of requis) if (el[f] === undefined || el[f] === null || el[f] === '' || (Array.isArray(el[f]) && !el[f].length)) b.push(`QC-01 : champ « ${f} » absent`);
    if (famille === 'kanji' && !el.on && !el.kun) b.push('QC-01 : ni lecture on ni lecture kun');
    if (famille === 'exemple' && el.grammaire === undefined && !el.loc.startsWith('v1:exemple:')) b.push('QC-01 : exemple sans point de grammaire');
    // QC-02 : furigana, sur tous les textes de l'élément.
    for (const t of textes(el)) if (t.includes('{') || t.includes('}')) { try { segmenterFurigana(t); } catch (e) { b.push(`QC-02 : ${e.message}`); } }
    // QC-04 et QC-06 : items à choix (quiz, questions de lecture et d'écoute).
    const items = famille === 'quiz' ? [{ q: el.question, o: el.options, a: el.reponse }] : (famille === 'lecture' || famille === 'ecoute') ? el.qs : [];
    items.forEach((it, i) => {
      const lab = items.length > 1 || famille !== 'quiz' ? ` (question ${i + 1})` : '';
      if (!Number.isInteger(it.a) || it.a < 0 || it.a >= it.o.length) { b.push(`QC-04 : clé hors des options${lab}`); return; }
      const opts = it.o.map((o) => sansFurigana(o).trim());
      if (new Set(opts).size !== opts.length) b.push(`QC-06 : options en double${lab}`);
      const rep = opts[it.a];
      if (rep.length >= 2 && sansFurigana(it.q).includes(rep) && !/[「」]/.test(it.q.replace(/「[^」]*」/g, ''))) s.push(`QC-04 : la question contient le texte de la réponse${lab}`);
      if (it.o.length < 3) s.push(`QC-06 : moins de 3 options${lab}`);
    });
    // QC-03 : lecture du mot de vocabulaire connue de JMdict (JMV).
    if (famille === 'vocabulaire' && lecturesConnues) {
      const conn = lecturesConnues.get(el.mot);
      if (!conn) s.push('QC-03 : mot absent de JMV (8 188 entrées) ; lecture non vérifiable automatiquement');
      else if (!conn.has(el.lecture)) s.push(`QC-03 : lecture « ${el.lecture} » absente des lectures JMV (${[...conn].join(', ')})`);
      const cle = `${el.mot}|${el.lecture}`;
      if (vus.mot.has(cle)) b.push(`QC-11 : mot déjà présent (${vus.mot.get(cle)})`); else vus.mot.set(cle, loc);
    }
    if (famille === 'kanji') { if (vus.kanji.has(el.caractere)) b.push(`QC-11 : kanji déjà présent (${vus.kanji.get(el.caractere)})`); else vus.kanji.set(el.caractere, loc); }
    // QC-13 : typographie des textes français (sans japonais).
    for (const t of textes(el)) for (const c of typographie(t.replace(/「[^」]*」/g, ''))) s.push(`QC-13 : ${c}`);
    elements[loc] = { famille, bloquants: [...new Set(b)], signalements: [...new Set(s)] };
  }
  const vals = Object.values(elements);
  return {
    denominateur: vals.length,
    elements,
    totaux: { bloquants: vals.filter((e) => e.bloquants.length).length, signalements: vals.filter((e) => e.signalements.length).length, conformes: vals.filter((e) => !e.bloquants.length).length },
  };
}

/** Table expression → lectures, depuis les notes JMV (champs 7 : expression, 9 : lecture). */
export function lecturesJmv(jmv) {
  const m = new Map();
  for (const n of jmv.valeur.notes) { const e = n[7], r = n[9]; if (!e || !r) continue; if (!m.has(e)) m.set(e, new Set()); m.get(e).add(r); if (!m.has(r)) m.set(r, new Set([r])); }
  return m;
}
