// KOTONOHA 2.0 · corpus Anki personnel (DC-7) : base IndexedDB distincte du journal (`kotonoha2-anki-local`, une par compte).
// L'import n'écrit JAMAIS dans le journal d'étude : leçons étudiées, réponses, réglages et sauvegardes restent intacts.
// Écriture atomique (§19.5) : une version (avec toutes ses notes, cartes et révisions) n'existe qu'une fois la transaction
// terminée ; un import interrompu ne laisse rien. Ajout seul : aucune entrée existante n'est modifiée ni supprimée. Retirer un
// paquet = le masquer (réversible, §19.6) : les données restent en place.
import { canonical } from '../core/canon.js';
import { DB_PREFIX } from './store-idb.js';

export const ANKI_DB_VERSION = 1;
const STORES = { versions: 'id', lignees: 'id', notes: 'k', cartes: 'k', revisions: 'k', journal: 'id', meta: 'k' };
const CORPS = ['notes', 'cartes', 'revisions'];
/** Marque d'un import en cours d'écriture : posée avant la transaction, retirée PAR la transaction. */
export const EN_COURS = 'import:en-cours';

/** Nom de la base du corpus : une par compte, une pour l'usage sans compte. @param {string|null} account */
export const ankiDbName = (account) => (account ? `${DB_PREFIX}anki-u-${encodeURIComponent(account)}` : `${DB_PREFIX}anki-local`);

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const borne = (v) => IDBKeyRange.bound(`${v}|`, `${v}|￿`);

/** @param {string|null} [account] @param {{idb?: IDBFactory}} [o] */
export async function openAnkiStore(account = null, { idb = globalThis.indexedDB } = {}) {
  const name = ankiDbName(account);
  const open = idb.open(name, ANKI_DB_VERSION);
  open.onupgradeneeded = () => { const db = open.result; for (const [s, keyPath] of Object.entries(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath }); };
  const db = await req(open);
  db.onversionchange = () => db.close();
  const tx = (stores, mode, body) => new Promise((res, rej) => {
    let t; try { t = db.transaction(stores, mode); } catch (e) { rej(e); return; }
    let out, fail = null;
    t.oncomplete = () => res(out);
    t.onabort = () => rej(fail || t.error || new Error('transaction interrompue'));
    try { out = body(t, (e) => { fail = e; try { t.abort(); } catch { /* déjà terminée */ } }); } catch (e) { fail = e; try { t.abort(); } catch { /* */ } }
  });
  const tout = (s, range) => tx([s], 'readonly', (t) => { const r = t.objectStore(s).getAll(range); const b = { v: [] }; r.onsuccess = () => { b.v = r.result; }; return b; }).then((b) => b.v);
  const getMeta = (k) => tx(['meta'], 'readonly', (t) => { const r = t.objectStore('meta').get(k); const b = { v: undefined }; r.onsuccess = () => { b.v = r.result?.v; }; return b; }).then((b) => b.v);

  /**
   * Ajoute une version, atomiquement. Refus (`deja-importe`) si la version existe ; refus (`conflit`) si une clé existe avec un
   * autre contenu. `lignee` nouvelle : ajoutée ; existante : inchangée.
   */
  function ajouterVersion({ version, lignee, notes, cartes, revisions, entree }) {
    return tx(Object.keys(STORES), 'readwrite', (t, abort) => {
      const ajout = (s, v) => { const st = t.objectStore(s), key = v[STORES[s]]; const g = st.get(key); g.onsuccess = () => { if (g.result === undefined) st.add(v); else if (canonical(g.result) !== canonical(v)) { const e = new Error(`conflit sur ${s} ${key}`); e.code = 'conflit'; abort(e); } }; };
      const gv = t.objectStore('versions').get(version.id);
      gv.onsuccess = () => {
        if (gv.result !== undefined) { const e = new Error('cette version est déjà importée'); e.code = 'deja-importe'; abort(e); return; }
        t.objectStore('versions').add(version);
        ajout('lignees', lignee);
        for (const n of notes) t.objectStore('notes').add(n);
        for (const c of cartes) t.objectStore('cartes').add(c);
        for (const r of revisions) t.objectStore('revisions').add(r);
        t.objectStore('journal').add(entree);
        t.objectStore('meta').delete(EN_COURS);
      };
    });
  }

  return {
    name,
    ajouterVersion,
    /** Tout le corpus (pour l'assembler en mémoire) et les paquets masqués. */
    async lireTout() {
      const [versions, lignees, notes, cartes, revisions, meta] = await Promise.all(['versions', 'lignees', 'notes', 'cartes', 'revisions', 'meta'].map((s) => tout(s)));
      return { versions, lignees, notes, cartes, revisions, masques: new Set(meta.filter((m) => m.k.startsWith('masque:') && m.v === true).map((m) => m.k.slice(7))) };
    },
    versions: () => tout('versions'),
    lignees: () => tout('lignees'),
    journal: () => tout('journal'),
    /** Contrôle d'intégrité d'une version écrite : nombres relus et GUID des notes relues. */
    async relire(versionId) {
      const [notes, cartes, revisions] = await Promise.all(CORPS.map((s) => tout(s, borne(versionId))));
      return { notes: notes.length, cartes: cartes.length, revisions: revisions.length, guids: notes.map((n) => n.guid) };
    },
    enCours: () => getMeta(EN_COURS),
    marquerEnCours: (v) => tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put({ k: EN_COURS, v }); }),
    effacerMarque: () => tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').delete(EN_COURS); }),
    /** Masquer ou rétablir un paquet (réversible) ; tracé dans le journal d'import. */
    masquer: (lignee, masque, entree) => tx(['meta', 'journal'], 'readwrite', (t) => { t.objectStore('meta').put({ k: `masque:${lignee}`, v: masque === true }); t.objectStore('journal').add(entree); }),
    ajouterJournal: (entree) => tx(['journal'], 'readwrite', (t) => { t.objectStore('journal').add(entree); }),
    /** Corpus complet pour une sauvegarde : chaque magasin, trié par clé. */
    async exporter() {
      const r = {}; for (const s of Object.keys(STORES)) if (s !== 'meta') r[s] = await tout(s);
      r.meta = (await tout('meta')).filter((m) => m.k.startsWith('masque:'));
      return r;
    },
    /**
     * Restauration par union (sauvegarde) : ajoute les versions absentes avec leurs notes, cartes et révisions, les lignées et
     * entrées de journal absentes, et l'état de masquage des lignées inconnues ici. Ne modifie ni ne retire rien. Atomique.
     */
    restaurer(c) {
      const versionsLocales = new Set();
      return tx(Object.keys(STORES), 'readwrite', (t, abort) => {
        const res = { versions: 0, notes: 0, cartes: 0, revisions: 0 };
        const vs = t.objectStore('versions').getAllKeys();
        vs.onsuccess = () => {
          for (const k of vs.result) versionsLocales.add(k);
          const ajoutSiAbsent = (s, v, compteur) => { const st = t.objectStore(s), g = st.get(v[STORES[s]]); g.onsuccess = () => { if (g.result === undefined) { st.add(v); if (compteur) res[compteur]++; } else if (canonical(g.result) !== canonical(v)) { const e = new Error(`conflit sur ${s}`); e.code = 'conflit'; abort(e); } }; };
          const neuves = new Set((c.versions || []).filter((v) => !versionsLocales.has(v.id)).map((v) => v.id));
          for (const v of c.versions || []) if (neuves.has(v.id)) ajoutSiAbsent('versions', v, 'versions');
          for (const l of c.lignees || []) ajoutSiAbsent('lignees', l);
          for (const s of CORPS) for (const x of c[s] || []) if (neuves.has(x.version)) ajoutSiAbsent(s, x, s);
          for (const e of c.journal || []) ajoutSiAbsent('journal', e);
          const lig = t.objectStore('meta');
          for (const m of c.meta || []) { if (!/^masque:/.test(m.k)) continue; const g = lig.get(m.k); g.onsuccess = () => { if (g.result === undefined) lig.add({ k: m.k, v: m.v === true }); }; }
        };
        return res;
      });
    },
    close: () => db.close(),
  };
}
