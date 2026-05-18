# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

PlayBlocker is a web app for theatrical stage blocking. Directors drag actor icons onto a stage diagram and annotate character movements in a script, with all positions saved to a backend API at `https://lwebber.ca/api`.

## Running locally

There is no build step — this is vanilla JS with ES modules. Open with VS Code Live Server (configured in `.vscode/settings.json`) or any static server that supports HTTPS (SSL certs are in `/ssl/`). Chrome debug is configured in `.vscode/launch.json`.

There is no test suite (`npm test` fails). Manual browser testing is the only option.

## Architecture

### Module layout

- **`/PlayBlocker.js`** (root, ~1200 lines) — Main entry point and front-end controller. Handles all user interaction: drag-and-drop, right-click movement creation, keyboard navigation, script loading, window resize.
- **`/Modules/Backend.js`** — Core data model: `DataStore` (singleton session state), `Speaker` (immutable actor), `Movement` (annotation with waypoints), `MovementList`, and `RP` (proportional coordinate).
- **`/Modules/Database.js`** — Thin fetch wrapper for all REST API calls.
- **`/Modules/ScriptText.js`** — Utilities for finding script page numbers and cursor position inside the script iframe.
- **`/Modules/Icons.js`** — SVG element creation for actor icons and movement markers.

### Key concepts

**Proportional coordinates (`RP`):** Actor positions are stored as fractions of the stage image dimensions (`rX`, `rY` in [0,1]). On window resize, pixel positions are recalculated from RP values. Never store raw pixel positions; always convert to/from RP.

**Movement creation workflow:** User right-clicks a paragraph in the script iframe → a `<span class="m-new">[?]</span>` is injected → user drags a speaker icon → drag-start binds the speaker to the movement, span updates to `<span class="m-normal">[XX]</span>` with actor initials → spacebar freezes waypoint markers along the path → drop on stage persists the movement.

**SVG connector lines:** Lines from speaker icon → waypoints → stage position are drawn inside each element's SVG with `overflow="visible"`. The `divGeometry()` helper normalises between speaker SVG viewBox (100×100) and marker viewBox (10×10) coordinates.

**Script display:** The script is rendered inside an isolated `<iframe>`. Context menus for movement creation are injected into the iframe's document. The `Selection` API detects cursor position within the iframe.

### Data flow

```
Browser (PlayBlocker.js)
  → Backend.js (DataStore / Speaker / Movement / RP)
  → Database.js (fetch)
  → REST API at https://lwebber.ca/api
```

### Authentication

Session-based with httpOnly cookies. Every page calls `validateSession()` on load; failed validation redirects to `index.html`. All `fetch` calls use `credentials: "include"`.

### Dependencies

- **interact.js** `^1.10.27` — touch-enabled drag-and-drop on actor icons and markers.
- **colors-named-hex** `^1.0.4` — CSS color name → hex lookup used when assigning speaker colors.

### Database schema

`PlayBlockerEER.mwb` (MySQL Workbench diagram) in the repo root documents the backend schema.
