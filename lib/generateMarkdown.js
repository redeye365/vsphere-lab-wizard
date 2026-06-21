// lib/generateMarkdown.js
//
// Produces design-doc.md: the reference document covering network topology,
// IP addressing, architecture decisions, sizing analysis, and credential
// locations. This is NOT a how-to -- config snippets and step-by-step
// instructions live in build-guide.md (see generateBuildGuide.js).

const { buildMermaidDiagram } = require('./generateNetworkDiagram');

const USE_CASE_LABELS = {
  certification: 'VCP / VCF study and certification practice',
  feature_testing: 'vSAN and NSX feature testing',
  homelab: 'general homelab and tinkering',
  demo: 'customer-facing demo environment',
  devtest: 'dev/test sandbox'
};

const NETWORK_TYPE_LABELS = {
  flat: 'a flat network with no VLANs',
  vlans: 'a network with VLANs already configured',
  unsure: 'a network of unknown VLAN capability'
};

const FIREWALL_LABELS = {
  allow_all: 'allow all traffic, treating the lab as part of the trusted network',
  restricted: 'restrict traffic to the specific ports the lab actually needs',
  isolated: 'fully isolate the lab with no outbound access'
};

const DEVICE_TYPE_LABELS = {
  nvme: 'NVMe',
  sata_ssd: 'SATA SSD',
  sas_ssd: 'SAS SSD',
  spinning_disk: 'Spinning disk'
};

const NESTED_DISK_PURPOSE_LABELS = {
  vsan_capacity:   'vSAN capacity tier',
  vsan_cache:      'vSAN cache / performance tier',
  local_datastore: 'Local datastore (host 1 only)',
  data:            'Additional data disk'
};

const NIC_SPEED_LABELS = {
  '1gbe': '1GbE',
  '10gbe': '10GbE',
  '25gbe': '25GbE or faster'
};

const REMOTE_ACCESS_LABELS = {
  vpn: 'VPN back into the home network',
  ssh_jump: 'SSH jump host',
  none: 'local access only, no remote path',
  reverse_proxy: 'reverse proxy in front of lab services'
};

const VPN_TYPE_LABELS = {
  wireguard: 'WireGuard server VM',
  vyos_site_to_site: 'VyOS site-to-site WireGuard tunnel'
};

function fmtNet(net) {
  if (!net) return null;
  const parts = [];
  if (net.cidr) parts.push(net.cidr);
  if (net.vlanId !== null && net.vlanId !== undefined) parts.push(`VLAN ${net.vlanId}`);
  return parts.length ? parts.join(', ') : null;
}

function buildMarkdown(spec) {
  const ph = spec.physicalHost;
  const nc = spec.nestedCluster;
  const nets = spec.networks;
  const sec = spec.security;
  const ra = spec.remoteAccess;
  const sizing = spec.sizing;
  const vyos = spec.vyos || {};
  const dc = spec.domainController || {};
  const localDs = spec.localDatastore || {};
  const wl = spec.workloadVms || {};
  const esxiVer = spec.esxiVersion || {};

  const useCase = USE_CASE_LABELS[spec.useCase] || spec.useCase || 'not specified';
  const out = [];

  out.push('# Lab Design Reference');
  out.push('');
  out.push(`Generated ${new Date(spec.generatedAt).toUTCString()} by vsphere-lab-wizard.`);
  out.push('');
  out.push(
    `This lab targets ${useCase}, running on ${ph.hostCount} physical host${ph.hostCount === 1 ? '' : 's'} ` +
    `with ${nc.hostCount} nested ESXi host${nc.hostCount === 1 ? '' : 's'} on top. ` +
    `This document explains what was designed and why. For step-by-step build instructions, see \`build-guide.md\`.`
  );
  out.push('');

  // --- Architecture decisions ---
  out.push('## Architecture decisions');
  out.push('');

  if (vyos.enabled) {
    out.push(
      '**VyOS as the first thing deployed.** VyOS provides the network foundation everything else runs on. ' +
      'Until the router is up, the nested hosts have no routable path to the outside world and DHCP on the ' +
      'lab networks doesn\'t exist. Every subsequent stage assumes the lab networks are routable.'
    );
    out.push('');
  }

  if (dc.enabled) {
    out.push(
      '**Domain controller before nested ESXi installs.** The nested hosts point at the DC for DNS and NTP ' +
      'from the moment they boot. More critically, vCenter\'s TLS certificates are generated using the FQDN ' +
      'given at install time. If DNS isn\'t resolving that FQDN correctly at install time, the certificates ' +
      'generate incorrectly and the environment accumulates certificate errors that are difficult to clean up later.'
    );
    out.push('');
  }

  if (localDs.enabled) {
    out.push(
      '**Local datastore on host 1 to break the vCenter/vSAN circular dependency.** vSAN requires a ' +
      'vCenter to manage it, but vCenter needs somewhere to live before the cluster exists. A dedicated ' +
      'VMFS disk on nested-esxi-01 (`local-ds`) gives vCenter a home that doesn\'t depend on the cluster ' +
      'it will go on to manage. vsan-cluster.ps1 runs in manual disk claim mode specifically so vSAN doesn\'t ' +
      'accidentally absorb the local-ds disk during cluster formation.'
    );
    out.push('');
  }

  out.push(
    '**vCenter deploys in standalone mode (directly to nested-esxi-01).** Once vCenter is up, the nested ' +
    'hosts join the cluster and vSAN forms. vSAN cannot exist without a vCenter -- that\'s why cluster ' +
    'formation is the last infrastructure step, not the first.'
  );
  out.push('');

  if (wl.enabled) {
    out.push(
      '**Workload VMs after the cluster is healthy.** They are placed on vSAN storage by default, so vSAN ' +
      'needs to be up and passing health checks first.'
    );
    out.push('');
  }

  // --- Physical hardware ---
  out.push('## Physical hardware');
  out.push('');
  const nicSpeedLabel = NIC_SPEED_LABELS[ph.nicSpeed] || 'unspecified';
  const nicWord = ph.nicCount === 1 ? 'NIC' : 'NICs';
  out.push(`${ph.cpuCores || '?'} logical cores, ${ph.ramGB || '?'}GB RAM, ${ph.nicCount || '?'} ${nicWord} at ${nicSpeedLabel}.`);
  out.push('');
  if (esxiVer.label) {
    out.push(`Target ESXi version for nested hosts: **${esxiVer.label}**.`);
    out.push('');
  }

  const storageDevices = ph.storageDevices || [];
  if (storageDevices.length > 0) {
    out.push('### Physical storage inventory');
    out.push('');
    out.push('| # | Type | Capacity |');
    out.push('|---|---|---|');
    storageDevices.forEach((d, i) => {
      const capLabel = d.capacityGB >= 1000
        ? `${(d.capacityGB / 1000).toFixed(1)} TB`
        : `${d.capacityGB} GB`;
      out.push(`| ${i + 1} | ${DEVICE_TYPE_LABELS[d.type] || d.type || '?'} | ${capLabel} |`);
    });
    out.push('');
  }

  const additionalDisks = nc.additionalDisks || [];
  if (additionalDisks.length > 0) {
    out.push('### Nested host disk layout');
    out.push('');
    out.push(`Each nested ESXi host VM gets a ${nc.bootDiskGB}GB boot disk plus the following virtual disks:`);
    out.push('');
    out.push('| Size | Purpose | Hosts |');
    out.push('|---|---|---|');
    additionalDisks.forEach((d) => {
      const hosts = d.purpose === 'local_datastore' ? 'Host 1 only' : 'All hosts';
      out.push(`| ${d.sizeGB}GB | ${NESTED_DISK_PURPOSE_LABELS[d.purpose] || d.purpose || '?'} | ${hosts} |`);
    });
    out.push('');
  }

  // --- Network diagram ---
  out.push('## Network diagram');
  out.push('');
  out.push('```mermaid');
  out.push(buildMermaidDiagram(spec));
  out.push('```');
  out.push('');

  // --- Network topology ---
  out.push('## Network topology');
  out.push('');
  const netTypeDesc = NETWORK_TYPE_LABELS[spec.existingNetwork?.type] || 'unspecified';
  out.push(`Existing network: ${netTypeDesc}.`);
  out.push('');
  out.push('| Network | CIDR | VLAN | Purpose |');
  out.push('|---|---|---|---|');
  const mgmtNet = nets.management;
  const vmotionNet = nets.vMotion;
  const vsanNet = nets.vsan;
  const vmNet = nets.vmTraffic;
  out.push(`| Management | ${mgmtNet?.cidr || '—'} | ${mgmtNet?.vlanId ?? '(native)'} | ESXi hosts, vCenter, DC, jumpbox |`);
  out.push(`| vMotion | ${vmotionNet?.cidr || '—'} | ${vmotionNet?.vlanId ?? '(native)'} | Live migration traffic |`);
  if (nc.vsanEnabled) {
    out.push(`| vSAN | ${vsanNet?.cidr || '—'} | ${vsanNet?.vlanId ?? '(native)'} | vSAN storage replication |`);
  }
  out.push(`| VM traffic | ${vmNet?.cidr || '—'} | ${vmNet?.vlanId ?? '(native)'} | Nested guest VMs |`);
  out.push('');
  out.push(
    'Each lab network gets its own port group on the physical vSwitch, tagged with the VLAN ID shown. ' +
    'Networks with no VLAN ride the native VLAN of the physical switch port. ' +
    'The port groups serving nested ESXi traffic must have **Promiscuous mode**, **Forged transmits**, ' +
    'and **MAC address changes** set to Accept on the physical vSwitch security policy.'
  );
  out.push('');

  // --- Lab components ---
  out.push('## Lab components');
  out.push('');

  if (vyos.enabled) {
    const modeDesc = vyos.networkMode === 'bgp'
      ? 'NAT, DHCP, DNS forwarding, BGP peering'
      : 'NAT, DHCP, DNS forwarding';
    out.push(`**VyOS virtual router** — 2 vCPU / 1GB RAM. Functions: ${modeDesc}.`);
    out.push('');
  }

  if (dc.enabled) {
    const domainStr = dc.domainName ? `\`${dc.domainName}\`` : 'domain TBD';
    const ipStr = dc.ipAddress ? `\`${dc.ipAddress}\`` : 'static IP TBD';
    out.push(`**Domain controller** — 2 vCPU / 4GB RAM / 80GB disk. IP: ${ipStr}. Domain: ${domainStr}. Provides DNS and NTP for the lab.`);
    out.push('');
  }

  {
    out.push(
      `**Nested ESXi cluster** — ${nc.hostCount} host${nc.hostCount === 1 ? '' : 's'}, ` +
      `${nc.vcpuPerHost} vCPU / ${nc.vramPerHostGB}GB vRAM / ${nc.bootDiskGB}GB boot disk each.` +
      (nc.vsanEnabled ? ' Each host also gets a 50GB cache VMDK and 200GB capacity VMDK for vSAN.' : '') +
      (nc.legacyCpuCompatibility ? ' `monitor.allowLegacyCPU` enabled.' : '')
    );
    out.push('');
  }

  if (localDs.enabled) {
    out.push('**Local datastore (local-ds)** — 200GB VMDK on nested-esxi-01, formatted as VMFS. Hosts vCenter. Not claimed by vSAN.');
    out.push('');
  }

  const vcSize = ra.vcenterDeploymentSize || 'small';
  out.push(`**vCenter (VCSA)** — deployed onto nested-esxi-01. Deployment size: ${vcSize}.`);
  out.push('');

  if (wl.enabled && wl.count > 0) {
    out.push(`**Workload VMs** — ${wl.count} blank VM shell${wl.count === 1 ? '' : 's'}, ${wl.vcpu} vCPU / ${wl.vramGB}GB RAM each. No OS pre-installed.`);
    out.push('');
  }

  const hasAccessVm = ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard');
  if (hasAccessVm) {
    const vmName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
    const role = ra.method === 'ssh_jump' ? 'SSH jump host' : 'WireGuard VPN server';
    out.push(`**${vmName}** — 1 vCPU / 1GB RAM / 20GB disk, Ubuntu 22.04 LTS. Role: ${role}.`);
    out.push('');
  }

  // --- Sizing analysis ---
  out.push('## Sizing analysis');
  out.push('');
  out.push('| Category | vCPU | vRAM |');
  out.push('|---|---|---|');
  out.push(`| Nested ESXi hosts (${nc.hostCount}×) | ${sizing.nestedVcpu} | ${sizing.nestedVramGB}GB |`);
  if (sizing.applianceVcpu > 0) {
    const names = [vyos.enabled && 'VyOS', dc.enabled && 'DC'].filter(Boolean).join(', ');
    out.push(`| Lab appliances (${names}) | ${sizing.applianceVcpu} | ${sizing.applianceVramGB}GB |`);
  }
  if (sizing.workloadVcpu > 0) {
    out.push(`| Workload VMs (${wl.count}×) | ${sizing.workloadVcpu} | ${sizing.workloadVramGB}GB |`);
  }
  if (sizing.accessVmVcpu > 0) {
    const label = ra.method === 'ssh_jump' ? 'jumpbox' : 'WireGuard VM';
    out.push(`| ${label} | ${sizing.accessVmVcpu} | ${sizing.accessVmVramGB}GB |`);
  }
  out.push(`| **Total** | **${sizing.totalRequestedVcpu}** | **${sizing.totalRequestedVramGB}GB** |`);
  out.push('');
  if (sizing.usableRamGB) {
    out.push(
      `Physical RAM: ${ph.ramGB}GB — ${sizing.reservedOverheadGB}GB reserved for host overhead = ` +
      `**${sizing.usableRamGB}GB usable**.`
    );
    if (sizing.ramOvercommitRatio !== null) {
      out.push(`RAM overcommit: **${sizing.ramOvercommitRatio}:1**`);
    }
    if (sizing.cpuOvercommitRatio !== null) {
      out.push(`CPU overcommit: **${sizing.cpuOvercommitRatio}:1**`);
    }
  }
  out.push('');

  if (sizing.warnings && sizing.warnings.length) {
    out.push('## Sizing warnings');
    out.push('');
    for (const w of sizing.warnings) {
      out.push(`- ${w}`);
    }
    out.push('');
  }

  // --- Security posture ---
  out.push('## Security posture');
  out.push('');
  out.push('| Setting | Value |');
  out.push('|---|---|');
  out.push(`| Isolated segment | ${sec.isolateLabSegment ? 'Yes' : 'No'} |`);
  out.push(`| Firewall policy | ${FIREWALL_LABELS[sec.firewallPolicy] || 'not specified'} |`);
  out.push(`| Outbound internet | ${sec.internetAccess ? 'Yes' : 'No'} |`);
  out.push('');

  // --- Remote access ---
  out.push('## Remote access');
  out.push('');
  out.push(`| Setting | Value |`);
  out.push('|---|---|');
  out.push(`| Method | ${REMOTE_ACCESS_LABELS[ra.method] || 'not specified'} |`);
  if (ra.method === 'vpn' && ra.vpnType) {
    out.push(`| VPN type | ${VPN_TYPE_LABELS[ra.vpnType] || ra.vpnType} |`);
  }
  if (ra.vcenterDeploymentSize) {
    out.push(`| vCenter size | ${ra.vcenterDeploymentSize} |`);
  }
  out.push('');

  if (ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard')) {
    const vmName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
    out.push('### SSH key locations');
    out.push('');
    out.push('| Item | Path |');
    out.push('|---|---|');
    out.push(`| Private key | \`%USERPROFILE%\\.ssh\\${vmName}\` |`);
    out.push(`| Public key | \`%USERPROFILE%\\.ssh\\${vmName}.pub\` |`);
    out.push('');
    out.push(
      '**Security:** the private key is generated on your local machine by `jumpbox-deploy.ps1`. ' +
      'Do not check it into version control or paste it into chat. It is the only credential ' +
      'protecting remote access to the lab.'
    );
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push('### WireGuard addressing');
    out.push('');
    out.push('| Item | Value |');
    out.push('|---|---|');
    out.push('| VPN subnet | `10.200.0.0/24` |');
    out.push('| Server address | `10.200.0.1` |');
    out.push('| Listen port | UDP 51820 |');
    out.push('');
    out.push('Client IPs are assigned sequentially from `10.200.0.2` onward, one per device.');
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push('### VyOS site-to-site tunnel addressing');
    out.push('');
    out.push('| Item | Value |');
    out.push('|---|---|');
    out.push('| Tunnel subnet | `10.201.0.0/30` |');
    out.push('| This router | `10.201.0.1` |');
    out.push('| Remote router | `10.201.0.2` |');
    out.push('| Listen port | UDP 51821 |');
    out.push('');
  }

  // --- Files in this output ---
  out.push('## Files in this output');
  out.push('');
  out.push('| File | Description |');
  out.push('|---|---|');
  out.push('| `lab-spec.json` | Full structured spec (source of truth for all generators) |');
  out.push('| `design-doc.md` | This document — reference only |');
  out.push('| `build-guide.md` | Step-by-step runbook — what to run, in what order |');
  if (vyos.enabled) out.push('| `vyos-deploy.ps1` | Stage 1: VyOS VM shell |');
  if (dc.enabled) out.push('| `dc-deploy.ps1` | Stage 2: DC VM shell |');
  out.push('| `deploy-lab.ps1` | Port groups and nested ESXi VM shells |');
  out.push('| `vcenter-deploy.ps1` | vCenter VCSA deployment (govc or PowerCLI) |');
  if (nc.vsanEnabled) out.push('| `vsan-cluster.ps1` | vSAN cluster formation |');
  if (wl.enabled) out.push('| `deploy-workloads.ps1` | Test workload VM shells |');
  if (ra.method === 'ssh_jump') out.push('| `jumpbox-deploy.ps1` | Jump host VM shell + SSH keypair generation |');
  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push('| `jumpbox-deploy.ps1` | WireGuard server VM shell + SSH keypair generation |');
    out.push('| `wireguard-server.sh` | WireGuard server setup (run on VM after OS install) |');
  }
  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push('| `vyos-site-to-site.conf` | VyOS CLI commands for site-to-site tunnel |');
  }
  out.push('');

  return out.join('\n');
}

module.exports = { buildMarkdown };
