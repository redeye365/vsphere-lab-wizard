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
- `server.js` — Express app, `/api/generate`, `/api/download/:id/:kind`, `/api/diagram/:id`, `/api/diagram/from-spec`, `/api/ks/:sessionId/:hostIndex`, `/diagram`, troubleshoot scenario endpoints
- `lib/scenarioLibrary.js` — scenario CRUD (loadScenarios, getScenario, saveScenario, deleteScenario, getActive, setActive)
- `lib/vcenterClient.js` — vSphere REST API client (createSession, listVMs, findSnapshot, revertAllToSnapshot, testConnection)
- `lib/vcenterConfig.js` — load/save vcenter-config.json from BASE_DIR (gitignored)
- `lib/hclData.js` — NIC HCL database: FLAGGED_NICS, KNOWN_GOOD_NICS, checkNic(model)
- `scenarios/<id>.json` — scenario metadata files (22 scenarios ship with the wizard)
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
- `lib/generateVcf.js` — VCF bring-up JSON (Cloud Builder workbook) + vcf-prep.ps1
- `lib/generateBuildGuide.js` — step-by-step human build guide
- `lib/generateMarkdown.js` — design-doc.md
- `lib/generateNetworkDiagram.js` — Mermaid flowchart
- `lib/generateDiagramHtml.js` — standalone diagram.html with embedded mermaid source
- `lib/generatePrerequisites.js` — PREREQUISITES.md (VCF section conditional on vcf.enabled)
- `lib/generateKickstart.js` — per-host ks.cfg files for unattended ESXi install (buildKickstartFiles, buildKickstartForHost)
- `lib/generateDepot.js` — optional local depot scripts

### Packaging

`IS_PKG` / `BASE_DIR` pattern supports `pkg` standalone executable. All writable
output goes to `BASE_DIR` (next to the binary), never `__dirname` (read-only snapshot).

---

## Step numbering (as of v0.6.0-beta)

| # | Step name | Notes |
|---|-----------|-------|
| 0 | Use case | |
| 1 | Hardware | NIC model + inline HCL check; per-host specs when hostCount > 1 |
| 2 | ESXi version | |
| 3 | Virtual router (VyOS) | |
| 4 | Domain controller | |
| 5 | Existing network | |
| 6 | Lab networks | |
| 7 | Nested cluster | ESA/OSA vSAN; memory tiering; placement when hostCount > 1 |
| 8 | NSX-T | Edge node count/size; BGP route advert mode; redistribution checkboxes |
| 9 | VCF Bring-up | Shown always; generates vcf-bringup.json + vcf-prep.ps1 when vcfEnabled |
| 10 | Nested disks | |
| 11 | Bundle depot | `depotStepVisible()` gates on vSAN + local_datastore |
| 12 | Workload VMs | |
| 13 | Security & access | |
| 14 | Review & generate | Live Mermaid diagram preview; `TOTAL_STEPS - 2` |
| 15 | Troubleshooting | Hidden; activated via Ctrl+Shift+X / Cmd+Shift+X |

`TOTAL_STEPS = 16`, `DEPOT_STEP = 11`, `NSX_STEP = 8`, `VCF_STEP = 9`, `TROUBLESHOOT_STEP = 15`

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
| 4 (extended) | v0.5.3-beta | Added to existing v4: `physicalHost.nicModel`; `nsx.edgeCount`, `nsx.edgeSize`, `nsx.bgpRouteAdvert`, `nsx.bgpPrefixes[]`, `nsx.redistConnected/Static/T1Lb`; `nestedCluster.memoryTiering`, `vsanArchitecture` |
| 4 (extended) | v0.6.0-beta | Added to existing v4: `vcf` section (enabled, sddcManagerIp, sddcManagerHostname, vcenterIp, vtepCidr/Vlan, edgeUplink1/2 Cidr/Vlan, esxiPassword, esxiLicense, vcenterLicense) |
| 4 (extended) | v0.6.3-beta | Added to existing v4: `nestedCluster.rootPassword` |
| 4 (extended) | v0.6.7-beta | Added to existing v4: `learningMode` (bool), `designRationale` (object with useCase, routerChoice, networkSecurity, availabilityRequirement, nsxRationale) |

---

## Versioning roadmap

### v1.0 (shipped)
Core wizard: physical host → networks → DC → VyOS → nested cluster → depot →
workloads → security → review. Generates PowerShell scripts, design doc, build guide,
network diagram, prerequisites.

### v0.4.9-beta (diagram viewer)
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

### v0.4.15-beta (scenario snapshot library)
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
  - `POST /api/admin/scenario-load` — set active + auto-revert vCenter snapshot if configured
  - `POST /api/admin/scenario-unload` — clear active
  - `POST /api/admin/scenario-save` — create/update scenario + verify script
  - `DELETE /api/admin/scenario/:id` — delete
  - `GET  /api/admin/scenario-export/:id` — download `.labscenario` bundle
  - `POST /api/admin/scenario-import` — import `.labscenario` bundle
  - `POST /api/admin/scenario-capture` — record snapshot name in metadata
  - `POST /api/admin/scenario-verify` — run PS1 verify script (requires pwsh)
  - `GET  /api/admin/vcenter-config` — return saved vCenter settings (password redacted)
  - `POST /api/admin/vcenter-config` — save vCenter connection settings to vcenter-config.json
  - `POST /api/admin/vcenter-test` — test vCenter connectivity (auth + immediate log-out)
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

### v0.5.1-beta (vCenter snapshot automation)
- **vCenter snapshot revert** wired in `POST /api/admin/scenario-load`:
  - Connects to vCenter using `vcenter-config.json` (gitignored, stored at BASE_DIR)
  - Lists all VMs via vSphere REST API, reverts any VM that has the named snapshot
  - Error `SNAPSHOT_NOT_FOUND`: surfaced to admin with clear message pointing to Capture button
  - Graceful fallback if vCenter not configured (admin can still revert manually)
- **vCenter snapshot capture** wired in `POST /api/admin/scenario-capture`:
  - Creates the snapshot on all VMs in vCenter inventory automatically
  - Snapshot name auto-generated (`scenario-<id>-<epoch>`) or admin-provided
  - Per-VM success/error reported back; name always recorded in scenario metadata
  - Graceful fallback if vCenter not configured — name recorded, admin creates manually
- **vCenter Settings panel** (⚙ vCenter button in Admin toolbar):
  - Form: server, username, password, trust self-signed cert checkbox
  - "Test Connection" — authenticate + immediate log-out to verify credentials
  - Credentials stored in `vcenter-config.json`, never in git
- **New endpoints**: `GET/POST /api/admin/vcenter-config`, `POST /api/admin/vcenter-test`
- **New lib files**: `lib/vcenterClient.js`, `lib/vcenterConfig.js` (no new npm deps — built-in `https` only)

### v0.5.3-beta (HCL NIC validation + NSX full depth + ESA/memory tiering)
- **HCL NIC validation** (step 1): inline check on blur against `lib/hclData.js`
  - Flagged (Realtek, I210/I211, Killer, Atheros, Marvell 88SE9235, JMicron): amber warning + reason
  - Known-good (Intel X-series, Broadcom BCM57xx, Mellanox ConnectX, etc.): teal badge
  - Unknown: grey hint
- **ESA / memory tiering** (step 7): ESA vs OSA vSAN architecture toggle; memory tiering with NVMe disk picker and `tierNvmePct` slider
- **NSX full depth** (step 8):
  - Edge transport node count + size (small / medium / large → vCPU/vRAM)
  - BGP route advertisement: all connected vs. specific prefix list (CIDR textarea)
  - Redistribution checkboxes: connected, static, T1 LB VIP
  - `nsx-configure.ps1`: edge cluster creation via `POST /api/v1/edge-clusters`
  - `nsx-bgp.ps1`: prefix list PATCH + outbound neighbour filter when `bgpRouteAdvert === 'specific'`
- **New spec fields**: `physicalHost.nicModel`; `nsx.edgeCount/edgeSize/bgpRouteAdvert/bgpPrefixes[]/redistConnected/redistStatic/redistT1Lb`; `nestedCluster.memoryTiering`, `vsanArchitecture`

### v0.6.0-beta (VCF layer)
- **New step 9 — VCF Bring-up** (inserted between NSX-T and Nested disks; old steps 9–14 → 10–15):
  - Generates `vcf-bringup.json` — VCF 5.x Cloud Builder deployment parameter workbook with all 6 network types (MANAGEMENT, VMOTION, VSAN, NSX_VTEP, NSX_EDGE_UPLINK1/2), per-host specs, dvs config, nsxSpec, vcenterSpec, sddcManagerSpec
  - Generates `vcf-prep.ps1` — pre-flight: NTP running, SSH enabled, hostname report per nested host
  - UI fields: SDDC Manager IP/hostname, vCenter IP, VTEP + Edge Uplink 1/2 CIDR/VLAN, ESXi password, ESXi/vCenter license keys
  - Review warnings: SSO domain = AD domain collision; nested host count < 4
  - Nested host IPs are sequential placeholders (.101+) in management CIDR — must match `deploy-lab.ps1` assignment
- **Step constant changes**: TOTAL_STEPS 15 → 16, DEPOT_STEP 10 → 11, TROUBLESHOOT_STEP 14 → 15, VCF_STEP = 9 (new)
- **New lib**: `lib/generateVcf.js` (buildVcfFiles, buildBringupJson, buildPrepScript, firstHostInCidr, cidrToMask, ipRange)
- **New spec section**: `vcf` (enabled, sddcManagerIp, sddcManagerHostname, vcenterIp, vtepCidr/Vlan, edgeUplink1/2 Cidr/Vlan, esxiPassword, esxiLicense, vcenterLicense)
- **Community repo**: `github.com/redeye365/vsphere-lab-scenarios` — 10 starter troubleshooting scenarios, contributor README, `.labscenario` import/export

### v0.6.1-beta (VCF prerequisites)
- **VCF prerequisites** added to `generatePrerequisites.js` (all conditional on `vcf.enabled`):
  - Broadcom portal section split into vSphere + VCF download locations
  - Cloud Builder OVA subsection: download location, manual deploy steps 1–4, bundle depot note
  - **VCF bring-up requirements** section: DNS records table (personalised from spec IPs/hostnames), NTP sync note, VLAN trunk table (all 6 types), license key check (confirms if entered / reminds if blank), minimum 4-host warning, ordered 7-step bring-up checklist
  - Cloud Builder OVA entry in recommended folder layout tree
  - Time table: Cloud Builder download/deploy, bring-up, bundle depot sync rows

### v0.6.2-beta (CLAUDE.md housekeeping)
- CLAUDE.md updated to reflect v0.6.1-beta state: step table, constants, key files, schema history, roadmap

### v0.6.3-beta (Kickstart generator)
- **Unattended ESXi install via Kickstart** — eliminates the main manual step in the build guide:
  - `lib/generateKickstart.js`: new — `buildKickstartFiles(spec)` generates one `ks-esxi-N.cfg` per nested host
    - Management IP `.101`/`.102`/… in management CIDR (matches vcf-bringup.json convention)
    - VLAN ID, gateway, DNS (DC if enabled, else `1.1.1.1`), hostname (`esxi-N.<domain>`), NTP from spec
    - `%firstboot` section: enables SSH persistently via `esxcli`, configures NTP, suppresses shell warning
  - `server.js`: writes `ks-esxi-N.cfg` files to output on every generate; adds `GET /api/ks/:sessionId/:hostIndex` endpoint — wizard serves ks.cfg files directly at boot time
  - `deploy-lab.ps1` (`generatePowerShell.js`): new `-WizardIp` param; embeds `$KsSessionId` constant; powers on VMs with `Start-VM`; prints `ks=http://$WizardIp:3000/api/ks/<id>/<n>` URL per host when `-WizardIp` is set
  - New wizard field: "Nested ESXi root password" (step 7) → `spec.nestedCluster.rootPassword`; blank → `<REPLACE_ME>` placeholder in ks.cfg

### v0.6.4-beta (build guide kickstart section)
- **`lib/generateBuildGuide.js`** — ISO-path nested ESXi install step updated:
  - AUTOMATED step: command example shows `-WizardIp` flag; description notes VMs are powered on immediately and ks.cfg files land in the output folder
  - MANUAL install step split into two options:
    - **Option A (Kickstart, recommended):** Shift+O at boot menu, `ks=` URL format, `-WizardIp` URL reference, post-install state (IP, hostname, SSH, NTP), `<REPLACE_ME>` warning when no password set, self-hosting fallback note
    - **Option B (Manual):** existing DCUI walkthrough, updated to note VMs are already powered on

### v0.6.5-beta (scenario library expansion)
- **12 new scenarios** added to `scenarios/` and mirrored to `vsphere-lab-scenarios` repo:
  - **Easy (3):** vm-snapshot-consolidation, host-disconnected-vcenter, vmotion-failing
  - **Medium (4):** ha-admission-control, nsx-t0-uplink-wrong, nsx-dfw-blocking, vsan-disk-claimed
  - **Hard (5):** vcf-ssh-config-corruption, vcf-ntp-drift, vcf-dns-ptr-missing, nsx-edge-transport-zone, storage-all-paths-down
- Wizard now ships 22 scenarios total (was 10); verify scripts added for all 12 in `scenarios/verify/`
- `vsphere-lab-scenarios` README updated: count corrected, table split into vSphere/NSX/VCF sections
- Authors: Jon — CloudITBlog.com

### v0.6.7-beta (current — Learning Mode)
- **Wizard Learning Mode**: mode selector screen (Build vs Learn) before wizard enters
  - Per-step `<div class="learn-block">` panels at steps 0, 1, 3, 5, 6, 7, 8, 14
  - Design rationale capture: useCase, routerChoice, networkSecurity, availabilityRequirement, nsxRationale (all in `state.designRationale`)
  - Architecture scorecard on step 14: Isolation / Resilience / Scalability / Complexity / VCF Readiness (Green/Amber/Red)
  - Anti-pattern detection: single-host HA, vSAN < 3 hosts, NSX without BGP, untagged management VLAN
  - RAM insights on steps 1 (cluster tier options) and 7 (headroom after cluster)
  - `learningMode` + `designRationale` added to spec by `generateSpec.js`
  - `generateMarkdown.js`: Design Rationale section (problem statement, router/networking, network security, availability, architecture assessment)
  - `generateBuildGuide.js`: Learning objectives + certification mapping (when useCase === 'certification')
- **Troubleshooter Learning Mode**: phase 0 mode selector (Fix vs Learn to troubleshoot)
  - 7-step methodology framework shown in phase 1 header
  - Guided prompts in phase 3: symptom, scope, layer isolation (saved to `state.tsMethodology`)
  - Hint meta-context framing for each of the 5 hint levels
  - Enhanced debrief: why it happened / what made it hard / learning point / prevention / methodology scorecard + pattern summary
  - Design rationale connection: if a learning-mode spec is loaded, debrief links back to the relevant design decisions

### v0.6.6-beta (pre-v1.0 security audit)
- **Server binding**: `app.listen` now binds to `127.0.0.1` only (was `0.0.0.0`)
- **Admin endpoint protection**: `requireLocalhost` middleware added to all `/api/admin/*` routes; rejects non-loopback connections with 403
- **Path traversal fix**: `saveScenario` now validates `verifyScript` field with `^[a-zA-Z0-9-]+\.ps1$`; admin-verify re-validates the filename before `path.join` + `spawnSync` — blocks malicious `.labscenario` imports
- **Sensitive field stripping**: `rootPassword`, `esxiPassword`, `esxiLicense`, `vcenterLicense` stripped from spec before returning in `/api/generate` response
- **Debrief response cleaned**: `verifyScript` filename removed from `/api/troubleshoot/debrief` response
- **XSS hardening**: resource tip rendering replaced with `setRichText()` helper (only `<code>` elements permitted); mermaid diagram preview switched from `innerHTML = svg` to `DOMParser` + `document.adoptNode`
- **Client cleanup**: `console.error` removed from debrief error path in `wizard.js`
- **Housekeeping**: `scenarios/active.json` added to `.gitignore`; `package.json` version updated from `0.2.0` to `0.6.5`

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
- Server binds to `127.0.0.1` only — never `0.0.0.0`. All `/api/admin/*` routes are
  additionally protected by `requireLocalhost` middleware as defence-in-depth.
- `saveScenario` and the admin-verify endpoint both validate `verifyScript` filenames
  with `^[a-zA-Z0-9-]+\.ps1$` to prevent path traversal via imported `.labscenario` files.
- Sensitive spec fields (`rootPassword`, `esxiPassword`, `esxiLicense`, `vcenterLicense`)
  are stripped before the spec is returned to the browser in the generate response.
- `setRichText(el, html)` in `wizard.js` is the safe alternative to `innerHTML` for
  strings that need `<code>` formatting — all other tags are rendered as plain text.
- Learning mode state lives in `state.learningMode` (bool) and `state.designRationale` (object).
  Toggled at startup by `wireModeSelect()`. Per-step learn-blocks are shown/hidden in `showStep()`.
- Architecture scorecard (`renderScorecard()`) and anti-pattern detection (`collectAntiPatterns()`)
  run entirely in the browser on step 14; a server-side mirror in `generateMarkdown.js`
  (`assessArchitecture`, `collectAntiPatterns`) reproduces the same logic for the design doc.
- Troubleshoot learning mode: `state.troubleshootLearningMode` set in phase 0; methodology
  prompts wired in `tsWirePhase3()`; enhanced debrief built by `tsBuildLearnDebrief(data)`.
