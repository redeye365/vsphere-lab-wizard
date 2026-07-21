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

## Step numbering (as of v1.13)

| # | Step name | Notes |
|---|-----------|-------|
| 0 | Use case | |
| 1 | Hardware | NIC model + inline HCL check; per-host specs when hostCount > 1 |
| 2 | ESXi version | |
| 3 | Virtual router (VyOS) | |
| 4 | Domain controller | |
| 5 | Existing network | |
| 6 | Lab networks | |
| 7 | Nested cluster | ESA/OSA vSAN; memory tiering; placement when hostCount > 1; `esxiDeployMethod` (iso/ova) chosen here |
| 8 | Deployment placement | `PLACEMENT_STEP`; skipped via `getNextStep()`/`getPrevStep()` when hostCount === 1 |
| 9 | NSX-T | Edge node count/size; BGP route advert mode; redistribution checkboxes |
| 10 | VCF Bring-up | Shown always; generates vcf-bringup.json + vcf-prep.ps1 when vcfEnabled |
| 11 | Nested disks | |
| 12 | Bundle depot | `DEPOT_STEP`; skipped via `getNextStep()`/`getPrevStep()` when `depotStepVisible()` is false |
| 13 | Workload VMs | |
| 14 | Security & access | |
| 15 | File locations | `FILE_LOCATIONS_STEP`; always shown, per-field visibility gated by `renderFileLocationsVisibility()` |
| 16 | Review & generate | Live Mermaid diagram preview; `TOTAL_STEPS - 2` |
| 17 | Troubleshooting | Hidden; activated via Ctrl+Shift+X / Cmd+Shift+X |

`TOTAL_STEPS = 18`, `PLACEMENT_STEP = 8`, `DEPOT_STEP = 12`, `NSX_STEP = 9`, `VCF_STEP = 10`, `FILE_LOCATIONS_STEP = 15`, `TROUBLESHOOT_STEP = 17`

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
| 4 (extended) | v0.6.8-beta | Added to existing v4: `architectMode` (bool), `discovery` (object), `decisionLog` (array), `riskRegister` (array) |

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

### v1.18.2 (current -- govc OVA import for standalone ESXi, remaining em-dash sweep)
- **`buildDeployLabOva` now detects and prefers `govc` for the nested-ESXi OVA import**,
  matching the pattern already used in `vcenter-deploy.ps1`: `Get-OvfConfiguration`/`Import-VApp`
  has known reliability problems against a standalone ESXi host, since vApp import assumes a
  vCenter-managed inventory that doesn't exist yet at this stage. When `govc` is on PATH:
  `govc import.spec` generates the OVF property spec, guestinfo properties (hostname, IP,
  netmask, gateway, VLAN, DNS, domain, NTP, password, ssh, createvmfs) and the network mapping
  are patched into it, `govc import.ova` deploys, then `govc vm.change -e` sets
  `vhv.enable`/`monitor.allowLegacyCPU`. Falls back to the existing PowerCLI `Import-VApp` path
  when `govc` isn't installed. `$env:GOVC_URL`/`GOVC_USERNAME`/`GOVC_PASSWORD` are set from the
  same credential already collected for `Connect-VIServer`, so the user isn't prompted twice.
  - **ESA vSAN storage-pool disks stay on PowerCLI regardless of import path** -- govc's
    `vm.disk.create` only supports SCSI controllers (verified against the govmomi docs), not
    NVMe, so there's no govc equivalent for the raw `VirtualNVMEController` API calls this
    needs. After a govc import, the script bridges back to a PowerCLI object (`Get-VM -Name
    $vmName`) and reuses the same `emitEsaNvmeBlock()` used by the PowerCLI/ISO paths.
  - **Found and fixed a real pre-existing bug while wiring this up**: `emitEsaNvmeBlock()`
    reused `$ds` as a local variable name for the per-disk `VirtualDeviceConfigSpec`, which
    collided with the `$ds` datastore object every caller already had in scope (`Get-Datastore`).
    On host 2+ in any multi-host deployment with ESA vSAN, this silently clobbered `$ds` after
    host 1, so `-Datastore $ds` on subsequent hosts passed a leftover device-config object
    instead of the datastore. Renamed to `$diskCfgSpec`. Affected both the ISO and OVA paths,
    pre-dating this release.
- **Em dash/en dash sweep completed**: every remaining `lib/generate*.js` file
  (`generateBuildGuide.js`, `generateMarkdown.js`, `generatePrerequisites.js`,
  `generateKickstart.js`, `generateDiagramHtml.js`) had its `—`/`–` characters
  replaced with `--`, on top of the `.ps1`-generating files already fixed in v1.18.1. Zero
  em/en-dash characters remain anywhere in the generator source or in a full regeneration's
  output (`.ps1`, `.md`, `.json`, `.sh`, `.txt`).
- Re-validated every generated script with PowerShell's own parser across single/multi-host,
  ISO/OVA, ESA/OSA, and BGP+NSX+VCF+depot configs after both changes.

### v1.18.1 (fix mis-encoded .ps1 scripts on Windows PowerShell 5.1)
- **Root cause of the recurring "random syntax error deep in the file" reports**: generated
  `.ps1` files are written as UTF-8 with no BOM. Windows PowerShell 5.1 (`powershell.exe`,
  still the default on most Windows machines — as opposed to PowerShell Core/`pwsh`, which
  defaults to UTF-8) reads a BOM-less script using the system's ANSI codepage instead. Every
  non-ASCII character we emitted (em dashes throughout comments/`Write-Host` strings) got
  mis-decoded byte-by-byte, and depending on the codepage one of those stray bytes can land on
  an actual quote or brace character — producing exactly the "missing quote terminator" /
  "missing closing '}'" errors reported, at a line number nowhere near the real cause. This
  never reproduced under `pwsh` (used for validation), which is why it looked intermittent.
  - `writeGeneratedFile()` (`server.js`) now prepends a UTF-8 BOM (`\uFEFF`) to every `.ps1`
    file at write time — this makes both `powershell.exe` and `pwsh` detect the encoding
    correctly regardless of system codepage. `.sh` scripts are deliberately excluded (a BOM
    before `#!` breaks shebang detection); `.json`/`.md` etc. don't need one.
  - Also replaced every em dash with `--` in the generator files that actually emit `.ps1`
    content (`generatePowerShell.js`, `generateNsx.js`, `generateVcf.js`, `generateDepot.js`)
    as a belt-and-suspenders fix, so the BOM isn't the only thing standing between a stray
    typographic character and a broken script.
  - Confirmed via `[System.Management.Automation.Language.Parser]::ParseFile` across several
    configs (single/multi-host, ISO/OVA, minimal and heavy/ESA+legacy-CPU+VCF+NSX+depot) that
    every generated script still parses cleanly with the BOM present.

### v1.18.0 (VLAN trunk network model, DC network placement)
- **Two-vSwitch VLAN trunk model replaces one-port-group-per-network**: physical host now gets
  **vSwitch0** (existing switch, physical uplink, carries VyOS's WAN NIC only) and **vSwitch1**
  (no physical uplink, created automatically by `deploy-lab.ps1`) with a single **Nested-Trunk**
  port group set to VLAN 4095 (trunk — passes every VLAN tag through). VyOS is the only device
  that routes between VLANs, via a per-network `vif` sub-interface on its own trunk NIC (see
  `vyos-config.txt`). All other lab VMs — nested ESXi, DC, jumpbox, workload VMs, depot — connect
  a single NIC to Nested-Trunk instead of one NIC per network.
  - `emitTrunkPortGroupBlock()` (`lib/generatePowerShell.js`) creates vSwitch1 + the trunk port
    group with the required Promiscuous/Forged-transmits/MAC-changes security policy, replacing
    the old per-network `emitPortGroupBlock()`.
  - `vyos-deploy.ps1` now attaches exactly 2 NICs (WAN + Nested-Trunk) instead of one per network.
  - Nested ESXi hosts (ISO and OVA paths) get one NIC on Nested-Trunk; they tag their own
    vMotion/vSAN/VM-Traffic vmkernel ports internally using the VLAN IDs from `lab-spec.json`
    (documented in the generated `.NOTES` and `build-guide.md`). OVA path additionally feeds the
    real management VLAN ID into the appliance's `guestinfo.vlan` OVF property.
  - `build-guide.md` / `design-doc.md` updated: two-vSwitch architecture description, VLAN
    "two-layer rule" (VyOS vif + nested vmk0 — the port group is always a fixed trunk, so it's
    no longer a factor, unlike the old three-layer rule).
- **`vyos-config.txt`**: new ready-to-paste VyOS CLI configuration file, generated alongside
  `vyos-deploy.ps1` whenever VyOS is enabled. Resolves real values from the spec — management
  CIDR/VLAN, NAT, DHCP range, DNS/NTP source, and (BGP mode) the actual AS numbers and NSX T0
  peer IP. `vyos-deploy.ps1`'s completion message now points here instead of printing generic
  instructions. New download kind `vyos-config` in `server.js` / `SCRIPT_LABELS` in `wizard.js`.
- **DC network placement option** (step 4): "Lab management network (Nested-Trunk)" vs
  "Physical/home network (VM Network)" — `g.dcNetworkPlacement`, `spec.domainController.networkPlacement`.
  Physical placement puts the DC's NIC on the WAN port group (`$PortGroup` param, default
  `"VM Network"`) instead of Nested-Trunk, and `build-guide.md`'s static-IP instructions switch to
  the home router as the gateway instead of VyOS. DNS/NTP references elsewhere already just use
  `dc.ipAddress`, so no other changes were needed for those to pick up a home-network IP.
- **VyOS DHCP syntax fixed for current/rolling release**: `subnet-id` is now required per subnet,
  and `name-server`/`default-router` moved under `option` (`set service dhcp-server
  shared-network-name LAB subnet '<cidr>' option name-server '<ip>'`) — the old flat
  `subnet '<cidr>' name-server '<ip>'` syntax silently fails to commit on rolling. Fixed in both
  `vyos-config.txt` and `build-guide.md`. Also added the previously-missing `option default-router`.
- **Another parse bug found by validating every generated script with PowerShell's own parser**
  (`[System.Management.Automation.Language.Parser]::ParseFile`): `nsx-configure.ps1` shelled out
  to `openssl s_client ... </dev/null` — literal bash redirection syntax, invalid in PowerShell
  (and the computed fingerprint was never even used — `thumbprint` was hardcoded to `""`).
  Replaced with a native `System.Net.Security.SslStream` fetch and wired the real thumbprint into
  the compute-manager registration body.

### v1.13 (lab-config.json / File locations step)
- **New step 15 — File locations** (inserted between Security & access and Review; old step 15 Review → 16, step 16 Troubleshooting → 17; `TOTAL_STEPS` 17 → 18, new `FILE_LOCATIONS_STEP = 15`):
  - Collects local Windows paths for `vyosIso`, `windowsServerIso`, `esxiIso`, `nestedEsxiOva`, `vCenterOva` — whichever are relevant given `vyosEnabled` / `dcProfile` / `esxiDeployMethod` (evaluated fresh on step entry by `renderFileLocationsVisibility()`, since those flags are decided in earlier steps)
  - Fields are optional in the wizard — leaving one blank just means editing `lab-config.json` by hand later; the generated scripts still hard-require it at runtime
  - New `spec.labConfig` section (`lib/generateSpec.js`) carries the five fields through to script generation
- **`lab-config.json` is now generated pre-filled**, not just a `.example` template: `buildLabConfigFromSpec(spec)` (`lib/generatePowerShell.js`) writes real values (or `""` if left blank in the wizard) into `localPaths`; `datastorePaths` stays empty (manual escape hatch, documented in PREREQUISITES.md, not collected by the wizard). `buildLabConfigExample()` is still written alongside as a blank reference copy of the schema. Both are new download kinds (`lab-config` / `lab-config-example`) in `server.js` and `SCRIPT_LABELS`/`renderDownloads()` in `wizard.js`.
- **Every deploy script reads ISO/OVA paths from `lab-config.json`, never a script parameter**: `vyos-deploy.ps1`, `dc-deploy.ps1`, `deploy-lab.ps1` (both ISO and OVA variants), `vcenter-deploy.ps1`. Shared helpers in `lib/generatePowerShell.js`: `emitLabConfigLoader()` (loads the JSON once, throws if missing), `emitLocalFileResolution()` (OVA appliances — Import-VApp/govc read the local file directly), `emitDatastoreIsoResolution()` (CD-ROM ISOs — auto-uploads the local file to `[<datastore>] ISOs/<filename>` via a `VimDatastore` PSDrive, or uses `datastorePaths` directly if set). No `[Parameter(Mandatory = $true)]` ISO/OVA params remain anywhere.
- **Template strips** (`buildWizardSave(true)`) now also clears `vyosIso`, `windowsServerIso`, `esxiIso`, `nestedEsxiOva`, `vCenterOva` — local file paths are machine-specific and shouldn't leak into a shared `.labtemplate`.
- Fixed a pre-existing parse bug found while syntax-validating the regenerated `vcenter-deploy.ps1` with PowerShell's own parser: `$ovfConfig.guestinfo.cis.vmdir.domain-name.Value` doesn't parse (hyphen in a bare dot-path) — quoted the property segment.

### v1.11.0 (Save and resume)
- **Auto-save to localStorage** (`vsphere-wizard-autosave`): state serialised after every `onChange` and every `showStep`. Cleared on successful generate. Key format: `{ _type, _version:1, _savedAt, _step, learningMode, architectMode, answers, designRationale, discovery, decisionLog, riskRegister }`.
- **Resume banner** on mode-select screen: `checkAutoSave()` runs at init; if a valid autosave exists, `#autosave-banner` is shown above the mode cards with the saved step and time-ago. Resume loads the config and enters the app; Start Fresh discards it.
- **4-option mode-select screen**: Build / Learning / Continue saved design / Start from template. Continue and template cards trigger hidden file inputs (`#load-config-input`, `#load-template-input`).
- **Save progress button** (`#rail-save-btn`) in the wizard sidebar: downloads `wizard-config-[ts].json` containing full state (including passwords). Present on every step.
- **Export as template** (`#btn-export-template`) on the review screen (step 14): same format but strips IPs and passwords → `.labtemplate` extension. Sits next to the Generate button in a `.generate-actions` flex row.
- **Load flow**: file → `isValidWizardConfig()` → `loadWizardConfig()` → `populateFormFromState()` → `enterAppWithConfig()` → `showStep(savedStep)`. A `#config-loaded-banner` confirms the load for 5 s.
- **`populateFormFromState()`**: syncs all wizard DOM fields from `state.answers` — inputs, selects, radios, checkboxes, conditional show/hide, dynamic lists (storage devices, additional hosts, nested disks, placement rows). Uses `_onFormChange` so re-rendered dynamic rows are fully wired.
- **`_onFormChange`**: module-level reference to the `onChange` closure in `wireForm()`, set at wireForm init. Used by `populateFormFromState` to pass the real onChange to render functions.
- **Template strips**: `hardware.ipAddress`, `additionalHosts[].ipAddress`, `dcIpAddress`, `nsxIpAddress`, `depotIpAddress`, `nestedEsxiPassword`, `vcfEsxiPassword`, `vcfEsxiLicense`, `vcfVcenterLicense`, `vcfSddcMgrIp`, `vcfVcenterIp`.

### v1.10.0 (DC deployment profiles)
- **DC deployment profile radio card layout** replaces single DC checkbox (step 4):
  - Four options: **No DC** / **DC only** / **DC + Jumpbox** / **DC + Jumpbox + File Server**
  - Profile-aware sizing: No DC → 0; DC only → 2 vCPU / 4 GB; Jumpbox → 4 vCPU / 8 GB; File Server → 4 vCPU / 8 GB OS + configurable second disk
  - `dc-jumpbox-fileserver` profile: `dcStorageDiskGB` input (default 200 GB); build guide includes PowerShell to init disk + create `\\dc\LabISOs` share
  - Jumpbox profiles: `buildRdpFile(dc)` in `generatePowerShell.js` generates `lab-dc.rdp` in output zip (pre-configured with DC IP, 1920×1080, clipboard redirect)
  - State: `g.dcProfile` (`'none'` | `'dc-only'` | `'dc-jumpbox'` | `'dc-jumpbox-fileserver'`), `g.dcStorageDiskGB`
  - `lib/sizing.js`: `DC_VCPU_BY_PROFILE` / `DC_VRAM_GB_BY_PROFILE` lookup objects replace scalar constants
  - `lib/generateSpec.js`: `domainController` spec now includes `profile`, `hasJumpbox`, `hasFileServer`, `storageDiskGB`; backward-compat fallback from `enabled` bool
  - `server.js`: writes `lab-dc.rdp` to output dir when `buildRdpFile` returns non-null
  - `module.exports` for `generatePowerShell.js`: `{ buildPowerShellScripts, buildRdpFile }`

### v1.9.2 (cert relevance field in build form)
- **Cert relevance checkbox grid** replaces free-text field in scenario build form:
  - 10-cert grid (`VCP-VCF-Architect`, `VCP-VCF-Admin`, `VCP-VCF-Support`, `VCP-VVF-Admin`, `VCP-VVF-Support`, `VCAP-VCF-Automation`, `VCAP-VCF-Operations`, `VCAP-VCF-Storage`, `VCAP-VCF-VKS`, `VCAP-VCF-Networking`)
  - `.ts-build-cert-checks` / `.ts-cert-check-item` styles; `tsLibOpenBuild()` pre-checks saved values; `tsLibSave()` reads checked values into `certRelevance[]`
- **Learning objectives textarea**: `#ts-build-objectives` (2–4 lines); stored as `learningObjectives[]` (one item per non-blank line)

### v1.9.1 (scenario library expansion — cert coverage)
- **5 new scenarios** added to fill zero-coverage certs; wizard now ships 27 scenarios (was 22):
  - `vcsa-disk-space-log` — easy, VCP-VVF-Support + VCP-VVF-Admin
  - `esxi-coredump-unconfigured` — easy, VCP-VVF-Support
  - `aria-automation-project-zone-missing` — medium, VCAP-VCF-Automation
  - `aria-ops-adapter-credentials` — medium, VCAP-VCF-Operations
  - `tkg-namespace-storage-policy` — medium, VCAP-VCF-VKS
- All 10 cert codes now have at least one scenario

### v1.9.0 (Study Plan tab)
- **Study Plan** — third tab in the troubleshooter panel (`#ts-studyplan-panel`):
  - Scenarios grouped by cert, sorted Easy → Medium → Hard within each cert
  - Per-cert progress bar + overall progress bar at top
  - Per-row: Load button + Mark Done / Undo toggle (persisted to `'vsphere-completed-scenarios'` localStorage key)
  - `tsRenderStudyPlan()` — main render function; `SP_CERT_LABELS` — cert display name map; `SP_DIFF_ORDER` — sort constants
  - `tsGetCompleted()` / `tsSetCompleted(id, done)` — localStorage helpers
  - Tab button: `#ts-tab-studyplan` (`data-mode="studyplan"`)

### v0.6.8-beta (current — Architect Thinking mode)
- **Three-tier mode system**: Standard (fast wizard) / Learning (onboarding + learn-blocks + scorecard) /
  Architect (Learning PLUS Phase 0 discovery, options analysis, decision log, risk register, architect design doc).
  Architect mode is a secondary toggle (`#learn-arch-toggle`) shown at the bottom of the learn-onboard screen,
  only visible once goal + experience + time are answered (`updateOnboardStart()` toggles `#learn-arch-toggle-wrap`).
- **Architect state** (in `state`): `architectMode` (bool); `discovery` { stakeholders, problemStatement,
  moscow{networking/compute/storage/security/management}, constraints{time/budget/skills/compliance},
  successCriteria, successMeasure, risks[], designPrinciples[] }; `decisionLog[]`; `riskRegister[]`.
- **Phase 0 discovery** (`#arch-discovery-screen`, full-screen, shown by `showArchDiscovery()` after onboarding when
  architectMode on): 7 sections — stakeholders, problem statement, MoSCoW table, constraints, success criteria,
  top-3 risks (with suggested-risk chips), design principles (8 toggles + custom). `finishDiscovery()` imports the
  discovery risks into `riskRegister` (source:'discovery'), reveals the sidebar panels, then enters the wizard.
- **Options analysis** (`OPTIONS_ANALYSIS` constant, 4 keys: `router`, `storage`, `nsx`, `clusterSize`):
  full-page overlay (`#arch-options-panel`) shown once per session via `showOptionsAnalysis(key)`. Hooked into
  `showStep()` (steps 3→router, 7→clusterSize, 8→nsx) and the vSAN toggle (→storage). Confirming logs a decision.
- **Decision log + risk register** sidebar panels (`#arch-decision-log-panel`, `#arch-risk-register-panel`):
  collapsible (`wireArchPanelToggles()`), rendered by `renderDecisionLog()` / `renderRiskRegister()`.
  `addDecision()` appends to log; `addAutoRisk()` dedupes by description. `detectDesignRisks()`
  (wired by `wireArchitectWizardSteps()` on nestedHostCount / vramPerHostGB / nsxEnabled / mgmtVlan / vsanEnabled)
  auto-detects: single-host SPOF, >85% RAM overcommit, vSAN < 3 hosts, NSX without BGP, untagged management VLAN.
- **generateMarkdown.js**: when `spec.architectMode && spec.learningMode`, emits a 10-section architect document
  (Executive Summary, Stakeholder Analysis, Requirements/MoSCoW, Constraints, Design Principles, Architecture
  Overview, Design Decisions, Risk Register, Component Specifications, Open Items) plus a **Design readiness %**
  blockquote. Takes priority over the learning-mode Design Rationale block (`else if (spec.learningMode)`).
- **generateSpec.js**: adds `architectMode`, `discovery`, `decisionLog`, `riskRegister` to the spec.
- **Wizard → server**: `wireGenerate()` posts `architectMode`, `discovery`, `decisionLog`, `riskRegister`.

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
- DC profile state: `g.dcProfile` (`'none'`|`'dc-only'`|`'dc-jumpbox'`|`'dc-jumpbox-fileserver'`).
  All old `g.dcEnabled` references replaced. Sizing uses `DC_RAM_GB_BY_PROFILE[g.dcProfile]`
  in `wizard.js` and `DC_VCPU_BY_PROFILE` / `DC_VRAM_GB_BY_PROFILE` in `lib/sizing.js`.
- Study plan helpers: `tsGetCompleted()` / `tsSetCompleted(id, done)` read/write `'vsphere-completed-scenarios'`
  localStorage key (JSON array of IDs). `tsRenderStudyPlan()` is the full render function.
- Cert codes (10, canonical): `VCP-VCF-Architect`, `VCP-VCF-Admin`, `VCP-VCF-Support`,
  `VCP-VVF-Admin`, `VCP-VVF-Support`, `VCAP-VCF-Automation`, `VCAP-VCF-Operations`,
  `VCAP-VCF-Storage`, `VCAP-VCF-VKS`, `VCAP-VCF-Networking`.
- Save/resume key: `vsphere-wizard-autosave` (localStorage). Save format: `_type` `wizard-config` | `lab-template`, `_version:1`, `_savedAt` ISO, `_step`, mode flags, `answers`, `designRationale`, `discovery`, `decisionLog`, `riskRegister`.
- `_onFormChange` — module-level reference to the real `onChange` inside `wireForm()`. Must be used (not `() => {}`) when calling render functions from outside wireForm so dynamic list elements stay wired.
