// KOTONOHA 2.0 · MOD-03 core/derive — dérivation des états à partir du journal, coupures,
// instantanés (08 §7.5, §7.6, §8.1, §8.3, §19.1, §19.2 ; INV-06, INV-08). Domaine pur, déterministe :
// deux appareils qui détiennent les mêmes opérations obtiennent la même vue et la même empreinte.
import { categoryOf, cmpOps, SCHEMA } from './ops.js';
import { canonical, clone, hashOf, hashRounded } from './canon.js';
import { newId } from './ids.js';

/** Version des règles de dérivation (08 §11) : tout changement impose un recalcul complet.
 * 2 : annulation locale d'un effacement en préparation (`erase.cancel`, 08 §19.16, R5).
 * 3 : deux `erase` de même sujet s'ajoutent (union des objets, ANO-016) au lieu de se remplacer ; `eras[].devs`. */
export const RULES = 3;

/** Accumulateur vide. Les états d'apprentissage (`learn`) sont provisoires : FSRS relève de PH-3.
 * `eras` : effacements dans l'ordre total, avec leur auteur et leur annulation éventuelle. */
export function emptyAcc() {
  return { n: 0, prefs: {}, plan: {}, learn: {}, sessions: { n: 0, active: 0 }, docs: {}, erase: {}, eras: [], restores: [] };
}

/**
 * Dédoublonne par identifiant et trie dans l'ordre total. Deux contenus différents sous le même
 * identifiant sont une anomalie : on garde, partout, la forme canonique la plus petite (INV-08).
 * @param {any[]} ops
 */
export function prepare(ops) {
  const byId = new Map(), anomalies = [];
  for (const o of ops) {
    const prev = byId.get(o.op);
    if (!prev) { byId.set(o.op, o); continue; }
    const a = canonical(prev), b = canonical(o);
    if (a !== b) { anomalies.push(o.op); if (b < a) byId.set(o.op, o); }
  }
  const sorted = [...byId.values()].sort(cmpOps);
  return { byId, sorted, anomalies: [...new Set(anomalies)].sort() };
}

/**
 * Coupures actives (08 §19.2) : toutes leurs parties sont reçues et aucune annulation ne les vise,
 * même reçue avant elles.
 * @param {any[]} sorted
 */
export function activeCuts(sorted) {
  const cuts = new Map(), uncut = new Set();
  for (const o of sorted) {
    if (o.type === 'uncut') uncut.add(o.subject);
    if (o.type !== 'cut') continue;
    const c = cuts.get(o.subject) || { id: o.subject, kind: o.payload.kind, parts: o.payload.parts, got: new Map(), cats: o.payload.cats, since: o.payload.since, hlc: o.hlc, bad: false };
    // Parties incohérentes (type, nombre, catégories, date) : la coupure n'est jamais active.
    if (o.payload.kind !== c.kind || o.payload.parts !== c.parts || canonical(o.payload.cats ?? null) !== canonical(c.cats ?? null) || o.payload.since !== c.since) c.bad = true;
    if (!c.got.has(o.payload.part)) c.got.set(o.payload.part, o.payload.ops);
    cuts.set(o.subject, c);
  }
  const out = [];
  for (const c of cuts.values()) {
    if (c.bad || uncut.has(c.id) || c.got.size !== c.parts) continue;
    out.push({ id: c.id, kind: c.kind, cats: c.cats, since: c.since, hlc: c.hlc, ops: [...c.got.values()].flat().sort() });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Une coupure s'applique-t-elle à cette opération ? (« recommencer » : DC-2 seulement.) Un effacement
 * (`erase`) et son annulation (`erase.cancel`) ne sont JAMAIS neutralisés : le registre d'effacement
 * ne se lève ni ne se rétablit par effet de bord (08 §19.1, INV-06, INV-09). Seule une annulation
 * explicite de l'auteur, en E2, le lève (§19.16) ; E3 et E4 relèvent de PH-2.
 */
function applies(cut, o) {
  const cat = categoryOf(o.type);
  if (cat === 'SYS' || o.type === 'erase' || o.type === 'erase.cancel' || o.type === 'erase.revoke') return false;
  if (cut.kind === 'restart') return cat === 'DC-2';
  if (cut.kind === 'date') return cut.cats.includes(cat) && o.t >= cut.since;
  return true; // undo-restore : annulation d'une restauration, toutes catégories sauf SYS
}

/** @param {any[]} cuts @returns {Map<string, any[]>} identifiant listé → coupures qui le listent */
function listedIndex(cuts) {
  const m = new Map();
  for (const c of cuts) for (const id of c.ops) { if (!m.has(id)) m.set(id, []); m.get(id).push(c); }
  return m;
}

/** @param {Map<string, any[]>} listed @param {any} o */
const isNeutralized = (listed, o) => (listed.get(o.op) || []).some((c) => applies(c, o));

/** Applique une opération active à l'accumulateur. @param {ReturnType<typeof emptyAcc>} acc @param {any} o */
function fold(acc, o) {
  acc.n++;
  const p = o.payload;
  switch (o.type) {
    case 'answer': {
      const l = acc.learn[o.subject] || (acc.learn[o.subject] = { n: 0, ok: 0, first: o.t, last: o.t });
      l.n++; if (p.ok) l.ok++; l.last = o.t; break;
    }
    case 'session': acc.sessions.n++; acc.sessions.active += p.active; break;
    case 'pref': acc.prefs[o.subject] = { v: p.v, op: o.op }; break;   // FU-04 : registre par clé
    case 'plan': acc.plan[o.subject] = { v: p.v, op: o.op }; break;    // FU-05
    case 'doc.rev': doc(acc, o.subject).revs[p.obj.id] = { parent: p.parent, h: p.obj.h, op: o.op, t: o.t }; break;
    case 'trash': doc(acc, o.subject).trash.push(o.op); break;
    case 'untrash': doc(acc, o.subject).untrash.push(...p.trash); break;
    case 'erase': { // un seul effacement par objet : celui qui le désigne en premier
      // Même sujet déjà vu : UNION (ANO-016). L'ordre total ne doit pas laisser une opération forgée, d'un HLC antérieur,
      // faire disparaître les objets d'une autre : les objets s'ajoutent, quel que soit l'ordre, et les auteurs aussi.
      const same = acc.eras.find((e) => e.id === o.subject);
      if (same) {
        if (same.cancelled) break; // annulé : un ajout tardif ne ressuscite rien
        if (!same.devs.includes(o.dev)) same.devs = [...same.devs, o.dev].sort();
        for (const id of p.objs) if (!same.objs.includes(id)) { same.objs.push(id); if (!acc.erase[id]) acc.erase[id] = o.subject; }
        break;
      }
      acc.eras.push({ id: o.subject, dev: o.dev, devs: [o.dev], objs: [...p.objs], cancelled: false });
      for (const id of p.objs) if (!acc.erase[id]) acc.erase[id] = o.subject;
      break;
    }
    case 'erase.cancel': // E2 → E0 (08 §19.16) : seul l'appareil auteur annule ; sinon sans effet
    case 'erase.revoke': { // E3 → E0 constaté par un autre appareil (après `unerase/`) : tout appareil du compte
      const e = acc.eras.find((x) => x.id === o.subject);
      if (!e || e.cancelled || (o.type === 'erase.cancel' && !e.devs.includes(o.dev))) break;
      e.cancelled = true;
      if (o.type === 'erase.revoke') e.revokedBy = o.dev; // constaté ailleurs : le serveur le confirme avant que les textes ne repartent
      for (const id of e.objs) {
        if (acc.erase[id] !== e.id) continue;
        // Un autre effacement actif qui liste l'objet le reprend (08 §19.16, ligne E0) ; sinon l'objet revient.
        const next = acc.eras.find((x) => !x.cancelled && x.objs.includes(id));
        if (next) acc.erase[id] = next.id; else delete acc.erase[id];
      }
      break;
    }
    case 'restore': acc.restores.push({ bak: o.subject, mode: p.mode, added: p.added }); break;
    default: break;
  }
}
const doc = (acc, id) => acc.docs[id] || (acc.docs[id] = { revs: {}, trash: [], untrash: [] });

/**
 * Vue dérivée, sérialisable et comparable (08 §7.5) : documents avec têtes et conflits (FU-06),
 * corbeille sans règle « dernier gagnant » (§19.1), objets en attente d'effacement masqués (E2).
 * @param {ReturnType<typeof emptyAcc>} acc
 */
export function view(acc) {
  const docs = {};
  for (const [id, d] of Object.entries(acc.docs)) {
    const parents = new Set(Object.values(d.revs).map((r) => r.parent).filter(Boolean));
    const heads = Object.keys(d.revs).filter((r) => !parents.has(r)).sort();
    const untrashed = new Set(d.untrash);
    const trash = d.trash.filter((t) => !untrashed.has(t)).sort();
    const masked = Object.keys(d.revs).filter((r) => acc.erase[r]).sort();
    const orphan = Object.entries(d.revs).filter(([, r]) => r.parent && acc.erase[r.parent] && !acc.erase[r]).map(([k]) => k).sort();
    docs[id] = { revs: Object.keys(d.revs).length, heads: heads.filter((h) => !acc.erase[h]), conflict: heads.filter((h) => !acc.erase[h]).length > 1, trashed: trash.length > 0, trash, masked, orphan };
  }
  return { rules: RULES, s: SCHEMA, n: acc.n, prefs: acc.prefs, plan: acc.plan, learn: acc.learn, sessions: acc.sessions, docs, erase: acc.erase, restores: acc.restores };
}

/**
 * Dérivation complète.
 * @param {any[]} ops
 * @returns {{view: any, acc: any, sorted: any[], neutralized: string[], cuts: any[], anomalies: string[], late: {op: string, cut: string}[]}}
 */
export function derive(ops) {
  const { sorted, anomalies } = prepare(ops);
  const cuts = activeCuts(sorted), listed = listedIndex(cuts);
  const acc = emptyAcc(), neutralized = [], late = [];
  for (const o of sorted) {
    if (categoryOf(o.type) === 'SYS') continue;
    if (isNeutralized(listed, o)) { neutralized.push(o.op); continue; }
    // Opération tardive (08 §8.3) : non listée, du périmètre d'une coupure et antérieure à elle ; elle reste active.
    for (const c of cuts) if (applies(c, o) && cmpHlcOp(o, c) < 0 && c.kind !== 'undo-restore') late.push({ op: o.op, cut: c.id });
    fold(acc, o);
  }
  return { view: view(acc), acc, sorted, neutralized: neutralized.sort(), cuts, anomalies, late };
}
const cmpHlcOp = (o, c) => o.hlc[0] - c.hlc[0] || o.hlc[1] - c.hlc[1];

/** Empreinte de la vue (valeurs arrondies par la forme canonique). @param {any} v */
export const viewHash = (v) => hashRounded(v);

const frontierOf = (o) => [o.hlc[0], o.hlc[1], o.dev, o.op];
const cmpFrontier = (o, f) => cmpOps(o, { hlc: [f[0], f[1]], dev: f[2], op: f[3] });

/**
 * Instantané : cache de l'état dérivé, jamais source de vérité (08 §7.6). Il contient
 * l'accumulateur, les identifiants inclus, les coupures actives et une empreinte.
 * @param {ReturnType<typeof derive>} d @param {number} t
 */
export async function makeSnapshot(d, t) {
  const last = d.sorted[d.sorted.length - 1];
  const body = { rules: RULES, s: SCHEMA, t, frontier: last ? frontierOf(last) : null, ids: d.sorted.map((o) => o.op).sort(), cuts: d.cuts.map((c) => ({ id: c.id, ops: c.ops })), acc: clone(d.acc) };
  return { id: newId('ku', 'snap', t), ...body, hash: await hashOf(body) };
}

/**
 * Dérivation à partir d'un instantané. Retourne null si l'instantané ne peut pas servir : empreinte
 * ou règles différentes, opération incluse absente, opération tardive (antérieure à la frontière),
 * nouvelle coupure ou annulation (08 §7.6, §19.2). L'appelant dérive alors depuis un instantané plus
 * ancien ou depuis le début.
 * @param {any} snap @param {any[]} ops
 */
export async function deriveFrom(snap, ops) {
  const { id, hash, ...body } = snap;
  if (snap.rules !== RULES || snap.s !== SCHEMA || hash !== (await hashOf(body))) return null;
  const { byId, sorted, anomalies } = prepare(ops);
  if (anomalies.length) return null;
  const inSnap = new Set(snap.ids);
  for (const i of inSnap) if (!byId.has(i)) return null;
  const fresh = sorted.filter((o) => !inSnap.has(o.op));
  for (const o of fresh) if (categoryOf(o.type) === 'SYS' || (snap.frontier && cmpFrontier(o, snap.frontier) <= 0)) return null;
  // Les coupures de l'instantané valent pour les opérations listées arrivées depuis.
  const full = activeCuts(sorted.filter((o) => categoryOf(o.type) === 'SYS'));
  if (canonical(full.map((c) => ({ id: c.id, ops: c.ops }))) !== canonical(snap.cuts)) return null;
  const listed = listedIndex(full), acc = clone(snap.acc), neutralized = [];
  for (const o of fresh) { if (isNeutralized(listed, o)) { neutralized.push(o.op); continue; } fold(acc, o); }
  return { view: view(acc), acc, fresh: fresh.length, neutralized };
}

/**
 * Accepte-t-on un instantané reçu (serveur, autre appareil, restauration) ? Refusé s'il a été
 * calculé avec d'autres coupures actives que celles que l'on connaît (08 §19.2).
 * @param {any} snap @param {any[]} knownOps
 */
export function snapshotCompatible(snap, knownOps) {
  const cuts = activeCuts(prepare(knownOps).sorted.filter((o) => categoryOf(o.type) === 'SYS'));
  const listed = new Set(cuts.flatMap((c) => c.ops));
  const snapListed = new Set((snap.cuts || []).flatMap((c) => c.ops));
  for (const i of snap.ids) if (listed.has(i) !== snapListed.has(i)) return false;
  return true;
}
