# vSphere Lab Wizard — Developer Context

This file is loaded automatically by Claude Code. It captures architectural decisions,
current roadmap state, and working constraints so every session starts with full context.

---

## Project overview

A local Express.js wizard (port 3000) that guides a user through designing a nested
vSphere lab and generates ready-to-run PowerShell/bash automation scripts, a design
document, network diagram, and build guide. No framework (React/Vue/etc.) — plain
HTML/CSS/JS in `public/`. Server-side generation only (no client-side bundling).

Key files:
- `server.js` — Express app, `/api/generate`, `/api/download/:id/:kind`, `/api/diagram/:id`, `/api/diagram/from-spec`, `/diagram`, quiz endpoint
- `public/index.html` — all wizard steps in one HTML file
- `public/wizard.js` — all client state, step logic, form wiring
- `public/style.css` — all styles
- `public/diagram.html` — standalone diagram viewer (live Mermaid, zoom/pan, download SVG/PNG, file picker, session load)
- `lib/generateSpec.js` — builds the canonical spec object from wizard answers
- `lib/sizing.js` — resource maths (vCPU / vRAM totals, warnings)
- `lib/validateAnswers.js` — server-side input validation
- `lib/generatePowerShell.js` — main script generator
- `lib/generateNsx.js` — NSX-T deploy/configure/BGP scripts
- `lib/generateBuildGuide.js` — step-by-step human build guide
- `lib/generateMarkdown.js` — design-doc.md
- `lib/generateNetworkDiagram.js` — Mermaid flowchart
- `lib/generateDiagramHtml.js` — standalone diagram.html with embedded mermaid source
- `lib/generatePrerequisites.js` — PREREQUISITES.md
- `lib/generateDepot.js` — optional local depot scripts

### Packaging

`IS_PKG` / `BASE_DIR` pattern supports `pkg` standalone executable. All writable
output goes to `BASE_DIR` (next to the binary), never `__dirname` (read-only snapshot).

---

## Step numbering (as of v0.4.8-beta)

| # | Step name | Notes |
|---|-----------|-------|
| 0 | Use case | |
| 1 | Hardware | Per-host specs when hostCount > 1 |
| 2 | ESXi version | |
| 3 | Virtual router (VyOS) | |
| 4 | Domain controller | |
| 5 | Existing network | |
| 6 | Lab networks | |
| 7 | Nested cluster | Placement section shown when hostCount > 1 |
| 8 | NSX-T | Always shown |
| 9 | Nested disks | |
| 10 | Bundle depot | `depotStepVisible()` gates on vSAN + local_datastore |
| 11 | Workload VMs | |
| 12 | Security & access | |
| 13 | Review & generate | Live Mermaid diagram preview; `TOTAL_STEPS - 2` |
| 14 | Troubleshooting | Hidden; activated via Ctrl+Shift+X / Cmd+Shift+X |

`TOTAL_STEPS = 15`, `DEPOT_STEP = 10`, `NSX_STEP = 8`, `TROUBLESHOOT_STEP = 14`

---

## Security constraints (permanent — do not remove)

- **No PATs in remote URLs.** SSH-only: `git@github.com:redeye365/vsphere-lab-wizard.git`
- Three leaked PATs have been revoked — they MUST NOT be referenced, regenerated, or
  re-used under any circumstances. If git operations fail, investigate SSH key auth only.
- git config: `user.email = claude.faceless597@passmail.net`, `user.name = redeye365`

---

## Spec schema version history

| schemaVersion | Added in | Key changes |
|---------------|----------|-------------|
| 1 | v0.1 | Initial |
| 2 | v0.2 | remoteAccess, workloadVms |
| 3 | v0.4 | nsx section, extendMode flag |
| 4 | v0.4.8-beta | `physicalHosts[]` array (multi-host); `nestedCluster.hosts[]` placement; `nestedCluster.hostPlacement` ('auto'/'manual') |

---

## Versioning roadmap

### v1.0 (shipped)
Core wizard: physical host → networks → DC → VyOS → nested cluster → depot →
workloads → security → review. Generates PowerShell scripts, design doc, build guide,
network diagram, prerequisites.

### v0.4.9-beta (current build — diagram viewer)
- **Network diagram viewer** (`/diagram` route, `public/diagram.html`):
  - Live Mermaid render in review screen (step 13) — auto-updates on entry, "Open in viewer" link
  - Standalone `/diagram` viewer: file picker for spec.json, session ID load, zoom/pan, fullscreen, download SVG/PNG, component key
  - "View Diagram" button in left rail (always visible); updates to `?id=<session>` after generate
  - `diagram.html` included in every generated output (CDN Mermaid, embedded source, standalone)
  - New endpoints: `GET /api/diagram/:id`, `POST /api/diagram/from-spec`, `GET /diagram`
- **Multi-host support** (v0.4.8-beta):
  - Per-host hardware collection (step 1) when hostCount > 1
  - Nested VM placement: auto (round-robin) or manual assignment
  - deploy-lab.ps1: `$physicalHostGroups` loop; per-host port group creation
  - sizing.js: per-host RAM/CPU checks
  - Network diagram: PHYS1/PHYS2 subgraphs
  - schemaVersion 4

### v1.5 → v0.4-beta
- NSX-T wizard step (step 8): Small/Medium sizing; T0T1 / T0T1DFW / Full topology;
  BGP peering auto-populated from VyOS config (AS 65001/65002).
  Generates: nsx-deploy.ps1, nsx-configure.ps1, nsx-bgp.ps1
- Spec versioning: "Extend existing lab" option loads a prior spec.json back into the
  wizard; only new/changed scripts are regenerated.
- Troubleshooting mode (hidden, Ctrl+Shift+X / Cmd+Shift+X):
  - Amber fixed badge; step 14 added to rail (hidden by default)
  - Part 1: choose spec source (current answers or load spec.json)
  - Ticket logging form (symptom / tried / cause / impact); completeness gates hint level
  - Part 2: 5–10 MC quiz questions generated from actual spec values via
    `/api/troubleshoot/generate-quiz`; pass = ≥70%; fail shows hint system
  - Progressive hint system: 5 levels (Nudge → Direction → Clue → Near-answer →
    Full solution); personalized to spec values; ticket quality sets starting level
  - After ticket submit: "Ticket logged. Hint system ready for when fault injection
    is added in v2."
  - **No mention of troubleshooting mode anywhere in UI, docs, or README.**

### v2a — Fault injection (future)
- Inject deliberate misconfigurations into generated scripts/configs
- Broken VLAN, wrong NTP, misconfigured vSAN witness, MTU mismatch, etc.
- Troubleshooting mode quiz becomes a live diagnostic exercise
- Fault injection toggle in troubleshooting step (still hidden from normal users)

### v2b — Ticket logging wired (future)
- Replace placeholder ticket message with real ServiceNow / Jira / plain-file logging
- Ticket quality scoring becomes meaningful (auto-tagging, severity classification)
- Link tickets to fault injection session IDs

### v3 — VCF layer (future)
- SDDC Manager bring-up JSON generation
- VCF-aware step: commission hosts, define workload domains, network pools
- NSX step extended with VCF-specific transport zones and host profiles
- Warning when SSO domain clashes with AD domain (already tracked in quiz explanations)

---

## Coding conventions

- No frontend framework. All state in a plain `state` object in `wizard.js`.
- No build step. `public/` is served as-is.
- Server endpoints never trust client data — `validateAnswers()` runs on every generate.
- NSX configuration via REST (`Invoke-RestMethod`) — no full PowerCLI NSX module.
- `depotStepVisible()` is the canonical gating function; depot step only appears when
  vSAN is on AND local_datastore is a storage type in the spec.
- Step visibility in `showStep()` uses `TOTAL_STEPS - 2` for the review step index so
  the troubleshooting step can follow without hardcoding.
- Troubleshooting endpoints intentionally not in README, UI text, or any error messages.
