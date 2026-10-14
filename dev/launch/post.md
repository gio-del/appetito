# LinkedIn post (draft — the owner publishes)

Status: final candidate (2026-10-14), waiting for the owner's approval. Not to be published before the launch gate is green (docs/PRD.md §10).

---

🇬🇧 English in the first comment

**L'appetito vien mangiando**

Avevo un telefono vecchio in un cassetto.

Ho provato a farne un server di casa. Prima il root (si scopre che un agente AI ti accompagna anche lì, passo per passo, trappole comprese), poi Debian dentro Android, poi i servizi: password manager, blocco della pubblicità, un calendario mio.

Poi è diventato un second brain: scrivo una nota sul telefono e un agente la smista, la archivia, la mette in calendario. E se la nota è un'idea per il server, la propone come lavoro.

E alla fine il server ha iniziato a evolversi da solo. Scrivo cosa voglio come issue, la sposto in "Da fare", e un agente la sviluppa, la prova e la mette in produzione. Se qualcosa si rompe, torna indietro da solo e apre una issue per sistemarla.

La parte su cui ho lavorato di più è quella che non si vede: l'agente non ha root, non mette niente in produzione da solo (lo fa un runner separato, e solo se i controlli passano), non può allentare i propri limiti e non esegue mai una proposta che non ho approvato io. Non perché glielo chiedo, ma perché il sistema operativo non glielo permette.

Oggi lo rendo open source: si chiama **appetito**.
→ È un seme, non un prodotto: lo cloni e diventa tuo.
→ Funziona con Claude Code o con qualsiasi endpoint compatibile OpenAI, anche un modello locale sulla tua macchina.
→ Debian o Ubuntu, amd64 (arm64: installazione e test provati solo in emulazione). Un box dedicato, non il tuo PC.

github.com/gio-del/appetito

(Il telefono? Ancora nel cassetto, ancora acceso.)

#selfhosting #opensource #homelab #ai

---

## First comment (English)

**Appetite comes with eating**

I had an old phone in a drawer.

I tried to turn it into a home server. Rooting first (turns out an AI agent can walk you through that too, traps included), then Debian inside Android, then services: a password manager, ad blocking, my own calendar.

Then it became a second brain: I write a note on my phone and an agent sorts it, files it, puts it in my calendar. If the note is an idea for the server, it proposes it as work.

And in the end the server started evolving itself. I write what I want as an issue, move it to "To do", and an agent builds it, tests it and deploys it. If something breaks, it rolls back on its own and opens an issue to fix it.

The part I worked on most is the one you don't see: the agent has no root, never deploys anything itself (a separate runner does, and only if the checks pass), can't loosen its own limits, and never runs a proposal I haven't approved. Not because it's asked to, but because the operating system doesn't let it.

Today I'm open-sourcing it: **appetito**.
→ A seed, not a product: you clone it and it becomes yours.
→ Works with Claude Code or any OpenAI-compatible endpoint, including a local model on your own machine.
→ Debian or Ubuntu, amd64 (arm64: install and tests checked under emulation only). A dedicated box, not your laptop.

github.com/gio-del/appetito

(The phone? Still in the drawer, still on.)

---

## Media
- Video: `dev/video/out/appetito-launch.mp4` (1080×1920, 60 fps, 41 s), composed from a real e2e run (`tests/e2e/run --scenario video`): the agent adds Vaultwarden, hands over the owner's steps, closes it.
- Screenshots, frames of the same run (sandbox, never the real system), in `dev/launch/media/`: `1-backlog.jpg` the starter backlog; `2-live.jpg` the live worker page mid-run; `3-for-you.jpg` the owner's (HITL) steps ticked; `4-done.jpg` the issue closed, branch merged.
