// lib/generatePrerequisites.js
//
// Generates PREREQUISITES.md — a short, personalised checklist included
// alongside every set of generated scripts. Everything here should be
// actionable before the user runs their first script.

function buildPrerequisites(spec) {
  const nc   = spec.nestedCluster || {};
  const vyos = spec.vyos || {};
  const dc   = spec.domainController || {};
  const esxiLabel = spec.esxiVersion?.label || 'ESXi';

  const lines = [];

  lines.push('# Prerequisites');
  lines.push('');
  lines.push('Read this before running any of the generated scripts.');
  lines.push('Everything here needs to be in place first — the scripts will');
  lines.push('fail with unhelpful errors if these are missing.');
  lines.push('');

  // ── 1. PowerShell ──────────────────────────────────────────────────────
  lines.push('## PowerShell');
  lines.push('');
  lines.push('**Required: PowerShell 7.2 or newer** (PowerShell Core, not Windows PowerShell 5.1).');
  lines.push('');
  lines.push('- Windows: download from https://github.com/PowerShell/PowerShell/releases');
  lines.push('  or `winget install Microsoft.PowerShell`');
  lines.push('- macOS: `brew install powershell/tap/powershell`');
  lines.push('- Linux: follow the install guide at https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux');
  lines.push('');
  lines.push('Verify: `pwsh --version` should print `PowerShell 7.x.x`.');
  lines.push('');

  // ── 2. VMware PowerCLI ─────────────────────────────────────────────────
  lines.push('## VMware PowerCLI');
  lines.push('');
  lines.push('**Required: PowerCLI 13.x or newer.**');
  lines.push('');
  lines.push('Install from a PowerShell 7 session:');
  lines.push('');
  lines.push('```powershell');
  lines.push('Install-Module VMware.PowerCLI -Scope CurrentUser');
  lines.push('```');
  lines.push('');
  lines.push('You will see an "untrusted repository" prompt — type `Y` to accept.');
  lines.push('The install downloads ~200 MB and takes a few minutes.');
  lines.push('');
  lines.push('After installing, suppress the CEIP prompt:');
  lines.push('');
  lines.push('```powershell');
  lines.push('Set-PowerCLIConfiguration -ParticipateInCEIP $false -Confirm:$false');
  lines.push('```');
  lines.push('');
  lines.push('Verify: `Get-Module VMware.PowerCLI -ListAvailable | Select Version`');
  lines.push('');

  // ── 3. govc (vCenter deploy uses it) ───────────────────────────────────
  lines.push('## govc');
  lines.push('');
  lines.push('**Required for vCenter deployment.** `vcenter-deploy.ps1` detects `govc`');
  lines.push('and uses it as the primary deployment method; it falls back to PowerCLI');
  lines.push('`Import-VApp` if govc is not found — but govc is faster and more reliable');
  lines.push('for large OVA files.');
  lines.push('');
  lines.push('Download the latest release for your platform from:');
  lines.push('https://github.com/vmware/govmomi/releases');
  lines.push('');
  lines.push('- Windows: download `govc_windows_amd64.exe`, rename to `govc.exe`,');
  lines.push('  place it in a directory on your `$PATH` (e.g. `C:\\Windows\\System32`)');
  lines.push('- macOS: `brew install govc`');
  lines.push('- Linux: `curl -L <url> | gunzip > /usr/local/bin/govc && chmod +x /usr/local/bin/govc`');
  lines.push('');
  lines.push('Verify: `govc version`');
  lines.push('');

  // ── 4. Broadcom account ────────────────────────────────────────────────
  lines.push('## Broadcom portal account');
  lines.push('');
  lines.push('You need a free account at **https://support.broadcom.com** to download');
  lines.push('ESXi and vCenter ISOs. Registration is free — use a personal or work email.');
  lines.push('Once logged in, ISOs are under **VMware vSphere → My Downloads**.');
  lines.push('');

  // ── 5. ISO files ───────────────────────────────────────────────────────
  lines.push('## ISO / OVA files');
  lines.push('');
  lines.push('The following files are required for **your specific design**.');
  lines.push('Download them before running the scripts.');
  lines.push('');

  // ESXi ISO — always required
  lines.push(`### ${esxiLabel} ISO`);
  lines.push('');
  lines.push(`**Required** — \`deploy-lab.ps1\` attaches this to each nested ESXi VM.`);
  lines.push('');
  lines.push('Download from: https://support.broadcom.com → VMware vSphere → My Downloads');
  lines.push(`Search for \`${esxiLabel}\` and download the full installer ISO`);
  lines.push('(filename starts with `VMware-VMvisor-Installer-`).`');
  lines.push('');

  // vCenter VCSA OVA — always required
  lines.push('### vCenter Server Appliance (VCSA) OVA');
  lines.push('');
  lines.push('**Required** — `vcenter-deploy.ps1` deploys the VCSA from this file.');
  lines.push('');
  lines.push('Download from: https://support.broadcom.com → VMware vSphere → My Downloads');
  lines.push('Download the **VMware vCenter Server Appliance** ISO bundle');
  lines.push('(filename starts with `VMware-VCSA-all-`). Mount or extract it — the');
  lines.push('OVA is inside under `vcsa/`.');
  lines.push('');

  // VyOS ISO — conditional
  if (vyos.enabled) {
    lines.push('### VyOS ISO');
    lines.push('');
    lines.push('**Required** — `vyos-deploy.ps1` attaches this to the VyOS router VM.');
    lines.push('');
    lines.push('Download the latest LTS rolling release from: https://vyos.io/get-vyos/');
    lines.push('Click **Download** and select **LTS** — filename starts with `vyos-`.``');
    lines.push('');
  }

  // Windows Server ISO — conditional
  if (dc.enabled) {
    lines.push('### Windows Server ISO');
    lines.push('');
    lines.push('**Required** — `dc-deploy.ps1` attaches this to the domain controller VM.');
    lines.push('');
    lines.push('Download a **180-day evaluation** from:');
    lines.push('https://www.microsoft.com/en-us/evalcenter/evaluate-windows-server-2022');
    lines.push('Select **ISO download** — a 5 GB file.');
    lines.push('');
  }

  // ── 6. Network diagram ────────────────────────────────────────────────
  lines.push('## Network topology diagram (optional)');
  lines.push('');
  lines.push('A Mermaid diagram of your lab topology is always embedded in **build-guide.md**');
  lines.push('as a fenced code block. You can paste it into [mermaid.live](https://mermaid.live)');
  lines.push('at any time to see the full diagram — no extra software needed.');
  lines.push('');
  lines.push('**For an SVG file export**, `@mermaid-js/mermaid-cli` (mmdc) must be installed');
  lines.push('on the machine running the wizard. The SVG download button only appears when');
  lines.push('mmdc is available.');
  lines.push('');
  lines.push('> **Why it cannot be built in:** mmdc renders diagrams by launching a headless');
  lines.push('> Chromium browser via Puppeteer (~170 MB per platform). That native binary');
  lines.push('> cannot be embedded in the standalone wizard executable.');
  lines.push('');
  lines.push('Install mmdc:');
  lines.push('');
  lines.push('```');
  lines.push('npm install -g @mermaid-js/mermaid-cli');
  lines.push('```');
  lines.push('');
  lines.push('Verify: `mmdc --version`');
  lines.push('');
  lines.push('Then restart the wizard — SVG export will be available on the next Generate.');
  lines.push('');

  // ── 7. Folder structure ────────────────────────────────────────────────
  lines.push('## Recommended folder layout');
  lines.push('');
  lines.push('Store everything under a single root — this keeps the script `-IsoPath`');
  lines.push('parameters simple when you run them.');
  lines.push('');
  lines.push('```');
  lines.push('C:\\Lab\\               (Windows) — or ~/Lab/ on macOS/Linux');
  lines.push('├── ISOs\\');
  lines.push(`│   ├── VMware-VMvisor-Installer-*.iso   (${esxiLabel})`);
  lines.push('│   ├── VMware-VCSA-all-*.iso             (vCenter bundle/ISO)');
  if (vyos.enabled) {
    lines.push('│   ├── vyos-*.iso                        (VyOS)');
  }
  if (dc.enabled) {
    lines.push('│   └── WinServer2022-eval.iso            (Windows Server)');
  }
  lines.push('├── Scripts\\            ← extract the generated scripts here');
  lines.push('└── Output\\             ← generated output lands here');
  lines.push('```');
  lines.push('');
  lines.push('When you run the scripts, pass paths like:');
  lines.push('');
  lines.push('```powershell');
  lines.push('.\\deploy-lab.ps1 -EsxiIsoPath "C:\\Lab\\ISOs\\VMware-VMvisor-Installer-8.0U3-*.iso" ...');
  lines.push('```');
  lines.push('');

  // ── 7. Time ────────────────────────────────────────────────────────────
  lines.push('## Time to set aside');
  lines.push('');
  lines.push('| Stage | Estimate |');
  lines.push('|-------|----------|');
  lines.push('| ISO downloads | 1–3 hours (depends on your connection) |');
  lines.push('| Software prerequisites | 15–30 minutes |');
  lines.push(`| Running all scripts + manual ESXi install × ${nc.hostCount || 1} | 2–4 hours |`);
  lines.push('| vCenter first-boot + vSAN formation | 30–60 minutes |');
  lines.push('');
  lines.push('Read the **build-guide.md** alongside these scripts — it explains');
  lines.push('each step in order and flags which steps require manual interaction.');
  lines.push('');
  lines.push('---');
  lines.push(`*Generated by vsphere-lab-wizard on ${spec.generatedAt}*`);

  return lines.join('\n');
}

module.exports = { buildPrerequisites };
