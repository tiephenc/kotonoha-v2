// KOTONOHA 2.0 · accès partagé au corpus Anki de l'appareil (base `kotonoha2-anki-…`), gardé en mémoire le temps de la session.
// Le corpus est assemblé à la demande à partir des données stockées et du journal (réponses KOTONOHA aux cartes).
import { openAnkiStore, ankiDbName } from '../../infra/anki-store.js';
import { assemblerCorpus, indexLecons, rapprocher } from '../../core/anki.js';

export function ankiDe(ctx) {
  if (ctx._anki) return ctx._anki;
  let store = null, brut = null, corpus = null, idx = null, parLoc = null;
  const a = {
    async store() { if (!store) store = await openAnkiStore(ctx.journal.account ?? null); return store; },
    async brut() { if (!brut) brut = await (await a.store()).lireTout(); return brut; },
    /** Corpus assemblé ; recalculé si le journal a changé (nouvelles réponses) ou après un import. */
    async corpus() { const n = ctx.journal.ops.length; if (!corpus || corpus.n !== n) corpus = { n, ...assemblerCorpus(await a.brut(), ctx.journal.derived) }; return corpus; },
    /** Après un import, un masquage ou une restauration : relire la base. */
    invalider() { brut = null; corpus = null; parLoc = null; },
    /** Rien d'importé ? Sans ouvrir (donc sans créer) la base quand le navigateur sait lister les bases. */
    async vide() {
      if (!store && !brut && indexedDB.databases) { try { const n = ankiDbName(ctx.journal.account ?? null); if (!(await indexedDB.databases()).some((d) => d.name === n)) return true; } catch { /* liste indisponible : on ouvre */ } }
      return (await a.brut()).versions.length === 0;
    },
    /** Index des leçons (vocabulaire, kanji) : disponible quand le catalogue est chargé. */
    index() { if (!idx && ctx.cat) idx = indexLecons(ctx.cat.lecons()); return idx; },
    /** Correspondances d'une carte avec les leçons (calculées, jamais stockées dans les fiches). */
    liens(item) { const i = a.index(); return i && item.note ? rapprocher(item.note, i) : { liens: [], ambigu: false }; },
    /** Cartes rattachées à chaque élément de leçon (`loc`). */
    async parElement() {
      const c = await a.corpus(), i = a.index();
      if (parLoc && parLoc.n === c.n && parLoc.i === i) return parLoc.m;
      parLoc = { n: c.n, i, m: new Map() };
      if (!i) return parLoc.m;
      for (const it of c.items) { if (!it.note) continue; for (const l of rapprocher(it.note, i).liens) (parLoc.m.get(l.loc) || parLoc.m.set(l.loc, []).get(l.loc)).push(it); }
      return parLoc.m;
    },
    /** Corpus complet pour une sauvegarde (null si rien n'a été importé). */
    async pourSauvegarde() { if (await a.vide()) return null; return (await a.store()).exporter(); },
  };
  ctx._anki = a;
  return a;
}
