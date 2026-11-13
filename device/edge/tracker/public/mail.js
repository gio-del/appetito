// "Mail" (issue 015): set up the Apps Script bridge (copy the script, save its URL), its state, the +edge address and
// a test mail. Same session as the board; the server's side is mail-fetch (cron, every 2 minutes).
'use strict';
const $ = id => document.getElementById(id);
const msg = $('ml-msg');
let data = null, timer = null, busy = false;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function hm(t) { if (!t) return ''; const d = new Date(t * 1000); return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }

async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  if (r.status === 401) { location.href = '/?next=mail.html'; throw new Error('accesso'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}

function state(text, cls) {
  const s = $('ml-state'); s.hidden = false; s.replaceChildren(el('div', cls, text));
}

function render() {
  const d = data, st = d.status || {};
  if (!d.enabled) { state('Il collegamento mail non è attivo sul server.', 'muted'); return; }
  const linked = !!d.url, fresh = st.at && st.at >= d.urlAt;
  $('ml-setup').hidden = !d.script || (linked && !d.update);
  for (const [id, show] of [['ml-new-h', !d.update], ['ml-new', !d.update], ['ml-up-h', d.update], ['ml-up', d.update]]) $(id).hidden = !show;
  $('ml-copy-h').textContent = d.update ? '1. Copia lo script nuovo' : '1. Copia lo script';
  if (d.script && $('ml-script').value !== d.script) $('ml-script').value = d.script;
  $('ml-form').hidden = false;
  $('ml-url-h').textContent = linked ? 'Indirizzo dello script' : '3. Indirizzo dello script';
  if (document.activeElement !== $('ml-url')) $('ml-url').value = d.url;
  $('ml-unlink').hidden = !linked;
  if (!linked) state(d.script ? 'Da collegare: segui i passi qui sotto.' : "Da collegare, ma lo script è già stato consegnato: chiedi all'AI un segreto nuovo (sudo mail-setup --reset).", 'pa-new');
  else if (!fresh) state('Salvato: il server lo prova entro 2 minuti.', 'muted');
  else if (d.update && fresh && st.ok) state('Collegato, ma c\'è uno script più nuovo da pubblicare: segui i passi qui sotto. Finché non lo fai la posta funziona come prima.', 'pa-new');
  else if (!st.ok) state(`Problema (${hm(st.at)}): ${st.error || 'sconosciuto'}`, 'pa-new');
  else state(`Collegato · ultimo controllo ${hm(st.at)} · ${st.accepted || 0} mail entrate${st.rejectedCount ? `, ${st.rejectedCount} scartate` : ''}`, 'pa-ok');
  $('ml-use').hidden = !(linked && st.alias && st.lastOk);
  $('ml-alias').textContent = st.alias || '';
  const ts = $('ml-test-st');
  if (d.testPending) { ts.className = 'small muted'; ts.textContent = 'Richiesta inviata: parte entro 2 minuti…'; }
  else if (st.test) { ts.className = st.test.ok ? 'small pa-ok' : 'small err'; ts.textContent = st.test.ok ? `Mandata alle ${hm(st.test.at)}: controlla Posta in arrivo (e Spam).` : `Non partita: ${st.test.error}`; }
  else ts.textContent = '';
  $('ml-test').disabled = busy || d.testPending;
  const rj = $('ml-rejected'); rj.replaceChildren();
  if ((st.rejected || []).length) {
    rj.append(el('h2', 'st-group', 'Ultime scartate'));
    for (const r of st.rejected.slice().reverse()) rj.append(el('p', 'small muted', `${hm(r.at)} · ${r.from || 'mittente sconosciuto'} · ${r.reason}`));
  }
  clearTimeout(timer);
  if (linked && (!fresh || d.testPending || d.update)) timer = setTimeout(load, 10000);
}

async function load() {
  try { data = await api('GET', '/api/mail'); msg.textContent = ''; render(); } catch (e) { msg.textContent = e.message; }
}

async function copy(text, out) {
  try { await navigator.clipboard.writeText(text); out.textContent = 'Copiato'; }
  catch { out.textContent = 'Copia non riuscita: tieni premuto sul testo e copialo a mano'; }
  setTimeout(() => { out.textContent = ''; }, 4000);
}

async function act(btn, fn) {
  if (busy) return;
  busy = true; btn.disabled = true; msg.textContent = '';
  try { await fn(); await load(); } catch (e) { msg.textContent = e.message; }
  finally { busy = false; btn.disabled = false; if (data) render(); }
}

$('ml-copy').addEventListener('click', () => copy(data.script || '', $('ml-copied')));
$('ml-alias-copy').addEventListener('click', e => copy($('ml-alias').textContent, $('ml-test-st')));
$('ml-form').addEventListener('submit', e => {
  e.preventDefault();
  const b = e.submitter || $('ml-form').querySelector('button[type=submit]');
  act(b, async () => { await api('PUT', '/api/mail/url', { url: $('ml-url').value.trim() }); $('ml-url').blur(); $('ml-saved').textContent = 'Salvato'; setTimeout(() => { $('ml-saved').textContent = ''; }, 3000); });
});
$('ml-unlink').addEventListener('click', e => {
  if (!confirm('Scollegare lo script? Le mail a +edge smettono di arrivare al server.')) return;
  act(e.currentTarget, () => api('PUT', '/api/mail/url', { url: '' }));
});
$('ml-test').addEventListener('click', e => act(e.currentTarget, () => api('POST', '/api/mail/test')));

load();
