# vSphere Lab Wizard

A local wizard that guides you through designing a nested vSphere home lab, then generates a complete set of personalised PowerCLI scripts, a written design document, a step-by-step build guide, and a network topology diagram.

The pitch: **every consultant who has built a nested vSphere lab has spent days rediscovering the same gotchas** — promiscuous mode on the parent vSwitch, VLAN tagging at three separate layers, NTP sync across all appliances, SSO domain collision with Active Directory. This wizard encodes those lessons. Answer the questions once; get the scripts and the knowledge together.

Blog posts explaining the background: **[CloudITBlog.com](https://CloudITBlog.com)**

---

## What it produces

Run the wizard and click **Generate** — it writes the following to an output folder and offers them as individual downloads:

| File | What it is |
|------|-----------|
| `PREREQUISITES.md` | **Start here.** Personalised checklist of software and ISOs needed for your specific design |
| `design-doc.md` | Written explanation of every design decision and why it was made |
| `build-guide.md` | Step-by-step deployment guide in order, with manual steps clearly flagged |
| `lab-spec.json` | The full design as structured JSON — machine-readable, diff-able |
| `network-diagram.svg` | SVG topology diagram *(requires mmdc — see below; Mermaid source always in build-guide.md)* |
| `deploy-lab.ps1` | Creates port groups on the physical vSwitch, deploys nested ESXi VM shells |
| `vyos-deploy.ps1` | Deploys the VyOS virtual router VM *(if VyOS chosen)* |
| `dc-deploy.ps1` | Deploys the Windows Server domain controller VM *(if DC chosen)* |
| `vcenter-deploy.ps1` | Deploys vCenter VCSA via govc or PowerCLI *(always)* |
| `vsan-cluster.ps1` | Creates datacenter, cluster, adds nested hosts, enables vSAN *(if vSAN chosen)* |
| `deploy-workloads.ps1` | Creates blank test VM shells on the vSAN cluster *(if workload VMs chosen)* |
| `configure-memory-tiering.ps1` | Adds virtual NVMe + enables ESXi memory tiering *(if memory tiering chosen)* |
| `jumpbox-deploy.ps1` | Deploys a lightweight jumpbox VM *(if chosen)* |
| `wireguard-server.sh` | WireGuard server setup *(if WireGuard remote access chosen)* |
| `vyos-site-to-site.conf` | VyOS site-to-site VPN config *(if site-to-site VPN chosen)* |

---

## Software prerequisites

### PowerShell 7.2 or newer

The scripts use PowerShell 7 (PowerShell Core) syntax. Windows PowerShell 5.1 will not work.

- **Windows**: `winget install Microsoft.PowerShell` or download from [github.com/PowerShell/PowerShell/releases](https://github.com/PowerShell/PowerShell/releases)
- **macOS**: `brew install powershell/tap/powershell`
- **Linux**: [learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux)

Verify: `pwsh --version`

### VMware PowerCLI 13.x or newer

```powershell
Install-Module VMware.PowerCLI -Scope CurrentUser
Set-PowerCLIConfiguration -ParticipateInCEIP $false -Confirm:$false
```

You will see an "untrusted repository" prompt during install — type `Y`. The download is around 200 MB.

Verify: `Get-Module VMware.PowerCLI -ListAvailable | Select Version`

### govc (optional but recommended)

`vcenter-deploy.ps1` detects `govc` and uses it for VCSA deployment when available. It falls back to PowerCLI `Import-VApp` if govc is missing, but govc is faster and more reliable for large OVA files.

Download the latest release from [github.com/vmware/govmomi/releases](https://github.com/vmware/govmomi/releases) and place the binary on your PATH.

- **macOS**: `brew install govc`
- **Windows/Linux**: download the binary for your platform, rename to `govc` (or `govc.exe`), add to PATH

Verify: `govc version`

### Node.js 18 or newer

Required only to run the wizard itself — not needed on the machine where you run the scripts.

Download from [nodejs.org](https://nodejs.org) or `brew install node`.

### @mermaid-js/mermaid-cli (optional — SVG export only)

The Mermaid diagram source for your lab topology is **always included** in `build-guide.md` as a fenced code block. Paste it into [mermaid.live](https://mermaid.live) to view the diagram without any extra software.

`@mermaid-js/mermaid-cli` (mmdc) is only needed if you want the `network-diagram.svg` file download. Without it, the SVG download button does not appear — everything else works normally.

**If running from source** (`npm start`): mmdc is already in devDependencies and is installed by `npm install` automatically.

**If running the standalone executable** (`dist/vsphere-lab-wizard-*`): mmdc cannot be bundled into the executable. It uses Puppeteer which requires a headless Chromium binary (~170 MB per platform) — too large and platform-specific to embed. Install it separately if you want SVG export:

```sh
npm install -g @mermaid-js/mermaid-cli
```

Then restart the wizard — SVG export will be available on the next Generate. The startup log will confirm: `Network diagram: SVG generation enabled`.

---

## ISO and OVA prerequisites

### Broadcom portal account

VMware ISOs are now hosted on the Broadcom portal. Registration is free — but it is not obvious for people encountering it post-acquisition.

1. Go to [support.broadcom.com](https://support.broadcom.com)
2. Click **Register** — use a personal or work email
3. After registration, go to **My Dashboard → My Downloads → VMware vSphere**
4. Select your version and download the ISO(s)

Allow 15–30 minutes the first time, including working through the registration flow.

### ESXi ISO

Always required. Filename starts with `VMware-VMvisor-Installer-`.

Download: [support.broadcom.com](https://support.broadcom.com) → VMware vSphere → My Downloads

### vCenter Server Appliance (VCSA)

Always required. Download the **VMware vCenter Server Appliance** bundle (filename starts with `VMware-VCSA-all-`). This is an ISO containing an OVA — mount it or extract it; the OVA is at `vcsa/VMware-vCenter-Server-Appliance-*.ova`.

Download: [support.broadcom.com](https://support.broadcom.com) → VMware vSphere → My Downloads

### VyOS ISO *(if VyOS virtual router chosen)*

Download the LTS rolling release from [vyos.io/get-vyos](https://vyos.io/get-vyos/). Filename starts with `vyos-`.

### Windows Server ISO *(if domain controller chosen)*

Download the 180-day evaluation from the [Microsoft Evaluation Center](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-server-2022). Select **ISO download** (~5 GB).

---

## Hardware prerequisites

The wizard's sizing checks validate against these minimums at generate time — warnings appear in the UI if your design exceeds what the hardware can support.

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Physical host RAM | 64 GB | 256 GB+ |
| Physical host CPU | 8 cores | 16–32 cores |
| Physical storage | 500 GB NVMe or SSD | 1–2 TB NVMe |
| NIC | 1 × 1 GbE | 1 × 10 GbE |
| Host OS | VMware ESXi 8.0+ | ESXi 8.0 U3 or 9.0 |

**Nested virtualisation must be enabled on the physical host.** `deploy-lab.ps1` creates port groups with promiscuous mode, forged transmits, and MAC address changes — all three are required for nested ESXi networking to work.

For vSAN ESA (the default), all storage must be all-flash (NVMe or high-performance SSD). Spinning disks are not eligible.

---

## Recommended folder structure

```
C:\Lab\                 (Windows) — or ~/Lab/ on macOS/Linux
├── ISOs\
│   ├── VMware-VMvisor-Installer-*.iso      (ESXi)
│   ├── VMware-VCSA-all-*.iso               (vCenter bundle)
│   ├── vyos-*.iso                          (VyOS, if used)
│   └── WinServer2022-eval.iso              (Windows Server, if used)
├── Scripts\            ← save generated scripts here
└── Output\             ← wizard output folder
```

---

## Running the wizard

```
git clone https://github.com/redeye365/vsphere-lab-wizard.git
cd vsphere-lab-wizard
npm install
npm start
```

Open **http://localhost:4173** in your browser.

The wizard runs entirely locally. No data leaves your machine.

### Wizard steps

1. **Use case** — certification, homelab, feature testing, demo, or dev/test
2. **Physical hardware** — CPU, RAM, storage devices, NIC
3. **Existing network** — flat or VLANs, DHCP available
4. **ESXi version** — 8.0 U3, 9.0, etc.
5. **Appliances** — VyOS router, Windows domain controller
6. **Networks** — management CIDR, VLAN mode (tagged/untagged), vMotion, vSAN, VM traffic
7. **Nested cluster** — host count, vCPU/vRAM per host, vSAN ESA/OSA, cluster name, SSO domain, memory tiering
8. **Additional disks** — per-host VMDKs for vSAN, local datastore
9. **Security** — segment isolation, firewall policy
10. **Remote access** — VPN type, jumpbox
11. **Review** — live summary of the full design with sizing warnings
12. **Generate** — writes all output files, shows download links

---

## Known limitations (v1)

- **VCF / SDDC Manager out of scope.** The wizard is designed to produce a vSphere foundation that *could* have VCF layered on top later (correct SSO domain, DNS PTR records, NTP single-source, cluster naming, vSAN ESA) but does not deploy VCF itself.
- **Interactive ESXi install is still manual.** `deploy-lab.ps1` creates the VM shells and attaches the ISO; you power on each VM and step through the installer.
- **vCenter first-boot is still manual.** `vcenter-deploy.ps1` deploys the OVA; the ~20-minute first-boot configurator runs inside the appliance.
- **SVG diagram requires mmdc.** The Mermaid source is always in build-guide.md; SVG export requires mmdc installed separately (see above). Not bundled in the standalone executable.
- **Single physical host assumed.** Nested VM shell placement across multiple physical hosts is not yet implemented.
- **NSX, Aria, and HCX are out of scope.** Deliberate scope cut for v1.

---

## Project layout

```
server.js                    Express app: UI, /api/generate, /api/download
public/
  index.html                 Step definitions and form fields
  wizard.js                  State machine, validation, rendering
  style.css                  Styles
lib/
  sizing.js                  RAM/CPU overcommit checks, vSAN sanity checks
  generateSpec.js            Builds the JSON spec from wizard answers
  generatePowerShell.js      Builds all PowerCLI scripts from the spec
  generateMarkdown.js        Builds design-doc.md from the spec
  generateBuildGuide.js      Builds build-guide.md from the spec
  generatePrerequisites.js   Builds PREREQUISITES.md from the spec
  generateNetworkDiagram.js  Builds Mermaid topology diagram from the spec
output/                      Generated files (one subfolder per run, gitignored)
```

---

*Built by [CloudITBlog.com](https://CloudITBlog.com)*
