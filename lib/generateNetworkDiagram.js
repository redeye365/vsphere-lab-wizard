// lib/generateNetworkDiagram.js
//
// Produces a Mermaid flowchart from the spec. Embedded in design-doc.md as a
// fenced ```mermaid block and optionally rendered to network-diagram.svg via
// mmdc (mermaid-cli) in server.js if it is available.

function firstHostInCidr(cidr) {
  if (!cidr) return null;
  const base = cidr.split('/')[0];
  const p = base.split('.').map(Number);
  p[3] = 1;
  return p.join('.');
}

function segLabel(name, net) {
  if (!net) return name;
  const parts = [name];
  if (net.vlanId != null) parts.push(`VLAN ${net.vlanId}`);
  if (net.cidr) parts.push(net.cidr);
  return parts.join(' · ');
}

function buildMermaidDiagram(spec) {
  const nc  = spec.nestedCluster;
  const nets = spec.networks;
  const dc   = spec.domainController || {};
  const vyos = spec.vyos || {};
  const ra   = spec.remoteAccess || {};
  const wl   = spec.workloadVms || {};
  const ph   = spec.physicalHost;
  const esxiVer = spec.esxiVersion || {};

  const lines = [];
  lines.push('graph TD');
  lines.push('');

  // WAN (only when VyOS provides NAT/routing)
  if (vyos.enabled) {
    lines.push('    WAN(["Internet / Home Network"])');
    lines.push('');
  }

  // Physical host outer subgraph
  const physParts = ['Physical Host'];
  if (ph.cpuCores) physParts.push(`${ph.cpuCores} cores`);
  if (ph.ramGB)    physParts.push(`${ph.ramGB} GB RAM`);
  if (ph.nicCount && ph.nicSpeed) physParts.push(`${ph.nicCount}× ${ph.nicSpeed}`);
  lines.push(`    subgraph PHYS["${physParts.join(' · ')}"]`);

  // VyOS node — sits above the management subgraph since it routes all VLANs
  if (vyos.enabled) {
    const gwIp  = firstHostInCidr(nets.management?.cidr);
    const vyosL = gwIp
      ? `lab-vyos\\nVyOS Router\\nWAN: DHCP · LAN: ${gwIp}`
      : `lab-vyos\\nVyOS Router`;
    lines.push(`        VYOS["${vyosL}"]`);
    lines.push('');
  }

  // Management VLAN subgraph — all control-plane VMs
  lines.push(`        subgraph MGMT["${segLabel('Management', nets.management)}"]`);

  if (dc.enabled) {
    const dcParts = ['lab-dc', 'Domain Controller'];
    if (dc.ipAddress)  dcParts.push(dc.ipAddress + (dc.domainName ? ' · ' + dc.domainName : ''));
    else if (dc.domainName) dcParts.push(dc.domainName);
    lines.push(`            DC["${dcParts.join('\\n')}"]`);
  }

  const hostCount  = nc.hostCount || 0;
  const shownHosts = Math.min(hostCount, 6);
  for (let i = 1; i <= shownHosts; i++) {
    const name     = `nested-esxi-${String(i).padStart(2, '0')}`;
    const hostSpec = `${nc.vcpuPerHost || '?'} vCPU / ${nc.vramPerHostGB || '?'} GB`;
    lines.push(`            ESXI${i}["${name}\\n${esxiVer.label || 'ESXi'}\\n${hostSpec}"]`);
  }
  if (hostCount > shownHosts) {
    lines.push(`            ESXIREST["... and ${hostCount - shownHosts} more hosts"]`);
  }

  lines.push('            VCSA["vcenter\\nvCenter Server"]');

  const hasJumpbox = ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard');
  if (hasJumpbox) {
    const jbName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
    const jbRole = ra.method === 'ssh_jump' ? 'SSH jump host' : 'WireGuard VPN server';
    lines.push(`            JB["${jbName}\\n${jbRole}"]`);
  }

  lines.push('        end');
  lines.push('');

  // Other network segments — shown as plain nodes so Mermaid can lay them out
  // alongside the MGMT subgraph. ESXi hosts connect to these with dashed edges.
  const hasVmotion = nets.vMotion?.cidr || nets.vMotion?.vlanId != null;
  if (hasVmotion) {
    lines.push(`        VMOT["${segLabel('vMotion', nets.vMotion)}"]`);
  }

  const hasVsan = nc.vsanEnabled && nets.vsan;
  if (hasVsan) {
    lines.push(`        VSANNET["${segLabel('vSAN', nets.vsan)}"]`);
  }

  const hasVmnet = nets.vmTraffic?.cidr || nets.vmTraffic?.vlanId != null;
  if (hasVmnet) {
    lines.push(`        VMNET["${segLabel('VM Traffic', nets.vmTraffic)}"]`);
  }

  if (wl.enabled && wl.count > 0) {
    const wlSpec = `${wl.count} VM${wl.count === 1 ? '' : 's'} · ${wl.vcpu} vCPU / ${wl.vramGB} GB each`;
    lines.push(`        WL["workload VMs\\n${wlSpec}"]`);
  }

  lines.push('    end');
  lines.push('');

  // ---- Edges ----

  const esxiRefs = Array.from({ length: shownHosts }, (_, i) => `ESXI${i + 1}`);
  if (hostCount > shownHosts) esxiRefs.push('ESXIREST');

  if (vyos.enabled) {
    lines.push('    WAN -->|"WAN"| VYOS');

    // VyOS → non-ESXi management devices
    const nonEsxi = [];
    if (dc.enabled)  nonEsxi.push('DC');
    nonEsxi.push('VCSA');
    if (hasJumpbox)  nonEsxi.push('JB');
    lines.push(`    VYOS -->|"NAT · DHCP · DNS"| ${nonEsxi.join(' & ')}`);

    // VyOS → ESXi hosts (separate line to keep edge labels readable)
    if (esxiRefs.length > 0) {
      lines.push(`    VYOS --> ${esxiRefs.join(' & ')}`);
    }
  }

  // DC → ESXi hosts (DNS / NTP, dashed)
  if (dc.enabled && esxiRefs.length > 0) {
    lines.push(`    DC -.->|"DNS · NTP"| ${esxiRefs.join(' & ')}`);
  }

  // ESXi hosts → vCenter
  if (esxiRefs.length > 0) {
    lines.push(`    ${esxiRefs.join(' & ')} --> VCSA`);
  }

  // ESXi hosts ↔ vMotion / vSAN (dashed = same-segment traffic, not routed)
  if (esxiRefs.length > 0) {
    const netRefs = [];
    if (hasVmotion) netRefs.push('VMOT');
    if (hasVsan)    netRefs.push('VSANNET');
    if (netRefs.length > 0) {
      lines.push(`    ${esxiRefs.join(' & ')} -.- ${netRefs.join(' & ')}`);
    }
  }

  // vCenter → workload VMs; workload VMs on VM-traffic segment
  if (wl.enabled) {
    lines.push('    VCSA --> WL');
    if (hasVmnet) lines.push('    WL -.- VMNET');
  } else if (hasVmnet) {
    lines.push('    VCSA -.- VMNET');
  }

  // VyOS site-to-site WireGuard tunnel endpoint
  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    lines.push('');
    lines.push('    REMOTE(["Remote Network"])');
    lines.push('    VYOS -.->|"WireGuard tunnel\\n10.201.0.0/30"| REMOTE');
  }

  return lines.join('\n');
}

module.exports = { buildMermaidDiagram };
