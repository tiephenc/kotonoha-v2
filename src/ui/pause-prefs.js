// KOTONOHA 2.0 · préférence d'affichage partagée par le minuteur Focus et l'écran de pause : « Masquer le temps ».
// Un seul booléen, sur l'appareil ; aucun historique. Stockage injecté (null : aucune mémoire).
export const CLE_AFFICHAGE = 'kotonoha2.focus.affichage.v1';

export function lireMasque(stockage) {
  try { const o = JSON.parse(stockage?.getItem(CLE_AFFICHAGE) ?? 'null'); return !!o && o.masque === true; } catch (e) { return false; }
}
export function ecrireMasque(stockage, masque) {
  try { stockage?.setItem(CLE_AFFICHAGE, JSON.stringify({ masque: masque === true })); } catch (e) { /* stockage refusé : la préférence ne dure que le temps de la vue */ }
}
