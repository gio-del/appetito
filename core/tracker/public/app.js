'use strict';
// appetito tracker UI: board + detail drawer over /api/issues. No dependencies, no inline
// styles/scripts (the CSP forbids them): DOM built with h(), markdown rendered from escaped text.
// Strings come from i18n.js (t()). Sign-in and every approval happen on the tracker's confirm
// origin (pages rendered by the server, no script): this code only sends the browser there.

const COL_IDS = ['proposed', 'backlog', 'todo', 'in-progress', 'blocked', 'done'];
const COLS = () => COL_IDS.map(c => [c, t('col.' + c)]);
const COL_NAME = c => t('col.' + c);
const PRIO_IDS = ['urgent', 'high', 'medium', 'low', 'none'];
const PRIOS = () => PRIO_IDS.map(p => [p, t('prio.' + p)]);
const PRIO_NAME = p => t('prio.' + p);
const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
// Same keys as REJECT_REASONS in server.js; the label is translated.
const REJECT_REASONS = ['not-interested', 'not-now', 'too-complex', 'already-covered', 'wrong'];
const MOBILE = matchMedia('(max-width: 760px)');

const $ = s => document.querySelector(s);
const S = { staleAfter: 30, stale: new URLSearchParams(location.search).has('stale'), pickTab: new URLSearchParams(location.search).has('label'), issues: [], q: '', prio: '', entry: '', label: (new URLSearchParams(location.search).get('label') || '').slice(0, 40), tab: COL_IDS.find(c => c === new URLSearchParams(location.search).get('tab')) || localGet('tab') || 'in-progress', open: null, detail: null };

function localGet(k) { try { return localStorage.getItem('tracker.' + k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem('tracker.' + k, v); } catch { /* private mode */ } }

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ---------- API ----------

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function api(method, url, body) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(data.login); throw new ApiError(401, 'login'); }
  if (data.lang && setLang(data.lang)) staticTexts();
  if (!r.ok) throw new ApiError(r.status, data.error || r.statusText);
  return data;
}

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function fail(e) {
  if (e.status === 401) return;
  toast(e.status === 409 ? t('err.changed') : t('err', e.message), true);
}

// ---------- markdown (subset used by the issue files) ----------

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function inline(s) {
  return s.split(/(`[^`]+`)/).map((p, i) => i % 2 ? `<code>${esc(p.slice(1, -1))}</code>` : esc(p)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
  ).join('');
}
// Task items carry data-line (index in the source) so a click can toggle that exact line.
function md(src) {
  const L = src.split('\n');
  let out = '', para = [];
  const flush = () => { if (para.length) out += `<p>${inline(para.join(' '))}</p>`; para = []; };
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (/^\s*```/.test(l)) {
      flush();
      const code = [];
      while (++i < L.length && !/^\s*```/.test(L[i])) code.push(L[i]);
      out += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
    } else if (/^#{1,6} /.test(l)) {
      flush();
      const n = Math.min(l.indexOf(' ') + 1, 5);
      out += `<h${n}>${inline(l.replace(/^#+ /, ''))}</h${n}>`;
    } else if (/^\s*\|/.test(l) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(L[i + 1] || '')) {
      flush();
      const row = (r, t) => '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(c => `<${t}>${inline(c.trim())}</${t}>`).join('') + '</tr>';
      out += '<table><thead>' + row(l, 'th') + '</thead><tbody>';
      i++;
      while (i + 1 < L.length && /^\s*\|/.test(L[i + 1])) out += row(L[++i], 'td');
      out += '</tbody></table>';
    } else if (/^\s*([-*+]|\d+[.)]) /.test(l)) {
      flush();
      const items = [];
      for (; i < L.length; i++) {
        const m = /^(\s*)([-*+]|\d+[.)]) (.*)$/.exec(L[i]);
        if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3], line: i });
        else if (L[i].trim() && /^\s+/.test(L[i]) && items.length) items[items.length - 1].text += ' ' + L[i].trim();
        else { i--; break; }
      }
      out += list(items);
    } else if (/^>\s?/.test(l)) {
      flush();
      const q = [];
      for (; i < L.length && /^>\s?/.test(L[i]); i++) q.push(L[i].replace(/^>\s?/, ''));
      i--;
      out += `<blockquote>${md(q.join('\n'))}</blockquote>`;
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { flush(); out += '<hr>'; }
    else if (!l.trim()) flush();
    else para.push(l.trim());
  }
  flush();
  return out;
}
function list(items) {
  let out = '';
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) out += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) { const tag = it.ordered ? 'ol' : 'ul'; stack.push({ indent: it.indent, tag }); out += `<${tag}>`; }
    else out += '</li>';
    const t = /^\[([ xX])\] (.*)$/.exec(it.text);
    out += t
      ? `<li class="task${t[1] !== ' ' ? ' done' : ''}"><input type="checkbox" data-line="${it.line}"${t[1] !== ' ' ? ' checked' : ''}><span>${inline(t[2])}</span>`
      : `<li>${inline(it.text)}`;
  }
  while (stack.length) out += `</li></${stack.pop().tag}>`;
  return out;
}

// ---------- small widgets ----------

const statusIcon = col => h('span', { class: 'st st-' + col, title: COL_NAME(col) });
function prioIcon(p) {
  if (p === 'urgent') return h('span', { class: 'pr pr-urgent', title: PRIO_NAME('urgent') }, '!');
  return h('span', { class: 'pr pr-' + p, title: PRIO_NAME(p) }, h('i'), h('i'), h('i'));
}
function labelColor(name) {
  let n = 0;
  for (const c of name) n = (n * 31 + c.codePointAt(0)) >>> 0;
  return `hsl(${n % 360} 65% 58%)`;
}
function labelChip(name, onRemove) {
  const el = h('span', { class: 'lbl' }, name, onRemove && h('button', { 'aria-label': '× ' + name, onclick: onRemove }, '×'));
  el.style.setProperty('--c', labelColor(name));
  return el;
}
function progress(n, what = t('tasks.done')) {
  if (!n.total) return null;
  const bar = h('i');
  bar.style.width = Math.round(100 * n.done / n.total) + '%';
  return h('span', { class: 'prog', title: t('progress', n.done, n.total, what) }, h('span', { class: 'prog-bar' }, bar), `${n.done}/${n.total}`);
}
function relTime(iso) {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return t('time.now');
  if (d < 3600) return t('time.min', Math.floor(d / 60));
  if (d < 86400) return t('time.h', Math.floor(d / 3600));
  if (d < 86400 * 30) return t('time.d', Math.floor(d / 86400));
  return new Date(iso).toLocaleDateString(LOCALE());
}
// Chip on a sub-issue pointing to its parent; a click opens the parent, not the card.
function parentChip(i) {
  if (!i.parent) return null;
  return h('button', { class: 'parent-chip', title: t('parent.open'),
    onclick: e => { e.stopPropagation(); openIssue(i.parent); } }, `↑ ${i.parent} ${i.parentTitle || ''}`.trim());
}
// "Blocked on: issue NNN[, MMM]" -> "Blocked by #NNN" with each id opening that issue.
function blockedChip(i) {
  if (!i.blockedOn) return null;
  const m = /^issues?\s+(#?\d{3,}(?:\s*(?:,|&|and|e)\s*#?\d{3,})*)\s*(?:\(.*\))?$/i.exec(i.blockedOn.trim());
  if (!m) return h('span', { class: 'blocked-on' }, '⛔ ' + i.blockedOn);
  return h('span', { class: 'blocked-on' }, t('blocked.by'), m[1].match(/\d{3,}/g).map(id =>
    h('button', { class: 'parent-chip', title: t('blocked.open'),
      onclick: e => { e.stopPropagation(); openIssue(id); } }, '#' + id)));
}
// Relations in the drawer: one chip per issue, opening it; optional × to remove the link.
function linkChips(list, onRemove) {
  return list.map(c => h('span', { class: 'link-chip' },
    h('button', { class: 'parent-chip', title: c.title, onclick: e => { e.stopPropagation(); openIssue(c.id); } },
      statusIcon(c.column), `#${c.id} ${c.title}`),
    onRemove && h('button', { class: 'btn ghost icon', 'aria-label': '× #' + c.id, title: t('link.remove'), onclick: () => onRemove(c) }, '×')));
}
// "NNN" or "#NNN" typed by the owner -> an existing issue id other than `self`, or null (with a toast).
function askIssue(question, self) {
  const v = (prompt(question) || '').trim().replace(/^#/, '');
  if (!v) return null;
  const id = /^\d+$/.test(v) ? v.padStart(3, '0') : '';
  if (!id || id === self || !S.issues.some(i => i.id === id)) { toast(t('issue.notfound', v), true); return null; }
  return id;
}

// Where a proposal came from: the server derives `entry` from `Source:` (set from the proposer's
// token) and `Origin:`; an unknown second-brain origin counts as 'other', the cautious case.
const ENTRY_IDS = ['system', 'note', 'other'];
const ENTRY = id => ({ name: t(`entry.${id}`), title: t(`entry.${id}.title`), warn: t(`entry.${id}.warn`) });
function sourceBadge(i) {
  if (!ENTRY_IDS.includes(i.entry)) return null;
  const e = ENTRY(i.entry);
  return h('span', { class: `src src-${i.entry}`, title: e.title }, e.name);
}
// Stale backlog: a Backlog issue with no decision for APPETITO_BACKLOG_STALE_DAYS days (settings page).
const staleBadge = i => i.stale ? h('span', { class: 'stale', title: t('stale.title', i.stale, S.staleAfter) }, t('stale.badge', i.stale)) : null;
// Scarta reason chips (proposals and stale backlog): returns the element and a getter for the chosen one.
function reasonChips() {
  let reason = '';
  const el = h('div', { class: 'reasons', role: 'group', 'aria-label': t('reject.why') }, REJECT_REASONS.map(r =>
    h('button', { class: 'reason', 'aria-pressed': 'false', 'data-reason': r, onclick: e => {
      reason = reason === r ? '' : r;
      for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.reason === reason));
      e.currentTarget.blur();
    } }, t('reason.' + r))));
  return [el, () => reason];
}
const allLabels = () => [...new Set(S.issues.flatMap(i => i.labels))].sort();

// ---------- board ----------

function visible(i) {
  if (S.stale && !i.stale) return false;
  if (S.prio && i.priority !== S.prio) return false;
  if (S.label && !i.labels.includes(S.label)) return false;
  if (S.entry && i.entry !== S.entry) return false;
  if (S.q) {
    const q = S.q.toLowerCase();
    if (!(i.title.toLowerCase().includes(q) || i.id.includes(q) || i.parent === q || i.labels.some(l => l.includes(q)))) return false;
  }
  return true;
}

function card(i) {
  const el = h('article', { class: 'card', tabindex: 0, draggable: MOBILE.matches ? null : 'true','data-id': i.id,
    onclick: () => openIssue(i.id), onkeydown: e => { if (e.key === 'Enter') openIssue(i.id); } },
  h('div', { class: 'card-top' }, statusIcon(i.column), `#${i.id}`, prioIcon(i.priority)),
  h('div', { class: 'card-title' }, i.title),
  h('div', { class: 'card-meta' },
    sourceBadge(i),
    staleBadge(i),
    parentChip(i),
    blockedChip(i),
    i.labels.map(l => labelChip(l)),
    i.children?.total ? h('span', { class: 'subs' }, '⑂', progress(i.children, t('subs.closed'))) : null,
    progress(i.tasks),
    i.comments ? h('span', { title: t('comments') }, '💬 ' + i.comments) : null,
    h('span', { title: new Date(i.updated).toLocaleString(LOCALE()) }, relTime(i.updated))));
  el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', i.id); el.classList.add('dragging'); });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

function sortIssues(a, b, col) {
  if (col === 'done') return (b.closed || '').localeCompare(a.closed || '') || b.id.localeCompare(a.id);
  return PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || b.updated.localeCompare(a.updated);
}

function renderBoard() {
  const board = $('#board'), tabs = $('#tabs');
  const shown = S.issues.filter(visible);
  // Opened with ?label= (e.g. from the dashboard): on the phone, show the first column that has a match.
  if (S.pickTab && S.issues.length) { S.pickTab = false; const c = COL_IDS.find(col => shown.some(i => i.column === col)); if (c) S.tab = c; }
  board.replaceChildren(); tabs.replaceChildren();
  for (const [col, name] of COLS()) {
    const items = shown.filter(i => i.column === col).sort((a, b) => sortIssues(a, b, col));
    tabs.append(h('button', { role: 'tab', 'aria-selected': String(S.tab === col),
      onclick: () => { S.tab = col; localSet('tab', col); renderBoard(); } }, statusIcon(col), name, h('span', { class: 'muted' }, items.length)));
    const listEl = h('div', { class: 'col-list' }, items.length ? items.map(card) : h('div', { class: 'empty' }, t('empty')));
    const colEl = h('section', { class: 'col' + (S.tab === col ? ' active' : ''), 'data-col': col },
      h('div', { class: 'col-head' }, statusIcon(col), name, h('span', { class: 'count' }, items.length),
        col !== 'done' && col !== 'proposed' && h('button', { class: 'btn ghost icon add', title: t('new.in', name), onclick: () => newIssue(col) }, '+')),
      listEl);
    colEl.addEventListener('dragover', e => { e.preventDefault(); colEl.classList.add('drop'); });
    colEl.addEventListener('dragleave', e => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('drop'); });
    colEl.addEventListener('drop', e => {
      e.preventDefault(); colEl.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      const i = S.issues.find(x => x.id === id);
      if (i && i.column !== col && col !== 'proposed') {
        if (i.column === 'proposed' && col !== 'done') approve(i, col === 'backlog' ? 'backlog' : 'todo', '');
        else move(i, col);
      }
    });
    board.append(colEl);
  }
  if (MOBILE.matches) tabs.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderFilters() {
  const fp = $('#f-prio'), fl = $('#f-label');
  fp.replaceChildren(h('option', { value: '' }, t('filter.prio')), ...PRIOS().map(([v, n]) => h('option', { value: v }, n)));
  fp.value = S.prio;
  const labels = allLabels();
  if (S.label && !labels.includes(S.label)) S.label = '';
  fl.replaceChildren(h('option', { value: '' }, t('filter.label')), ...labels.map(l => h('option', { value: l }, l)));
  fl.value = S.label;
  // "Stale backlog": shown only when there are some, or while active.
  const n = S.issues.filter(i => i.stale).length, fst = $('#f-stale');
  fst.hidden = !n && !S.stale;
  fst.textContent = t('filter.stale', n);
  fst.title = t('filter.stale.title');
  fst.setAttribute('aria-pressed', String(S.stale));
  const fe = $('#f-entry');
  fe.replaceChildren(h('option', { value: '' }, t('filter.entry')), ...ENTRY_IDS.map(v => h('option', { value: v }, t('entry.' + v))));
  fe.value = S.entry;
  syncClear();
}

// "×" next to an active priority/label filter: shown only when a value is set.
const CLEAR = { 'f-prio': 'prio', 'f-label': 'label' };
function syncClear() {
  for (const [id, k] of Object.entries(CLEAR)) {
    $(`[data-clear="${id}"]`).hidden = !S[k];
    $(`#${id}`).classList.toggle('active', !!S[k]);
  }
}

// Header pill with the worker's state, linking to /auto.html.
const AUTO_PILL = { working: ['bot', 'live'], deploying: ['deploy', 'live'], idle: ['moon', 'calm'], empty: ['moon', 'ok'],
  paused: ['pause', 'warn'], quota: ['gauge', 'warn'], budget: ['cost', 'warn'], error: ['alert', 'bad'] };
let autoState = null;
async function refreshAuto() {
  try { autoState = await api('GET', '/api/auto'); } catch { return; }
  const st = autoState.status;
  const [ic, tone] = autoState.pending ? ['hourglass', 'info'] : AUTO_PILL[st?.code] || ['bot', ''];
  const txt = autoState.pending ? t('auto.requested') : AUTO_PILL[st?.code] ? t('auto.' + st.code) : t('auto.default');
  const pill = $('#auto-pill');
  pill.className = `auto-pill ${tone}`;
  pill.replaceChildren(icon(ic), h('span', { class: 'lbl' }, (st?.code === 'working' || st?.code === 'deploying') && st.current ? `#${st.current.id}` : txt));
}

async function refresh() {
  try {
    const data = await api('GET', '/api/issues');
    refreshAuto();
    S.issues = data.issues;
    S.staleAfter = data.staleAfter || S.staleAfter;
    S.waiting = data.waiting || 0;
    showApp();
    renderWaiting();
    renderFilters();
    renderBoard();
  } catch (e) { fail(e); }
}

// Moving to "Blocked" asks what it waits for (the files use user / hardware / free text).
async function move(i, col, version) {
  const body = { version: version || i.version, column: col };
  if (col === 'blocked') {
    const w = prompt(t('move.blocked'), 'user');
    if (!w || !w.trim()) return;
    body.blockedOn = w.trim();
  }
  try {
    const upd = await api('PATCH', `/api/issues/${i.id}`, body);
    toast(`#${i.id} → ${COL_NAME(upd.column)}`);
  } catch (e) { fail(e); }
  await refresh();
  if (S.open === i.id) await openIssue(i.id);
}

// ---------- detail ----------

// Navigation: every drawer view (issue, new issue) is a history entry, so the phone's Back goes to the
// previous view instead of leaving the app. state.depth counts our entries, so ✕ can unwind them all.
const depth = () => history.state?.depth || 0;
function go(hash, push = true) {
  if (location.hash === hash) return;
  if (push) history.pushState({ depth: depth() + 1 }, '', hash);
  else history.replaceState({ depth: depth() }, '', hash);
}

async function openIssue(id, push = true) {
  let d;
  try { d = await api('GET', `/api/issues/${id}`); } catch (e) { fail(e); return; }
  S.open = id; S.detail = d;
  go('#' + id, push);
  $('#drawer').hidden = false;
  renderDetail();
}
function hideDrawer() { $('#drawer').hidden = true; S.open = null; S.detail = null; }
function closeDrawer() {
  if (depth()) history.go(-depth()); // popstate hides the drawer
  else { hideDrawer(); history.replaceState(null, '', location.pathname); }
}
addEventListener('popstate', () => {
  const m = /^#(\d+)$/.exec(location.hash);
  if (m) openIssue(m[1], false);
  else if (location.hash === '#new') newIssue('todo', null, false);
  else hideDrawer();
});

async function patch(body) {
  const d = S.detail;
  try {
    await api('PATCH', `/api/issues/${d.id}`, { version: d.version, ...body });
    await openIssue(d.id);
    refresh();
    return true;
  } catch (e) {
    fail(e);
    if (e.status === 409) await openIssue(d.id);
    return false;
  }
}

function renderDetail() {
  const d = S.detail;
  $('#d-id').textContent = `#${d.id}  ·  ${d.file}`;
  $('#d-dirty').textContent = d.history.uncommitted ? t('d.dirty') : '';
  const body = $('#d-body');

  const title = h('h2', { class: 'd-title', id: 'd-title', title: t('d.edit') }, d.title);
  title.addEventListener('click', () => {
    const inp = h('input', { type: 'text', class: 'title-input', value: d.title, maxlength: 200 });
    const save = async () => { const v = inp.value.trim(); if (v && v !== d.title) await patch({ title: v }); else renderDetail(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); renderDetail(); } });
    inp.addEventListener('blur', save);
    title.replaceWith(inp); inp.focus();
  });

  // Only proposals sit in "Proposals"; nothing can be moved back into it, and moving a proposal out
  // of it (other than to Done = reject) is an approval: the confirm page.
  const colSel = h('select', { 'aria-label': t('d.status') },
    COLS().filter(([v]) => v !== 'proposed' || d.column === 'proposed').map(([v, n]) => h('option', { value: v }, n)));
  colSel.value = d.column;
  colSel.addEventListener('change', () => {
    if (d.column === 'proposed' && colSel.value !== 'done') approve(d, colSel.value === 'backlog' ? 'backlog' : 'todo', '');
    else if (d.column === 'proposed') patch({ reject: {} });
    else move(d, colSel.value, d.version);
  });
  const prioSel = h('select', { 'aria-label': t('d.prio') }, PRIOS().map(([v, n]) => h('option', { value: v }, n)));
  prioSel.value = d.priority;
  prioSel.addEventListener('change', () => patch({ priority: prioSel.value }));

  const labIn = h('input', { type: 'text', placeholder: t('d.label.add'), list: 'label-list', maxlength: 30 });
  const addLabel = () => {
    const v = labIn.value.trim().toLowerCase();
    if (v && !d.labels.includes(v)) patch({ labels: [...d.labels, v] });
  };
  labIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } });
  labIn.addEventListener('change', addLabel);
  const labels = h('div', { class: 'label-edit' },
    d.labels.map(l => labelChip(l, e => { e.stopPropagation(); patch({ labels: d.labels.filter(x => x !== l) }); })),
    labIn, h('datalist', { id: 'label-list' }, allLabels().filter(l => !d.labels.includes(l)).map(l => h('option', { value: l }))));

  let blocked = null;
  if (d.column === 'blocked') {
    blocked = h('input', { type: 'text', value: d.blockedOn, maxlength: 60, 'aria-label': t('d.blockedby') });
    blocked.addEventListener('change', () => { const v = blocked.value.trim(); if (v) patch({ blockedOn: v }); });
  }

  // Parent: one level only, so an issue with children can't get one and only top-level issues are offered.
  let parentEl;
  if (d.children.length) parentEl = h('span', { class: 'muted' }, t('d.parent.haskids'));
  else {
    parentEl = h('select', { 'aria-label': t('d.parent') }, h('option', { value: '' }, t('d.parent.none')),
      S.issues.filter(i => i.id !== d.id && !i.parent && (i.state === 'open' || i.id === d.parent))
        .map(i => h('option', { value: i.id }, `#${i.id} ${i.title}`)));
    parentEl.value = d.parent;
    parentEl.addEventListener('change', () => patch({ parent: parentEl.value }));
  }

  // Relations: Related both sides (editable), the rest derived from the other issues' fields.
  const L = d.links;
  const relAdd = h('select', { 'aria-label': t('d.related.add') }, h('option', { value: '' }, t('d.related.add')),
    S.issues.filter(i => i.id !== d.id && !d.relatedAll.includes(i.id) && i.state !== 'done').map(i => h('option', { value: i.id }, `#${i.id} ${i.title}`)));
  relAdd.addEventListener('change', () => { if (relAdd.value) patch({ related: [...d.relatedAll, relAdd.value] }); });
  const related = h('div', { class: 'links' }, linkChips(L.related, c => patch({ related: d.relatedAll.filter(x => x !== c.id) })), relAdd);
  const markDup = d.state === 'open' && h('button', { class: 'btn ghost', onclick: () => {
    const id = askIssue(t('d.markdup.ask'), d.id);
    if (id && confirm(t('d.markdup.confirm', d.id, id))) patch({ duplicateOf: id });
  } }, t('d.markdup'));

  // Manual start of the worker on this issue: only issues its selector would pick.
  const ast = autoState && autoState.status;
  const autoWhy = !autoState ? '' : autoState.pending ? t('d.auto.why.pending') : (ast?.code === 'working' || ast?.code === 'deploying') ? t('d.auto.why.working', ast.current?.id)
    : ast?.gates?.quotaUntil ? t('d.auto.why.quota') : '';
  const autoGo = d.pickable && h('button', { class: 'btn auto-go', disabled: !!autoWhy, title: autoWhy || t('d.auto.go.title'), onclick: async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await api('POST', '/api/auto/run', { issue: d.id }); toast(t('d.auto.started', d.id)); refreshAuto(); }
    catch (err) { if (err.status !== 401) toast(t('err', err.message), true); b.disabled = false; }
  } }, icon('play'), t('d.auto.go'));

  const props = h('div', { class: 'props' },
    h('span', { class: 'k' }, t('d.status')), h('div', null, colSel),
    blocked && [h('span', { class: 'k' }, t('d.blockedby')), h('div', null, blocked, /^issues?\s/i.test(d.blockedOn) && blockedChip(d))],
    h('span', { class: 'k' }, t('d.prio')), h('div', null, prioSel),
    h('span', { class: 'k' }, t('d.labels')), labels,
    h('span', { class: 'k' }, t('d.parent')), h('div', null, parentEl),
    h('span', { class: 'k' }, t('d.related')), related,
    L.blocks.length && [h('span', { class: 'k' }, t('d.blocks')), h('div', { class: 'links' }, linkChips(L.blocks))],
    L.duplicateOf.length && [h('span', { class: 'k' }, t('d.dupof')), h('div', { class: 'links' }, linkChips(L.duplicateOf))],
    L.duplicates.length && [h('span', { class: 'k' }, t('d.dups')), h('div', { class: 'links' }, linkChips(L.duplicates))],
    markDup && [h('span', { class: 'k' }, ''), h('div', null, markDup)],
    autoGo && [h('span', { class: 'k' }, t('d.auto')), h('div', null, autoGo)],
    d.source && [h('span', { class: 'k' }, t('d.source')), h('div', null, sourceBadge(d))],
    d.origin && [h('span', { class: 'k' }, t('d.origin')), d.originUrl
      ? h('a', { class: 'origin', href: d.originUrl, title: t('d.origin.open') }, d.origin)
      : h('span', { class: 'origin' }, d.origin)],
    d.rejectReason && [h('span', { class: 'k' }, t('d.rejected')), h('span', null, REJECT_REASONS.includes(d.rejectReason) ? t('reason.' + d.rejectReason) : d.rejectReason)],
    h('span', { class: 'k' }, t('d.opened')), h('span', null, d.opened || '—'),
    d.approved && [h('span', { class: 'k' }, t('d.approved')), h('span', null, d.approved)],
    d.closed && [h('span', { class: 'k' }, t('d.closed')), h('span', null, d.closed)],
    d.branches?.length && [h('span', { class: 'k' }, t('d.branches')), h('div', { class: 'links' }, d.branches.map(b =>
      h('a', { class: 'parent-chip', href: 'changes.html' }, `${b.branch.replace(/^agent\//, '')} · ${t('branch.' + b.state)}`)))]);

  // Description: rendered, checkboxes toggle their source line; "Modifica" swaps in a textarea.
  const descView = h('div', { class: 'md', html: d.desc ? md(d.desc) : `<p class="muted">${esc(t('d.desc.none'))}</p>` });
  descView.addEventListener('change', e => {
    const n = e.target.dataset?.line;
    if (n == null) return;
    const lines = d.desc.split('\n');
    lines[+n] = lines[+n].replace(/\[([ xX])\]/, e.target.checked ? '[x]' : '[ ]');
    patch({ desc: lines.join('\n') });
  });
  const descBox = h('div', null, descView);
  const editBtn = h('button', { class: 'btn ghost', onclick: () => {
    const ta = h('textarea', { rows: Math.min(30, Math.max(8, d.desc.split('\n').length + 2)) });
    ta.value = d.desc;
    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      saveBtn.disabled = true;
      if (!await patch({ desc: ta.value })) saveBtn.disabled = false;
    } }, t('save'));
    descBox.replaceChildren(ta, h('div', { class: 'edit-actions' }, h('button', { class: 'btn', onclick: () => renderDetail() }, t('cancel')), saveBtn));
    editBtn.hidden = true; ta.focus();
  } }, t('d.desc.edit'));

  const subs = d.parent ? null : [
    h('div', { class: 'section-h' }, t('d.subs', d.children.filter(c => c.state === 'done').length, d.children.length),
      h('button', { class: 'btn ghost', onclick: () => newIssue('todo', d) }, t('d.subs.add'))),
    d.children.length
      ? h('ul', { class: 'children' }, d.children.map(c => h('li', { tabindex: 0, onclick: () => openIssue(c.id),
        onkeydown: e => { if (e.key === 'Enter') openIssue(c.id); } }, statusIcon(c.column), h('span', { class: 'muted' }, '#' + c.id), h('span', null, c.title))))
      : h('p', { class: 'muted' }, t('d.subs.none'))];

  const comments = d.commentList.map(c => h('div', { class: 'comment' },
    h('div', { class: 'comment-h' }, h('b', null, c.author), c.date),
    h('div', { class: 'md', html: md(c.text) })));
  const cIn = h('textarea', { rows: 3, placeholder: t('d.comment.ph') });
  const cBtn = h('button', { class: 'btn primary', onclick: async () => {
    if (!cIn.value.trim()) return;
    cBtn.disabled = true;
    if (await patch({ comment: cIn.value })) toast(t('d.comment.added')); else cBtn.disabled = false;
  } }, t('d.comment'));
  cIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cBtn.click(); });

  const hist = d.history.commits.length
    ? h('ul', { class: 'hist' }, d.history.commits.map(c => h('li', null, h('code', null, c.hash), h('span', null, c.subject),
      h('span', { class: 'when', title: new Date(c.date).toLocaleString(LOCALE()) }, relTime(c.date)))))
    : h('p', { class: 'muted' }, t('d.history.none'));

  // A proposal was not written by the owner (second brain: from untrusted material; system: the
  // daily suggestions): it becomes work for the agent only once approved, on the confirm page.
  // Reason/note feed the next suggestions.
  let proposal = null;
  if (d.column === 'proposed') {
    const note = h('input', { type: 'text', maxlength: 1000, placeholder: t('p.note'), 'aria-label': t('p.note') });
    const [chips, reason] = reasonChips();
    const decide = async (body, btn) => { btn.disabled = true; if (!await patch(body)) btn.disabled = false; };
    const e = ENTRY(ENTRY_IDS.includes(d.entry) ? d.entry : 'other');
    proposal = h('div', { class: 'proposal' },
      h('p', null, h('b', null, e.warn[0]), e.warn[1]),
      L.possibleDuplicate.length && h('div', { class: 'possible-dup' }, h('b', null, t('p.possibledup')), linkChips(L.possibleDuplicate)),
      note,
      h('p', { class: 'muted reasons-h' }, t('p.why')), chips,
      h('div', { class: 'edit-actions' },
        L.possibleDuplicate.length && h('button', { class: 'btn', title: t('p.rejectdup.title', L.possibleDuplicate[0].id),
          onclick: ev => decide({ duplicateOf: L.possibleDuplicate[0].id, note: note.value }, ev.currentTarget) }, t('p.rejectdup')),
        h('button', { class: 'btn', onclick: ev => decide({ reject: { reason: reason(), note: note.value } }, ev.currentTarget) }, t('p.reject')),
        h('button', { class: 'btn', title: t('p.approve.backlog.title') + ' — ' + t('p.confirm'),
          onclick: ev => { ev.currentTarget.disabled = true; approve(d, 'backlog', note.value); } }, t('p.approve.backlog')),
        h('button', { class: 'btn primary', title: t('p.approve.title') + ' — ' + t('p.confirm'),
          onclick: ev => { ev.currentTarget.disabled = true; approve(d, 'todo', note.value); } }, t('p.approve'))));
  }

  // Stale backlog: decide with one tap. The agent never takes an issue out of Backlog by itself.
  let stale = null;
  if (d.stale) {
    const note = h('input', { type: 'text', maxlength: 1000, placeholder: t('p.note'), 'aria-label': t('p.note') });
    const [chips, reason] = reasonChips();
    const decide = async (body, btn) => { btn.disabled = true; if (!await patch({ backlog: body })) btn.disabled = false; };
    stale = h('div', { class: 'proposal' },
      h('p', null, h('b', null, t('s.title', d.stale)), t('s.text')),
      note,
      h('p', { class: 'muted reasons-h' }, t('p.why')), chips,
      h('div', { class: 'edit-actions' },
        h('button', { class: 'btn', onclick: ev => decide({ action: 'reject', reason: reason(), note: note.value }, ev.currentTarget) }, t('p.reject')),
        h('button', { class: 'btn', title: t('s.keep.title'),
          onclick: ev => decide({ action: 'keep', note: note.value }, ev.currentTarget) }, t('s.keep')),
        h('button', { class: 'btn primary', title: t('s.todo.title'),
          onclick: ev => decide({ action: 'todo', note: note.value }, ev.currentTarget) }, t('s.todo'))));
  }

  // Shape rules (issues/README.md): the worker can't see work in an issue shaped like this.
  const problems = d.problems?.length && h('div', { class: 'proposal' },
    h('p', null, h('b', null, t('shape.title')), t('shape.text')),
    h('ul', null, d.problems.map(x => h('li', null, x))));

  body.replaceChildren(title, proposal || '', stale || '', problems || '', props,
    h('div', { class: 'section-h' }, t('d.desc'), editBtn), descBox,
    ...(subs || []),
    h('div', { class: 'section-h' }, t('d.comments', d.commentList.length)), ...comments, cIn, h('div', { class: 'edit-actions' }, cBtn),
    h('div', { class: 'section-h' }, t('d.history')), hist);
}

// ---------- new issue ----------

function newIssue(col = 'todo', parent = null, push = true) {
  S.open = null; S.detail = null;
  go('#new', push);
  const title = h('input', { type: 'text', class: 'title-input', placeholder: t('n.title'), maxlength: 200, required: true });
  const colSel = h('select', { 'aria-label': t('d.status') }, COLS().filter(([v]) => v !== 'done' && v !== 'proposed').map(([v, n]) => h('option', { value: v }, n)));
  colSel.value = col === 'done' || col === 'proposed' ? 'todo' : col;
  const prioSel = h('select', { 'aria-label': t('d.prio') }, PRIOS().map(([v, n]) => h('option', { value: v }, n)));
  prioSel.value = 'none';
  const labIn = h('input', { type: 'text', placeholder: t('n.labels'), list: 'label-list-new' });
  const desc = h('textarea', { rows: 12, placeholder: t('n.desc') });
  const create = h('button', { class: 'btn primary', type: 'submit' }, t('n.create'));
  const form = h('form', { class: 'new-form' },
    parent && h('p', { class: 'muted small' }, t('n.sub', parent.id, parent.title)), title,
    h('div', { class: 'row' }, colSel, prioSel, labIn,
      h('datalist', { id: 'label-list-new' }, allLabels().map(l => h('option', { value: l })))),
    desc, h('div', { class: 'edit-actions' }, create));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!title.value.trim()) return;
    const body = {
      title: title.value.trim(), desc: desc.value, column: colSel.value, priority: prioSel.value,
      labels: labIn.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      ...(parent ? { parent: parent.id } : {}),
    };
    if (body.column === 'blocked') {
      const w = prompt(t('move.blocked'), 'user');
      if (!w || !w.trim()) return;
      body.blockedOn = w.trim();
    }
    create.disabled = true;
    try {
      const i = await api('POST', '/api/issues', body);
      toast(t('n.created', i.id));
      await refresh();
      openIssue(i.id, false);
    } catch (err) { fail(err); create.disabled = false; }
  });
  $('#d-id').textContent = parent ? t('n.newsub') : t('n.new');
  $('#d-dirty').textContent = '';
  $('#d-body').replaceChildren(form);
  $('#drawer').hidden = false;
  title.focus();
}

// ---------- approvals, waiting changes ----------

// Approving a proposal happens on the confirm page (another origin, rendered by the server): ask the
// server for its address and go there. The page sends the browser back here when done.
async function approve(i, status, note) {
  try {
    const r = await api('POST', '/api/confirm', { action: 'approve-proposal', id: i.id, status, note: note || '' });
    location.href = r.url;
  } catch (e) { fail(e); refresh(); }
}
function renderWaiting() {
  const el = $('#waiting');
  el.hidden = !S.waiting;
  if (S.waiting) el.replaceChildren(icon('shield'), h('span', null, t('waiting.banner', S.waiting)));
}

// ---------- login / boot ----------

// Sign-in lives on the confirm origin (the password never reaches this page's code).
function showLogin(url) {
  const go = u => { location.href = `${u}?next=${encodeURIComponent(location.href)}`; };
  if (url) return go(url);
  fetch('/api/whoami', { credentials: 'same-origin' }).then(r => r.json()).then(w => go(w.login)).catch(() => {});
}
function showApp() { $('#app').hidden = false; }
// Texts in index.html that don't come from a render function.
function staticTexts() {
  document.title = t('app.title');
  $('#q').placeholder = t('search'); $('#q').setAttribute('aria-label', t('search.aria'));
  $('#new').textContent = t('new'); $('#new').title = t('new.title');
  $('#logout').textContent = t('logout');
  $('#settings-link').title = t('settings'); $('#settings-link').setAttribute('aria-label', t('settings'));
  $('#auto-pill').title = t('auto.title');
  for (const b of document.querySelectorAll('[data-clear]')) { b.title = t('filter.clear'); b.setAttribute('aria-label', t('filter.clear')); }
  for (const b of document.querySelectorAll('[data-close]')) b.setAttribute('aria-label', t('close'));
  if (S.issues.length) { renderFilters(); renderBoard(); }
}
staticTexts();
$('#settings-link').append(icon('gear'));

$('#logout').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch { /* ignore */ } showLogin(); });
$('#waiting').addEventListener('click', () => { location.href = 'changes.html'; });
$('#new').addEventListener('click', () => newIssue(MOBILE.matches ? S.tab : 'todo'));
$('#q').addEventListener('input', e => { S.q = e.target.value.trim(); renderBoard(); });
$('#f-prio').addEventListener('change', e => { S.prio = e.target.value; syncClear(); renderBoard(); });
$('#f-label').addEventListener('change', e => { S.label = e.target.value; syncClear(); renderBoard(); });
for (const b of document.querySelectorAll('[data-clear]')) b.addEventListener('click', () => {
  const id = b.dataset.clear;
  S[CLEAR[id]] = ''; $(`#${id}`).value = ''; syncClear(); renderBoard();
});
$('#f-stale').addEventListener('click', () => {
  S.stale = !S.stale;
  if (S.stale) { S.tab = 'backlog'; localSet('tab', S.tab); }
  renderFilters(); renderBoard();
});
$('#f-entry').addEventListener('change', e => { S.entry = e.target.value; renderBoard(); });
$('#drawer').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDrawer(); });
MOBILE.addEventListener('change', renderBoard);

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && !$('#drawer').hidden) { if (typing) document.activeElement.blur(); else closeDrawer(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('#app').hidden) return;
  if (e.key === 'c' && $('#drawer').hidden) { e.preventDefault(); newIssue(MOBILE.matches ? S.tab : 'todo'); }
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
});

// The agent and the monitor edit the same files: pick up outside changes when the page is visible.
setInterval(() => { if (!document.hidden && !$('#app').hidden) refresh(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) refresh(); });

refresh().then(() => { if (!$('#app').hidden && /^#\d+$/.test(location.hash)) openIssue(location.hash.slice(1)); });
