// KOTONOHA 2.0 · sauvegarde complète téléchargeable : journal d'étude ET fiches Anki importées (partie « corpus »).
import { backupJournal } from '../../infra/backup.js';
import { ankiDe } from './anki-etat.js';

export function telecharger(nom, texte) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texte], { type: 'application/json' })); a.download = nom;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Sauvegarde vérifiée (construite, relue, contrôlée) de tout ce que l'appareil contient pour ce compte. */
export async function sauvegardeComplete(ctx, t = Date.now()) {
  const corpus = await ankiDe(ctx).pourSauvegarde();
  return backupJournal(ctx.journal, t, 'complete', { corpus });
}

export const nomSauvegarde = () => `kotonoha2-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
