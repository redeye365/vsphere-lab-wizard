# vSphere Lab Wizard

A local wizard that walks through designing a nested vSphere home lab, then generates:

- `lab-spec.json` &mdash; the full design as structured data
- `deploy-lab.ps1` &mdash; a PowerCLI script that creates the port groups and nested ESXi VM shells
- `lab-design.md` &mdash; a written explanation of the choices made and why

This is vSphere only. No VCF, no NSX Manager, no VCF Operations. That's a deliberate scope cut for v1, not an oversight.

## Running it

Needs Node 18 or newer.

```
npm install
npm start
```

Then open `http://localhost:4173`.

Everything runs locally. No data leaves your machine, nothing is sent anywhere except to the script itself.

## How it works

The wizard has two phases:

1. **Discovery** &mdash; use case, physical hardware, existing network
2. **Design** &mdash; lab network ranges, nested cluster sizing, security, remote access

The review step shows a live summary plus a topology preview that updates as you fill things in. Generating the design writes the three output files to `output/<id>/` on disk and gives you download links for each.

## What `deploy-lab.ps1` does and doesn't do

It does:
- Creates a tagged port group on the physical vSwitch for each lab network
- Sets promiscuous mode, forged transmits, and MAC address changes on those port groups (nested ESXi needs all three, or its traffic gets dropped by the parent vSwitch)
- Creates the nested ESXi VM shells at the requested vCPU/vRAM/disk size
- Attaches the ESXi ISO and enables nested virtualisation (`vhv.enable`)
- Applies `monitor.allowLegacyCPU` if you switched that on in the wizard

It doesn't:
- Install ESXi (run the installer manually after powering on each VM)
- Deploy vCenter (use VMware's own VCSA deployment tool)

Both of those expect interactive input or their own CLI tooling, and scripting around that reliably causes more problems than it solves for a homelab.

## Project layout

```
server.js              Express app: serves the UI, /api/generate, /api/download
public/                 Wizard frontend (no build step, no framework)
lib/sizing.js           RAM/CPU overcommit checks, vSAN sanity checks
lib/generateSpec.js     Builds the JSON spec from wizard answers
lib/generatePowerShell.js  Builds the PowerCLI script from the spec
lib/generateMarkdown.js    Builds the design doc from the spec
output/                 Generated files land here, one folder per run
```

## Extending it

Sizing presets, default VLANs, and the use-case labels all live near the top of `public/wizard.js` and `lib/generateMarkdown.js`. The nested cluster currently assumes a single physical host or pool; multi-host placement logic (which physical host gets which nested VM) isn't in scope yet.

VCF support (management domain, NSX, workload domains) is a natural phase two, but it's a different enough deployment model that it deserves its own wizard branch rather than being bolted onto this one.
