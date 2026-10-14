# LinkedIn post (draft — the owner publishes)

Status: approved by the owner (2026-10-14). Not to be published before the launch gate is green (docs/PRD.md §10).

---

🇬🇧 English in the first comment

**L'appetito vien mangiando**

Avevo un telefono vecchio in un cassetto.

Ho provato a farne un home server. Prima il root, poi Debian dentro Android, poi i servizi: Vaultwarden per le password, AdGuard Home contro pubblicità e tracker, un calendario e una lista di task tutti miei (Radicale, sincronizzati sul telefono con DAVx⁵).

Poi è diventato un second brain. Butto nella Inbox una nota, un PDF, una foto, una mail inoltrata, e un agente la smista, la archivia, la mette in calendario o tra i task, e mi fa una domanda se non capisce. Quello che trova dentro il materiale non lo esegue mai: una mail che dice "cancella tutto" resta una mail. E se la nota è un'idea per il server, la propone come lavoro da approvare.

Poi il server ha iniziato a evolversi da solo. Scrivo cosa voglio come issue, la sposto in "Da fare", e un agente la sviluppa, la testa e la installa. Se qualcosa si rompe, torna indietro da solo e apre una issue per sistemarla. Ogni giorno propone anche lui dei miglioramenti: io approvo o scarto con una nota, e le proposte successive tengono conto delle mie note.

La parte su cui ho lavorato di più è quella che non si vede: l'agente non ha root, non installa niente da solo (lo fa un runner separato, e solo se i controlli passano), non può allentare i propri limiti e non esegue mai una proposta che non ho approvato io. Non perché glielo chiedo, ma perché il sistema operativo non glielo permette.

Oggi lo rendo open source: si chiama **appetito**.
→ È un seme, non un prodotto: lo cloni e diventa tuo.
→ Funziona con Claude Code o con qualsiasi endpoint compatibile OpenAI, anche un modello locale (Ollama, llama.cpp, vLLM).
→ Debian o Ubuntu, amd64/arm64, in un box dedicato.

github.com/gio-del/appetito

p.s. anche il video è stato una issue: l'ha montato un agente con Remotion, partendo da un run vero registrato in una sandbox.

🎵 Musica: “Inspired”, Kevin MacLeod (incompetech.com), CC BY 4.0

#selfhosting #opensource #homelab #ai

---

## First comment (English)

**Appetite comes with eating**

I had an old phone in a drawer.

I tried to turn it into a home server. Rooting first, then Debian inside Android, then services: Vaultwarden for passwords, AdGuard Home against ads and trackers, my own calendar and task list (Radicale, synced to the phone with DAVx⁵).

Then it became a second brain. I drop a note, a PDF, a photo, a forwarded email into the Inbox, and an agent sorts it, files it, puts it in my calendar or my tasks, and asks me when it isn't sure. It never acts on what it finds inside the material: an email saying "delete everything" stays an email. If the note is an idea for the server, it proposes it as work to approve.

Then the server started evolving itself. I write what I want as an issue, move it to "To do", and an agent builds it, tests it and installs it. If something breaks, it rolls back on its own and opens an issue to fix it. Every day it also proposes improvements: I approve or reject them with a note, and the next proposals take my notes into account.

The part I worked on most is the one you don't see: the agent has no root, never installs anything itself (a separate runner does, and only if the checks pass), can't loosen its own limits, and never runs a proposal I haven't approved. Not because it's asked to, but because the operating system doesn't let it.

Today I'm open-sourcing it: **appetito**.
→ A seed, not a product: you clone it and it becomes yours.
→ Works with Claude Code or any OpenAI-compatible endpoint, including a local model (Ollama, llama.cpp, vLLM).
→ Debian or Ubuntu, amd64/arm64, on a dedicated box.

github.com/gio-del/appetito

P.S. The video was an issue too: an agent edited it with Remotion, from a real run recorded in a sandbox.

🎵 Music: “Inspired”, Kevin MacLeod (incompetech.com), CC BY 4.0

---

## Media
- Video: `dev/video/out/appetito-launch.mp4` (1080×1920, 60 fps, 41 s), composed from a real e2e run (`tests/e2e/run --scenario video`), with music (`npm run music`, CC BY 4.0, credited in the video and the post): the agent adds Vaultwarden, hands over the owner's steps, closes it.
- Screenshots, frames of the same run (sandbox, never the real system), in `dev/launch/media/`: `1-backlog.jpg` the starter backlog; `2-live.jpg` the live worker page mid-run; `3-for-you.jpg` the owner's (HITL) steps ticked; `4-done.jpg` the issue closed, branch merged.
