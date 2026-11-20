// KOTONOHA 2.0 · adaptateur navigateur du catalogue V1 : lit les fichiers servis et délègue la vérification au domaine.
// À chaque ouverture, les 1 890 identifiants bloqués (registre 11 §9.6) sont chargés (empreinte vérifiée), réservés
// auprès du générateur d'identifiants, puis comparés au catalogue : toute collision fait échouer l'ouverture.
import { chargerCatalogue, appliquerCorrections, identifiantsDuCatalogue } from '../core/catalogue.js';
import { chargerBloques, reserverBloques, verifierCollisions } from '../core/bloques.js';

const lireTexte = (f) => async (adresse) => {
  const r = await f(adresse, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${adresse} indisponible (${r.status})`);
  return r.text();
};

/**
 * @param {string | { base?: string, manifesteBloques?: string, corrections?: string | null, fetch?: typeof fetch }} [o] adresse du catalogue, ou options
 * @param {typeof fetch} [f] (forme courte, compatible avec la première version)
 */
export async function chargerCatalogueServi(o = {}, f) {
  if (typeof o === 'string') o = { base: o, fetch: f };
  const base = o.base ?? new URL('../../donnees/catalogue-v1/', import.meta.url).href;
  const manifeste = o.manifesteBloques ?? new URL('../../donnees/identifiants-bloques-1890.tsv', import.meta.url).href;
  const adresseCorrections = o.corrections === undefined ? new URL('../../donnees/corrections/CORRECTIONS.json', import.meta.url).href : o.corrections;
  const lire = lireTexte(o.fetch ?? globalThis.fetch);
  const [verifie, texteBloques, texteCorrections] = await Promise.all([chargerCatalogue((nom) => lire(new URL(nom, base).href)), lire(manifeste), adresseCorrections ? lire(adresseCorrections) : null]);
  // Les empreintes ont été vérifiées sur les fichiers d'origine ; les corrections autorisées s'ajoutent ensuite (échec si orpheline ou « avant » différent).
  const catalogue = texteCorrections === null ? verifie : appliquerCorrections(verifie, JSON.parse(texteCorrections));
  const bloques = await chargerBloques(texteBloques);
  reserverBloques(bloques);
  const collisions = verifierCollisions(identifiantsDuCatalogue(catalogue), bloques);
  if (collisions.length) throw new Error(`catalogue : ${collisions.length} identifiant(s) bloqué(s) porté(s) par le catalogue V1 (${collisions.slice(0, 3).join(', ')})`);
  return catalogue;
}
