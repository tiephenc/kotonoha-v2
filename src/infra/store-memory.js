// KOTONOHA 2.0 · magasin en mémoire, même contrat que store-idb.js. Sert aux tests du domaine et de
// l'application sous Node ; il n'est jamais utilisé par l'interface.
import { canonical, clone } from '../core/canon.js';

/** Clé de méta du registre des textes détruits (identifiants seuls, jamais de contenu). */
export const REGISTRE = 'eff:detruits';

/** @param {{fail?: () => Error|null}} [o] `fail` permet aux tests d'injecter un refus d'écriture. */
export function memoryStore(o = {}) {
  const m = { ops: new Map(), objs: new Map(), pending: new Set(), snaps: new Map(), backups: new Map(), meta: new Map(), alias: new Map() };
  let closed = false;
  const guard = () => { if (closed) { const e = new Error('base fermée'); e.code = 'read-only'; throw e; } const f = o.fail?.(); if (f) throw f; };
  return {
    name: 'memoire', version: 1,
    get closed() { return closed; },
    async appendOps(ops, objs = [], { queue = true } = {}) {
      guard();
      const conflict = (map, k, v) => map.has(k) && canonical(map.get(k)) !== canonical(v);
      for (const b of objs) if (conflict(m.objs, b.id, b)) { const e = new Error(`conflit sur ${b.id}`); e.code = 'conflict'; throw e; }
      for (const x of ops) if (conflict(m.ops, x.op, x)) { const e = new Error(`conflit sur ${x.op}`); e.code = 'conflict'; throw e; }
      const added = [];
      const gone = new Set(m.meta.get(REGISTRE)?.ids || []); // registre des destructions (08 §19.16, INV-09) : jamais réintroduit
      for (const b of objs) if (!m.objs.has(b.id) && !gone.has(b.id)) m.objs.set(b.id, clone(b));
      for (const x of ops) if (!m.ops.has(x.op)) { m.ops.set(x.op, clone(x)); if (queue) m.pending.add(x.op); added.push(x.op); }
      return added;
    },
    async addAliases(list) { guard(); for (const a of list) if (m.alias.has(a.k) && canonical(m.alias.get(a.k)) !== canonical(a)) { const e = new Error(`alias déjà enregistré autrement : ${a.k}`); e.code = 'conflict'; throw e; } for (const a of list) if (!m.alias.has(a.k)) m.alias.set(a.k, clone(a)); },
    async allAliases() { return [...m.alias.values()].map(clone); },
    async allOps() { return [...m.ops.values()].map(clone); },
    async allObjs() { return [...m.objs.values()].map(clone); },
    async pendingCount() { return m.pending.size; },
    async pendingIds() { return [...m.pending].sort(); },
    async requeue(ids) { guard(); for (const op of ids) m.pending.add(op); },
    async ackLot(rec, ids) { guard(); for (const op of ids) m.pending.delete(op); m.meta.set(`lot:${rec.id}`, clone(rec)); },
    async listMeta(prefix) { return [...m.meta.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => clone(v)); },
    async getMeta(k) { return clone(m.meta.get(k)); },
    async setMeta(k, v) { guard(); m.meta.set(k, clone(v)); },
    async putSnap(s) { guard(); m.snaps.set(s.id, clone(s)); },
    async listSnaps() { return [...m.snaps.values()].map(clone); },
    async deleteSnap(id) { m.snaps.delete(id); },
    async putBackup(b) { guard(); m.backups.set(b.id, clone(b)); },
    async putBackups(bs, del = []) { guard(); for (const b of bs) m.backups.set(b.id, clone(b)); for (const d of del) m.backups.delete(d); },
    async listBackups() { return [...m.backups.values()].map(clone); },
    /** Identifiants dont le texte a été détruit (E4) : le registre est conservé. */
    async erasedIds() { return [...(m.meta.get(REGISTRE)?.ids || [])]; },
    /** Détruit des objets ET inscrit leur identifiant au registre, atomiquement (08 §19.16, E4). */
    async destroyObjs(ids) {
      guard();
      const ids2 = new Set([...(m.meta.get(REGISTRE)?.ids || []), ...ids]);
      m.meta.set(REGISTRE, { id: REGISTRE, ids: [...ids2].sort() });
      for (const id of ids) m.objs.delete(id);
    },
    close() { closed = true; },
  };
}
