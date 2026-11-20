// KOTONOHA 2.0 · alias V1 typés et identifiants du catalogue (08 §5.2 à §5.4 ; D-64). Domaine pur.
// Un alias rattache un identifiant V1, tel qu'il est lu, à une cible V2, sans jamais le renommer ;
// il n'est jamais supprimé. Ce module ne lit aucune donnée V1 : la lecture relève de MOD-20 (migration).

/** Identifiant du catalogue : `kc:<type>:<clé>`, attribué à l'édition, jamais recyclé (08 §5.3). */
export const isKc = (id) => typeof id === 'string' && /^kc:[a-z][a-z0-9-]{1,23}:[A-Za-z0-9._~-]{1,120}$/.test(id);

/**
 * Familles d'identifiants V1 connues (08 §5.2). `g<unité>-<i>` (avec tiret) et `g<hex>` (GUID codé
 * en hexadécimal, sans tiret) partagent le préfixe `g` : seul le typage les distingue sûrement.
 * @param {string} id @returns {'carte-unite'|'ankid'|'jmdict'|'kanji-importe'|'mes-mots'|null}
 */
export function familyOf(id) {
  if (typeof id !== 'string' || !id || /^(kc|kf|ku|op|dev|lot|anki|v1):/.test(id)) return null;
  if (/^[vg]\d+-\d+$/.test(id)) return 'carte-unite';
  if (/^k[^:]*$/.test(id)) return 'carte-unite';            // famille `k…` du parcours (forme non détaillée en 08)
  if (/^@\d+$/.test(id)) return 'ankid';
  if (/^m:.+/.test(id)) return 'mes-mots';
  if (/^g(?:[0-9a-f]{2})+$/.test(id)) return 'kanji-importe';
  if (/^j[^:]*$/.test(id)) return 'jmdict';
  return null;
}

export const FAMILIES = Object.freeze(['carte-unite', 'ankid', 'jmdict', 'kanji-importe', 'mes-mots']);

/**
 * Entrée d'alias (08 §5.4). `idOrigine` garde l'identifiant d'avant `migrate`, `mig3` ou `mig4` ;
 * les deux valeurs sont conservées sans choisir. `cible` null : « non rattaché » (T-MIG-03).
 * @param {{famille: string, idLu: string, idOrigine?: string|null, cible: string|null, appareil: string, source: string, regle: string}} a
 */
export function makeAlias({ famille, idLu, idOrigine = null, cible, appareil, source, regle }) {
  const e = [];
  if (!FAMILIES.includes(famille)) e.push('famille inconnue');
  if (familyOf(idLu) !== famille) e.push(`identifiant « ${idLu} » hors de la famille ${famille}`);
  if (idOrigine !== null && typeof idOrigine !== 'string') e.push('idOrigine invalide');
  if (cible !== null && !(isKc(cible) || /^kf:/.test(cible) || /^ku:/.test(cible) || /^anki:/.test(cible))) e.push('cible invalide');
  if (!/^dev:/.test(appareil || '')) e.push('appareil invalide');
  if (!source || !regle) e.push('traçabilité incomplète');
  if (e.length) throw new Error(`alias refusé : ${e.join(' ; ')}`);
  // Clé typée : famille, identifiant lu et appareil source (chaque appareil a sa copie V1, 08 §12.4).
  return { k: `v1:${famille}:${idLu}@${appareil}`, famille, idLu, idOrigine, cible, statut: cible ? 'rattache' : 'non-rattache', appareil, source, regle };
}
