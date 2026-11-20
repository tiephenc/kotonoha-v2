// KOTONOHA 2.0 · commandes d'étude et de préférences de la couche application (PH-4). Une action = une opération `pref`
// du journal, écrite dans une transaction ; le résultat dit si elle est confirmée (`saved`) ou restée dans le tampon.
import { sujetSection, sujetLecon } from '../core/parcours.js';

function refuser(journal) {
  if (!journal.canStartActivity()) {
    const e = new Error(journal.status.readOnly ? 'lecture seule : rechargez la page' : 'des actions ne sont pas encore enregistrées : exportez-les ou réessayez avant de continuer');
    e.code = journal.status.readOnly ? 'read-only' : 'blocked';
    throw e;
  }
}
/** Valeur courante d'une préférence (booléen ou jeton), `defaut` si elle n'a jamais été écrite. */
/** Étude personnelle (exercices V1 au niveau estimé, signalés comme tels) : activée par défaut depuis le 20/11/2026, sur décision de
 * l'utilisateur (« ne pas bloquer la production sur l'incertitude du classement JLPT »). Un choix explicite de l'apprenant prime. */
export const ETUDE_PERSO_DEFAUT = true;
export const lirePref = (journal, sujet, defaut = null) => (journal.view.prefs[sujet] ? journal.view.prefs[sujet].v : defaut);

/** Écrit une préférence. @returns {Promise<{op: any, saved: boolean}>} */
export async function reglerPref(journal, sujet, valeur) { refuser(journal); return journal.record('pref', sujet, { v: valeur }); }

/** Marque une section d'une leçon (`cle`) ou la leçon entière (`cle` nul) comme étudiée ou non. */
export async function marquerEtude(journal, numero, cle, etudiee) {
  return reglerPref(journal, cle ? sujetSection(numero, cle) : sujetLecon(numero), !!etudiee);
}
