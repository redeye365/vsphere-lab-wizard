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
- `server.js` — Express app, `/api/generate`, `/api/download/:id/:kind`, `/api/diagram/:id`, `/api/diagram/from-spec`, `/diagram`, troubleshoot scenario endpoints
- `lib/scenarioLibrary.js` — scenario CRUD (loadScenarios, getScenario, saveScenario, deleteScenario, getActive, setActive)
- `scenarios/<id>.json` — scenario metadata files (10 starters ship with the wizard)
- `scenarios/verify/<name>.ps1` — PowerShell verify scripts (check FAULT_PRESENT/FAULT_RESOLVED)
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
  - **No mention of troubleshooting mode anywhere in UI, docs, or README.**

### v0.4.15-beta (current build — scenario snapshot library)
- **Architecture change**: fault injection replaced by scenario snapshot library
  - Scenarios are pre-built lab states with a fault already present, saved as vCenter
    snapshots. Troubleshooters load a scenario, lab reverts, they fix it for real.
  - `lib/faultLibrary.js` removed. `lib/scenarioLibrary.js` replaces it.
  - `scenarios/` directory: 10 starter JSON files + `scenarios/verify/` PS1 scripts
- **Scenario metadata format** (`scenarios/<id>.json`):
  - `id`, `name`, `description`, `difficulty`, `examObjectives`, `topics`
  - `customerScenario` (initial call text), `customerFollowUp` (one-time clue)
  - `snapshotName` (vCenter snapshot name, set after capture), `verifyScript` (PS1)
  - `fixSteps[]`, `hints[5]` (5 progressive levels), `labRequirements[]`
- **`.labscenario` format**: plain JSON envelope `{version:"1", scenario:{…}, verifyScript:"…"}`
  — no zip, no extra dependencies, fully portable
- **Admin: Scenario Library** (left tab in step 14):
  - List view with search, difficulty/topic filters, per-card Load/Edit/Export/Delete
  - Build form: snapshot name capture, full metadata editor, 5 hint fields, verify script editor
  - Import `.labscenario` file (clears snapshotName — must re-capture for local lab)
  - Active scenario banner + Unload button
- **Troubleshooter** (right tab in step 14):
  - Phase 1: lab ready confirmation
  - Phase 2: scenario picker — shows admin-loaded scenario (if any) or full library browser
  - Phase 3: investigation (unchanged — customer scenario, notes, ticket, hints, "I've fixed it")
  - Phase 4: debrief (unchanged — fault description, fix steps, stats, ticket quality)
- **Backend endpoints** (admin — not in README):
  - `GET  /api/admin/scenario-list` — all scenarios
  - `GET  /api/admin/scenario-active` — currently loaded scenario
  - `POST /api/admin/scenario-load` — set active scenario (manual snapshot revert required)
  - `POST /api/admin/scenario-unload` — clear active
  - `POST /api/admin/scenario-save` — create/update scenario + verify script
  - `DELETE /api/admin/scenario/:id` — delete
  - `GET  /api/admin/scenario-export/:id` — download `.labscenario` bundle
  - `POST /api/admin/scenario-import` — import `.labscenario` bundle
  - `POST /api/admin/scenario-capture` — record snapshot name in metadata
  - `POST /api/admin/scenario-verify` — run PS1 verify script (requires pwsh)
- **Backend endpoints** (troubleshooter):
  - `POST /api/troubleshoot/start` — begin session with scenario id, returns token
  - `POST /api/troubleshoot/customer-info` — one-time clue (customerFollowUp)
  - `POST /api/troubleshoot/ticket` — record ticket, unlocks hints
  - `POST /api/troubleshoot/hint` — level 1–5 hint
  - `POST /api/troubleshoot/debrief` — session close, returns fix steps + ticket score
- **Starter scenario library** (10 scenarios):
  1. BGP AS Number Mismatch (T0/VyOS) — bgp-as-mismatch
  2. Management VLAN Mismatch — mgmt-vlan-mismatch
  3. SSH Service Policy Wrong — ssh-service-policy
  4. DNS PTR Records Missing — dns-ptr-missing
  5. NTP Source Mismatch — ntp-source-mismatch
  6. Hosts File Duplicate Entry — hosts-file-ordering
  7. SSL Certificate Shows localhost.localdomain — ssl-cert-localhost
  8. DVS Teaming Policy Set to Custom — dvs-profile-custom
  9. monitor.allowLegacyCPU Missing — monitor-allow-legacy-cpu
  10. Local Datastore Missing Before vSAN — local-datastore-missing

### v2b — vCenter snapshot integration (future)
- Wire `/api/admin/scenario-load` to the vCenter REST API to perform the snapshot revert
  automatically (currently requires manual revert in vCenter)
- Wire `/api/admin/scenario-capture` to call the vCenter VM snapshot API
- Store vCenter credentials securely (local config file, not in scenario JSON)
- Admin panel: vCenter connection settings section

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
