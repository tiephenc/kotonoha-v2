// KOTONOHA 2.0 · écran « Effacement définitif » (PH-2, lot L20-01 ; 04 §15.6 PX-07, ET-16, ET-16b ; 08 §19.16). Interface du module
// `infra/effacement.js` : déclencher l'effacement de textes enregistrés sur l'appareil, suivre l'état de chaque effacement (préparé E2,
// en attente E3 avec son terme, définitif E4, détruit, annulé, refusé), l'annuler tant que c'est permis, et CONFIRMER sur l'appareil auteur
// une annulation faite depuis un autre appareil. Règles :
//  - le terme vient de l'heure du serveur déjà portée par le lot (`decrire().terme`) ; l'horloge de l'appareil n'intervient jamais ;
//  - jamais le texte d'un effacement n'est affiché : seuls des comptes (« 2 textes ») ; un texte effacé reste masqué tant que
//    l'annulation n'est pas confirmée EXPLICITEMENT sur cet appareil (`confirmerAnnulationDistante`) ;
//  - aucune lecture de l'état par la vue du journal seule : `decrire`, `masque` et `annulationsDistantes` du module.
// L'interface ne modifie aucune garantie ANO-016 : elle n'appelle que l'API publique du module et `journal.erase`.
import { h, brut } from './dom.js';
import { note, caseACocher } from './composants-app.js';
import { EFF } from '../../infra/effacement-etat.js';

/** Choix « garder masqué pour l'instant » d'une annulation faite ailleurs : méta du magasin, survit au rechargement et ne démasque rien. */
const GARDE = 'eff:garde:';
import { presenter, RANG, nbTextes, DELAI_HEURES } from './effacement-etats.js';

const NB = ' ';
const MAX_LISTE = 200, EXTRAIT = 60;
const extrait = (t) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > EXTRAIT ? s.slice(0, EXTRAIT - 1) + '…' : s || '(texte vide)'; };

export function vueEffacement(ctx) {
  const j = ctx.journal, er = ctx.effacement, actif = !!ctx.effacementDistant;
  const racine = h('div', { class: 'vue vue-effacement' });
  const etat = h('p', { id: 'eff-etat', class: 'etat-compte', role: 'status' });
  const retour = h('div', { id: 'eff-retour', role: 'status', 'aria-live': 'polite' });
  const zoneChoix = h('div', {});
  const titreListe = h('h2', { id: 'eff-liste-titre', tabindex: '-1' }, 'Effacements en cours et passés');
  const liste = h('ul', { class: 'eff-liste', 'aria-labelledby': 'eff-liste-titre' });
  const choisis = new Set(), maintenus = new Set(), abandons = new Set(), reeff = new Map(); // `reeff` : effacements annulés en cours de relance (identifiant → vrai) ; // sélection ; demandes « gardées masquées » (persistées, GARDE) ; abandons en attente de confirmation
  let signature = '', enCours = 0, enMaj = null, rejouer = false, fini = false, enEnvoi = false, cible = null; // cible : { ids, depuis } ; `depuis` = identifiant de l'effacement annulé relancé, ou null

  const dire = (type, texte) => retour.replaceChildren(note({ type, texte }));
  const rafraichirTout = async () => { await maj(); ctx.effacementChange?.(); };
  const cycler = async () => { if (!ctx.effacementDistant) return; try { await ctx.cycle(); } catch { /* l'état du module le dit */ } await rafraichirTout(); };

  // ——— Dialogue de confirmation (double : case à cocher, puis bouton) ———
  const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': 'eff-dlg-titre', 'aria-describedby': 'eff-dlg-texte' });
  const oui = h('button', { type: 'button', class: 'btn btn-principal', id: 'eff-dlg-oui', disabled: true }, 'Effacer définitivement');
  const dlgCase = caseACocher('eff-dlg-case', `Je comprends que l’effacement sera définitif dans ${DELAI_HEURES}${NB}heures et ne pourra plus être annulé.`, false, (on) => { oui.disabled = !on; });
  const non = h('button', { type: 'button', class: 'btn btn-secondaire', id: 'eff-dlg-non' }, 'Garder les textes');
  const dlgTexte = h('div', { id: 'eff-dlg-texte' });
  dlg.append(h('h2', { id: 'eff-dlg-titre' }, 'Effacer définitivement ?'), dlgTexte, dlgCase.element, h('div', { class: 'barre-actions' }, oui, non));
  const reinit = () => { dlgCase.input.checked = false; oui.disabled = true; };
  const fermer = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { // le navigateur rend le focus au déclencheur ; si l'écran l'a reconstruit entre-temps, on le retrouve
    reinit();
    if (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected) document.getElementById('eff-lancer')?.focus();
  });
  non.addEventListener('click', fermer);
  oui.addEventListener('click', async () => {
    if (enEnvoi) return; // une seule soumission : le drapeau précède la fermeture, la sélection est copiée de façon synchrone
    const c = cible; if (!c || !c.ids.length || !dlgCase.input.checked) return;
    enEnvoi = true; oui.disabled = true;
    fermer(); retour.replaceChildren();
    if (c.depuis) { reeff.set(c.depuis, true); majSansAttendre(); } // état « en cours » visible tout de suite, jamais « effacé »
    try {
      const r = c.depuis ? await er.reeffacer(c.depuis) : await j.erase(c.ids); // à nouveau : les objets sont relus au moment de l'écriture
      if (!c.depuis) choisis.clear();
      const n = c.depuis ? (r.objs?.length ?? c.ids.length) : c.ids.length;
      ctx.confirmer(r, `Effacement préparé${NB}: ${nbTextes(n)} masqué${n > 1 ? 's' : ''}. Le délai de ${DELAI_HEURES}${NB}heures court à partir de l’acceptation par le serveur ; vous pouvez annuler jusque-là.`);
    } catch (e) {
      if (e.code === 'rien-a-effacer') dire('erreur', e.message); else { ctx.echec(e); if (c.depuis) dire('erreur', `L’effacement n’a pas pu être relancé${NB}: ${e.message}. Rien n’a été effacé ; vous pouvez réessayer.`); }
    } finally { if (c.depuis) reeff.delete(c.depuis); }
    try {
      await maj();
      titreListe.focus();
      await cycler();
    } finally { enEnvoi = false; }
  });

  function ouvrirDialogue(ids = [...choisis], depuis = null) {
    const n = ids.length;
    cible = { ids: [...ids], depuis };
    dlgTexte.replaceChildren(
      h('p', {}, depuis ? `Cet effacement avait été annulé. Vous allez effacer de nouveau ${nbTextes(n)}, avec un nouveau délai. Ils seront` : `Vous allez effacer ${nbTextes(n)}. Ils seront masqués tout de suite sur cet appareil, puis sur vos autres appareils dès qu’ils se connectent.`),
      h('ul', {}, h('li', {}, `Pendant ${DELAI_HEURES}${NB}heures, vous pouvez annuler : les textes redeviennent visibles.`),
        h('li', {}, 'Passé ce délai, mesuré sur l’heure du serveur, l’effacement est définitif : les copies sont détruites et KOTONOHA ne pourra pas les rétablir.'),
        h('li', {}, 'Vos exports et sauvegardes faits avant ce moment contiennent encore ces textes.')));
    reinit();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    non.focus();
  }

  // ——— Choix des textes à effacer ———
  function majChoix(snap) {
    if (!actif) {
      zoneChoix.replaceChildren(note({ type: 'info', texte: 'L’effacement définitif passe par votre compte : sans lui, rien ne peut être détruit de façon sûre sur vos appareils. Aucun compte n’est configuré ici ; vos textes restent donc intacts. Créez une sauvegarde dans les réglages si besoin.' }));
      return;
    }
    const objets = snap.objets.filter((o) => !snap.masques.has(o.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const id of [...choisis]) if (!objets.some((o) => o.id === id)) choisis.delete(id);
    if (!objets.length) { zoneChoix.replaceChildren(h('p', { id: 'eff-aucun' }, 'Aucun texte enregistré sur cet appareil.')); return; }
    const btn = h('button', { type: 'button', id: 'eff-lancer', class: 'btn btn-principal', disabled: !choisis.size, on: { click: () => ouvrirDialogue() } }, 'Effacer les textes choisis…');
    const fs = h('fieldset', { class: 'eff-choix' }, h('legend', {}, 'Textes enregistrés sur cet appareil'));
    objets.slice(0, MAX_LISTE).forEach((o, i) => {
      const c = caseACocher(`eff-c-${i}`, brut(extrait(o.content)), choisis.has(o.id), (on) => { if (on) choisis.add(o.id); else choisis.delete(o.id); btn.disabled = !choisis.size; });
      c.input.dataset.obj = o.id; fs.append(c.element);
    });
    zoneChoix.replaceChildren(...[fs, objets.length > MAX_LISTE ? h('p', { class: 'aide-courte' }, `Les ${MAX_LISTE} premiers textes sur ${objets.length} sont affichés.`) : null,
      h('p', { class: 'aide-courte' }, 'Choisissez ce que vous voulez effacer ; une confirmation vous sera demandée.'), h('div', { class: 'barre-actions' }, btn)].filter(Boolean));
  }

  // ——— Liste des effacements ———
  async function lister() {
    const recs = new Map((await j.store.listMeta(EFF)).map((r) => [r.id, r]));
    const pendants = new Map(j.pendingErases().map((p) => [p.id, p]));
    const distants = new Set((await er.annulationsDistantes()).map((d) => d.id));
    const gardes = new Set((await j.store.listMeta(GARDE)).filter((g) => g && g.on).map((g) => g.id));
    maintenus.clear(); for (const g of gardes) maintenus.add(g);
    const sortie = [];
    for (const id of [...new Set([...recs.keys(), ...pendants.keys()])].sort()) {
      const rec = recs.get(id) || null, desc = await er.decrire(id);
      if (desc.sub === 'inconnu') continue;
      const objs = rec?.objs ?? pendants.get(id)?.objs ?? [];
      const pres = presenter(desc, rec), reef = pres.cle === 'annule' ? await er.reeffacables(id) : [];
      sortie.push({ id, n: objs.length, distant: distants.has(id), origineLocale: desc.origineLocale, reef, enRelance: reeff.has(id), ...pres });
    }
    return sortie.sort((a, b) => RANG[a.cle] - RANG[b.cle] || (a.id < b.id ? -1 : 1));
  }

  const erreurAnnulation = (e) => {
    if (e.code === 'erase-definitif') return e.message;
    if (e.code === 'offline') return 'L’annulation n’a pas pu être envoyée : pas de connexion. Votre demande est conservée sur cet appareil et sera renvoyée automatiquement au retour de la connexion ; en attendant, le texte reste masqué.';
    if (e.code === 'auth') return 'L’annulation n’a pas pu être envoyée : votre session a expiré. Reconnectez-vous ; le texte reste masqué en attendant.';
    return `L’annulation a échoué${NB}: ${e.message}. Le texte reste masqué ; réessayez.`;
  };
  async function annuler(id) {
    retour.replaceChildren();
    try { await er.annuler(id); ctx.notifier('Effacement annulé. Les textes redeviennent visibles.', 'succes'); } catch (e) { dire('erreur', erreurAnnulation(e)); }
    await rafraichirTout();
    await cycler();
  }
  async function confirmer(id) {
    retour.replaceChildren();
    try {
      const r = await er.confirmerAnnulationDistante(id);
      if (r) await j.store.setMeta(GARDE + id, { id, on: false });
      if (r) ctx.notifier('Annulation confirmée : les textes redeviennent visibles et sont renvoyés à votre compte.', 'succes');
      else dire('info', 'Cette demande n’est plus en attente.');
    } catch (e) { dire('erreur', `La confirmation a échoué${NB}: ${e.message}. Le texte reste masqué ; réessayez.`); }
    await rafraichirTout();
    await cycler();
  }

  const majSansAttendre = () => { maj().catch(() => {}); };
  const reactiver = async (e, f) => { const b = e.currentTarget; b.disabled = true; try { await f(); } finally { if (b.isConnected) b.disabled = false; } }; // le bouton ne reste pas figé après un échec
  const garder = async (id, oui) => {
    try { await j.store.setMeta(GARDE + id, { id, on: oui }); } catch (e) { dire('erreur', `Le choix n’a pas pu être enregistré${NB}: ${e.message}. Le texte reste masqué.`); }
    await maj();
  };
  function demande(it, k) {
    const idT = `eff-d-${k}-t`;
    if (maintenus.has(it.id)) {
      return h('div', { class: 'eff-demande', role: 'group', 'aria-labelledby': idT },
        h('p', { id: idT }, h('strong', {}, 'Texte gardé masqué ici ; l’effacement n’aura pas lieu')),
        h('p', {}, 'L’effacement a été annulé sur votre compte. Ce texte n’est pas détruit ; il peut encore exister sur le serveur et sur vos autres appareils. Il reste masqué ici tant que vous n’avez pas confirmé. Si cette annulation n’est pas de vous, changez votre mot de passe. Pour effacer réellement : confirmez l’annulation, puis utilisez « Effacer à nouveau ».'),
        h('div', { class: 'barre-actions' },
          h('button', { type: 'button', class: 'btn btn-principal', 'data-act': 'confirmer', on: { click: (e) => reactiver(e, () => confirmer(it.id)) } }, 'Confirmer l’annulation'),
          h('button', { type: 'button', class: 'btn btn-secondaire', 'data-act': 'revoir', on: { click: () => garder(it.id, false) } }, 'Revoir la demande')));
    }
    return h('div', { class: 'eff-demande', role: 'group', 'aria-labelledby': idT },
      h('p', { id: idT }, h('strong', {}, 'Confirmation demandée sur cet appareil')),
      h('p', {}, it.origineLocale === false
        ? `Une annulation de cet effacement existe sur le serveur ; nous ne pouvons pas dire quel appareil l’a faite (${nbTextes(it.n)}). Ce texte reste masqué ici : il n’est ni réaffiché ni renvoyé tant que vous n’avez pas confirmé.`
        : `Un autre appareil a demandé l’annulation de cet effacement (${nbTextes(it.n)}). Ce texte reste masqué ici : il n’est ni réaffiché ni renvoyé tant que vous n’avez pas confirmé.`),
      h('p', { class: 'aide-courte' }, 'Confirmer rend le texte de nouveau visible et le renvoie à votre compte. Il n’y a pas de date limite de ce côté : le serveur a accepté l’annulation avant le terme, donc l’effacement n’aboutira pas même si vous confirmez plus tard. Si l’annulation avait été demandée après le terme, le serveur l’aurait refusée et l’effacement serait resté définitif.'),
      h('div', { class: 'barre-actions' },
        h('button', { type: 'button', class: 'btn btn-principal', 'data-act': 'confirmer', on: { click: (e) => reactiver(e, () => confirmer(it.id)) } }, 'Confirmer l’annulation'),
        h('button', { type: 'button', class: 'btn btn-secondaire', 'data-act': 'maintenir', on: { click: () => garder(it.id, true) } }, 'Garder masqué pour l’instant')));
  }

  /** « Effacer à nouveau » : seulement pour un effacement annulé dont des textes sont visibles ici ; la confirmation explicite suit. */
  function relance(it, idT) {
    if (it.enRelance) return h('p', { class: 'aide-courte', 'data-eff-relance': 'cours' }, 'Nouvel effacement en cours de préparation… Rien n’est confirmé tant que le serveur n’a pas répondu.');
    if (!it.reef.length) return null;
    return h('div', { class: 'barre-actions' }, h('button', { type: 'button', class: 'btn btn-secondaire', 'aria-describedby': idT, 'data-act': 'reeffacer', disabled: enEnvoi, on: { click: () => ouvrirDialogue(it.reef, it.id) } }, `Effacer à nouveau (${nbTextes(it.reef.length)})…`));
  }

  function carte(it, k) {
    const idT = `eff-i-${k}-t`;
    return h('li', { class: 'carte eff-item', dataset: { eff: it.id, etat: it.cle } },
      h('h3', { id: idT }, `Effacement n°${NB}${k + 1} · ${nbTextes(it.n)}`),
      h('p', { class: 'eff-etat' }, h('strong', {}, it.etat), it.etranger ? ' · reçu d’un autre appareil' : ''),
      h('p', {}, it.detail),
      it.annulationEnAttente ? h('p', { class: 'aide-courte' }, 'Votre demande d’annulation est enregistrée ; elle sera envoyée dès que la connexion le permet. Le texte reste masqué en attendant.') : null,
      it.cle === 'distant' ? demande(it, k) : null,
      it.cle === 'annule' ? relance(it, idT) : null,
      it.annulable ? (it.cle === 'refuse' && abandons.has(it.id)
        ? h('div', { class: 'eff-demande', role: 'group', 'aria-describedby': idT },
          h('p', {}, 'Abandonner cet effacement rend les textes concernés de nouveau visibles sur cet appareil. Confirmer ?'),
          h('div', { class: 'barre-actions' },
            h('button', { type: 'button', class: 'btn btn-secondaire', 'data-act': 'annuler', on: { click: (e) => reactiver(e, () => { abandons.delete(it.id); return annuler(it.id); }) } }, 'Oui, abandonner et rendre les textes visibles'),
            h('button', { type: 'button', class: 'btn btn-principal', 'data-act': 'garder-refuse', on: { click: () => { abandons.delete(it.id); maj(); } } }, 'Non, garder masqués')))
        : h('div', { class: 'barre-actions' }, h('button', { type: 'button', class: 'btn btn-secondaire', 'aria-describedby': idT, 'data-act': 'annuler', on: { click: (e) => (it.cle === 'refuse' ? (abandons.add(it.id), maj()) : reactiver(e, () => annuler(it.id))) } }, it.cle === 'refuse' ? 'Abandonner et rendre les textes visibles' : 'Annuler l’effacement'))) : null);
  }

  function texteEtat() {
    if (!actif) return 'Sur cet appareil uniquement : aucun effacement n’est envoyé.';
    if (er.state === 'hors-ligne') return 'Hors connexion : les envois et les annulations reprendront au retour du réseau. Les textes effacés restent masqués ; une annulation faite sur un autre appareil n’est pas encore connue ici.';
    if (er.state === 'session-expiree') return 'Session expirée : reconnectez-vous pour poursuivre les effacements. Les textes effacés restent masqués.';
    if (er.state === 'erreur') return `Erreur de synchronisation des effacements${NB}: ${er.lastError?.message ?? 'inconnue'}. Les textes effacés restent masqués ; réessayez depuis l’indicateur de synchronisation.`;
    if (er.state === 'suppression-compte') return 'Suppression du compte arrivée à son terme : plus aucun effacement n’est synchronisé.';
    return er.state === 'a-jour' ? 'Effacements à jour avec le serveur.' : 'Synchronisation des effacements en attente.';
  }

  // Rendu en deux temps : un instantané unique (objets AVANT masque, puis le reste), puis un rendu synchrone. Les appels concurrents sont
  // sérialisés (un seul rendu à la fois, rejoué si une demande est arrivée entre-temps) ; un rendu périmé n'écrit jamais dans le DOM.
  async function instantane() {
    const objets = actif ? await j.objects() : [], masques = actif ? await er.masque() : new Set();
    const distants = actif ? await er.annulationsDistantes() : [];
    for (const d of distants) for (const id of d.objs) masques.add(id); // défense en profondeur : une annulation non confirmée ne démasque rien
    return { objets, masques, items: await lister() };
  }
  async function rendre() {
    const mon = ++enCours;
    const snap = await instantane();
    if (mon !== enCours || fini) return;
    const choix = actif ? `${[...snap.masques].sort().join(',')}|${snap.objets.map((o) => o.id).sort().join(',')}` : 'sans-compte';
    const sig = JSON.stringify([snap.items, [...maintenus], [...abandons], texteEtat(), choix]);
    if (sig === signature) return;
    const actuel = document.activeElement, sousFocus = racine.contains(actuel) && actuel !== racine ? actuel : null;
    const cle = sousFocus?.closest?.('[data-eff]')?.dataset.eff, act = sousFocus?.dataset?.act, idFocus = sousFocus?.id;
    etat.replaceChildren(h('strong', {}, texteEtat()));
    majChoix(snap);
    liste.replaceChildren(...(snap.items.length ? snap.items.map(carte) : [h('li', { class: 'eff-vide' }, 'Aucun effacement pour le moment.')]));
    signature = sig; // posée seulement une fois le rendu achevé
    if (sousFocus && !sousFocus.isConnected && !dlg.open) { // le nœud a été remplacé : le focus ne se perd pas
      const retrouve = (cle && act && liste.querySelector(`[data-eff="${CSS.escape(cle)}"] [data-act="${act}"]`)) || (idFocus && document.getElementById(idFocus)) || titreListe;
      retrouve.focus?.();
    }
  }
  function maj() {
    if (enMaj) { rejouer = true; return enMaj; }
    enMaj = (async () => { try { do { rejouer = false; await rendre(); } while (rejouer && !fini); } finally { enMaj = null; } })();
    return enMaj;
  }

  racine.append(h('h1', { tabindex: '-1' }, 'Effacement définitif'),
    h('p', {}, `Effacer définitivement un texte le masque tout de suite sur cet appareil, puis sur vos autres appareils dès qu’ils se connectent. Pendant ${DELAI_HEURES}${NB}heures, vous pouvez annuler ; ensuite, l’effacement est définitif et irréversible.`),
    etat, retour,
    h('section', { class: 'carte', 'aria-labelledby': 'eff-choix-titre' }, h('h2', { id: 'eff-choix-titre' }, 'Effacer des textes'), zoneChoix),
    h('section', { 'aria-labelledby': 'eff-liste-titre', class: 'eff-section' }, titreListe, liste), dlg);
  maj().catch(() => { /* l'état du module le dit */ });
  const off = ctx.surEffacement?.(() => { maj().catch(() => {}); });
  return { titre: 'Effacement définitif', element: racine, maj, fin: () => { fini = true; off?.(); fermer(); } };
}
