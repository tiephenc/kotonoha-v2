// KOTONOHA 2.0 · catalogue pédagogique V1 (PH-3a, M2-02). Domaine pur : aucun accès au DOM, au stockage ni au réseau.
// Le corpus V1 est repris TEL QUEL (statut d'origine « repris ») depuis v2/donnees/catalogue-v1/, extrait de index.html
// par v2/tools/catalogue/extraire.mjs et contrôlé contre tools/data-baseline.json. Rien n'est corrigé ici.
// Champs séparés (socle S3) : origine, fondement, validation, droits. Le niveau JLPT est porté avec son statut de
// provenance (Q-12) : « estime-v1 », jamais « verifie » (D-55 non satisfait). La validation vient d'une surcouche en
// ajout seul (v2/donnees/controles/) : la retirer rend le corpus d'origine à l'identique.
import { tableCorrections, corrigerElement, correctionsOrphelines } from './corrections.js';
// Les corrections autorisées (donnees/corrections/, corrections.js) s'appliquent après la vérification des empreintes, par appliquerCorrections.


/** Empreintes SHA-256 des fichiers du catalogue (octets exacts, fins de ligne LF). Tout écart est fatal. */
export const MANIFESTE = Object.freeze({
  'v1-unites.json': 'e46c1c69dead7d9510bf1097a496dc3d706183c5909af32047bcfd5dc38369e0',
  'v1-grammaire.json': '71a32f1aaa8c31e30f5e293e88e99e8a7356e0c361e8676897eb6b3ae6575611',
  'v1-exemples.json': '00d26ab27e050edb6138df14b75ebbf77e625a9434f9914f6256e3043a447b7d',
  'v1-vocabulaire.json': '19916886afa4cba622fb9beb645991ca1502597a62e9301552145ed6c2c20279',
  'v1-kanji.json': '9a7eaa454da27a363832fadb929acf1ea1176be79b7d2d0d0766df4c8e73e9c8',
  'v1-quiz.json': 'ec32f3e453ef7d606068f370cba98a85b881e55ded7165c5375696218a55f81d',
  'v1-lectures.json': '04b9f1580e48c4438af81ae5e792ced99996760b630ae3d230f6f00402ba13db',
  'v1-ecoutes.json': '7d722e41dd020bd90d264cda7f19f5aa76264289bd6e9a67dd49e9b952350522',
  'v1-ordonner.json': 'e71d10829dff3e54724fec1d1f57aa58b8ffc7feeb1025142ac7cd00901c0f1e',
  'v1-tables.json': '1406affa9253a5707a03c0ed87d5fd0b516e38a167f48c3969c648d70666c93a',
});

/** Volumes de référence (tools/data-baseline.json, 2026-11-04 ; rapport V5 §5.1). */
export const VOLUMES = Object.freeze({ unites: 210, grammaire: 628, exemples: 1884, vocabulaire: 2355, kanji: 785, quiz: 942, lectures: 157, ecoutes: 157, ordonner: 1884 });

/**
 * Suppléments produits pour KOTONOHA 2.0 (v2/tools/supplements/), dans l'ordre de chargement : même format que la V1,
 * empreinte et volumes propres, vérifiés à part. Le corpus V1 reste vérifié seul, avec ses propres volumes.
 */
const VOLUMES_SUPPLEMENT = { unites: 12, grammaire: 36, exemples: 108, vocabulaire: 96, quiz: 60, lectures: 12, ecoutes: 12, ordonner: 108 };
export const SUPPLEMENTS = Object.freeze({
  N5: Object.freeze({ fichier: 'catalogue-n5/n5.json', sha256: 'c9d8b082fcf0c7563e7252b9f071c33934b93ffc4ecd6f619c5ac8a3fb68dd61', volumes: Object.freeze({ ...VOLUMES_SUPPLEMENT, kanji: 95 }) }),
  N1: Object.freeze({ fichier: 'catalogue-n1/n1.json', sha256: '3a7a3c2b3ce59391fbdc76597847d24b10ed6e9d98378fc8ae2b861fe1032f37', volumes: Object.freeze({ ...VOLUMES_SUPPLEMENT, kanji: 72 }) }),
});
export const ORIGINE_SUPPLEMENT = 'produit';
export const STATUT_NIVEAU_SUPPLEMENT = 'estime-editorial-nouveau';
export const DROITS_SUPPLEMENT = 'contenu original de KOTONOHA 2.0 ; licence de diffusion à fixer (Q-16) ; usage personnel seulement';

export const ORIGINE = 'repris';
export const STATUT_NIVEAU = 'estime-v1';
export const SANS_CONTROLE = 'extrait sans contrôle de contenu';
export const DROITS = 'contenu propre à KOTONOHA V1 ; licence de diffusion à fixer (Q-16) ; usage personnel seulement';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (t) => hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));

/**
 * Charge et vérifie le catalogue. `lire(nom)` rend le texte exact d'un fichier de v2/donnees/catalogue-v1/.
 * Échoue au moindre écart d'empreinte ou de volume, sans jamais compléter ni corriger.
 * @param {(nom: string) => Promise<string>} lire
 */
/** @param {{ lireSupplement?: ((fichier: string) => Promise<string>) | null }} [o] lecture d'un fichier de v2/donnees/ (suppléments) ; absent : V1 seule */
export async function chargerCatalogue(lire, { lireSupplement = null } = {}) {
  const d = {};
  for (const [nom, attendu] of Object.entries(MANIFESTE)) {
    const texte = await lire(nom);
    const e = await sha256(texte);
    if (e !== attendu) throw new Error(`catalogue V1 altéré : ${nom} (${e})`);
    d[nom.replace(/^v1-|\.json$/g, '')] = JSON.parse(texte);
  }
  for (const [k, n] of Object.entries(VOLUMES)) if (d[k].length !== n) throw new Error(`catalogue V1 : volume ${k} = ${d[k].length}, attendu ${n}`);
  if (!lireSupplement) return construire(d);
  const supps = [];
  for (const [niveau, s] of Object.entries(SUPPLEMENTS)) {
    const texte = await lireSupplement(s.fichier);
    const e = await sha256(texte);
    if (e !== s.sha256) throw new Error(`catalogue ${niveau} altéré : ${s.fichier} (${e})`);
    const x = JSON.parse(texte);
    if (x.niveau !== niveau) throw new Error(`catalogue ${niveau} : niveau ${x.niveau}`);
    for (const [k, n] of Object.entries(s.volumes)) if (x[k].length !== n) throw new Error(`catalogue ${niveau} : volume ${k} = ${x[k].length}, attendu ${n}`);
    supps.push(x);
  }
  return construire(d, supps);
}

const AUCUNE_CORRECTION = Object.freeze({ de: () => null, taille: 0, ids: () => [] });

/** Leçons d'un jeu de données au format V1, avec leur provenance. */
function leconsDe(d, { origine, statut, droits }) {
  const parUnite = (liste) => { const m = new Map(); for (const x of liste) { if (!m.has(x.unite)) m.set(x.unite, []); m.get(x.unite).push(x); } return m; };
  const gram = parUnite(d.grammaire), voc = parUnite(d.vocabulaire), kan = parUnite(d.kanji), qz = parUnite(d.quiz), ordo = parUnite(d.ordonner);
  const exParG = new Map(); for (const e of d.exemples) { if (!exParG.has(e.grammaire)) exParG.set(e.grammaire, []); exParG.get(e.grammaire).push(e); }
  const lect = new Map(d.lectures.map((x) => [x.unite, x])), ecou = new Map(d.ecoutes.map((x) => [x.unite, x]));
  const ordoParEx = new Map(); for (const o of d.ordonner) if (o.exemple) ordoParEx.set(o.exemple, o);
  const prov = (loc) => ({ origine, fondement: loc, droits });
  const lecons = new Map();
  for (const u of d.unites) {
    const g = (gram.get(u.unite) || []).sort((a, b) => a.rang - b.rang).map((x) => ({
      ...prov(x.loc), loc: x.loc, id: x.id, motif: x.pat, forme: x.form, sens: x.mean, explication: x.expl,
      exemples: (exParG.get(x.id) || []).sort((a, b) => a.rang - b.rang).map((e) => ({ ...prov(e.loc), loc: e.loc, jp: e.valeur[0], fr: e.valeur[1], ordonner: ordoParEx.get(e.loc)?.valeur ?? null })),
    }));
    lecons.set(u.unite, Object.freeze({
      ...prov(u.loc), loc: u.loc, numero: Number(u.unite), niveau: u.niveau, statutNiveau: statut, module: u.module,
      titre: u.syl?.t ?? null, sousTitre: u.syl?.g ?? null, champs: u.champs, ordreChamps: u.ordreChamps,
      grammaire: g,
      vocabulaire: (voc.get(u.unite) || []).sort((a, b) => a.rang - b.rang).map((x) => ({ ...prov(x.loc), loc: x.loc, mot: x.valeur[0], lecture: x.valeur[1], sens: x.valeur[2] })),
      kanji: (kan.get(u.unite) || []).sort((a, b) => a.rang - b.rang).map((x) => ({ ...prov(x.loc), loc: x.loc, caractere: x.valeur[0], sens: x.valeur[1], on: x.valeur[2], kun: x.valeur[3], exemples: x.valeur[4] })),
      quiz: (qz.get(u.unite) || []).sort((a, b) => a.rang - b.rang).map((x) => ({ ...prov(x.loc), loc: x.loc, question: x.valeur.q, options: x.valeur.o, reponse: x.valeur.a, explication: x.valeur.w })),
      lecture: lect.has(u.unite) ? { ...prov(lect.get(u.unite).loc), loc: lect.get(u.unite).loc, ...lect.get(u.unite).valeur } : null,
      ecoute: ecou.has(u.unite) ? { ...prov(ecou.get(u.unite).loc), loc: ecou.get(u.unite).loc, ...ecou.get(u.unite).valeur } : null,
      ordonner: (ordo.get(u.unite) || []).filter((o) => o.valeur !== null).map((o) => ({ loc: o.loc, exemple: o.exemple, segments: o.valeur })),
    }));
  }
  return lecons;
}

/** Catalogue : corpus V1, puis les suppléments (leçons à la suite ; niveaux rangés par phase : N5 avant la V1, N1 après). */
function construire(d, supps = []) {
  const lecons = leconsDe(d, { origine: ORIGINE, statut: STATUT_NIVEAU, droits: DROITS });
  for (const x of supps) for (const [k, l] of leconsDe(x, { origine: ORIGINE_SUPPLEMENT, statut: STATUT_NIVEAU_SUPPLEMENT, droits: DROITS_SUPPLEMENT })) lecons.set(k, l);
  const tablesNiveaux = [...d.tables.LEVELS, ...supps.map((x) => x.table)].sort((a, b) => a.phase - b.phase);
  const niveaux = Object.freeze(Object.fromEntries(tablesNiveaux.map((l) => [l.lv, Object.freeze({ ...l, unites: [...lecons.values()].filter((x) => x.niveau === l.lv).map((x) => x.numero) })])));
  return Object.freeze({
    niveaux,
    /** Modules du supplément (lignes [de, à, nom, niveau, …], à la suite de MODULES des tables V1). */
    modulesSupplement: Object.freeze(supps.flatMap((x) => x.modules)),
    nombre: lecons.size,
    corrections: AUCUNE_CORRECTION,
    /** @param {number|string} n */
    lecon: (n) => lecons.get(String(n)) ?? null,
    lecons: () => [...lecons.values()],
  });
}

/**
 * Applique la surcouche de corrections { corrections: [...] } à un catalogue vérifié. Rend un nouveau catalogue dont les
 * éléments visés sont corrigés (« adapté », liste `corrections`), y compris exemples imbriqués, questions de lecture et
 * d'écoute, lignes d'écoute, nuances et productions (qui se répercutent dans `champs`). Échoue sur une correction
 * orpheline ou dont le texte « avant » ne correspond pas ; ne corrige rien en partie.
 */
export function appliquerCorrections(c, surcouche) {
  const table = tableCorrections(surcouche);
  if (!table.size) return c;
  const connus = new Set(), marques = new Map();
  const fixe = (el) => { if (!table.has(el.loc)) return el; const k = corrigerElement(el, table); marques.set(el.loc, k.corrections); return k; };
  const synth = (loc, el) => { const k = fixe({ ...el, loc }); return k; };
  const lecons = c.lecons().map((l) => {
    for (const e of elementsDeLecon(l)) connus.add(e.loc);
    const grammaire = l.grammaire.map((g) => {
      const exemples = g.exemples.map(fixe);
      return fixe(exemples.some((e, i) => e !== g.exemples[i]) ? { ...g, exemples } : g);
    });
    let champs = l.champs;
    if (typeof champs?.nuance === 'string' && champs.nuance) { const k = synth(`${l.loc}#nuance`, { texte: champs.nuance }); if (k.texte !== champs.nuance) champs = { ...champs, nuance: k.texte }; }
    if (Array.isArray(champs?.prod)) {
      const prod = champs.prod.map((p, i) => { const k = synth(`${l.loc}#prod${i}`, { consigne: p[0], modele: p[1] }); return k.consigne === p[0] && k.modele === p[1] ? p : [k.consigne, k.modele, ...p.slice(2)]; });
      if (prod.some((p, i) => p !== champs.prod[i])) champs = { ...champs, prod };
    }
    return Object.freeze({ ...l, champs, grammaire, vocabulaire: l.vocabulaire.map(fixe), kanji: l.kanji.map(fixe), quiz: l.quiz.map(fixe), lecture: l.lecture ? fixe(l.lecture) : null, ecoute: l.ecoute ? fixe(l.ecoute) : null });
  });
  const orphelines = correctionsOrphelines(table, connus);
  if (orphelines.length) throw new Error(`corrections : localisateur(s) inconnu(s) du catalogue : ${orphelines.join(', ')}`);
  const parNumero = new Map(lecons.map((l) => [String(l.numero), l]));
  return Object.freeze({
    niveaux: c.niveaux, modulesSupplement: c.modulesSupplement, nombre: parNumero.size,
    corrections: Object.freeze({ de: (loc) => marques.get(loc) ?? null, taille: marques.size, ids: () => [...new Set([...marques.values()].flat())].sort() }),
    lecon: (n) => parNumero.get(String(n)) ?? null,
    lecons: () => [...parNumero.values()],
  });
}

/** Tous les identifiants et localisateurs portés par le catalogue (contrôle des identifiants bloqués). */
export function identifiantsDuCatalogue(c) {
  const out = [];
  for (const l of c.lecons()) { out.push(l.loc); for (const e of elementsDeLecon(l)) { out.push(e.loc); if (e.el.id) out.push(e.el.id); } for (const o of l.ordonner) out.push(o.loc); }
  return out;
}

/** Éléments contrôlables d'une leçon, à plat, avec leur localisateur (dénominateur des contrôles AC). */
export function elementsDeLecon(l) {
  const out = [];
  for (const g of l.grammaire) { out.push({ famille: 'grammaire', loc: g.loc, el: g }); for (const e of g.exemples) out.push({ famille: 'exemple', loc: e.loc, el: e }); }
  if (typeof l.champs?.nuance === 'string' && l.champs.nuance) out.push({ famille: 'nuance', loc: `${l.loc}#nuance`, el: { texte: l.champs.nuance } });
  (Array.isArray(l.champs?.prod) ? l.champs.prod : []).forEach((p, i) => out.push({ famille: 'production', loc: `${l.loc}#prod${i}`, el: { consigne: p[0], modele: p[1] } }));
  for (const v of l.vocabulaire) out.push({ famille: 'vocabulaire', loc: v.loc, el: v });
  for (const k of l.kanji) out.push({ famille: 'kanji', loc: k.loc, el: k });
  for (const q of l.quiz) out.push({ famille: 'quiz', loc: q.loc, el: q });
  if (l.lecture) out.push({ famille: 'lecture', loc: l.lecture.loc, el: l.lecture });
  if (l.ecoute) out.push({ famille: 'ecoute', loc: l.ecoute.loc, el: l.ecoute });
  return out;
}

/**
 * Applique la surcouche de contrôle (ajout seul). Rend une table loc → validation. Un élément absent de toute
 * surcouche vaut « extrait sans contrôle de contenu ». La valeur « validé par un humain » n'existe pas (M2-03).
 * Valeur : `controle-automatique` si la seule passe est AC-0 (outil, sans relecture) ; sinon `autocontrole-ia`.
 * @param {{ lot: string, date: string, elements: Record<string, { resultat: 'conforme'|'incertain'|'erreur', passes: string[], note?: string }> }[]} surcouches
 */
export function tableValidation(surcouches) {
  const t = new Map();
  for (const s of surcouches) for (const [loc, v] of Object.entries(s.elements)) {
    if (!['conforme', 'incertain', 'erreur'].includes(v.resultat)) throw new Error(`surcouche ${s.lot} : résultat inconnu pour ${loc}`);
    if (!Array.isArray(v.passes) || !v.passes.length || !v.passes.every((p) => /^AC-(0|1|2|3|4|4N1)$/.test(p))) throw new Error(`surcouche ${s.lot} : passes invalides pour ${loc}`);
    if (t.has(loc)) throw new Error(`surcouche ${s.lot} : ${loc} déjà contrôlé par ${t.get(loc).lot}`);
    t.set(loc, Object.freeze({ valeur: v.passes.length === 1 && v.passes[0] === 'AC-0' ? 'controle-automatique' : 'autocontrole-ia', lot: s.lot, date: s.date, resultat: v.resultat, passes: Object.freeze([...v.passes]), note: v.note ?? null, apresCorrection: Object.freeze([...(v.apresCorrection ?? [])]) }));
  }
  return { de: (loc) => t.get(loc) ?? SANS_CONTROLE, taille: t.size };
}

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/u;
const HIRA = /^[ぁ-ゟー]+$/u;

/**
 * Découpe un texte V1 à furigana « 漢字{かんじ} » en segments { base, lecture? }. La base d'une lecture est la suite
 * de kanji qui précède immédiatement l'accolade. Échoue sur une forme mal construite (QC-02).
 * @param {string} s
 * @returns {{ base: string, lecture?: string }[]}
 */
export function segmenterFurigana(s) {
  const out = []; let txt = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '}') throw new Error(`furigana : accolade fermante isolée dans « ${s} »`);
    if (c !== '{') { txt += c; continue; }
    const j = s.indexOf('}', i);
    if (j < 0) throw new Error(`furigana : accolade non fermée dans « ${s} »`);
    const lecture = s.slice(i + 1, j);
    if (lecture.includes('{')) throw new Error(`furigana : accolades imbriquées dans « ${s} »`);
    let k = txt.length; while (k > 0 && KANJI.test(txt[k - 1])) k--;
    const base = txt.slice(k);
    if (!base) throw new Error(`furigana : lecture « ${lecture} » sans kanji avant elle dans « ${s} »`);
    if (!HIRA.test(lecture)) throw new Error(`furigana : lecture « ${lecture} » hors hiragana dans « ${s} »`);
    if (k > 0) out.push({ base: txt.slice(0, k) });
    out.push({ base, lecture }); txt = ''; i = j;
  }
  if (txt) out.push({ base: txt });
  return out;
}

/** Texte sans furigana (lecture d'écran, comparaison). */
export const sansFurigana = (s) => s.replace(/\{[^}]*\}/g, '');
