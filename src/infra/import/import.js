// KOTONOHA 2.0 · infra/import/import — import d'un paquet Anki, côté page. Un Worker NEUF par import, toujours
// terminé à la fin (réussite, échec, annulation, plantage) : la mémoire du Worker est rendue en entier et rien
// n'est conservé (parade contre la rétention mémoire observée sous Firefox). Aucune écriture : l'import ne touche
// à aucune donnée existante ; il ne renvoie qu'un résumé.
//
// Plafonds PROVISOIRES (décision du 2026-11-15), en Mo DÉCIMAUX (1 Mo = 1 000 000 octets ; jamais des Mio) :
// P1 = 256 Mo sur la taille du fichier, contrôlée ici et dans le Worker AVANT toute lecture ;
// P2 = 150 Mo sur les octets décompressés de la base, comptés pendant la décompression (zip-flux.js).
export const MO = 1_000_000;
export const P1 = 256 * MO; // 256 000 000 octets
export const P2 = 150 * MO; // 150 000 000 octets

export class ImportAnkiError extends Error {
  constructor(code, message, etape = null) { super(message); this.name = 'ImportAnkiError'; this.code = code; this.etape = etape; }
}

const WORKER = new URL('./import-worker.js', import.meta.url);

/**
 * @param {Blob} file
 * @param {{p1?: number, p2?: number, signal?: AbortSignal, onProgress?: (o: {octets: number}) => void,
 *   creerWorker?: (url: URL) => Worker}} [o]
 * @returns {Promise<object>} résumé : entrée choisie, tailles, notes, cartes, GUID distincts, empreinte des GUID
 */
export function importerPaquet(file, { p1 = P1, p2 = P2, signal, onProgress, creerWorker = (u) => new Worker(u) } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') { reject(new ImportAnkiError('fichier', 'aucun fichier')); return; }
    if (!(p1 > 0 && p2 > 0)) { reject(new ImportAnkiError('plafonds', 'plafonds invalides')); return; }
    if (file.size > p1) { reject(new ImportAnkiError('P1', `fichier de ${(file.size / MO).toFixed(1)} Mo, au-delà de P1 (${p1 / MO} Mo)`, 'controle')); return; }
    if (signal && signal.aborted) { reject(new ImportAnkiError('annule', 'import annulé', 'controle')); return; }
    let w = null, fini = false;
    const fin = (f) => {
      if (fini) return; fini = true;
      try { if (w) w.terminate(); } finally { w = null; if (signal) signal.removeEventListener('abort', surAnnulation); f(); }
    };
    const surAnnulation = () => fin(() => reject(new ImportAnkiError('annule', 'import annulé')));
    try { w = creerWorker(WORKER); } catch (x) { reject(new ImportAnkiError('worker', `Worker impossible : ${(x && x.message) || x}`)); return; }
    if (signal) signal.addEventListener('abort', surAnnulation, { once: true });
    w.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progression') { if (onProgress && !fini) onProgress({ octets: m.octets }); return; }
      if (m.ok) fin(() => resolve(m.resultat));
      else fin(() => reject(new ImportAnkiError(m.code || 'inconnu', m.message || 'échec de l’import', m.etape || null)));
    };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); fin(() => reject(new ImportAnkiError('worker', (e && e.message) || 'erreur du Worker (mémoire épuisée ?)'))); };
    w.onmessageerror = () => fin(() => reject(new ImportAnkiError('worker', 'message illisible du Worker')));
    try { w.postMessage({ file, p1, p2 }); } catch (x) { fin(() => reject(new ImportAnkiError('worker', `envoi impossible : ${(x && x.message) || x}`))); }
  });
}
