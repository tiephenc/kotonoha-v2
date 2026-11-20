// KOTONOHA 2.0 · coquille de l'application (PH-4) : ouverture du journal, catalogue, synchronisation (C-SYNC), navigation,
// routage par `location.hash`, focus et titre à chaque changement de vue, états de chargement et d'erreur.
// Couche interface : elle ne modifie jamais un état dérivé, elle passe par les commandes de la couche application.
import { openLocal } from '../../app/open.js';
import { createSync } from '../../infra/sync.js';
import { createErasure } from '../../infra/effacement.js';
import { createAccountDeletion } from '../../infra/suppression-compte.js';
import { chargerCatalogueServi } from '../../infra/catalogue-fetch.js';
import { requestPersist } from '../../infra/storage.js';
import { MANIFESTE } from '../../core/catalogue.js';
import { analyser, entreeCourante, SANS_CATALOGUE, hashPour } from './routeur.js';
import { codeSync, parametres, CLE_RECONCILIE } from './synchro.js';
import { lirePref } from '../../app/etude.js';
import { h, fr } from './dom.js';
import { note } from './composants-app.js';
import { chargerValidation } from './validation.js';
import { vueAccueil, vueParcours } from './vue-parcours.js';
import { vueLecon } from './vue-lecon.js';
import { vueReglages } from './vue-reglages.js';
import { vueRevision } from './vue-revision.js';
import { vuePositionnement } from './vue-positionnement.js';
import { vueCompte } from './vue-compte.js';
import { vueFocus } from './vue-focus.js';
import { vuePause } from './vue-pause.js';
import { vueEffacement } from './vue-effacement.js';
import { vueKana } from './vue-kana.js';
import { vueAnki } from './vue-anki.js';
import { sauvegardeComplete, telecharger, nomSauvegarde } from './sauvegarde.js';

const NB = ' ';
const BASE_DONNEES = new URL('../../../donnees/', import.meta.url).href;
const $ = (id) => document.getElementById(id);

/** Modules du niveau (tables V1), vérifiés par l'empreinte du manifeste du catalogue. */
async function chargerModules(f = globalThis.fetch) {
  const r = await f(new URL('catalogue-v1/v1-tables.json', BASE_DONNEES));
  if (!r.ok) throw new Error(`tables V1 : HTTP ${r.status}`);
  const texte = await r.text();
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== MANIFESTE['v1-tables.json']) throw new Error('tables V1 altérées');
  return JSON.parse(texte).MODULES;
}

/**
 * Démarre l'application.
 * @param {{remote?: any, account?: string|null, retryAuto?: boolean, itemsExercices?: ((lecon: any) => any[])|null, itemsRevision?: (() => any[])|null, itemsPositionnement?: (() => any[])|null, maintenant?: (() => number)|null}} [o]
 *   `remote` : port distant de synchronisation (aucun par défaut : « sur cet appareil uniquement »).
 *   `itemsExercices`, `itemsRevision`, `maintenant` : RÉSERVÉS AUX TESTS (jeu de démonstration, horloge) ; l'application réelle ne les fournit jamais.
 */
export async function demarrer({ remote = null, account = null, retryAuto = true, itemsExercices = null, itemsRevision = null, itemsPositionnement = null, maintenant = null } = {}) {
  const html = document.documentElement, vue = $('vue');
  const KDS = window.KDS;
  if (!KDS?.sync) throw new Error('design system absent');
  const ctx = { KDS, itemsExercices, itemsRevision, itemsPositionnement, remote, maintenant: maintenant ?? (() => Date.now()), cat: null, modules: null, journal: null, validation: { de: () => 'extrait sans contrôle de contenu' } };

  // ——— Contexte sécurisé (comme diagnostic.html) ———
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
    vue.replaceChildren(h('h1', { tabindex: '-1' }, 'Page à ouvrir dans un contexte sécurisé'),
      note({ type: 'erreur', texte: 'KOTONOHA doit être ouvert en HTTPS ou sur localhost : sans cela, le stockage et le chiffrement du navigateur manquent. Rien n’a été lu ni écrit.' }));
    document.title = 'Contexte non sécurisé · KOTONOHA'; html.dataset.pret = 'non-securise'; vue.removeAttribute('aria-busy');
    return;
  }

  // ——— Notifications ———
  ctx.notifier = (texte, type = 'succes') => KDS.toast(fr(texte), { type });
  ctx.signaler = (texte) => KDS.banniere($('bannieres'), { id: 'banniere-action', type: 'erreur', texte: fr(texte), fermable: true, retour: $('contenu') });
  ctx.confirmer = (r, texte) => {
    if (r.saved) ctx.notifier(texte, 'succes');
    else ctx.signaler('Cette action n’est pas encore enregistrée sur cet appareil. Elle est gardée en attente : exportez-la ou réessayez avant de continuer.');
  };
  ctx.echec = (e) => ctx.signaler(e.code === 'read-only' ? 'Cet onglet est en lecture seule : rechargez la page pour continuer.' : e.code === 'blocked' ? 'Des actions ne sont pas encore enregistrées. Exportez-les ou réessayez avant de continuer.' : `L’action a échoué${NB}: ${e.message}.`);

  // ——— Journal ———
  let journal;
  try { journal = await openLocal({ account, now: ctx.maintenant }); } catch (e) {
    vue.replaceChildren(h('h1', { tabindex: '-1' }, 'Ouverture impossible'),
      note({ type: 'erreur', texte: `Le stockage local du navigateur n’a pas pu être ouvert${NB}: ${e.message}. Rien n’a été modifié.` }),
      h('p', {}, h('button', { type: 'button', class: 'btn btn-principal', on: { click: () => location.reload() } }, 'Réessayer')));
    document.title = 'Ouverture impossible · KOTONOHA'; html.dataset.pret = 'erreur'; vue.removeAttribute('aria-busy');
    return;
  }
  ctx.journal = journal;
  // Stockage persistant (07 §17.8) : demandé dès qu'il existe une progression à protéger, sans bloquer le démarrage.
  if (journal.ops?.length) requestPersist().catch(() => {});
  ctx.prefs = () => journal.view.prefs;
  const appliquerPrefs = () => {
    html.dataset.furigana = lirePref(journal, 'affichage.furigana', true) ? 'visible' : 'masque';
    if (lirePref(journal, 'mouvement.reduit', false)) html.dataset.mouvement = 'reduit'; else delete html.dataset.mouvement;
  };
  appliquerPrefs();

  // ——— Alertes du journal (tampon, lecture seule, éviction, schéma) ———
  const alertesJournal = () => {
    const s = journal.status, zone = $('bannieres');
    const lignes = [];
    if (s.buffer) lignes.push(`L’enregistrement sur cet appareil a échoué (${s.lastError?.code || 'erreur'}) : ${s.buffer} action${s.buffer > 1 ? 's ne sont' : ' n’est'} pas encore enregistrée${s.buffer > 1 ? 's' : ''}. Exportez-${s.buffer > 1 ? 'les' : 'la'} maintenant ou réessayez avant de continuer.`);
    if (s.readOnly) lignes.push('Une version plus récente de KOTONOHA est ouverte dans un autre onglet. Cet onglet est en lecture seule : rechargez la page.');
    if (journal.evicted) lignes.push(`Le navigateur semble avoir effacé les données de cet appareil (${journal.evicted.expected} opérations attendues, ${journal.evicted.found} trouvées). Restaurez une sauvegarde dans les réglages.`);
    if (s.updateRequired) lignes.push('Des données d’une version plus récente sont présentes : mettez KOTONOHA à jour.');
    const ancienne = $('banniere-journal');
    if (!lignes.length) { ancienne?.remove(); return; }
    const actions = [];
    if (s.buffer) {
      actions.push({ libelle: 'Exporter maintenant', run: () => { const t = journal.exportBuffer(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'application/json' })); a.download = 'kotonoha2-actions-en-attente.json'; document.body.append(a); a.click(); a.remove(); journal.bufferExported(); alertesJournal(); } });
      actions.push({ libelle: 'Réessayer', run: async () => { await journal.retry(); alertesJournal(); } });
    }
    if (s.readOnly) actions.push({ libelle: 'Recharger la page', run: () => location.reload() });
    KDS.banniere(zone, { id: 'banniere-journal', type: 'erreur', texte: fr(lignes.join(' ')), actions });
  };
  alertesJournal();

  // ——— C-SYNC branché sur le module de synchronisation ———
  // Suppression du compte (08 §19.11) : si le port distant sait la lire, le gel arrête la synchronisation ET les effacements (ET-19).
  const suppression = remote && typeof remote.getDeletion === 'function' ? createAccountDeletion({ remote }) : null;
  const halt = suppression ? async () => { try { return await suppression.gele(); } catch { return false; } } : null;
  const sync = createSync({ journal, remote, halt });
  ctx.sync = sync;
  // ——— Effacement définitif (PH-2, L20-01) : le cycle du module suit chaque cycle de synchronisation ———
  // Le port distant d'un essai peut ne pas porter les méthodes d'effacement : sans elles, aucun effacement n'est envoyé ni proposé.
  ctx.effacementDistant = !!remote && typeof remote.listEraseLots === 'function';
  ctx.effacement = createErasure({ journal, remote: ctx.effacementDistant ? remote : null, halt });
  const ecouteursEff = new Set();
  ctx.surEffacement = (f) => { ecouteursEff.add(f); return () => ecouteursEff.delete(f); };
  async function majBanniereEffacement() {
    try {
      const att = await ctx.effacement.annulationsDistantes(), n = att.length;
      if (!n) { $('banniere-effacement')?.remove(); return; }
      if ($('banniere-effacement')) return; // une seule annonce, pas de répétition à chaque rafraîchissement
      KDS.banniere($('bannieres'), { id: 'banniere-effacement', type: 'avertissement', texte: fr(att.every((d) => d.origineLocale) ? 'Un autre appareil a demandé l’annulation d’un effacement. Les textes concernés restent masqués ici tant que vous ne l’avez pas confirmée.' : 'Une annulation d’un effacement existe sur le serveur ; nous ne pouvons pas dire quel appareil l’a faite. Les textes concernés restent masqués ici tant que vous ne l’avez pas confirmée.'), actions: [{ libelle: 'Examiner', run: () => { location.hash = hashPour('effacement'); } }] });
    } catch { /* la bannière est une aide : l'écran dédié dit l'état */ }
  }
  ctx.effacementChange = () => { majBanniereEffacement(); for (const f of ecouteursEff) f(); };
  majBanniereEffacement();
  const exporterTout = async () => {
    try { const { text } = await sauvegardeComplete(ctx); telecharger(nomSauvegarde(), text); ctx.notifier('Sauvegarde téléchargée.', 'succes'); } catch (e) { ctx.signaler(`La sauvegarde a échoué${NB}: ${e.message}.`); }
  };
  let minuteur = 0, horsLigneVu = false;
  const cycle = async () => {
    clearTimeout(minuteur);
    if (!remote) return;
    const r = await sync.cycle();
    if (ctx.effacementDistant) { try { await ctx.effacement.cycle(); } catch { /* l'état du module le dit ; la reprise ci-dessous reste programmée */ } ctx.effacementChange(); }
    if (retryAuto && r?.retryIn) minuteur = setTimeout(cycle, r.retryIn);
  };
  ctx.cycle = cycle;
  const indicateur = KDS.sync($('sync'), { panneau: $('sync-panneau'), region: $('sync-annonce'), etat: 'ET-20', actions: { exporter: exporterTout, reessayer: () => { cycle(); } } });
  async function majSync() {
    const etat = sync.state, code = codeSync(etat);
    const pending = (await journal.store.pendingIds()).length, reconcilieA = (await journal.store.getMeta(CLE_RECONCILIE)) || 0;
    const p = parametres(etat, { pending, reconcilieA, libelle: await sync.label(), erreur: sync.lastError });
    indicateur.changer(code, p);
    $('sync').dataset.etatSync = etat;
    const d = KDS.SYNC_ETATS[code];
    if (code === 'ET-25' || code === 'ET-26' || code === 'ET-19') KDS.banniere($('bannieres'), { id: 'banniere-sync', type: 'avertissement', texte: fr(d.detail(p)) });
    else if (code === 'ET-27') KDS.banniere($('bannieres'), { id: 'banniere-sync', type: 'erreur', texte: fr(d.detail(p)), fermable: true, retour: $('sync'), actions: [{ libelle: 'Exporter maintenant', run: exporterTout }, { libelle: 'Réessayer', run: () => { cycle(); } }] });
    else if (code === 'ET-23' && !horsLigneVu) { horsLigneVu = true; KDS.banniere($('bannieres'), { id: 'banniere-sync', type: 'info', texte: 'Hors ligne : vos actions sont enregistrées sur cet appareil.', fermable: true, retour: $('sync') }); }
    else $('banniere-sync')?.remove();
  }
  sync.on(() => { majSync(); });
  await majSync();
  let planifie = 0;
  journal.on((ev) => {
    if (ev.type === 'saved' && remote) { clearTimeout(planifie); planifie = setTimeout(cycle, 200); }
    if (ev.type === 'saved' || ev.type === 'change' || ev.type === 'write-failed' || ev.type === 'read-only') { appliquerPrefs(); alertesJournal(); courante?.maj?.(); majSync(); }
  });
  globalThis.addEventListener('online', () => { cycle(); });

  // ——— Navigation et vues ———
  // Différé (D-2) : le catalogue (≈ 4 Mo) n'est demandé que lorsqu'une vue qui en dépend est affichée, puis gardé en mémoire.
  const cat = { statut: 'inactif', erreur: null };
  let courante = null, premier = true;
  const nav = document.querySelectorAll('#nav-principale a');
  // Les révisions n'ont besoin du catalogue qu'en étude personnelle (leur banque est alors tirée des leçons des niveaux ouverts).
  const besoinCatalogue = (vue = analyser(location.hash).vue) => !SANS_CATALOGUE.includes(vue) || vue === 'anki' || (vue === 'revision' && lirePref(journal, 'etude.personnel', false) === true);
  async function chargerCatalogueEtModules() {
    cat.statut = 'chargement'; cat.erreur = null; rendre({ focus: false });
    try {
      ctx.cat = await chargerCatalogueServi();
      ctx.modules = await chargerModules();
      ctx.validation = await chargerValidation(BASE_DONNEES);
      cat.statut = 'pret';
    } catch (e) { cat.statut = 'erreur'; cat.erreur = e; }
    rendre({ focus: false });
  }
  function ecranChargement() {
    return { titre: 'Chargement', element: h('div', { class: 'vue vue-chargement' }, h('h1', { tabindex: '-1' }, 'Chargement'),
      h('p', { role: 'status', class: 'chargement' }, h('span', { class: 'chargement-trait', 'aria-hidden': 'true' }), 'Chargement du contenu des leçons…'),
      h('div', { class: 'squelette', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'))) };
  }
  function ecranErreur(e) {
    return { titre: 'Chargement impossible', element: h('div', { class: 'vue vue-erreur' }, h('h1', { tabindex: '-1' }, 'Contenu indisponible'),
      note({ type: 'erreur', texte: 'Le contenu des leçons n’a pas pu être chargé. Vérifiez votre connexion puis réessayez ; vos données personnelles ne sont pas touchées.' }),
      h('p', { class: 'aide-courte', id: 'erreur-detail' }, `Détail technique${NB}: ${e?.message ?? 'inconnu'}`),
      h('p', {}, h('button', { type: 'button', id: 'reessayer-catalogue', class: 'btn btn-principal', on: { click: () => chargerCatalogueEtModules() } }, 'Réessayer'))) };
  }
  const introuvable = () => ({ titre: 'Page introuvable', element: h('div', { class: 'vue' }, h('h1', { tabindex: '-1' }, 'Page introuvable'), h('p', {}, 'Cette page n’existe plus.'), h('p', {}, h('a', { class: 'btn btn-principal', href: '#/' }, 'Retour à l’accueil'))) });

  // Adresse à laquelle l'écran de pause ramène : gardée en mémoire et, pour survivre à un rechargement de l'écran de pause, en sessionStorage.
  const CLE_RETOUR = 'kotonoha2.pause.retour';
  let retourEtude = null;
  const retenirRetour = (adresse) => { retourEtude = adresse; try { sessionStorage.setItem(CLE_RETOUR, adresse); } catch { /* sans mémoire de session */ } };
  ctx.retourEtude = () => { if (retourEtude) return retourEtude; try { return sessionStorage.getItem(CLE_RETOUR) || null; } catch { return null; } };
  function rendre({ focus }) {
    const r = analyser(location.hash);
    // Le Focus ne se remonte pas quand seul le catalogue change d'état : le minuteur affiché (et les champs en cours de saisie) restent intacts.
    if (!focus && (r.vue === 'focus' || r.vue === 'pause' || r.vue === 'anki') && courante?.cle === r.vue) return;
    // Dernière vue d'étude : « Reprendre l'étude » de l'écran de pause y ramène exactement (vue ou leçon).
    if (r.vue !== 'focus' && r.vue !== 'pause' && r.vue !== 'introuvable') retenirRetour(location.hash || '#/');
    courante?.fin?.();
    let v;
    if (r.vue === 'introuvable') v = introuvable();
    else if (r.vue === 'reglages') v = vueReglages(ctx);
    else if (r.vue === 'revision' && (!besoinCatalogue(r.vue) || cat.statut === 'pret')) v = vueRevision(ctx);
    else if (r.vue === 'positionnement') v = vuePositionnement(ctx);
    else if (r.vue === 'compte') v = vueCompte(ctx);
    else if (r.vue === 'focus') v = vueFocus(ctx);
    else if (r.vue === 'pause') v = vuePause(ctx);
    else if (r.vue === 'effacement') v = vueEffacement(ctx);
    else if (r.vue === 'kana') v = vueKana(ctx, r);
    else if (r.vue === 'anki') v = vueAnki(ctx);
    else if (cat.statut === 'chargement' || cat.statut === 'inactif') v = ecranChargement();
    else if (cat.statut === 'erreur') v = ecranErreur(cat.erreur);
    else if (r.vue === 'revision') v = vueRevision(ctx);
    else v = r.vue === 'accueil' ? vueAccueil(ctx) : r.vue === 'parcours' ? vueParcours(ctx, r) : vueLecon(ctx, r);
    courante = v;
    vue.replaceChildren(v.element);
    vue.setAttribute('aria-busy', String(cat.statut !== 'pret' && cat.statut !== 'erreur' && besoinCatalogue(r.vue)));
    document.title = `${v.titre} · KOTONOHA`;
    const cur = entreeCourante(r);
    for (const a of nav) { if (a.dataset.vue === cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    if (focus) { window.scrollTo(0, 0); v.element.querySelector('h1')?.focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', () => { rendre({ focus: true }); if (cat.statut === 'inactif' && besoinCatalogue()) chargerCatalogueEtModules(); });
  document.querySelector('.lien-evitement').addEventListener('click', (e) => { e.preventDefault(); $('contenu').focus(); });
  html.dataset.pret = '0';
  rendre({ focus: false });
  premier = false;
  if (besoinCatalogue()) await chargerCatalogueEtModules();
  if (remote) cycle();
  html.dataset.pret = '1';
  return { ctx, sync, journal, cycle };
}
