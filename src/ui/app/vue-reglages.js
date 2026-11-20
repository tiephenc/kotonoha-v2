// KOTONOHA 2.0 · écran Réglages (PX-07, PX-08 ; ET-13 à ET-19, ET-28 pour ce qui existe dans PREM-1) : compte (non configuré),
// affichage, voix, mouvement, sauvegarde et restauration avec confirmation explicite.
import { h } from './dom.js';
import { interrupteur, bouton, note } from './composants-app.js';
import { reglerPref, lirePref } from '../../app/etude.js';
import { backupJournal, verifyBackup, planRestore, applyRestore, BACKUP_MAX_BYTES } from '../../infra/backup.js';
import { voixJaponaise, surVoix } from './voix.js';

const NB = ' ';
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);

function telecharger(nom, texte) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texte], { type: 'application/json' })); a.download = nom;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function vueReglages(ctx) {
  const j = ctx.journal, racine = h('div', { class: 'vue vue-reglages' });
  const bascule = (id, libelle, sujet, defaut, textes) => {
    const sw = interrupteur(id, libelle, lirePref(j, sujet, defaut), async (on) => {
      try { const r = await reglerPref(j, sujet, on); ctx.confirmer(r, on ? textes[0] : textes[1]); } catch (e) { ctx.echec(e); sw.regler(!on); }
    });
    return sw;
  };
  const swFur = bascule('reg-furigana', 'Afficher les furigana', 'affichage.furigana', true, ['Furigana affichés.', 'Furigana masqués.']);
  const swVoix = bascule('reg-voix', 'Synthèse vocale', 'voix.active', true, ['Synthèse vocale activée.', 'Synthèse vocale désactivée.']);
  const swPerso = bascule('reg-etude-perso', 'Étude personnelle', 'etude.personnel', false, ['Étude personnelle activée.', 'Étude personnelle désactivée.']);
  const swMvt = bascule('reg-mouvement', 'Réduire les animations', 'mouvement.reduit', false, ['Animations réduites.', 'Animations rétablies.']);
  const etatVoix = h('p', { class: 'aide-courte', id: 'reg-voix-etat', role: 'status' });
  const sauvegarde = h('p', { id: 'reg-sauv-etat', role: 'status', class: 'aide-courte' });
  const apercu = h('div', { class: 'carte apercu-restauration', hidden: true, role: 'group', 'aria-labelledby': 'reg-apercu-titre' });
  const fichier = h('input', { type: 'file', id: 'reg-fichier', accept: 'application/json,.json', hidden: true, tabindex: '-1' });
  let plan = null;
  const ferme = (focus) => { plan = null; apercu.hidden = true; apercu.replaceChildren(); focus?.focus(); };

  const btnSauver = bouton('Créer une sauvegarde', 'btn-principal', async () => {
    sauvegarde.textContent = '';
    try {
      const { text, backup } = await backupJournal(j, Date.now());
      telecharger(`kotonoha2-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, text);
      sauvegarde.textContent = `Sauvegarde vérifiée et téléchargée${NB}: ${fmt(backup.parts.ops.count)} opérations, ${fmt(backup.parts.objs.count)} textes.`;
      ctx.notifier('Sauvegarde téléchargée.', 'succes');
    } catch (e) { ctx.signaler(`La sauvegarde a échoué${NB}: ${e.message}. Rien n’a été modifié.`); }
  });
  const btnRestaurer = bouton('Restaurer depuis un fichier…', 'btn-secondaire', async () => { fichier.click(); });
  fichier.addEventListener('change', async () => {
    const f = fichier.files[0]; fichier.value = ''; if (!f) return;
    sauvegarde.textContent = '';
    if (f.size > BACKUP_MAX_BYTES) { ctx.signaler(`Sauvegarde refusée${NB}: fichier de plus de ${BACKUP_MAX_BYTES / 1e6} Mo, non lu. Rien n’a été modifié.`); return; } // taille contrôlée AVANT la lecture
    try {
      const v = await verifyBackup(await f.text());
      if (!v.ok) { ctx.signaler(`Sauvegarde refusée${NB}: ${v.errors.join(' ; ')}. Rien n’a été modifié.`); return; }
      plan = await planRestore(j, v.backup);
      if (!plan.ok) { ctx.signaler(plan.message); plan = null; return; }
      const titre = h('h3', { id: 'reg-apercu-titre', tabindex: '-1' }, 'Confirmer la restauration');
      apercu.replaceChildren(titre,
        h('p', {}, `${fmt(plan.add.length)} opérations à ajouter, ${fmt(plan.identical)} déjà présentes, ${fmt(plan.objs.length)} textes à ajouter, ${fmt(plan.objsRefused.length)} textes effacés non réintroduits.`),
        h('p', {}, 'Rien ne sera retiré. Une copie vérifiée de l’état actuel est faite avant : si elle échoue, la restauration n’a pas lieu.'),
        h('div', { class: 'barre-actions' },
          bouton('Ajouter ces données', 'btn-principal', async () => {
            if (!plan) return;
            try {
              const r = await applyRestore(j, plan, Date.now());
              ferme(btnRestaurer);
              if (r.ok) { sauvegarde.textContent = `Restauration faite${NB}: ${fmt(r.added.length)} opérations ajoutées.`; ctx.notifier('Restauration terminée.', 'succes'); } else ctx.signaler(r.message);
            } catch (e) { ctx.signaler(`La restauration a échoué${NB}: ${e.message}. Rien n’a été ajouté.`); }
          }),
          bouton('Annuler', 'btn-secondaire', async () => { ferme(btnRestaurer); sauvegarde.textContent = 'Restauration annulée. Rien n’a été modifié.'; })));
      apercu.hidden = false; titre.focus();
    } catch (e) { ctx.signaler(`Fichier illisible${NB}: ${e.message}. Rien n’a été modifié.`); }
  });
  apercu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !apercu.hidden) { ferme(btnRestaurer); sauvegarde.textContent = 'Restauration annulée. Rien n’a été modifié.'; } });

  const majVoix = () => {
    const v = voixJaponaise();
    etatVoix.textContent = !lirePref(j, 'voix.active', true) ? 'Synthèse vocale désactivée : aucune lecture ne sera proposée.' : v ? `Voix japonaise disponible (${v.name}). La lecture ne démarre jamais seule.` : 'Voix japonaise indisponible sur cet appareil : le dialogue reste lisible, sans lecture audio.';
  };
  majVoix();

  racine.append(h('h1', { tabindex: '-1' }, 'Réglages'),
    h('section', { class: 'carte', 'aria-labelledby': 'reg-compte' }, h('h2', { id: 'reg-compte' }, 'Compte'),
      h('p', { id: 'reg-compte-etat', class: 'etat-compte' }, h('strong', {}, 'Non configuré')),
      h('p', {}, 'La connexion à un compte n’est pas encore disponible dans cette version : votre travail est enregistré sur cet appareil seulement. Aucun mot de passe n’est demandé ni envoyé.'),
      note({ type: 'info', texte: 'Pensez à créer une sauvegarde ci-dessous pour ne pas dépendre d’un seul appareil.' }),
      h('p', {}, h('a', { class: 'lnk', href: '#/compte' }, 'Compte et second appareil'))),
    h('section', { class: 'carte', 'aria-labelledby': 'reg-aff' }, h('h2', { id: 'reg-aff' }, 'Affichage'),
      h('p', { class: 'aide-courte' }, 'Les lectures en petits kana s’affichent au-dessus des kanji.'), swFur.element,
      h('p', { class: 'aide-courte' }, 'Réduire les animations s’ajoute au réglage de votre système, qui est toujours respecté.'), swMvt.element),
    h('section', { class: 'carte', 'aria-labelledby': 'reg-etude' }, h('h2', { id: 'reg-etude' }, 'Étude'),
      h('p', { class: 'aide-courte' }, `Étude personnelle${NB}: proposer aussi les exercices de KOTONOHA V1 dont le niveau est seulement estimé. Ils sont signalés comme tels, ne sont jamais notés ni utilisés en examen blanc, et leur niveau n’est pas certifié.`), swPerso.element),
    h('section', { class: 'carte', 'aria-labelledby': 'reg-son' }, h('h2', { id: 'reg-son' }, 'Voix'), swVoix.element, etatVoix),
    h('section', { class: 'carte', 'aria-labelledby': 'reg-eff' }, h('h2', { id: 'reg-eff' }, 'Effacement définitif'),
      h('p', {}, 'Effacer des textes pour de bon : ils sont masqués tout de suite et détruits après un délai de 72 heures, pendant lequel vous pouvez annuler.'),
      h('p', {}, h('a', { class: 'lnk', href: '#/effacement' }, 'Gérer les effacements'))),
    h('section', { class: 'carte', 'aria-labelledby': 'reg-don' }, h('h2', { id: 'reg-don' }, 'Sauvegarde et restauration'),
      h('p', {}, 'La sauvegarde est un fichier que vous gardez. La restauration ajoute les données d’un fichier à celles de cet appareil, sans rien retirer.'),
      h('div', { class: 'barre-actions' }, btnSauver, btnRestaurer, fichier), sauvegarde, apercu));
  const fin = surVoix(majVoix);
  return { titre: 'Réglages', element: racine, maj: () => { swFur.regler(lirePref(j, 'affichage.furigana', true)); swVoix.regler(lirePref(j, 'voix.active', true)); swMvt.regler(lirePref(j, 'mouvement.reduit', false)); swPerso.regler(lirePref(j, 'etude.personnel', false)); majVoix(); }, fin };
}
