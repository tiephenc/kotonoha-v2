// KOTONOHA 2.0 · ouverture du journal local dans le navigateur : base IndexedDB du compte,
// coordination des onglets, pointeur et détection d'éviction (07 §17.9 ; 08 §10.7).
import { openIdbStore, dbName, DB_VERSION } from '../infra/store-idb.js';
import { evictionOf, writePointer } from '../infra/storage.js';
import { openJournal } from './journal.js';
import { riskyBackupHook } from '../infra/backup.js';

export const CHANNEL = 'kotonoha-v2';

/**
 * @param {{account?: string|null, version?: number, now?: () => number}} [o]
 */
export async function openLocal({ account = null, version = DB_VERSION, now = () => Date.now() } = {}) {
  let journal = null, early = null;
  const name = dbName(account);
  const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel(CHANNEL) : null;
  const store = await openIdbStore(name, {
    version,
    // Un autre onglet ouvre une version plus récente : celui-ci passe en lecture seule et propose de recharger.
    onVersionChange: () => { if (journal) journal.setReadOnly('version'); else early = 'version'; },
  });
  // Tant qu'une éviction n'est pas reconnue par l'apprenant, le pointeur garde le nombre attendu :
  // l'alerte reste visible au rechargement, même après de nouvelles écritures (m11).
  journal = await openJournal({ store, account, now, channel, onSaved: (n) => { if (!journal?.evicted) writePointer(name, n, now()); }, beforeRisky: riskyBackupHook(() => journal, now) });
  if (early) journal.setReadOnly(early);
  const ev = evictionOf(name, journal.ops.length);
  journal.evicted = ev; // null si rien n'a disparu
  if (!ev) writePointer(name, journal.ops.length, now());
  /** L'apprenant a pris connaissance de l'éviction (et restauré, ou choisi de repartir de l'état présent). */
  journal.ackEviction = () => { journal.evicted = null; writePointer(name, journal.ops.length, now()); };
  // Fermeture avec un tampon non enregistré ni exporté : avertissement du navigateur et tampon confié
  // aux autres onglets (C-13). Rien n'est perdu en silence.
  const onUnload = (e) => {
    const s = journal.status;
    if (!s.buffer || s.exported) return;
    journal.handOff();
    e.preventDefault(); e.returnValue = '';
  };
  globalThis.addEventListener?.('beforeunload', onUnload);
  journal.close = () => { globalThis.removeEventListener?.('beforeunload', onUnload); channel?.close(); store.close(); };
  return journal;
}
