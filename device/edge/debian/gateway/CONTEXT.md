# Gateway

The root folder (`~/projects` on the server) is not a project itself: it is the Gateway, a lightweight orchestration layer that tracks the state of every independent project repo in its subfolders, so that "what's going on across all my projects" is answerable without opening each one. Same terms as the Gateway on the owner's PC.

## Language

**Gateway**:
The root folder and its `GATEWAY.md`. Not a project: it has no product code of its own, only the bookkeeping that indexes the real projects.
_Avoid_: Root, monorepo (there is no shared code between projects; each project repo is fully independent)

**Project**:
One subfolder of the Gateway, backed by its own independent Git repository, with a corresponding entry in `GATEWAY.md`. On the server the list of Projects is home-server's `device/edge/debian/projects`; home-server itself is one of them.
_Avoid_: Repo (a Project always has a repo, but "repo" alone doesn't capture that it's also a tracked Gateway entry)

**App**:
A Project's running service on this server (e.g. Sumisura's web app), installed from a pinned commit by home-server and reached from the dashboard group "Progetti". A Project may have none.
_Avoid_: Deployment, instance

**Checkpoint**:
The commit hash recorded against a Project in `GATEWAY.md`. On the server it is the HEAD of the Project's folder when `gateway-sync` last ran (hourly); on the PC, the last commit `/update-gateway` has already processed.
_Avoid_: Last hash, cursor

**Status**:
The current lifecycle stage of a Project, one of four fixed values: `active` (work in progress), `paused` (exists, not being worked on now, may resume), `archived` (deliberately closed), `idea` (registered intent, no repo/folder yet).
_Avoid_: State, phase

**Snapshot**:
The nature of a Project's entry in `GATEWAY.md`: it reflects only the current state, overwritten on each `/update-gateway` run. History lives in each Project's own Git log.
_Avoid_: Changelog, history
