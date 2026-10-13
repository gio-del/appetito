'use strict';
// UI strings in English (default) and Italian, chosen on the settings page (APPETITO_UI_LANG).
// t('key', a, b) fills {0}, {1}. The language comes with every API answer; until the first one the
// last language seen (localStorage) avoids a flash of the wrong one.
const I18N = {
  en: {
    'col.proposed': 'Proposals', 'col.backlog': 'Backlog', 'col.todo': 'To do', 'col.in-progress': 'In progress', 'col.blocked': 'Blocked', 'col.done': 'Done',
    'prio.urgent': 'Urgent', 'prio.high': 'High', 'prio.medium': 'Medium', 'prio.low': 'Low', 'prio.none': 'None',
    'reason.not-interested': 'not interested', 'reason.not-now': 'not now', 'reason.too-complex': 'too complex', 'reason.already-covered': 'already covered', 'reason.wrong': 'wrong',
    'app.title': 'appetito', 'search': 'Search…  /', 'search.aria': 'Search',
    'filter.prio': 'Priority: all', 'filter.label': 'Label: all', 'filter.entry': 'Proposed by: all', 'filter.clear': 'Clear the filter',
    'filter.stale': 'Stale backlog ({0})', 'filter.stale.title': 'Only Backlog issues left without a decision for too long',
    'new': '+ New', 'new.title': 'New issue (C)', 'logout': 'Sign out', 'settings': 'Settings', 'changes': 'Changes',
    'auto.title': 'Worker: status and manual start',
    'err.changed': 'The issue changed meanwhile: reloaded, try again.', 'err': 'Error: {0}',
    'empty': 'No issues', 'new.in': 'New in {0}',
    'time.now': 'now', 'time.min': '{0} min ago', 'time.h': '{0} h ago', 'time.d': '{0} d ago',
    'parent.open': 'Open the parent issue', 'blocked.by': '⛔ Blocked by ', 'blocked.open': 'Open the issue blocking it',
    'link.remove': 'Remove the link', 'issue.notfound': 'Issue "{0}" not found',
    'entry.system': 'system', 'entry.system.title': 'Proposed by the daily suggestions',
    'entry.system.warn': ['System proposal. ', 'Made by the daily run from the state of the server. Approved, it becomes work for the agent; rejected, the reason steers the next proposals.'],
    'entry.note': 'your note', 'entry.note.title': 'From one of your notes, rewritten by the second brain',
    'entry.note.warn': ['From one of your notes, rewritten by the second brain: ', 'check that it says what you meant. Approved, it becomes work for the agent.'],
    'entry.other': 'second brain', 'entry.other.title': 'From the second brain: the material may come from strangers',
    'entry.other.warn': ['From the second brain, out of material that may come from strangers (e.g. forwarded mail): ', 'read it carefully before approving.'],
    'stale.badge': 'idle for {0} days', 'stale.title': 'No decision for {0} days (threshold {1}, Settings page)',
    'reject.why': 'Reason to reject',
    'subs.closed': 'sub-issues closed', 'tasks.done': 'done', 'progress': '{0} of {1} {2}', 'comments': 'Comments',
    'auto.working': 'working', 'auto.deploying': 'deploying', 'auto.idle': 'waiting', 'auto.empty': 'nothing queued', 'auto.paused': 'paused',
    'auto.quota': 'limit', 'auto.budget': 'budget', 'auto.error': 'error', 'auto.requested': 'start requested', 'auto.default': 'worker',
    'move.blocked': 'Blocked by what? (user, hardware, …)',
    'd.dirty': '· changes not committed yet', 'd.edit': 'Click to edit', 'd.status': 'Status', 'd.prio': 'Priority', 'd.labels': 'Labels', 'd.label.add': '+ label',
    'd.blockedby': 'Blocked by', 'd.parent': 'Parent', 'd.parent.none': 'None', 'd.parent.haskids': 'None (it has sub-issues)', 'd.related': 'Related', 'd.related.add': '+ related',
    'd.blocks': 'Blocks', 'd.dupof': 'Duplicate of', 'd.dups': 'Duplicates',
    'd.markdup': 'Mark as duplicate of…', 'd.markdup.ask': 'Duplicate of which issue? (number, e.g. 032). Copy over what matters first: this one will be closed.', 'd.markdup.confirm': 'Close #{0} as a duplicate of #{1}?',
    'd.auto': 'Worker', 'd.auto.go': 'Work on this issue', 'd.auto.go.title': 'The worker starts on this issue within a minute',
    'd.auto.why.pending': 'a request is already waiting', 'd.auto.why.working': 'already working on #{0}', 'd.auto.why.quota': 'usage limit reached',
    'd.auto.started': 'Start requested on #{0}: it begins within a minute',
    'd.source': 'Proposed by', 'd.origin': 'Origin', 'd.origin.open': 'Open in Obsidian', 'd.rejected': 'Rejected because', 'd.opened': 'Opened', 'd.closed': 'Closed', 'd.approved': 'Approved',
    'd.desc': 'Description', 'd.desc.none': 'No description.', 'd.desc.edit': 'Edit', 'save': 'Save', 'cancel': 'Cancel',
    'd.subs': 'Sub-issues ({0}/{1})', 'd.subs.add': '+ Sub-issue', 'd.subs.none': 'No sub-issues.',
    'd.comments': 'Comments ({0})', 'd.comment.ph': 'Write a comment… (Ctrl+Enter to send)', 'd.comment': 'Comment', 'd.comment.added': 'Comment added',
    'd.history': 'History (git)', 'd.history.none': 'No commits yet.', 'd.branches': 'Agent branches',
    'p.note': 'Note or reason (optional)', 'p.why': 'If you reject it, why?', 'p.possibledup': 'Possible duplicate of ',
    'p.rejectdup': 'Reject as duplicate', 'p.rejectdup.title': 'Rejected as already covered by #{0}', 'p.reject': 'Reject',
    'p.approve.backlog': 'Approve to backlog', 'p.approve.backlog.title': 'Becomes a Backlog issue: nobody works on it until you move it',
    'p.approve': 'Approve', 'p.approve.title': 'Becomes a To do issue: the worker develops it', 'p.confirm': 'Confirm on the next page',
    's.title': 'Idle in Backlog for {0} days. ', 's.text': 'Nobody works on it while it stays here: decide whether to do it, keep it or reject it.',
    's.keep': 'Keep in backlog', 's.keep.title': 'Stays in Backlog: the day count restarts today', 's.todo': 'Move to To do', 's.todo.title': 'Becomes To do: the worker develops it',
    'shape.title': 'Shape to fix. ', 'shape.text': 'Shaped like this, the worker can\'t see this issue\'s work:',
    'n.title': 'Title', 'n.labels': 'labels, comma-separated', 'n.desc': 'Description (markdown). E.g.:\n\n## To do\n- [ ] first step', 'n.create': 'Create issue',
    'n.created': 'Created #{0}', 'n.sub': 'Sub-issue of #{0} {1}', 'n.new': 'New issue', 'n.newsub': 'New sub-issue',
    'waiting.banner': '{0} change(s) wait for your tap', 'close': 'Close',
    'branch.merged': 'merged', 'branch.rolled-back': 'rolled back', 'branch.rejected': 'rejected', 'branch.rejected-by-owner': 'rejected by you', 'branch.conflict': 'conflict',
    'branch.waiting-guard': 'needs your tap (protections)', 'branch.waiting-approval': 'needs your tap', 'branch.pending': 'deploying',
  },
  it: {
    'col.proposed': 'Proposte', 'col.backlog': 'Backlog', 'col.todo': 'Da fare', 'col.in-progress': 'In corso', 'col.blocked': 'Bloccate', 'col.done': 'Fatte',
    'prio.urgent': 'Urgente', 'prio.high': 'Alta', 'prio.medium': 'Media', 'prio.low': 'Bassa', 'prio.none': 'Nessuna',
    'reason.not-interested': 'non mi interessa', 'reason.not-now': 'non ora', 'reason.too-complex': 'troppo complessa', 'reason.already-covered': 'già coperta', 'reason.wrong': 'sbagliata',
    'app.title': 'appetito', 'search': 'Cerca…  /', 'search.aria': 'Cerca',
    'filter.prio': 'Priorità: tutte', 'filter.label': 'Etichetta: tutte', 'filter.entry': 'Proposta da: tutte', 'filter.clear': 'Togli il filtro',
    'filter.stale': 'Backlog ferme ({0})', 'filter.stale.title': 'Solo le issue ferme in Backlog da troppo tempo',
    'new': '+ Nuova', 'new.title': 'Nuova issue (C)', 'logout': 'Esci', 'settings': 'Impostazioni', 'changes': 'Modifiche',
    'auto.title': 'Worker: stato e avvio manuale',
    'err.changed': 'La issue è cambiata nel frattempo: ricaricata, riprova.', 'err': 'Errore: {0}',
    'empty': 'Nessuna issue', 'new.in': 'Nuova in {0}',
    'time.now': 'ora', 'time.min': '{0} min fa', 'time.h': '{0} h fa', 'time.d': '{0} g fa',
    'parent.open': 'Apri la issue padre', 'blocked.by': '⛔ Bloccata da ', 'blocked.open': 'Apri la issue che la blocca',
    'link.remove': 'Rimuovi il collegamento', 'issue.notfound': 'Issue «{0}» non trovata',
    'entry.system': 'sistema', 'entry.system.title': 'Proposta dal giro giornaliero',
    'entry.system.warn': ['Proposta del sistema. ', 'Generata dal giro giornaliero a partire dallo stato del server. Approvata, diventa lavoro per l\'agente; scartata, il motivo guida le prossime proposte.'],
    'entry.note': 'tua nota', 'entry.note.title': 'Da una tua nota, riscritta dal second brain',
    'entry.note.warn': ['Nata da una tua nota, riscritta dal second brain: ', 'controlla che dica quello che volevi. Approvata, diventa lavoro per l\'agente.'],
    'entry.other': 'second brain', 'entry.other.title': 'Dal second brain: il materiale può venire da estranei',
    'entry.other.warn': ['Dal second brain, da materiale che può venire da estranei (es. mail inoltrate): ', 'leggila con attenzione prima di approvare.'],
    'stale.badge': 'ferma da {0} giorni', 'stale.title': 'Nessuna decisione da {0} giorni (soglia {1}, pagina Impostazioni)',
    'reject.why': 'Motivo per scartare',
    'subs.closed': 'sotto-issue chiuse', 'tasks.done': 'completati', 'progress': '{0} di {1} {2}', 'comments': 'Commenti',
    'auto.working': 'al lavoro', 'auto.deploying': 'deploy', 'auto.idle': 'in attesa', 'auto.empty': 'niente in coda', 'auto.paused': 'in pausa',
    'auto.quota': 'limite', 'auto.budget': 'budget', 'auto.error': 'errore', 'auto.requested': 'avvio richiesto', 'auto.default': 'worker',
    'move.blocked': 'Bloccata da cosa? (user, hardware, …)',
    'd.dirty': '· modifiche non ancora committate', 'd.edit': 'Clicca per modificare', 'd.status': 'Stato', 'd.prio': 'Priorità', 'd.labels': 'Etichette', 'd.label.add': '+ etichetta',
    'd.blockedby': 'Bloccata da', 'd.parent': 'Padre', 'd.parent.none': 'Nessuno', 'd.parent.haskids': 'Nessuno (ha sotto-issue)', 'd.related': 'Correlate', 'd.related.add': '+ correlata',
    'd.blocks': 'Blocca', 'd.dupof': 'Duplicato di', 'd.dups': 'Duplicati',
    'd.markdup': 'Segna come duplicato di…', 'd.markdup.ask': 'Duplicato di quale issue? (numero, es. 032). Prima copia lì quello che serve: questa verrà chiusa.', 'd.markdup.confirm': 'Chiudere #{0} come duplicato di #{1}?',
    'd.auto': 'Worker', 'd.auto.go': 'Lavora su questa issue', 'd.auto.go.title': 'Il worker parte su questa issue entro un minuto',
    'd.auto.why.pending': 'richiesta già in attesa', 'd.auto.why.working': 'già al lavoro su #{0}', 'd.auto.why.quota': 'limite d\'uso raggiunto',
    'd.auto.started': 'Avvio richiesto su #{0}: parte entro un minuto',
    'd.source': 'Proposta da', 'd.origin': 'Origine', 'd.origin.open': 'Apri in Obsidian', 'd.rejected': 'Scartata perché', 'd.opened': 'Aperta', 'd.closed': 'Chiusa', 'd.approved': 'Approvata',
    'd.desc': 'Descrizione', 'd.desc.none': 'Nessuna descrizione.', 'd.desc.edit': 'Modifica', 'save': 'Salva', 'cancel': 'Annulla',
    'd.subs': 'Sotto-issue ({0}/{1})', 'd.subs.add': '+ Sotto-issue', 'd.subs.none': 'Nessuna sotto-issue.',
    'd.comments': 'Commenti ({0})', 'd.comment.ph': 'Scrivi un commento… (Ctrl+Invio per inviare)', 'd.comment': 'Commenta', 'd.comment.added': 'Commento aggiunto',
    'd.history': 'Cronologia (git)', 'd.history.none': 'Nessun commit ancora.', 'd.branches': 'Branch dell\'agente',
    'p.note': 'Nota o motivo (facoltativo)', 'p.why': 'Se scarti, perché?', 'p.possibledup': 'Possibile duplicato di ',
    'p.rejectdup': 'Scarta come duplicato', 'p.rejectdup.title': 'Scartata come già coperta da #{0}', 'p.reject': 'Scarta',
    'p.approve.backlog': 'Approva in backlog', 'p.approve.backlog.title': 'Diventa una issue in Backlog: nessuno ci lavora finché non la sposti',
    'p.approve': 'Approva', 'p.approve.title': 'Diventa una issue Da fare: il worker la sviluppa', 'p.confirm': 'Conferma nella pagina successiva',
    's.title': 'Ferma in Backlog da {0} giorni. ', 's.text': 'Nessuno ci lavora finché resta qui: decidi se farla, tenerla ancora o scartarla.',
    's.keep': 'Tieni in backlog', 's.keep.title': 'Resta in Backlog: il conteggio dei giorni riparte da oggi', 's.todo': 'Sposta in To do', 's.todo.title': 'Diventa Da fare: il worker la sviluppa',
    'shape.title': 'Forma da correggere. ', 'shape.text': 'Così il worker non vede il lavoro di questa issue:',
    'n.title': 'Titolo', 'n.labels': 'etichette, separate da virgola', 'n.desc': 'Descrizione (markdown). Es.:\n\n## To do\n- [ ] primo passo', 'n.create': 'Crea issue',
    'n.created': 'Creata #{0}', 'n.sub': 'Sotto-issue di #{0} {1}', 'n.new': 'Nuova issue', 'n.newsub': 'Nuova sotto-issue',
    'waiting.banner': '{0} modifiche aspettano il tuo tocco', 'close': 'Chiudi',
    'branch.merged': 'unito', 'branch.rolled-back': 'annullato', 'branch.rejected': 'rifiutato', 'branch.rejected-by-owner': 'rifiutato da te', 'branch.conflict': 'conflitto',
    'branch.waiting-guard': 'aspetta il tuo tocco (protezioni)', 'branch.waiting-approval': 'aspetta il tuo tocco', 'branch.pending': 'in deploy',
  },
};
let LANG = (() => { try { return localStorage.getItem('appetito.lang') || 'en'; } catch { return 'en'; } })();
if (!I18N[LANG]) LANG = 'en';
function setLang(l) {
  if (!I18N[l] || l === LANG) { document.documentElement.lang = LANG; return false; }
  LANG = l;
  try { localStorage.setItem('appetito.lang', l); } catch {}
  document.documentElement.lang = l;
  return true;
}
function t(key, ...args) {
  const v = (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  return typeof v === 'string' ? v.replace(/\{(\d)\}/g, (_, i) => String(args[+i] ?? '')) : v;
}
const LOCALE = () => (LANG === 'it' ? 'it-IT' : 'en-GB');
document.documentElement.lang = LANG;

// Settings page and changes page.
Object.assign(I18N.en, {
  'st.title': 'Settings', 'st.intro': 'Pace and limits of the server\'s automatic jobs. Changes apply from the next run, no restarts. Addresses, passwords and permissions can\'t be changed from here.',
  'st.save': 'Save', 'st.saved': 'Saved', 'st.yes': 'yes', 'st.no': 'no', 'st.range': 'from {0} to {1}, ', 'st.default': 'default {0}', 'st.inuse': ' (in use)', 'st.back': 'Board',
  'st.group.tracker': 'Tracker', 'st.group.auto': 'Worker', 'st.group.suggest': 'Daily proposals', 'st.group.brain': 'Second brain',
  'st.gate': 'Merge gate', 'st.gate.auto': 'auto: a change that passes the checks is deployed by itself (changes to protections always wait for you).',
  'st.gate.approve': 'approve: every change waits for your tap.', 'st.gate.how': 'Set APPETITO_MERGE_GATE in /etc/appetito/appetito.env on the server (root only, on purpose).',
  'ch.title': 'Changes', 'ch.intro': 'Branches the agent pushed that wait for you, and the latest deploys.', 'ch.none': 'Nothing waits for you.',
  'ch.waiting': 'Waiting for your tap', 'ch.recent': 'Latest deploys', 'ch.approve': 'Deploy…', 'ch.reject': 'Reject', 'ch.note': 'Why (optional, the agent reads it)',
  'ch.guard': 'Changes the protections: {0}', 'ch.gate': 'Merge gate set to approve', 'ch.issue': 'issue #{0}', 'ch.rejected': 'Rejected', 'ch.diff': 'Diff',
});
Object.assign(I18N.it, {
  'st.title': 'Impostazioni', 'st.intro': 'Ritmo e limiti dei lavori automatici del server. Le modifiche valgono dal prossimo giro, senza riavvii. Indirizzi, password e permessi non si cambiano da qui.',
  'st.save': 'Salva', 'st.saved': 'Salvato', 'st.yes': 'sì', 'st.no': 'no', 'st.range': 'da {0} a {1}, ', 'st.default': 'predefinito {0}', 'st.inuse': ' (in uso)', 'st.back': 'Board',
  'st.group.tracker': 'Tracker', 'st.group.auto': 'Worker', 'st.group.suggest': 'Proposte giornaliere', 'st.group.brain': 'Second brain',
  'st.gate': 'Merge gate', 'st.gate.auto': 'auto: una modifica che passa i controlli viene applicata da sola (le modifiche alle protezioni aspettano sempre te).',
  'st.gate.approve': 'approve: ogni modifica aspetta il tuo tocco.', 'st.gate.how': 'Si cambia con APPETITO_MERGE_GATE in /etc/appetito/appetito.env sul server (solo root, apposta).',
  'ch.title': 'Modifiche', 'ch.intro': 'I branch dell\'agente che aspettano te, e gli ultimi deploy.', 'ch.none': 'Niente aspetta te.',
  'ch.waiting': 'Aspettano il tuo tocco', 'ch.recent': 'Ultimi deploy', 'ch.approve': 'Applica…', 'ch.reject': 'Rifiuta', 'ch.note': 'Perché (facoltativo, l\'agente lo legge)',
  'ch.guard': 'Cambia le protezioni: {0}', 'ch.gate': 'Merge gate su approve', 'ch.issue': 'issue #{0}', 'ch.rejected': 'Rifiutata', 'ch.diff': 'Diff',
});
