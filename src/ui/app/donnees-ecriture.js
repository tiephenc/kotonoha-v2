// KOTONOHA 2.0 · chargement des données de l'écriture des kana : kana.json, kana-traces.json (KanjiVG, CC BY-SA 3.0), groupes et items.
// Indépendant de la vue Kana (pas d'import circulaire) ; utilisé par la vue d'écriture et par la vue Révisions.
import { groupesParcours } from '../../core/niv0-lecon.js';
import { groupesEcriture, itemsEcriture } from '../../core/niv0-ecriture.js';

const BASE = new URL('../../../donnees/niv0/', import.meta.url).href;
let promesse = null;

/** Charge (une fois ; un échec n'est pas mémorisé) les données et en tire groupes et items d'écriture. */
export function chargerDonneesEcriture(f = globalThis.fetch) {
  promesse ??= (async () => {
    const lire = async (nom) => { const r = await f(new URL(nom, BASE)); if (!r.ok) throw new Error(`${nom} : HTTP ${r.status}`); return r.json(); };
    const [kana, traces] = await Promise.all([lire('kana.json'), lire('kana-traces.json')]);
    return { kana, traces, groupes: groupesEcriture(groupesParcours(kana), traces), items: itemsEcriture(kana, traces) };
  })().catch((e) => { promesse = null; throw e; });
  return promesse;
}
