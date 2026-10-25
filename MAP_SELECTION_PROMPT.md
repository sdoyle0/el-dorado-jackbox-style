# New-session prompt: map selection UI

Build a user-facing map selector for new game rooms in this repository.

## Context

- The game now composes board tiles from `shared/pieces.json` and
  `shared/layouts/*.js` via `shared/mapCompose.js`.
- `server/game/GameManager.js` has a map registry and accepts a map ID when a
  room is created. `client/src/main.js` currently reads a `?map=` query
  parameter instead of offering a UI choice.
- Hills of Gold is the verified playable layout and must remain the default.
- First Play is a draft and currently fails its connectivity proof. Do not
  expose it as a playable choice unless its layout is corrected, visually
  checked against the setup diagram, and its proof passes.
- The browser Map Studio at `tools/mapbuilder/` is a separate authoring tool;
  do not conflate its local map-building controls with the game lobby selector.

## Requirements

1. Add a clear map choice to the new-room/lobby flow, with a human-readable
   name and concise description for each eligible map.
2. Keep Hills of Gold selected by default and preserve the existing default
   game behavior when no map is specified.
3. Populate choices from a shared, trusted source where practical, rather than
   maintaining inconsistent client and server lists. The server must validate
   submitted IDs against its own allowlist; never load an arbitrary path or
   module from client input.
4. Pass the selected map ID through the existing room-creation flow and use
   that room's selected layout for the game. Do not allow a map change after
   the game starts.
5. Make the choice understandable and usable in the existing responsive
   desktop/phone/TV views. Check whether the selected map should be shown in
   the waiting room so all players know which layout the host chose.
6. Add focused tests for the default, valid selection, and invalid map ID.
   Verify that Hills of Gold still matches the canonical map and seams.
7. Do not modify tile geometry or promote any unverified layout as part of
   this task. If only Hills of Gold is verified, present only that map and
   make the structure ready for verified maps to be added later.

Inspect the current worktree before editing and preserve unrelated staged or
unstaged changes. Run the smallest relevant checks and report any known
baseline failures separately from regressions.
