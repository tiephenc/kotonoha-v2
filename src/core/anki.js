// KOTONOHA 2.0 · corpus Anki personnel (DC-7 ; 08 §6.3, §19.4, §19.5). Domaine pur : aucun accès au DOM, au stockage ni au réseau.
//
// Règles appliquées (décisions de réalisation, documentées dans docs/developpement/IMPORT-ANKI.md) :
// - Rien n'est modifié ni fusionné : chaque import crée une VERSION en lecture seule (identité : empreinte SHA-256 de la base de
//   la collection). Une version déjà importée n'a aucun effet. `nid`, GUID, `cards.id`, `did`, `mid`, identifiants de révision,
//   champs, étiquettes et valeurs de planification sont gardés BRUTS ; aucun identifiant n'est créé dans l'espace Anki.
// - Lignée (§19.4) : une version nouvelle est proposée comme « nouvelle version » d'un paquet déjà importé si plus de la moitié de
//   ses GUID y figurent ; l'apprenant le confirme à l'écran de confirmation. Sinon, nouvelle lignée.
// - Identité d'une carte (§19.4) : (1) même `cards.id` avec même GUID et même rang, quelle que soit la lignée (même carte de la même
//   collection) ; (2) sinon (GUID, rang, modèle) dans la lignée déclarée ; (3) sinon clé propre, « à rapprocher » en cas de collision.
//   Clé d'état : (lignée, identité de carte). Annuler un import = masquer sa version (réversible) ; rien n'est supprimé.
// - État : planification Anki d'origine (historique `revlog` rejoué dans FSRS-4.5, échéance Anki gardée telle quelle), puis
//   réponses KOTONOHA postérieures à la dernière révision Anki. Une carte suspendue dans Anki reste suspendue.
// - Correspondance avec les leçons : écriture ET lecture identiques (vocabulaire), kanji identique (kanji) ; une écriture seule est
//   « ambiguë » et n'est pas rattachée. Rien n'est jamais rapproché sur le seul sens ou la seule traduction.
import { initial, review, interval } from './fsrs.js';

/** Intervalle à partir duquel Anki dit une carte « mûre » (ici : « maîtrisée »), en jours. */
export const MATURE_JOURS = 21;
/** Nouvelles cartes proposées par jour, au plus (réglage par défaut d'Anki : 20 ; ici plus prudent). [Hyp] */
export const NOUVELLES_PAR_JOUR = 10;
/** Recouvrement de GUID au-delà duquel une version est proposée comme nouvelle version d'un paquet connu (§19.4, [Hyp] 50 %). */
export const SEUIL_LIGNEE = 0.5;

const KANJI = /[㐀-䶿一-鿿豈-﫿々]/u;
/** Jour civil local (même définition que core/revision.js). */
export const jourLocal = (t) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 864e5);

/** Sujet des réponses KOTONOHA à une carte Anki : `anki:<lignée sans préfixe>:<clé de carte>` (ops.js : espace `anki:`). */
export const sujetCarte = (lignee, cle) => `anki:${String(lignee).replace(/^ku:lin:/, '')}:${cle}`;

// ——— Contrôle des données lues ———

/**
 * Vérifie la forme des données lues dans la base (Worker). Refuse ce qui n'est pas exploitable ; rapporte le reste sans rien corriger.
 * @param {any} d @returns {{ok: boolean, erreurs: string[], signalements: Record<string, number>}}
 */
export function controlerDonnees(d) {
  const erreurs = [];
  const ent = (x) => Number.isSafeInteger(x);
  if (!d || !Array.isArray(d.notes) || !Array.isArray(d.cartes) || !Array.isArray(d.revisions)) return { ok: false, erreurs: ['contenu de collection absent'], signalements: {} };
  if (!d.notes.length) erreurs.push('aucune note dans la collection');
  if (d.notes.some((n) => !ent(n.id) || typeof n.guid !== 'string' || !n.guid || !Array.isArray(n.champs))) erreurs.push('note sans identifiant, sans GUID ou sans champs');
  if (d.cartes.some((c) => !ent(c.id) || !ent(c.nid))) erreurs.push('carte sans identifiant ou sans note');
  const nids = new Set(d.notes.map((n) => n.id)), cids = new Set(d.cartes.map((c) => c.id));
  if (nids.size !== d.notes.length) erreurs.push('identifiant de note en double');
  if (cids.size !== d.cartes.length) erreurs.push('identifiant de carte en double');
  const guids = new Map(); for (const n of d.notes) guids.set(n.guid, (guids.get(n.guid) || 0) + 1);
  const avecCarte = new Set(d.cartes.map((c) => c.nid));
  const signalements = {
    cartesOrphelines: d.cartes.filter((c) => !nids.has(c.nid)).length,
    notesSansCarte: d.notes.filter((n) => !avecCarte.has(n.id)).length,
    guidEnDouble: [...guids.values()].filter((v) => v > 1).length,
    revisionsSansCarte: d.revisions.filter((r) => !cids.has(r.cid)).length,
  };
  return { ok: !erreurs.length, erreurs, signalements };
}

// ——— État d'une carte ———

/** Révisions qui comptent pour la mémoire : apprentissage, révision, réapprentissage, paquet filtré ; jamais un report manuel (type 4) ni une note 0. */
const compte = (r) => [0, 1, 2, 3].includes(r.type ?? 1) && r.ease >= 1 && r.ease <= 4;

/** Difficulté FSRS approchée à partir du facteur de facilité Anki (1300 à 3500 ‰), quand l'historique manque. [Hyp] documentée. */
export const difficulteDepuisFacteur = (f) => (Number.isFinite(f) && f > 0 ? Math.min(10, Math.max(1, 10 - ((f - 1300) / 2200) * 9)) : 5);

/**
 * État d'une carte Anki, dérivé sans rien modifier : historique Anki rejoué dans FSRS-4.5, échéance Anki, puis réponses KOTONOHA.
 * @param {{carte: any, revisions?: any[], reponses?: {t: number, ok: boolean}[], crt?: number|null}} a
 *   `revisions` : révisions d'origine de CETTE carte (toutes versions de la lignée, sans doublon) ; `reponses` : réponses KOTONOHA, ordonnées.
 */
export function etatCarte({ carte, revisions = [], reponses = [], crt = null }) {
  const revs = revisions.filter(compte).sort((a, b) => a.id - b.id);
  let st = null, dernierJour = null, approx = false;
  for (const r of revs) {
    const j = jourLocal(r.id);
    st = st ? review(st, r.ease, j - dernierJour) : initial(r.ease);
    dernierJour = j;
  }
  if (dernierJour === null) { try { const lrt = JSON.parse(carte.data || '{}').lrt; if (Number.isFinite(lrt) && lrt > 0) dernierJour = jourLocal(lrt * 1000); } catch { /* données de carte illisibles : sans date de dernière révision */ } }
  const finAnki = Math.max(revs.length ? revs[revs.length - 1].id : 0, Number.isFinite(carte.mod) ? carte.mod * 1000 : 0);
  // Échéance donnée par Anki (file 2 et 3 : jour depuis la création de la collection ; file 1 : instant en secondes).
  let due = null;
  if ((carte.queue === 2 || carte.queue === 3) && Number.isFinite(crt) && Number.isFinite(carte.due)) due = jourLocal((crt + carte.due * 86400) * 1000);
  else if (carte.queue === 1 && Number.isFinite(carte.due)) due = jourLocal(carte.due * 1000);
  else if ((carte.type === 2 || carte.type === 3) && dernierJour !== null && carte.ivl > 0) due = dernierJour + carte.ivl;
  if (!st && carte.type === 2 && carte.ivl > 0) { st = { s: carte.ivl, d: difficulteDepuisFacteur(carte.factor) }; approx = true; }
  let statut = carte.type === 0 ? 'nouvelle' : carte.type === 2 ? 'revision' : 'apprentissage';
  let ivl = carte.type === 2 ? carte.ivl : 0, dernier = finAnki || null;
  const apres = reponses.filter((x) => x.t > finAnki);
  for (const x of apres) {
    const j = jourLocal(x.t), g = x.ok ? 3 : 1;
    st = st ? review(st, g, dernierJour === null ? 0 : Math.max(0, j - dernierJour)) : initial(g);
    dernierJour = j; dernier = x.t;
    ivl = x.ok ? interval(st.s) : 0;
    due = j + (x.ok ? ivl : 1);
    statut = x.ok ? 'revision' : 'apprentissage';
  }
  if (carte.queue === -1) statut = 'suspendue';
  return {
    statut, due, ivl, s: st?.s ?? null, d: st?.d ?? null, approx,
    maitrisee: statut !== 'suspendue' && ivl >= MATURE_JOURS,
    repsAnki: carte.reps ?? 0, lapsesAnki: carte.lapses ?? 0, revisionsAnki: revs.length, reponsesKotonoha: reponses.length, reponsesApresAnki: apres.length,
    dernier, source: apres.length ? (revs.length || carte.type !== 0 ? 'anki+kotonoha' : 'kotonoha') : 'anki',
  };
}

// ——— Identité des cartes et lignées ———

/**
 * Identité des cartes d'une version nouvelle (§19.4). `connues` : cartes déjà importées, toutes versions non masquées,
 * `{cle, lignee, id, guid, ord, mid}`. Règles, dans l'ordre :
 * (1) même `cards.id`, même GUID, même rang : même carte, quelle que soit sa lignée (c'est la même carte de la même collection
 *     Anki, exportée dans un autre fichier : paquet seul, puis collection complète). Elle garde sa lignée et sa clé ;
 * (2) sinon, dans la lignée choisie (« nouvelle version de… »), même (GUID, rang, modèle) : même carte ;
 * (3) sinon, carte nouvelle de la lignée choisie, clé = son identifiant ; si cet identifiant y est déjà pris par une autre carte :
 *     « à rapprocher », clé distincte, jamais rattachée d'office.
 * @param {{notes: any[], cartes: any[]}} d @param {any[]} connues @param {string} version empreinte @param {string} lignee lignée choisie
 * @returns {{carte: Map<number, {cle: string, lignee: string}>, aRapprocher: any[], parIdentifiant: number, parGuidRang: number, nouvelles: number}}
 */
export function identifierCartes(d, connues, version, lignee) {
  const note = new Map(d.notes.map((n) => [n.id, n]));
  const parId = new Map(), parGuid = new Map(), cles = new Set();
  for (const c of connues) {
    if (!parId.has(c.id)) parId.set(c.id, c);
    if (c.lignee === lignee) { const k = `${c.guid}|${c.ord}|${c.mid}`; if (!parGuid.has(k)) parGuid.set(k, c); cles.add(String(c.cle)); }
  }
  const carte = new Map(), aRapprocher = [];
  let parIdentifiant = 0, parGuidRang = 0, nouvelles = 0;
  for (const c of d.cartes) {
    const n = note.get(c.nid);
    const a = parId.get(c.id);
    if (a && n && a.guid === n.guid && a.ord === c.ord) { carte.set(c.id, { cle: a.cle, lignee: a.lignee }); parIdentifiant++; continue; }
    const b = n ? parGuid.get(`${n.guid}|${c.ord}|${n.mid}`) : null;
    if (b) { carte.set(c.id, { cle: b.cle, lignee: b.lignee }); parGuidRang++; continue; }
    if (cles.has(String(c.id))) { const k = `${c.id}~${version.slice(0, 12)}`; carte.set(c.id, { cle: k, lignee }); cles.add(k); aRapprocher.push({ id: c.id, nid: c.nid, guid: n?.guid ?? null }); continue; }
    carte.set(c.id, { cle: String(c.id), lignee }); cles.add(String(c.id)); nouvelles++;
  }
  return { carte, aRapprocher, parIdentifiant, parGuidRang, nouvelles };
}

/**
 * Lignée proposée : celle dont les GUID recouvrent le plus la version, au-delà du seuil. `lignees` : `{id, nom, guids: Set}`.
 * @param {string[]} guids @param {{id: string, nom: string, guids: Set<string>}[]} lignees
 */
export function proposerLignee(guids, lignees) {
  let mieux = null;
  const total = new Set(guids).size || 1;
  for (const l of lignees) {
    let communs = 0; for (const g of new Set(guids)) if (l.guids.has(g)) communs++;
    const ratio = communs / total;
    if (communs && (!mieux || ratio > mieux.ratio)) mieux = { id: l.id, nom: l.nom, communs, ratio };
  }
  return mieux && mieux.ratio > SEUIL_LIGNEE ? mieux : mieux ? { ...mieux, sousLeSeuil: true } : null;
}

// ——— Correspondance avec les leçons KOTONOHA ———

/** Texte brut d'un champ Anki pour la comparaison : balises, médias, entités usuelles et espaces retirés. */
export function texteBrut(s) {
  return String(s ?? '').replace(/\[sound:[^\]]*\]/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/**
 * Index des contenus des leçons : vocabulaire (écriture, lecture) et kanji. `lecons` : leçons du catalogue servi (`numero`,
 * `vocabulaire[].mot/lecture`, `kanji[].caractere`) ou du corpus brut (`unite`, `valeur`).
 * @param {any[]} lecons
 */
export function indexLecons(lecons) {
  const vocab = new Map(), kanji = new Map();
  for (const l of lecons) {
    const unite = Number(l.numero ?? l.unite ?? l.syl?.id);
    for (const v of l.vocabulaire || []) {
      const [mot, lecture] = v.valeur || [v.mot, v.lecture];
      if (!mot) continue;
      const e = { loc: v.loc, unite, mot: String(mot), lecture: String(lecture ?? '') };
      (vocab.get(e.mot) || vocab.set(e.mot, []).get(e.mot)).push(e);
    }
    for (const k of l.kanji || []) {
      const c = String((k.valeur || [])[0] ?? k.caractere ?? '');
      if (c.length !== 1 && [...c].length !== 1) continue;
      (kanji.get(c) || kanji.set(c, []).get(c)).push({ loc: k.loc, unite, kanji: c });
    }
  }
  return { vocab, kanji };
}

/**
 * Rapprochement d'une note : vocabulaire si un champ vaut l'écriture ET un champ vaut la lecture (fiable) ; écriture seule : ambiguë,
 * non rattachée. Kanji : un champ fait d'un seul kanji, suivi au plus d'une lecture entre parenthèses (fiable).
 * @param {{champs: string[]}} note @param {ReturnType<typeof indexLecons>} idx
 * @returns {{liens: {type: 'vocabulaire'|'kanji', loc: string, unite: number}[], ambigu: boolean}}
 */
export function rapprocher(note, idx) {
  const textes = note.champs.map(texteBrut).filter(Boolean);
  const ens = new Set(textes);
  const liens = [], vus = new Set(); let ambigu = false;
  for (const t of ens) {
    const cand = idx.vocab.get(t);
    if (!cand) continue;
    const surs = cand.filter((e) => e.lecture === e.mot ? true : ens.has(e.lecture));
    if (surs.length) { for (const e of surs) if (!vus.has(e.loc)) { vus.add(e.loc); liens.push({ type: 'vocabulaire', loc: e.loc, unite: e.unite }); } }
    else ambigu = true;
  }
  for (const t of textes) {
    const m = /^(\S)(?:\s*[（(][^)）]*[)）])?$/u.exec(t);
    if (!m || !KANJI.test(m[1])) continue;
    for (const e of idx.kanji.get(m[1]) || []) if (!vus.has(e.loc)) { vus.add(e.loc); liens.push({ type: 'kanji', loc: e.loc, unite: e.unite }); }
  }
  return { liens, ambigu: ambigu && !liens.length };
}

// ——— Analyse avant import ———

/**
 * Résumé de ce que l'import ferait, sans rien écrire.
 * @param {{donnees: any, meta: {empreinteBase: string, entreesMedias?: number, entree?: string}, existant: {versions: any[], lignees: {id: string, nom: string, guids: Set<string>}[], connues?: any[], reponses?: Map<string, number>},
 *   index?: ReturnType<typeof indexLecons>|null, maintenant: number}} a
 */
export function analyserImport({ donnees, meta, existant, index = null, maintenant }) {
  const ctrl = controlerDonnees(donnees);
  const dejaImporte = existant.versions.find((v) => v.id === meta.empreinteBase) || null;
  const d = donnees;
  const guids = d.notes.map((n) => n.guid);
  const lignee = proposerLignee(guids, existant.lignees);
  const choisie = lignee && !lignee.sousLeSeuil ? lignee.id : '(nouvelle)';
  const ident = identifierCartes(d, existant.connues || [], meta.empreinteBase, choisie);
  let reponsesExistantes = 0;
  if (existant.reponses) for (const x of ident.carte.values()) reponsesExistantes += existant.reponses.get(sujetCarte(x.lignee, x.cle)) || 0;
  const jour = jourLocal(maintenant);
  const revsPar = new Map(); for (const r of d.revisions) (revsPar.get(r.cid) || revsPar.set(r.cid, []).get(r.cid)).push(r);
  const etats = { nouvelles: 0, apprentissage: 0, revision: 0, maitrisees: 0, suspendues: 0, enfouies: 0, duesAujourdhui: 0, aVenir: 0 };
  for (const c of d.cartes) {
    const e = etatCarte({ carte: c, revisions: revsPar.get(c.id) || [], crt: d.crt });
    if (e.statut === 'nouvelle') etats.nouvelles++; else if (e.statut === 'suspendue') etats.suspendues++; else if (e.statut === 'revision') etats.revision++; else etats.apprentissage++;
    if (e.maitrisee) etats.maitrisees++;
    if (c.queue === -2 || c.queue === -3) etats.enfouies++;
    if (e.statut !== 'nouvelle' && e.statut !== 'suspendue' && e.due !== null) { if (e.due <= jour) etats.duesAujourdhui++; else etats.aVenir++; }
  }
  let liees = 0, ambigues = 0, sans = 0; const parType = { vocabulaire: 0, kanji: 0 };
  if (index) for (const n of d.notes) { const r = rapprocher(n, index); if (r.liens.length) { liees++; for (const t of new Set(r.liens.map((x) => x.type))) parType[t]++; } else if (r.ambigu) ambigues++; else sans++; }
  const ids = d.revisions.map((r) => r.id);
  return {
    ok: ctrl.ok, erreurs: ctrl.erreurs, signalements: ctrl.signalements,
    dejaImporte: !!dejaImporte, versionExistante: dejaImporte,
    notes: d.notes.length, cartes: d.cartes.length, revisions: d.revisions.length,
    periode: ids.length ? { debut: ids.reduce((a, b) => Math.min(a, b)), fin: ids.reduce((a, b) => Math.max(a, b)) } : null,
    modeles: d.modeles.map((m) => m.nom), paquets: d.paquets.filter((p) => d.cartes.some((c) => c.did === p.id)).map((p) => p.nom),
    etats, lignee, identite: { parIdentifiant: ident.parIdentifiant, parGuidRang: ident.parGuidRang, nouvelles: ident.nouvelles, aRapprocher: ident.aRapprocher.length },
    dejaConnues: ident.parIdentifiant + ident.parGuidRang, reponsesKotonohaExistantes: reponsesExistantes,
    correspondances: index ? { liees, ambigues, sans, parType } : null,
    medias: meta.entreesMedias ?? 0, schema: d.schema, entree: meta.entree ?? null,
    planificationPresente: d.revisions.length > 0 || d.cartes.some((c) => c.type !== 0),
  };
}

// ——— Corpus de travail (toutes versions) et séance ———

/**
 * Assemble le corpus à partir des enregistrements stockés. Les versions masquées (import annulé) sont ignorées en entier. Pour chaque
 * carte (clé d'état = lignée + clé), l'enregistrement retenu est celui de la version où la carte a été modifiée en dernier dans Anki
 * (`cards.mod`), puis la plus récemment importée : réimporter un export plus ancien ne fait jamais reculer l'état. Les révisions
 * d'origine de toutes les versions sont réunies (dédoublonnées par identifiant) ; les réponses KOTONOHA sont lues dans le journal.
 * @param {{versions: any[], lignees: any[], notes: any[], cartes: any[], revisions: any[], masques?: Set<string>}} s
 * @param {{sorted: any[], neutralized?: string[]}|null} derived vue dérivée du journal
 */
export function assemblerCorpus(s, derived) {
  const masques = s.masques || new Set();
  const versions = s.versions.filter((v) => !masques.has(v.id)).sort((a, b) => a.importeLe - b.importeLe || (a.id < b.id ? -1 : 1));
  const rang = new Map(versions.map((v, i) => [v.id, i]));
  const verInfo = new Map(versions.map((v) => [v.id, v]));
  const notes = new Map(); for (const n of s.notes) if (rang.has(n.version)) notes.set(`${n.version}|${n.id}`, n);
  const off = new Set(derived?.neutralized || []), reponses = new Map();
  for (const o of derived?.sorted || []) if (o.type === 'answer' && !off.has(o.op) && o.subject.startsWith('anki:')) (reponses.get(o.subject) || reponses.set(o.subject, []).get(o.subject)).push({ t: o.t, ok: o.payload.ok === true });
  const cartes = new Map(), sujetDe = new Map(); // clé d'état → carte retenue ; (version|cid) → clé d'état
  for (const c of s.cartes) {
    if (!rang.has(c.version)) continue;
    const k = sujetCarte(c.lignee, c.cle);
    sujetDe.set(`${c.version}|${c.id}`, k);
    const prev = cartes.get(k);
    if (!prev || (c.mod ?? 0) > (prev.carte.mod ?? 0) || ((c.mod ?? 0) === (prev.carte.mod ?? 0) && rang.get(c.version) > rang.get(prev.carte.version))) cartes.set(k, { sujet: k, lignee: c.lignee, carte: c, version: verInfo.get(c.version) });
  }
  const revs = new Map();
  for (const r of s.revisions) { const k = sujetDe.get(`${r.version}|${r.cid}`); if (!k) continue; const m = revs.get(k) || revs.set(k, new Map()).get(k); if (!m.has(r.id)) m.set(r.id, r); }
  const items = [];
  for (const [k, x] of cartes) {
    const note = notes.get(`${x.carte.version}|${x.carte.nid}`) || null;
    const etat = etatCarte({ carte: x.carte, revisions: [...(revs.get(k)?.values() || [])], reponses: reponses.get(k) || [], crt: x.version.crt });
    const paquet = (x.version.paquets || []).find((p) => p.id === x.carte.did)?.nom ?? 'Sans paquet';
    items.push({ ...x, note, paquet, modele: (x.version.modeles || []).find((m) => m.id === note?.mid) || null, etat });
  }
  items.sort((a, b) => (a.sujet < b.sujet ? -1 : 1));
  const lignees = s.lignees.map((l) => ({ ...l, versions: s.versions.filter((v) => v.lignee === l.id).map((v) => ({ ...v, masque: masques.has(v.id) })) }));
  return { lignees, items, reponses, versions: s.versions.map((v) => ({ ...v, masque: masques.has(v.id) })) };
}

/**
 * Séance du jour : cartes dues (échéance passée ou du jour), puis au plus `nouvelles` cartes jamais étudiées, dans l'ordre d'Anki.
 * Les imports annulés (versions masquées) et les cartes suspendues ne sont jamais servis. L'arriéré n'est pas imposé : la séance s'arrête quand on veut.
 * @param {any[]} items @param {number} maintenant @param {{nouvelles?: number, paquet?: string|null}} [o]
 */
export function preparerSeanceAnki(items, maintenant, { nouvelles = NOUVELLES_PAR_JOUR, paquet = null } = {}) {
  const jour = jourLocal(maintenant);
  const actifs = items.filter((i) => (!paquet || i.paquet === paquet) && i.note);
  const dues = actifs.filter((i) => (i.etat.statut === 'revision' || i.etat.statut === 'apprentissage') && i.etat.due !== null && i.etat.due <= jour)
    .sort((a, b) => a.etat.due - b.etat.due || (a.sujet < b.sujet ? -1 : 1));
  // Nouvelles déjà commencées aujourd'hui (première réponse KOTONOHA du jour sur une carte nouvelle dans Anki) : comptées dans la limite.
  const commencees = actifs.filter((i) => i.carte.type === 0 && i.etat.reponsesKotonoha > 0 && i.etat.dernier && jourLocal(i.etat.dernier) === jour).length;
  const reste = Math.max(0, nouvelles - commencees);
  const neuves = actifs.filter((i) => i.etat.statut === 'nouvelle').sort((a, b) => (a.carte.due ?? 0) - (b.carte.due ?? 0) || a.carte.id - b.carte.id).slice(0, reste);
  return { dues, nouvelles: neuves, total: dues.length + neuves.length, jour };
}

/** Statistiques d'une liste d'items (une lignée ou tout le corpus). @param {any[]} items @param {number} maintenant */
export function statistiques(items, maintenant) {
  const jour = jourLocal(maintenant), s = { cartes: 0, nouvelles: 0, apprentissage: 0, revision: 0, maitrisees: 0, suspendues: 0, dues: 0, revisionsAnki: 0, reponsesKotonoha: 0 };
  for (const i of items) {
    s.cartes++; s[i.etat.statut === 'nouvelle' ? 'nouvelles' : i.etat.statut === 'suspendue' ? 'suspendues' : i.etat.statut === 'revision' ? 'revision' : 'apprentissage']++;
    if (i.etat.maitrisee) s.maitrisees++;
    if ((i.etat.statut === 'revision' || i.etat.statut === 'apprentissage') && i.etat.due !== null && i.etat.due <= jour) s.dues++;
    s.revisionsAnki += i.etat.revisionsAnki; s.reponsesKotonoha += i.etat.reponsesKotonoha;
  }
  return s;
}

// ——— Faces d'une carte (gabarits Anki lus, jamais exécutés) ———

const FILTRES = new Set(['furigana', 'kana', 'kanji', 'text', 'hint', 'type', 'cloze', 'tts']);
/** Références de champs d'un gabarit, dans l'ordre : `{{Champ}}`, `{{filtre:Champ}}` ; sections conditionnelles ignorées. */
export function referencesGabarit(g) {
  const out = [];
  for (const m of String(g ?? '').matchAll(/\{\{([^{}]+)\}\}/g)) {
    const x = m[1].trim();
    if (/^[#^/!]/.test(x)) continue;
    if (x === 'FrontSide') { out.push({ champ: 'FrontSide', filtre: null }); continue; }
    const p = x.split(':');
    const champ = p.pop().trim(), filtres = p.map((f) => f.trim()).filter((f) => FILTRES.has(f) || /^tts/.test(f));
    if (!champ) continue;
    out.push({ champ, filtre: filtres.find((f) => f !== 'text') ?? null });
  }
  return out;
}

/**
 * Faces d'une carte : champs du recto et du verso, selon le gabarit du rang de la carte. Sans gabarit lisible : premier champ au recto,
 * autres champs non vides au verso. Les champs restent bruts (HTML Anki) : l'interface les assainit à l'affichage.
 * @param {{champs: string[]}} note @param {{champs: string[], gabarits: any[]}|null} modele @param {number} ord
 */
export function facesCarte(note, modele, ord = 0) {
  const noms = modele?.champs || [];
  const val = (nom) => { const i = noms.indexOf(nom); return i >= 0 ? note.champs[i] ?? '' : null; };
  const g = (modele?.gabarits || []).find((t) => t.ord === ord) || (modele?.gabarits || [])[0];
  const garder = (refs) => refs.filter((r) => r.champ !== 'FrontSide' && r.filtre !== 'type' && !/^tts/.test(r.filtre || '')).map((r) => ({ nom: r.champ, filtre: r.filtre, valeur: val(r.champ) })).filter((r) => r.valeur !== null && texteBrut(r.valeur.replace(/<img[^>]*>/gi, '')) !== '');
  if (g && noms.length) {
    const recto = garder(referencesGabarit(g.recto));
    const dejaRecto = new Set(recto.map((r) => r.nom));
    const verso = garder(referencesGabarit(g.verso)).filter((r) => !dejaRecto.has(r.nom) || r.filtre === 'cloze');
    if (recto.length) return { recto, verso, cloze: recto.some((r) => r.filtre === 'cloze') ? ord + 1 : null, gabarit: g.nom };
  }
  const champs = note.champs.map((v, i) => ({ nom: noms[i] ?? `Champ ${i + 1}`, filtre: null, valeur: v })).filter((r) => texteBrut(r.valeur) !== '');
  return { recto: champs.slice(0, 1), verso: champs.slice(1), cloze: null, gabarit: null };
}
