// "Domande" (issue 352): every open question for the owner as a flashcard, one after the other. Local issues answer
// with PATCH {version, answers} (issues 173/307), Project issues through the write queue of projects-issue-apply.
// Every text is untrusted: textContent only. Buttons stay disabled while a request is pending.
'use strict';
const card = document.getElementById('dq-card');
const count = document.getElementById('dq-count');
const msg = document.getElementById('dq-msg');
let cards = [], pos = 0, answered = 0, snoozed = 0;
const hist = []; // positions seen, for «Indietro»

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/?next=domande.html'; throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  return { r, j };
}
async function load() {
  const { r, j } = await api('GET', '/api/questions');
  if (!r.ok) { msg.textContent = 'Errore nel caricamento'; return; }
  cards = j.cards; snoozed = j.snoozed; pos = 0; hist.length = 0;
  show();
}
function issueHref(c) { return c.kind === 'project' ? `projects.html#${c.project}-${c.number}` : `/#${c.issue}`; }

// Waits for the result of a Project request (answer arrives in seconds, issue 332).
async function projectCall(c, body) {
  const { r, j } = await api('POST', '/api/projects-issues/write', { project: c.project, number: c.number, ...body });
  if (!r.ok) throw new Error(j.error || 'errore');
  for (let n = 0; n < 260; n++) {
    await new Promise(res => setTimeout(res, 700));
    const s = (await api('GET', `/api/projects-issues/write/${j.id}`)).j;
    if (s.done) { if (!s.ok) throw new Error(s.msg || 'errore'); return s; }
  }
  throw new Error('nessuna risposta dal server, riprova');
}

function show() {
  card.replaceChildren(); msg.textContent = '';
  if (pos >= cards.length) {
    count.textContent = '';
    const done = el('div', 'dq-card dq-end');
    done.append(el('h2', null, 'Hai finito'), el('p', null, answered ? `Risposte date: ${answered}.` : 'Nessuna risposta data.'));
    if (snoozed || cards.length) done.append(el('p', 'muted small', 'Le domande messe «Non ancora» tornano fra un giorno.'));
    const again = el('button', 'btn', 'Ricarica'); again.type = 'button'; again.id = 'dq-reload';
    again.addEventListener('click', () => { answered = 0; load(); });
    done.append(again);
    card.append(done);
    return;
  }
  const c = cards[pos];
  count.textContent = `${pos + 1} di ${cards.length}`;
  const box = el('div', 'dq-card');
  const head = el('div', 'dq-head');
  head.append(el('span', 'muted small', c.kind === 'project' ? c.issue : `#${c.issue}`));
  if (c.blocks) head.append(el('span', 'lbl', `blocca ${c.blocks}`));
  if (c.expired) head.append(el('span', 'lbl', 'scaduta'));
  box.append(head, el('h2', 'dq-title', c.title));
  if (c.ai) box.append(el('div', 'section-h', c.ai.newer ? `L'AI ha risposto il ${c.ai.date}:` : `Dall'AI (${c.ai.date}):`));
  if (c.context) box.append(el('p', 'dq-ctx', c.context));
  if (c.last && c.last.text) { box.append(el('div', 'section-h', (c.ai && c.ai.newer ? 'Il tuo commento precedente' : 'Ultimo commento') + (!(c.ai && c.ai.newer) && c.last.by ? ' di ' + c.last.by : '')), el('p', 'pj-last', c.last.text)); }
  const q = el('p', 'dq-step', c.step || (c.kind === 'project' ? 'Leggo la issue su GitHub…' : 'Serve una tua risposta'));
  q.id = 'dq-q';
  box.append(q);
  const ta = el('textarea'); ta.rows = 3; ta.maxLength = 2000; ta.id = 'dq-text'; ta.placeholder = 'Risposta o nota (facoltativa se «Fatto»)'; ta.setAttribute('aria-label', 'Risposta');
  const out = el('p', 'muted small'); out.setAttribute('role', 'status'); out.id = 'dq-out';
  const mk = (t, id, cls) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), t); b.type = 'button'; b.id = id; return b; };
  const bAns = mk('Rispondi', 'dq-answer', 'primary'), bDone = mk('Fatto', 'dq-done'), bLater = mk(c.suggestion ? 'Lascia in sospeso' : 'Non ancora', 'dq-later');
  const bSkip = mk('Salta', 'dq-skip', 'ghost'), bBack = mk('Indietro', 'dq-back', 'ghost');
  bBack.disabled = !hist.length;
  const main = el('div', 'dq-actions'); main.append(bAns, bDone, bLater);
  const nav = el('div', 'dq-actions'); nav.append(bBack, bSkip);
  const link = el('a', 'small', 'Apri issue'); link.href = issueHref(c); link.id = 'dq-open';
  if (c.kind === 'local' && !c.step) bDone.hidden = true;
  // Suggested answer (issue 353): only text; Accetta sends it as it is, Modifica copies it into the box, Lascia in sospeso = «Non ancora».
  let bAcc = null, bEdit = null;
  if (c.suggestion) {
    const sg = el('div', 'dq-sugg'); sg.id = 'dq-sugg';
    const model = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' }[c.suggestion.model];
    sg.append(el('div', 'section-h', 'Risposta consigliata' + (model ? ' (suggerita da ' + model + ')' : '')), el('p', 'dq-sugg-text', c.suggestion.answer));
    if (c.suggestion.why) sg.append(el('p', 'muted small', c.suggestion.why));
    bAcc = mk('Accetta', 'dq-accept', 'primary'); bEdit = mk('Modifica', 'dq-edit');
    const sa = el('div', 'dq-actions'); sa.append(bAcc, bEdit);
    sg.append(sa);
    box.append(sg);
  }
  // Check: found the answer by itself (issue 354): only text; nothing is sent until the owner confirms.
  let bConf = null, bOpen = null;
  if (c.found) {
    const fd = el('div', 'dq-sugg'); fd.id = 'dq-found';
    fd.append(el('div', 'section-h', 'Sembra risolta'), el('p', 'dq-sugg-text', c.found.evidence));
    bConf = mk('Conferma e chiudi', 'dq-confirm', 'primary'); bOpen = mk('È ancora aperta', 'dq-still');
    const fa = el('div', 'dq-actions'); fa.append(bConf, bOpen);
    fd.append(fa);
    box.append(fd);
  }
  box.append(ta, main, nav, link, out);
  card.append(box);

  const all = [bAns, bDone, bLater, bSkip, bBack, ...(bAcc ? [bAcc, bEdit] : []), ...(bConf ? [bConf, bOpen] : [])];
  const busy = on => all.forEach(b => { b.disabled = on || (b === bBack && !hist.length); });
  const fail = text => { out.className = 'err small'; out.textContent = text; busy(false); };
  const next = () => { hist.push(pos); pos++; show(); };

  let steps = null; // Project: steps read from GitHub
  if (c.kind === 'project') {
    busy(true);
    projectCall(c, { action: 'read' }).then(s => {
      steps = s.steps;
      q.textContent = steps[0] || 'Serve una tua risposta';
      if (steps.length > 1) out.textContent = `Questa issue ha ${steps.length} passi: rispondi al primo, gli altri li trovi nella issue.`;
      if (!steps.length) bDone.hidden = true;
      if (s.last && s.last.text) box.insertBefore(el('p', 'pj-last', s.last.text), q);
      busy(false);
    }).catch(e => { q.textContent = 'Non riesco a leggere la issue'; fail(e.message); bAns.disabled = true; bDone.disabled = true; });
  }
  bSkip.addEventListener('click', () => { next(); });
  bBack.addEventListener('click', () => { pos = hist.pop(); show(); });
  bLater.addEventListener('click', async () => {
    busy(true);
    try {
      const { r, j } = await api('POST', '/api/questions/snooze', { key: c.key });
      if (!r.ok) return fail(j.error || 'errore');
      snoozed++; next();
    } catch { fail('rete non raggiungibile'); }
  });
  const submit = async (kind, given) => {
    const note = given != null ? given : ta.value.trim();
    if (kind === 'answer' && !note) { out.className = 'err small'; out.textContent = 'Scrivi la risposta'; return; }
    busy(true); out.className = 'muted small'; out.textContent = 'Invio…';
    try {
      if (c.kind === 'local') {
        const { r, j } = await api('PATCH', `/api/issues/${c.issue}`, { version: c.version, answers: [{ line: c.line, text: c.step, kind, note }] });
        if (r.status === 409) { out.className = 'err small'; out.textContent = 'La issue è cambiata, ricarico le domande'; setTimeout(load, 1500); return; }
        if (!r.ok) return fail(j.error || 'errore');
        if (j.version) for (const o of cards) if (o.kind === 'local' && o.issue === c.issue) o.version = j.version; // the other steps of this issue
      } else {
        if (!steps) return fail('Attendi la lettura della issue');
        await projectCall(c, { action: 'answer', answers: [{ text: steps[0] || '', kind, note }] });
      }
      answered++; next();
    } catch (e) { fail(e.message === 'Failed to fetch' ? 'rete non raggiungibile' : e.message); }
  };
  bAns.addEventListener('click', () => submit('answer'));
  if (bAcc) {
    bAcc.addEventListener('click', () => submit('answer', c.suggestion.answer));
    bEdit.addEventListener('click', () => { ta.value = c.suggestion.answer; ta.focus(); });
  }
  bDone.addEventListener('click', () => submit('done'));
  if (bConf) {
    bConf.addEventListener('click', () => submit(c.step ? 'done' : 'answer', 'Confermato dal controllo automatico: ' + c.found.evidence));
    bOpen.addEventListener('click', () => { document.getElementById('dq-found').remove(); });
  }
}
load().catch(() => { msg.textContent = 'Errore nel caricamento'; });
