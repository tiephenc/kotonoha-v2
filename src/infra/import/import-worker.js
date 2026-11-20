// KOTONOHA 2.0 · infra/import/import-worker — un Worker NEUF par import, terminé par l'appelant à la fin
// (réussite, échec ou annulation). Un seul message traité par Worker. Rien n'est écrit : ni IndexedDB, ni cache,
// ni OPFS, ni stockage local ; seul un résumé (nombres et empreinte) est renvoyé, jamais les octets de la base.
// sql.js : celui du site (vendor/ à la racine), inchangé (D-102). fzstd : copie exacte du bloc de la V1 (MIT).
'use strict';
importScripts('../../../vendor/fzstd.js', 'zip-flux.js', 'lecture-anki.js', '../../../../vendor/sql-wasm.js');
let pris = false;
const memoire = () => (self.performance && performance.memory ? performance.memory.usedJSHeapSize : null);
onmessage = async (e) => {
  if (pris) return; pris = true;
  const { file, p1, p2 } = e.data || {};
  const t0 = performance.now();
  let x = null, etape = 'extraction';
  try {
    let dernier = 0;
    x = await self.KZip.extract(file, { p1, p2, onProgress: (n) => { if (n - dernier >= 1e6) { dernier = n; postMessage({ type: 'progression', octets: n }); } } });
    const r = { entree: x.nom, compression: x.compression, factice: x.factice, ignorees: x.ignorees, octetsFichier: file.size, baseCompressee: x.brut, baseDecompressee: x.lus, capacite: x.capacite, copies: x.copies, octetsCopies: x.octetsCopies, msExtraction: Math.round(performance.now() - t0), memoireApresExtraction: memoire() };
    etape = 'import';
    const SQL = await initSqlJs({ locateFile: (f) => '../../../../vendor/' + f }).catch((y) => { throw new self.KZip.ImportError('sqljs', `sql.js indisponible : ${(y && y.message) || y}`); });
    const octets = x.octets; x = null; // seul `octets` référence encore le tampon ; libéré au retour de resumer()
    Object.assign(r, await self.KAnki.resumer(SQL, octets));
    r.msTotal = Math.round(performance.now() - t0); r.memoireApresImport = memoire();
    postMessage({ type: 'fin', ok: true, resultat: r });
  } catch (err) {
    x = null;
    postMessage({ type: 'fin', ok: false, etape, code: (err && err.code) || (etape === 'import' ? 'base-invalide' : 'inconnu'), message: String((err && err.message) || err) });
  }
};
