// KOTONOHA 2.0 · MOD-10 infra/store — IndexedDB par compte, distincte des bases V1 (08 §10.7, §12.6 ;
// D-60). Une écriture = une transaction ; sa promesse n'est tenue qu'à `complete` et rejetée sinon :
// un échec n'est jamais silencieux. Aucune base ni clé de la V1 n'est ouverte ou écrite ici.
import { canonical } from '../core/canon.js';

/** Version de la base. Toute montée ferme les connexions anciennes (07 §17.9). */
export const DB_VERSION = 1;
/** Préfixe des bases V2. La V1 utilise `kotonoha-core-media` et des caches `kotonoha-…`. */
export const DB_PREFIX = 'kotonoha2-';
/** Clé de méta du registre des textes détruits (identifiants seuls). */
export const REGISTRE = 'eff:detruits';
const STORES = { ops: 'op', objs: 'id', pending: 'op', snaps: 'id', backups: 'id', meta: 'k', alias: 'k' };

/** Nom de la base : une par compte, une pour l'usage sans compte. @param {string|null} account */
export const dbName = (account) => (account ? `${DB_PREFIX}u-${encodeURIComponent(account)}` : `${DB_PREFIX}local`);

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/**
 * Ouvre la base. `onVersionChange` est appelé quand un autre onglet monte la version : la connexion
 * est fermée et l'appelant passe en lecture seule (T-MT-01).
 * @param {string} name @param {{version?: number, onVersionChange?: (e: IDBVersionChangeEvent) => void, onBlocked?: () => void}} [o]
 */
export async function openIdbStore(name, o = {}) {
  if (!name.startsWith(DB_PREFIX)) throw new Error('base hors de l’espace V2');
  const version = o.version ?? DB_VERSION;
  const open = indexedDB.open(name, version);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const [s, keyPath] of Object.entries(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath });
  };
  if (o.onBlocked) open.onblocked = o.onBlocked;
  const db = await req(open);
  let closed = false;
  db.onversionchange = (e) => { closed = true; db.close(); o.onVersionChange?.(e); };

  const tx = (stores, mode, body) => new Promise((res, rej) => {
    if (closed) { const e = new Error('base fermée par une version plus récente'); e.code = 'read-only'; rej(e); return; }
    let t;
    try { t = db.transaction(stores, mode); } catch (e) { rej(e); return; }
    let out, fail = null;
    t.oncomplete = () => res(out);
    t.onabort = () => rej(fail || t.error || new Error('transaction interrompue'));
    // Une requête en erreur fait abandonner la transaction : onabort porte alors l'erreur.
    try { out = body(t, (e) => { fail = e; try { t.abort(); } catch { /* déjà terminée */ } }); } catch (e) { fail = e; try { t.abort(); } catch { /* */ } }
  });
  const all = (s) => tx([s], 'readonly', (t) => { const r = t.objectStore(s).getAll(); const box = { v: [] }; r.onsuccess = () => { box.v = r.result; }; return box; }).then((b) => b.v);

  return {
    name, version,
    get closed() { return closed; },
    /**
     * Ajoute des opérations et des objets de contenu, atomiquement. Une opération ou un objet déjà
     * présent à l'identique est ignoré ; présent avec un autre contenu : tout le lot est refusé.
     * `queue` : placer les opérations nouvelles dans la file d'envoi (faux pour une opération reçue).
     * @param {any[]} ops @param {any[]} [objs] @param {{queue?: boolean}} [o]
     */
    appendOps(ops, objs = [], { queue = true } = {}) {
      const added = [];
      return tx(['ops', 'objs', 'pending', 'meta'], 'readwrite', (t, abort) => {
        const so = t.objectStore('ops'), sb = t.objectStore('objs'), sp = t.objectStore('pending');
        const put = (store, key, v, onNew) => { const g = store.get(key); g.onsuccess = () => {
          if (g.result === undefined) { store.add(v); onNew?.(); }
          else if (canonical(g.result) !== canonical(v)) { const e = new Error(`conflit sur ${key}`); e.code = 'conflict'; abort(e); }
        }; };
        // Registre des destructions (08 §19.16, INV-09) : un objet détruit n'est jamais réintroduit.
        const reg = t.objectStore('meta').get(REGISTRE);
        reg.onsuccess = () => {
          const gone = new Set(reg.result?.v?.ids || []);
          for (const b of objs) if (!gone.has(b.id)) put(sb, b.id, b);
        };
        for (const o of ops) put(so, o.op, o, () => { if (queue) sp.put({ op: o.op }); added.push(o.op); });
        return added;
      });
    },
    /** Alias V1 : ajout seul ; une entrée existante n'est jamais modifiée ni supprimée (08 §5.4). */
    addAliases(list) {
      return tx(['alias'], 'readwrite', (t, abort) => { const s = t.objectStore('alias'); for (const a of list) { const g = s.get(a.k); g.onsuccess = () => { if (g.result === undefined) s.add(a); else if (canonical(g.result) !== canonical(a)) { const e = new Error(`alias déjà enregistré autrement : ${a.k}`); e.code = 'conflict'; abort(e); } }; } });
    },
    allAliases: () => all('alias'),
    allOps: () => all('ops'),
    allObjs: () => all('objs'),
    pendingCount: () => tx(['pending'], 'readonly', (t) => { const r = t.objectStore('pending').count(); const b = { v: 0 }; r.onsuccess = () => { b.v = r.result; }; return b; }).then((b) => b.v),
    // File d'envoi (MOD-11, 08 §7.3). Les lots figés et reçus sont des entrées `lot:<id>` de `meta`.
    pendingIds: () => tx(['pending'], 'readonly', (t) => { const r = t.objectStore('pending').getAllKeys(); const b = { v: [] }; r.onsuccess = () => { b.v = r.result; }; return b; }).then((b) => b.v),
    /** Remet des opérations dans la file (lot perdu sur le serveur). */
    requeue: (ids) => tx(['pending'], 'readwrite', (t) => { const s = t.objectStore('pending'); for (const op of ids) s.put({ op }); }),
    /** Lot reconnu par le serveur : ses opérations quittent la file et son état est enregistré, atomiquement. */
    ackLot: (rec, ids) => tx(['pending', 'meta'], 'readwrite', (t) => { const s = t.objectStore('pending'); for (const op of ids) s.delete(op); t.objectStore('meta').put({ k: `lot:${rec.id}`, v: rec }); }),
    listMeta: (prefix) => tx(['meta'], 'readonly', (t) => { const r = t.objectStore('meta').getAll(IDBKeyRange.bound(prefix, prefix + '￿')); const b = { v: [] }; r.onsuccess = () => { b.v = r.result.map((x) => x.v); }; return b; }).then((b) => b.v),
    getMeta: (k) => tx(['meta'], 'readonly', (t) => { const r = t.objectStore('meta').get(k); const b = { v: undefined }; r.onsuccess = () => { b.v = r.result?.v; }; return b; }).then((b) => b.v),
    setMeta: (k, v) => tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put({ k, v }); }),
    putSnap: (s) => tx(['snaps'], 'readwrite', (t) => { t.objectStore('snaps').put(s); }),
    listSnaps: () => all('snaps'),
    deleteSnap: (id) => tx(['snaps'], 'readwrite', (t) => { t.objectStore('snaps').delete(id); }),
    putBackup: (b) => tx(['backups'], 'readwrite', (t) => { t.objectStore('backups').put(b); }),
    putBackups: (bs, del = []) => tx(['backups'], 'readwrite', (t) => { const s = t.objectStore('backups'); for (const b of bs) s.put(b); for (const d of del) s.delete(d); }),
    listBackups: () => all('backups'),
    erasedIds: () => tx(['meta'], 'readonly', (t) => { const r = t.objectStore('meta').get(REGISTRE); const b = { v: [] }; r.onsuccess = () => { b.v = [...(r.result?.v?.ids || [])]; }; return b; }).then((b) => b.v),
    /** Détruit des objets ET inscrit leur identifiant au registre, dans une seule transaction (08 §19.16, E4). */
    destroyObjs: (ids) => tx(['objs', 'meta'], 'readwrite', (t) => {
      const sm = t.objectStore('meta'), so = t.objectStore('objs'), g = sm.get(REGISTRE);
      g.onsuccess = () => { const all = new Set([...(g.result?.v?.ids || []), ...ids]); sm.put({ k: REGISTRE, v: { id: REGISTRE, ids: [...all].sort() } }); };
      for (const id of ids) so.delete(id);
    }),
    close() { closed = true; db.close(); },
  };
}

/** Liste des bases V2 présentes (diagnostic et contrôle d'isolation). */
export async function listV2Databases() {
  if (!indexedDB.databases) return null;
  return (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith(DB_PREFIX)).sort();
}

export { req as idbRequest };
