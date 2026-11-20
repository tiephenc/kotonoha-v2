// KOTONOHA 2.0 · présentation de l'état d'un effacement (PH-2, lot L20-01 ; 04 §15.6-15.7, 08 §19.16). Domaine pur : aucune lecture du
// DOM ni de l'horloge de l'appareil. Entrée : la description rendue par `createErasure().decrire` et, s'il existe, l'enregistrement local
// `eff:e:<effacement>` ; sortie : ce que l'écran dit et permet. Le terme `T` vient de l'heure du serveur (enregistrement du lot), jamais d'ici.
import { D_MS } from '../../infra/effacement-etat.js';

const NB = ' ';
/** Délai avant le terme, en heures (72). */
export const DELAI_HEURES = D_MS / 3600_000;

/** Date d'un terme (heure du serveur), en UTC : « 22 novembre 2026 à 10:00 UTC ». */
export function termeFr(t) {
  const d = new Date(t).toLocaleString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${d.replace(',', '')}${NB}UTC`;
}

/** « 1 texte » / « 3 textes ». */
export const nbTextes = (n) => `${n}${NB}texte${n > 1 ? 's' : ''}`;

/**
 * @param {{phase: string, sub: string, terme?: number|null, why?: string, confirmationRequise?: boolean}} desc
 * @param {any} [rec] enregistrement local (absent en E2 avant la prise du lot)
 * @returns {{cle: 'prepare'|'envoye'|'attente'|'definitif'|'detruit'|'annule'|'refuse'|'distant', etat: string, detail: string, annulable: boolean, terme: number|null, etranger: boolean, annulationEnAttente: boolean}}
 */
export function presenter(desc, rec = null) {
  const r = rec || {}, terme = desc.terme ?? null, etranger = !!r.foreign;
  const annulationEnAttente = !!r.wantUnerase && ['fige', 'lot', 'marques'].includes(r.status);
  const base = { terme, etranger, annulationEnAttente };
  if (desc.confirmationRequise && desc.origineLocale === false) { // aucune marque locale : rien ne prouve que cet appareil ait effacé ce texte (L20-14 F2)
    return { ...base, cle: 'distant', etat: 'Annulation présente sur le serveur', annulable: false,
      detail: 'Une annulation de cet effacement existe sur le serveur ; nous ne pouvons pas dire quel appareil l’a faite. Ce texte reste masqué ici tant que vous n’avez pas confirmé l’annulation.' };
  }
  if (desc.confirmationRequise) {
    return { ...base, cle: 'distant', etat: 'Annulation demandée sur un autre appareil', annulable: false,
      detail: 'Ce texte reste masqué ici tant que vous n’avez pas confirmé l’annulation.' };
  }
  switch (desc.sub) {
    case 'prepare': return { ...base, cle: 'prepare', etat: 'Préparé', annulable: true, detail: 'Le texte est masqué sur cet appareil. Rien n’a encore quitté l’appareil : vous pouvez annuler sans conséquence.' };
    case 'fige': return { ...base, cle: 'prepare', etat: 'Préparé, pas encore envoyé', annulable: true, detail: 'Le texte est masqué sur cet appareil. L’envoi au compte aura lieu à la prochaine synchronisation ; vous pouvez annuler jusque-là.' };
    case 'envoye-non-confirme': return { ...base, cle: 'envoye', etat: 'Envoyé, réponse du serveur inconnue', annulable: true, detail: 'L’envoi a été essayé sans réponse. L’effacement sera confirmé ou repris à la prochaine synchronisation. L’annulation reste possible tant que le terme n’est pas atteint.' };
    case 'refuse': return { ...base, cle: 'refuse', etat: 'Refusé', annulable: true, detail: motifRefus(desc.why) };
    case 'confirme': case 'marque':
      if (desc.phase === 'E3') return { ...base, cle: 'attente', etat: 'En attente', annulable: true, detail: `Masqué sur cet appareil, puis sur vos autres appareils dès qu’ils se connectent. Il devient définitif le ${terme == null ? 'terme indiqué par le serveur' : termeFr(terme)} (délai de ${DELAI_HEURES}${NB}heures, heure du serveur) ; vous pouvez l’annuler jusque-là.` };
      return { ...base, cle: 'definitif', etat: 'Définitif', annulable: false, detail: `Le terme est atteint${terme == null ? '' : ` (${termeFr(terme)})`}. L’effacement ne peut plus être annulé ; la destruction des copies est en cours.` };
    case 'detruit-localement': return { ...base, cle: 'definitif', etat: 'Définitif', annulable: false, detail: 'Les copies de cet appareil sont détruites ; la suppression sur le serveur suit. Il ne peut plus être annulé.' };
    case 'detruit': return { ...base, cle: 'detruit', etat: 'Détruit', annulable: false, detail: `Effacé définitivement${terme == null ? '' : ` (terme : ${termeFr(terme)})`}. Vos exports et sauvegardes antérieurs peuvent encore contenir ce texte.` };
    case 'annule': return { ...base, cle: 'annule', etat: 'Annulé', annulable: false, detail: 'L’effacement est annulé : le texte est de nouveau visible (ou le sera après la prochaine synchronisation s’il vient d’un autre appareil).' };
    default: return { ...base, cle: 'prepare', etat: 'Inconnu', annulable: false, detail: '' };
  }
}

function motifRefus(why) {
  if (why === 'deja-efface') return 'Ce texte relève déjà d’un autre effacement : rien n’est envoyé pour celui-ci.';
  if (why === 'lot-different') return 'Le serveur détient un effacement différent sous le même identifiant : il n’a pas été adopté. Par prudence, le texte reste masqué ici.';
  if (why === 'refuse-par-les-regles') return 'Le serveur a refusé l’effacement. Le texte reste masqué ici ; vous pouvez abandonner cet effacement.';
  return 'L’effacement n’a pas été accepté. Le texte reste masqué ici ; vous pouvez abandonner cet effacement.';
}

/** Rang d'affichage : ce qui demande l'attention de l'apprenant d'abord. */
export const RANG = Object.freeze({ distant: 0, envoye: 1, prepare: 2, refuse: 3, attente: 4, definitif: 5, detruit: 6, annule: 7 });
