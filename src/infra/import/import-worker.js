// KOTONOHA 2.0 · infra/import/import-worker — un Worker NEUF par import, terminé par l'appelant à la fin
// (réussite, échec ou annulation). Un seul message traité par Worker. Rien n'est écrit : ni IndexedDB, ni cache,
// ni OPFS, ni stockage local. Mode « resume » : nombres et empreinte seulement. Mode « complet » : contenu lu de la base
// (notes, cartes, historique, modèles, paquets), valeurs brutes ; jamais les octets de la base ni les médias.
// sql.js : copie à l'identique de celui du site (vendor/ à la racine, D-102), placée dans v2/vendor pour que le site publié,
// servi depuis v2 seul, la trouve (identité vérifiée par test). fzstd : copie exacte du bloc de la V1 (MIT).
'use strict';
importScripts('../../../vendor/fzstd.js', 'zip-flux.js', 'lecture-anki.js', '../../../vendor/sql-wasm.js');
let pris = false;
const memoire = () => (self.performance && performance.memory ? performance.memory.usedJSHeapSize : null);
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
onmessage = async (e) => {
  if (pris) return; pris = true;
  const { file, p1, p2, mode = 'resume' } = e.data || {};
  const t0 = performance.now();
  let x = null, etape = 'extraction';
  try {
    let dernier = 0;
    x = await self.KZip.extract(file, { p1, p2, onProgress: (n) => { if (n - dernier >= 1e6) { dernier = n; postMessage({ type: 'progression', octets: n }); } } });
    const r = { entree: x.nom, compression: x.compression, factice: x.factice, ignorees: x.ignorees, octetsFichier: file.size, baseCompressee: x.brut, baseDecompressee: x.lus, capacite: x.capacite, copies: x.copies, octetsCopies: x.octetsCopies, msExtraction: Math.round(performance.now() - t0), memoireApresExtraction: memoire() };
    etape = 'import';
    const SQL = await initSqlJs({ locateFile: (f) => '../../../vendor/' + f }).catch((y) => { throw new self.KZip.ImportError('sqljs', `sql.js indisponible : ${(y && y.message) || y}`); });
    const octets = x.octets; x = null; // seul `octets` référence encore le tampon ; libéré à la fin
    Object.assign(r, await self.KAnki.resumer(SQL, octets));
    if (mode === 'complet') {
      // Empreinte de la base de la collection (identité de la version importée) ; autres entrées que la base : médias, non importés.
      r.empreinteBase = hex(await crypto.subtle.digest('SHA-256', octets));
      const noms = (await self.KZip.entries(file)).map((y) => y.nom);
      r.entreesMedias = noms.filter((n) => !self.KZip.BASES.includes(n) && n !== 'media' && n !== 'meta').length;
      r.donnees = self.KAnki.extraire(SQL, octets);
    }
    r.msTotal = Math.round(performance.now() - t0); r.memoireApresImport = memoire();
    postMessage({ type: 'fin', ok: true, resultat: r });
  } catch (err) {
    x = null;
    postMessage({ type: 'fin', ok: false, etape, code: (err && err.code) || (etape === 'import' ? 'base-invalide' : 'inconnu'), message: String((err && err.message) || err) });
  }
};
