'use strict';
// Démonstration du lot 2 : branche les composants sur la page. Données d'exemple seulement.
const $ = (id) => document.getElementById(id);
const journal = (t) => { $('n-journal').textContent = t; };
const ja = (avant, japonais, apres) => { const f = document.createDocumentFragment(); const s = document.createElement('span'); s.lang = 'ja'; s.textContent = japonais; f.append(avant, s, apres); return f; };

// C-LNK
KDS.lienExterne($('l-jmdict'));

// C-CHK
KDS.interrupteur($('sw-sons'), (on) => { $('sw-sons-sortie').textContent = on ? 'activés' : 'désactivés'; });

// C-NOTE
$('n-toast').addEventListener('click', () => KDS.toast('Mot ajouté à vos révisions.', { type: 'succes' }));
$('n-toast-action').addEventListener('click', () => KDS.toast('Carte supprimée.', { type: 'info', action: { libelle: 'Annuler', run: () => journal('Suppression annulée') } }));
$('ex-verifier').addEventListener('click', () => {
  const fs = $('ex-lecture'), v = document.querySelector('input[name="ex-lecture"]:checked');
  if (!v) return KDS.messageEnLigne(fs, { type: 'avertissement', texte: 'Choisissez d’abord une lecture.' });
  if (v.value === 'じゅんび') KDS.messageEnLigne(fs, { type: 'succes', texte: ja('Bonne réponse : ', 'じゅんび', '.') });
  else KDS.messageEnLigne(fs, { type: 'erreur', texte: ja('Ce n’est pas la bonne lecture : il fallait ', 'じゅんび', '.') });
});
for (const [type, texte] of [['info', 'Les révisions du jour sont prêtes.'], ['succes', 'Séance enregistrée.'], ['avertissement', 'Trois actions attendent d’être envoyées.'], ['erreur', 'L’envoi a échoué : vos actions restent sur cet appareil.']]) $('n-types').append(KDS.note({ type, texte }));

// C-SYNC : indicateur d'en-tête, bannières associées (04 §12.2), galerie des huit états
const PARAMS = { heure: '9:12', n: 3 };
const select = $('sync-simule'), galerie = $('sync-galerie');
for (const [code, d] of Object.entries(KDS.SYNC_ETATS)) {
  select.append(new Option(`${code} · ${d.nom}`, code));
  const li = document.createElement('li'); li.className = 'sync-apercu'; li.dataset.etat = code;
  const lib = document.createElement('span'); lib.textContent = d.libelle(PARAMS);
  const c = document.createElement('span'); c.className = 'sync-apercu-code'; c.textContent = `${code} · ${d.nom}`;
  li.append(KDS.syncIcone(code), lib, c); galerie.append(li);
}
let horsLigneVu = false;
const synchro = KDS.sync($('sync'), {
  panneau: $('sync-panneau'), region: $('sync-annonce'), etat: 'ET-20', params: PARAMS,
  actions: { exporter: () => journal('Export demandé'), reessayer: () => appliquer('ET-21') },
});
function appliquer(code) {
  synchro.changer(code, PARAMS); select.value = code;
  const zone = $('bannieres'), d = KDS.SYNC_ETATS[code], ancienne = $('banniere-sync');
  if (code === 'ET-25' || code === 'ET-26') KDS.banniere(zone, { id: 'banniere-sync', type: 'avertissement', texte: d.detail(PARAMS) });
  else if (code === 'ET-27') KDS.banniere(zone, { id: 'banniere-sync', type: 'erreur', texte: d.detail(PARAMS), fermable: true, retour: $('sync'), actions: [{ libelle: 'Exporter maintenant', run: () => journal('Export demandé') }, { libelle: 'Réessayer', run: () => appliquer('ET-21') }] });
  else if (code === 'ET-23' && !horsLigneVu) { horsLigneVu = true; KDS.banniere(zone, { id: 'banniere-sync', type: 'info', texte: 'Hors ligne : vos actions sont enregistrées sur cet appareil.', fermable: true, retour: $('sync') }); }
  else if (ancienne) ancienne.remove();
}
select.addEventListener('change', () => appliquer(select.value));

// C-PROG
let n = 4;
KDS.progression($('pb-seance'), n, 7);
$('pb-suivante').addEventListener('click', () => { n = KDS.progression($('pb-seance'), n + 1, 7); });
KDS.confiance($('conf-1'), 3); KDS.confiance($('conf-2'), 2); KDS.confiance($('conf-3'), 1);
