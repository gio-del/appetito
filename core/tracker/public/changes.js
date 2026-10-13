// Changes: agent branches that wait for the owner (a change under guard/, or every change when the
// merge gate is `approve`) with their diff, and the latest deploys. Approving goes through the
// confirm page (another origin, rendered by the server); rejecting is a plain request.
'use strict';
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = `${data.login}?next=${encodeURIComponent(location.href)}`; throw new Error('login'); }
  if (data.lang) setLang(data.lang);
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
function texts() {
  document.title = t('ch.title');
  $('#ch-h').textContent = t('ch.title'); $('#ch-intro').textContent = t('ch.intro'); $('#ch-back').textContent = '← ' + t('st.back');
}
// A unified diff as lines with a class per kind; text only, never HTML.
function diffView(d) {
  return h('pre', { class: 'diff' }, d.split('\n').slice(0, 4000).map(l =>
    h('span', { class: l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : /^diff --git/.test(l) ? 'file' : '' }, l + '\n')));
}
const when = s => new Date(s * 1000).toLocaleString(LOCALE());
function render(data) {
  texts();
  const w = data.waiting || [];
  $('#ch-waiting').replaceChildren(h('h2', { class: 'st-group' }, t('ch.waiting')),
    w.length ? w.map(b => {
      const note = h('input', { type: 'text', maxlength: 500, placeholder: t('ch.note'), 'aria-label': t('ch.note') });
      return h('article', { class: 'change' },
        h('div', { class: 'change-h' }, icon('shield'), h('code', null, b.branch), b.issue && h('a', { href: '/#' + b.issue }, t('ch.issue', b.issue))),
        h('p', { class: 'warn-box' }, b.state === 'waiting-guard' ? t('ch.guard', b.reason) : t('ch.gate')),
        h('details', null, h('summary', null, t('ch.diff')), diffView(b.diff || '')),
        note,
        h('div', { class: 'edit-actions' },
          h('button', { class: 'btn', onclick: async e => {
            e.currentTarget.disabled = true;
            try { await api('POST', '/api/deploy/reject', { branch: b.branch, sha: b.sha, note: note.value }); toast(t('ch.rejected')); load(); } catch (err) { toast(err.message, true); }
          } }, t('ch.reject')),
          h('button', { class: 'btn primary', onclick: async e => {
            e.currentTarget.disabled = true;
            try { location.href = (await api('POST', '/api/confirm', { action: 'approve-branch', branch: b.branch, sha: b.sha })).url; } catch (err) { toast(err.message, true); load(); }
          } }, t('ch.approve'))));
    }) : h('p', { class: 'muted' }, t('ch.none')));
  $('#ch-recent').replaceChildren(h('h2', { class: 'st-group' }, t('ch.recent')),
    h('ul', { class: 'hist' }, (data.recent || []).map(b => h('li', null, h('code', null, b.branch.replace(/^agent\//, '')),
      h('span', { class: 'bstate s-' + b.state }, t('branch.' + b.state)), h('span', { class: 'when' }, b.at ? when(b.at) : '')))));
}
let toastT;
function toast(m, bad) { const x = $('#toast'); x.textContent = m; x.className = 'toast' + (bad ? ' bad' : ''); x.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { x.hidden = true; }, 3500); }
function load() { return api('GET', '/api/deploy').then(render).catch(e => { if (e.message !== 'login') $('#ch-msg').textContent = e.message; }); }
texts();
load();
setInterval(() => { if (!document.hidden) load(); }, 20000);
