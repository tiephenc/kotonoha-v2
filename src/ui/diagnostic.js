// KOTONOHA 2 · écran de diagnostic de PH-1 (10 §3.2 : « un écran de diagnostic de développement »).
// Affiche l'état réel de la base locale et exerce les commandes. Aucun innerHTML : texte seulement.
import { openLocal } from '../app/open.js';
import { backupJournal, verifyBackup, planRestore, applyRestore, BACKUP_MAX_BYTES } from '../infra/backup.js';
import { requestPersist, storageState } from '../infra/storage.js';
import { listV2Databases } from '../infra/store-idb.js';

const $ = (id) => document.getElementById(id);
const say = (t) => { $('message').textContent = t; };
const fmt = (n) => (n === null || n === undefined ? 'inconnu' : new Intl.NumberFormat('fr-FR').format(n));
let j, plan = null;

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function render() {
  const s = j.status, st = await storageState(), dbs = await listV2Databases();
  const rows = [
    ['Base', j.name], ['Appareil', j.dev], ['Opérations', fmt(j.ops.length)], ['En attente d’envoi', fmt(await j.pendingCount())],
    ['Empreinte de l’état', j.hash.slice(0, 16) + '…'], ['Neutralisées par une coupure', fmt(j.derived.neutralized.length)],
    ['Documents', fmt(Object.keys(j.view.docs).length)], ['Stockage persistant', st.persisted === null ? 'non disponible' : st.persisted ? 'accordé' : 'non accordé'],
    ['Espace utilisé', st.usage === null ? 'inconnu' : `${fmt(Math.round(st.usage / 1024))} Ko sur ${fmt(Math.round(st.quota / 1048576))} Mo${st.alert ? ' (alerte)' : ''}`],
    ['Bases KOTONOHA 2', dbs ? dbs.join(', ') : 'liste non disponible'],
  ];
  const dl = $('etat'); dl.replaceChildren();
  for (const [k, v] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); }
  const alert = $('alerte');
  const lines = [];
  if (s.buffer) lines.push(`Vos ${s.buffer} dernières actions ne sont pas encore enregistrées sur cet appareil (${s.lastError?.code || 'erreur'}). Exportez-les ou réessayez avant de commencer une nouvelle activité.`);
  if (s.readOnly) lines.push('Une version plus récente de KOTONOHA est ouverte dans un autre onglet. Cet onglet est en lecture seule : rechargez la page.');
  if (j.evicted) lines.push(`Le navigateur semble avoir effacé les données de cet appareil (${fmt(j.evicted.expected)} opérations attendues, ${fmt(j.evicted.found)} trouvées). Restaurez une sauvegarde.`);
  if (s.updateRequired) lines.push('Des données d’une version plus récente sont présentes : mettez KOTONOHA à jour.');
  alert.hidden = !lines.length; $('alerte-texte').textContent = lines.join(' ');
  $('b-tampon').hidden = !s.buffer; $('b-reessayer').hidden = !s.buffer; $('b-recharger').hidden = !s.readOnly;
  for (const id of ['b-reponse', 'b-pref', 'b-texte']) $(id).disabled = !j.canStartActivity();
}

const guard = (f) => async () => { try { await f(); } catch (e) { say(`Échec : ${e.message}`); } await render(); };

async function start() {
  // WebCrypto, Web Locks et le stockage persistant n'existent qu'en contexte sécurisé (HTTPS ou localhost).
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
    say('Cette page doit être ouverte dans un contexte sécurisé (HTTPS ou localhost). Rien n’a été lu ni écrit.');
    document.documentElement.dataset.pret = 'non-securise';
    return;
  }
  j = await openLocal();
  j.on(() => render());
  $('b-reponse').onclick = guard(async () => { const r = await j.record('answer', 'kc:essai:item', { ok: Math.random() < 0.7, ctx: 'pratique' }); say(r.saved ? 'Réponse d’essai enregistrée.' : 'Réponse gardée en attente : écriture refusée.'); });
  $('b-pref').onclick = guard(async () => { const v = j.view.prefs['essai.theme']?.v === 'nuit' ? 'jour' : 'nuit'; const r = await j.record('pref', 'essai.theme', { v }); say(r.saved ? `Préférence d’essai : ${v}.` : 'Préférence gardée en attente.'); });
  $('b-texte').onclick = guard(async () => { const r = await j.revise(j.newDocId(), `Texte d’essai du ${new Date().toLocaleString('fr-FR')}`); say(r.saved ? 'Texte d’essai enregistré hors du journal.' : 'Texte gardé en attente.'); });
  $('b-instantane').onclick = guard(async () => { await j.snapshot(); say('Instantané créé.'); });
  $('b-sauver').onclick = guard(async () => { const { text, backup } = await backupJournal(j, Date.now()); download(`kotonoha2-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, text); say(`Sauvegarde vérifiée : ${backup.parts.ops.count} opérations, ${backup.parts.objs.count} textes.`); });
  $('b-tampon').onclick = guard(async () => { download('kotonoha2-actions-en-attente.json', j.exportBuffer()); j.bufferExported(); say('Actions en attente exportées.'); });
  $('b-reessayer').onclick = guard(async () => { say((await j.retry()) ? 'Actions enregistrées.' : 'Écriture toujours refusée.'); });
  $('b-recharger').onclick = () => location.reload();
  $('b-persist').onclick = guard(async () => { const r = await requestPersist(); say(r === null ? 'Non disponible dans ce navigateur.' : r ? 'Stockage persistant accordé.' : 'Stockage persistant refusé par le navigateur.'); });
  $('f-restaurer').onchange = guard(async () => {
    const f = $('f-restaurer').files[0]; $('f-restaurer').value = ''; if (!f) return;
    if (f.size > BACKUP_MAX_BYTES) { say(`Sauvegarde refusée : fichier de plus de ${BACKUP_MAX_BYTES / 1e6} Mo, non lu. Rien n’a été modifié.`); return; }
    const v = await verifyBackup(await f.text());
    if (!v.ok) { say(`Sauvegarde refusée : ${v.errors.join(' ; ')}. Rien n’a été modifié.`); return; }
    plan = await planRestore(j, v.backup);
    if (!plan.ok) { say(plan.message); plan = null; return; }
    $('apercu-texte').textContent = `${plan.add.length} opérations à ajouter, ${plan.identical} déjà présentes, ${plan.objs.length} textes à ajouter, ${plan.objsRefused.length} textes effacés non réintroduits, ${plan.neutralized.length} opérations resteront neutralisées par une coupure. Rien ne sera retiré ; une copie de l’état actuel est faite avant.`;
    $('apercu').hidden = false; $('b-confirmer').focus();
  });
  $('b-confirmer').onclick = guard(async () => { if (!plan) return; const r = await applyRestore(j, plan, Date.now()); plan = null; $('apercu').hidden = true; say(r.ok ? `Restauration faite : ${r.added.length} opérations ajoutées.` : r.message); });
  $('b-annuler').onclick = () => { plan = null; $('apercu').hidden = true; say('Restauration annulée. Rien n’a été modifié.'); };
  await render();
  document.documentElement.dataset.pret = '1';
}

start().catch((e) => { say(`Ouverture impossible : ${e.message}`); document.documentElement.dataset.pret = 'erreur'; });
