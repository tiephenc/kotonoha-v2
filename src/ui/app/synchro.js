// KOTONOHA 2.0 · C-SYNC branché sur le module de synchronisation (PH-4). États et libellés : infra/sync.js (08 §7.7) ->
// états ET-19 à ET-27 du design system (04 §12.2 ; ET-19 : suppression du compte, PH-2). Aucun état simulé : l'indicateur suit `sync.state`.
export const CODE_PAR_ETAT = Object.freeze({
  local: 'ET-20', reconciliation: 'ET-21', 'a-jour': 'ET-22', 'hors-ligne': 'ET-23', 'en-attente': 'ET-24',
  'session-expiree': 'ET-25', 'mise-a-jour-requise': 'ET-26', erreur: 'ET-27',
  'suppression-compte': 'ET-19', // PH-2 (08 §19.11) : suppression du compte arrivée à son terme ; plus rien ne se synchronise
});
/** Clé du magasin où le module de synchronisation note sa dernière réconciliation complète. */
export const CLE_RECONCILIE = 'sync:reconcilie';

export const codeSync = (etat) => CODE_PAR_ETAT[etat] ?? 'ET-27';

const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
/**
 * Paramètres des libellés C-SYNC. `a-jour` : « Synchronisé » seulement si la réconciliation est récente, sinon
 * « Envoyé · vérification en attente » (`verifie: false`), comme `sync.label()`.
 * @param {string} etat @param {{pending: number, reconcilieA: number, libelle: string, erreur?: {message?: string}|null}} o
 */
export function parametres(etat, { pending, reconcilieA, libelle, erreur = null }) {
  const p = { n: pending };
  if (etat === 'a-jour') { p.verifie = libelle === 'Synchronisé'; if (reconcilieA) p.heure = hhmm(reconcilieA); }
  if (etat === 'erreur' && erreur?.message) p.message = `Erreur de synchronisation${' '}: ${erreur.message}. Vos actions restent sur cet appareil, exportez-les ou réessayez.`;
  return p;
}
