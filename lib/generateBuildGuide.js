// lib/generateBuildGuide.js
//
// Produces build-guide.md: a sequential, numbered runbook for building the lab
// from scratch. Each step is tagged [AUTOMATED] or [MANUAL]. Steps are emitted
// only if the relevant component is part of the design.

const DEVICE_TYPE_LABELS = {
  nvme: 'NVMe', sata_ssd: 'SATA SSD', sas_ssd: 'SAS SSD', spinning_disk: 'Spinning disk'
};

const NESTED_DISK_PURPOSE_LABELS = {
  vsan_capacity:   'vSAN capacity tier',
  vsan_cache:      'vSAN cache / performance tier',
  local_datastore: 'Local datastore (host 1 only)',
  data:            'Additional data disk'
};

function buildBuildGuide(spec) {
  const ph = spec.physicalHost;
  const nc = spec.nestedCluster;
  const nets = spec.networks;
  const ra = spec.remoteAccess;
  const vyos = spec.vyos || {};
  const dc = spec.domainController || {};
  const localDs = spec.localDatastore || {};
  const wl = spec.workloadVms || {};
  const esxiVer = spec.esxiVersion || {};

  const mgmtCidr = nets.management?.cidr || '192.168.10.0/24';
  const mgmtGw = mgmtCidr.replace(/\.\d+\/\d+$/, '.1');
  const dcIp = dc.ipAddress || '<dc-ip>';
  const dcDomain = dc.domainName || 'lab.example.com';
  const vcSize = ra.vcenterDeploymentSize || 'small';
  const hasJumpboxVm = ra.method === 'ssh_jump' || (ra.method === 'vpn' && ra.vpnType === 'wireguard');
  const jumpVmName = ra.method === 'ssh_jump' ? 'lab-jumpbox' : 'lab-wireguard';
  const jumpKeyName = jumpVmName;

  const out = [];
  let step = 0;
  const s = (title, tag) => `## Step ${++step}: ${title} [${tag}]`;

  out.push('# Lab Build Guide');
  out.push('');
  out.push(`Generated ${new Date(spec.generatedAt).toUTCString()} by vsphere-lab-wizard.`);
  out.push('');
  out.push(
    'This is the build runbook — follow the steps in order. Each step is tagged **[AUTOMATED]** ' +
    '(run the named script, it handles everything) or **[MANUAL]** (interactive work, here\'s what to do). ' +
    'For architecture context and IP addressing, see `design-doc.md`.'
  );
  out.push('');

  // =========================================================================
  // Prerequisites
  // =========================================================================
  out.push('## Prerequisites');
  out.push('');
  out.push('Complete these before running anything.');
  out.push('');
  out.push('### Software to download');
  out.push('');
  out.push('| Software | Where to get it |');
  out.push('|---|---|');
  if (vyos.enabled) {
    out.push('| VyOS rolling release ISO | https://vyos.net/get/ (select "Rolling release") |');
  }
  if (dc.enabled) {
    out.push('| Windows Server 2022 ISO | MSDN / Visual Studio Subscriptions, or evaluation at Microsoft Evaluation Center |');
  }
  if (esxiVer.label) {
    out.push(`| ${esxiVer.label} ISO | Broadcom Customer Portal (formerly VMware Customer Connect) |`);
  }
  out.push('| VMware vCenter VCSA OVA | Broadcom Customer Portal — same download page as ESXi |');
  if (hasJumpboxVm) {
    out.push('| Ubuntu Server 22.04 LTS ISO | https://ubuntu.com/download/server |');
  }
  out.push('');
  out.push('Place all ISOs in a datastore accessible from the physical ESXi host before starting.');
  out.push('');

  const storageDev = ph.storageDevices || [];
  if (storageDev.length > 0) {
    out.push('### Physical storage inventory');
    out.push('');
    out.push('| # | Type | Capacity |');
    out.push('|---|---|---|');
    storageDev.forEach((d, i) => {
      const capLabel = d.capacityGB >= 1000 ? `${(d.capacityGB / 1000).toFixed(1)} TB` : `${d.capacityGB} GB`;
      out.push(`| ${i + 1} | ${DEVICE_TYPE_LABELS[d.type] || d.type} | ${capLabel} |`);
    });
    out.push('');
    out.push('Ensure each disk is formatted and visible as a datastore in the physical ESXi host UI before running any scripts.');
    out.push('');
  }

  const additionalDisks = nc.additionalDisks || [];
  if (additionalDisks.length > 0) {
    out.push('### Nested host disk layout');
    out.push('');
    out.push('Virtual disks added to each nested ESXi host VM by `deploy-lab.ps1`:');
    out.push('');
    out.push('| Disk | Size | Purpose | Hosts |');
    out.push('|---|---|---|---|');
    out.push(`| Boot | ${nc.bootDiskGB}GB | ESXi system | All |`);
    additionalDisks.forEach((d) => {
      const hosts = d.purpose === 'local_datastore' ? 'Host 1 only' : 'All hosts';
      out.push(`| Additional | ${d.sizeGB}GB | ${NESTED_DISK_PURPOSE_LABELS[d.purpose] || d.purpose} | ${hosts} |`);
    });
    out.push('');
    const vsanAdditional = additionalDisks.filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache');
    if (vsanAdditional.length > 0) {
      out.push('**Do not format vSAN cache or capacity disks during ESXi installation.** `vsan-cluster.ps1` claims them during cluster formation.');
      out.push('');
    }
    if (localDs.enabled) {
      out.push('The local datastore disk on host 1 **must be formatted** as VMFS immediately after installing ESXi on that host. Name it exactly `local-ds`.');
      out.push('');
    }
  }

  out.push('### Tools required on your workstation');
  out.push('');
  out.push('Install **at least one** of the following (both is fine — `vcenter-deploy.ps1` prefers `govc` when available):');
  out.push('');
  out.push('**VMware PowerCLI** (Windows PowerShell):');
  out.push('```powershell');
  out.push('Install-Module VMware.PowerCLI -Scope CurrentUser -AllowClobber');
  out.push('Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false');
  out.push('```');
  out.push('');
  out.push('**govc** (cross-platform CLI, faster for OVA deployment):');
  out.push('Download from: https://github.com/vmware/govmomi/releases — place `govc` (or `govc.exe`) somewhere in your PATH.');
  out.push('');

  out.push('### Physical vSwitch configuration');
  out.push('');
  out.push(
    'Nested ESXi requires three security settings on the port group(s) carrying nested VM traffic. ' +
    'Set these on every port group that nested ESXi hosts or their guests will use:'
  );
  out.push('');
  out.push('| Setting | Required value |');
  out.push('|---|---|');
  out.push('| Promiscuous mode | Accept |');
  out.push('| Forged transmits | Accept |');
  out.push('| MAC address changes | Accept |');
  out.push('');
  out.push(
    'In the physical ESXi host UI: **Networking → Virtual switches → [your vSwitch] → Edit → Security**. ' +
    'Apply the same settings to any port groups that carry management or VM traffic for the nested cluster.'
  );
  out.push('');


  // =========================================================================
  // VyOS
  // =========================================================================
  if (vyos.enabled) {
    out.push(s('Deploy VyOS VM', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\vyos-deploy.ps1 -PhysicalESXiHost <host-ip-or-fqdn> -VyOsIsoPath "[datastore] ISOs/vyos.iso"');
    out.push('```');
    out.push('');
    out.push('Creates the `lab-vyos` VM shell and attaches the VyOS ISO. The VM is left powered off.');
    out.push('');

    out.push(s('Install VyOS', 'MANUAL'));
    out.push('');
    out.push('1. Power on `lab-vyos` in the physical ESXi UI and open the console.');
    out.push('2. At the VyOS live prompt, run:');
    out.push('   ```');
    out.push('   install image');
    out.push('   ```');
    out.push('3. Follow the prompts: accept defaults for disk and partition, set a password, confirm.');
    out.push('4. Reboot when prompted (remove the ISO or let it time out to boot from disk).');
    out.push('5. Log in with the password you set.');
    out.push('');

    out.push(s('Configure VyOS networking', 'MANUAL'));
    out.push('');
    out.push('Enter configuration mode (`configure`) and paste these commands. Adapt interface names and CIDRs to your environment:');
    out.push('');
    out.push('```');
    out.push('configure');
    out.push('');
    out.push('# WAN — gets an IP from your home router via DHCP');
    out.push('set interfaces ethernet eth0 address dhcp');
    out.push('set interfaces ethernet eth0 description WAN');
    out.push('');
    out.push('# Management LAN');
    const mgmtGwCidr = mgmtCidr.replace(/\d+\/\d+$/, `1/${mgmtCidr.split('/')[1]}`);
    const mgmtVlanMode = nets.management?.mode;
    const mgmtVlanId = nets.management?.vlanId;
    const taggedMgmt = mgmtVlanMode === 'tagged' && mgmtVlanId;
    if (taggedMgmt) {
      out.push(`# Tagged management: VyOS uses a VLAN sub-interface (vif) on eth1`);
      out.push(`# VLAN ID ${mgmtVlanId} must also be set on the physical port group and nested vmk0`);
      out.push(`set interfaces ethernet eth1 vif ${mgmtVlanId} address '${mgmtGwCidr}'`);
      out.push(`set interfaces ethernet eth1 vif ${mgmtVlanId} description Management`);
    } else {
      out.push(`set interfaces ethernet eth1 address '${mgmtGwCidr}'`);
      out.push('set interfaces ethernet eth1 description Management');
    }
    out.push('');
    out.push('# NAT: masquerade management traffic out the WAN interface');
    out.push('set nat source rule 100 outbound-interface eth0');
    out.push(`set nat source rule 100 source address '${mgmtCidr}'`);
    out.push("set nat source rule 100 translation address masquerade");
    out.push('');
    out.push('# DHCP on management network');
    const dhcpStart = mgmtCidr.replace(/\.\d+\/\d+$/, '.100');
    const dhcpStop = mgmtCidr.replace(/\.\d+\/\d+$/, '.200');
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' range 0 start '${dhcpStart}'`);
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' range 0 stop '${dhcpStop}'`);
    if (dc.enabled && dc.ipAddress) {
      out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' name-server '${dc.ipAddress}'`);
    } else {
      out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' name-server 8.8.8.8`);
    }
    out.push('');
    if (vyos.networkMode === 'bgp') {
      out.push('# BGP peering (configure after basic NAT is confirmed working)');
      out.push('set protocols bgp system-as <your-ASN>');
      out.push('set protocols bgp neighbor <peer-ip> remote-as <peer-ASN>');
      out.push('set protocols bgp neighbor <peer-ip> address-family ipv4-unicast');
      out.push('');
    }
    out.push('commit');
    out.push('save');
    out.push('```');
    out.push('');
    out.push('**Verify:** from a machine on the management network, confirm you can ping the VyOS LAN interface and reach the internet through NAT.');
    out.push('');
  }

  // =========================================================================
  // Domain controller
  // =========================================================================
  if (dc.enabled) {
    out.push(s('Deploy domain controller VM', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\dc-deploy.ps1 -PhysicalESXiHost <host-ip-or-fqdn> -WindowsIsoPath "[datastore] ISOs/win-server.iso"');
    out.push('```');
    out.push('');
    out.push('Creates the `lab-dc` VM shell (2 vCPU / 4GB RAM / 80GB disk) and attaches the Windows Server ISO.');
    out.push('');

    out.push(s('Install Windows Server', 'MANUAL'));
    out.push('');
    out.push('1. Power on `lab-dc` and open the console.');
    out.push('2. Install Windows Server 2022 — choose **Desktop Experience** if you want a GUI.');
    out.push('3. After first boot, set a static IP:');
    out.push('   - IP address: `' + dcIp + '`');
    out.push('   - Subnet mask: matching your management CIDR');
    out.push('   - Default gateway: `' + mgmtGw + '` (VyOS LAN interface)');
    out.push('   - DNS: `8.8.8.8` for now (you\'ll point it at itself after promotion)');
    out.push('');

    out.push(s('Promote to domain controller', 'MANUAL'));
    out.push('');
    out.push('Open PowerShell as Administrator on the DC:');
    out.push('');
    out.push('```powershell');
    out.push('Install-WindowsFeature AD-Domain-Services -IncludeManagementTools');
    out.push(`Install-ADDSForest -DomainName "${dcDomain}" -SafeModeAdministratorPassword (Read-Host -AsSecureString)`);
    out.push('```');
    out.push('');
    out.push('The server reboots automatically after promotion. Log back in after ~5 minutes.');
    out.push('');
    out.push('After reboot, set the DNS server on the DC\'s NIC to `127.0.0.1` (pointing at itself):');
    out.push('');
    out.push('```powershell');
    out.push('Set-DnsClientServerAddress -InterfaceAlias "Ethernet*" -ServerAddresses 127.0.0.1');
    out.push('```');
    out.push('');

    out.push(s('Verify DNS resolution', 'MANUAL'));
    out.push('');
    out.push('From another machine on the management network, confirm DNS works in both directions:');
    out.push('');
    out.push('```powershell');
    out.push(`Resolve-DnsName "dc.${dcDomain}" -Server ${dcIp}         # forward: name → IP`);
    out.push(`Resolve-DnsName ${dcIp} -Server ${dcIp}                   # reverse: IP → name`);
    out.push('```');
    out.push('');
    out.push(
      '**Both must work before you continue.** vCenter generates its TLS certificate from the FQDN you give ' +
      'it at install time. If forward DNS is broken, the certificate will be wrong and the environment will ' +
      'produce certificate errors that are painful to fix retroactively.'
    );
    out.push('');
    out.push('Also update the VyOS DHCP config to hand out the DC\'s IP as the DNS server:');
    out.push('');
    out.push('```');
    out.push('configure');
    out.push(`set service dhcp-server shared-network-name LAB subnet '${mgmtCidr}' name-server '${dcIp}'`);
    out.push('commit; save');
    out.push('```');
    out.push('');
  }

  // =========================================================================
  // Nested ESXi
  // =========================================================================
  out.push(s('Deploy nested ESXi VMs and port groups', 'AUTOMATED'));
  out.push('');
  out.push('```powershell');
  out.push('.\\deploy-lab.ps1 -PhysicalESXiHost <host-ip-or-fqdn> -EsxiIsoPath "[datastore] ISOs/esxi.iso"');
  out.push('```');
  out.push('');
  out.push(`Creates ${nc.hostCount} nested VM shell${nc.hostCount === 1 ? '' : 's'} (`);
  for (let i = 1; i <= nc.hostCount; i++) {
    out.push(`\`nested-esxi-0${i}\`` + (i < nc.hostCount ? ', ' : ''));
  }
  out.push(`) and the required port groups on the physical vSwitch.`);
  out.push('');
  out.push(`Each VM: ${nc.vcpuPerHost} vCPU / ${nc.vramPerHostGB}GB RAM / ${nc.bootDiskGB}GB boot disk.`);
  if (additionalDisks.length > 0) {
    const vsanExtra = additionalDisks.filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache');
    const localDsExtra = additionalDisks.find((d) => d.purpose === 'local_datastore');
    const otherExtra = additionalDisks.filter((d) => d.purpose !== 'vsan_capacity' && d.purpose !== 'vsan_cache' && d.purpose !== 'local_datastore');
    if (vsanExtra.length > 0) {
      out.push(`Plus per host: ${vsanExtra.map((d) => d.sizeGB + 'GB ' + d.purpose.replace('vsan_', '') + ' VMDK').join(', ')} (leave unformatted — vSAN claims them).`);
    }
    if (localDsExtra) {
      out.push(`Plus on \`nested-esxi-01\` only: ${localDsExtra.sizeGB}GB local-ds VMDK (format as VMFS after ESXi install).`);
    }
    if (otherExtra.length > 0) {
      out.push(`Plus per host: ${otherExtra.map((d) => d.sizeGB + 'GB ' + (NESTED_DISK_PURPOSE_LABELS[d.purpose] || d.purpose)).join(', ')}.`);
    }
  }
  out.push('');

  out.push(s(`Install ESXi ${esxiVer.label || ''} on each nested host`, 'MANUAL'));
  out.push('');
  out.push(`Repeat for all ${nc.hostCount} nested host VM${nc.hostCount === 1 ? '' : 's'}:`);
  out.push('');
  out.push('1. Power on the VM and open the console.');
  out.push('2. Run through the ESXi installer. When it asks for a disk, select the boot disk (the smallest one).');
  const vsanExtra = (nc.additionalDisks || []).filter((d) => d.purpose === 'vsan_capacity' || d.purpose === 'vsan_cache');
  if (vsanExtra.length > 0) {
    out.push(`   **Do not touch the vSAN disks** (${vsanExtra.map((d) => d.sizeGB + 'GB').join(', ')}) — leave them unpartitioned for vSAN.`);
  }
  out.push('3. Set a root password you\'ll remember.');
  out.push('4. After reboot, press F2 at the DCUI to configure networking:');
  out.push('   - Management network: select the `Nested-Mgmt` port group');
  const taggedMgmtBg = nets.management?.mode === 'tagged' && nets.management?.vlanId;
  if (taggedMgmtBg) {
    out.push(`   - **VLAN**: enter \`${nets.management.vlanId}\` (must match the port group and VyOS vif ${nets.management.vlanId})`);
  }
  if (dc.enabled) {
    out.push(`   - DNS: \`${dcIp}\``);
    out.push(`   - Hostname: \`nested-esxi-0N.${dcDomain}\` (replace N with host number)`);
  }
  out.push('5. Confirm the host is reachable: `ping <nested-host-ip>` from your workstation.');
  out.push('');

  if (localDs.enabled) {
    out.push(s('Create local datastore on host 1', 'MANUAL'));
    out.push('');
    out.push(
      'This step must happen **before** deploying vCenter. The local datastore gives vCenter ' +
      'somewhere to live that doesn\'t depend on the vSAN cluster it\'s about to manage.'
    );
    out.push('');
    out.push('1. Browse to `nested-esxi-01` in the physical ESXi host UI (or use the ESXi host client directly).');
    out.push('2. Go to **Storage → Datastores → New datastore**.');
    const localDsDisk = (nc.additionalDisks || []).find((d) => d.purpose === 'local_datastore');
    const localDsSizeLabel = localDsDisk ? `${localDsDisk.sizeGB}GB` : '200GB';
    out.push(`3. Select the ${localDsSizeLabel} local datastore disk on host 1 (not the boot disk or any vSAN disks).`);
    out.push('4. Name it exactly `local-ds`. Format as VMFS.');
    out.push('5. Confirm it appears as `local-ds` in the datastore list before continuing.');
    out.push('');
  }

  // =========================================================================
  // vCenter
  // =========================================================================
  out.push(s('Deploy vCenter (VCSA)', 'AUTOMATED'));
  out.push('');
  out.push('```powershell');
  out.push('.\\vcenter-deploy.ps1 `');
  out.push('    -NestedESXiHost <nested-esxi-01-ip> `');
  out.push('    -VcsaOvaPath "C:\\path\\to\\VMware-VCSA-all-*.ova" `');
  out.push(`    -DeploymentSize "${vcSize}" \``);
  if (dc.enabled) {
    out.push(`    -DnsServer "${dcIp}" \``);
    out.push(`    -DnsDomain "${dcDomain}"`);
  }
  out.push('```');
  out.push('');
  out.push(
    `Deploys the VCSA onto \`${localDs.enabled ? 'local-ds on ' : ''}nested-esxi-01\`. ` +
    'The script detects `govc` and uses it if present; otherwise it falls back to PowerCLI `Import-VApp`.'
  );
  out.push('');

  out.push(s('Wait for vCenter first-boot', 'MANUAL'));
  out.push('');
  out.push(
    'The VCSA runs an internal setup process after first power-on. This takes **~20 minutes** and ' +
    'cannot be skipped. Monitor progress at:'
  );
  out.push('');
  out.push('```');
  out.push('https://<vcsa-ip>:5480');
  out.push('```');
  out.push('');
  out.push('Wait until the **Getting Started** page loads at `https://<vcsa-ip>` before proceeding.');
  out.push('Log in with username `administrator@vsphere.local` and the password set during deployment.');
  out.push('');

  // =========================================================================
  // vSAN
  // =========================================================================
  if (nc.vsanEnabled) {
    out.push(s('Form vSAN cluster', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\vsan-cluster.ps1 -VCenterServer <vcsa-ip>');
    out.push('```');
    out.push('');
    out.push('Connects to vCenter, creates the datacenter and cluster, adds all nested hosts, then claims vSAN disks in manual mode (which leaves `local-ds` on host 1 untouched).');
    out.push('');
    out.push('**After the script completes:**');
    out.push('1. In vCenter, go to **Cluster → Monitor → vSAN → Health**.');
    out.push('2. Wait for all checks to turn green before deploying anything onto vSAN storage.');
    out.push('3. If the "Performance service" health check shows yellow, enable it: **Configure → vSAN → Services → Performance service → Enable**.');
    out.push('');
  }

  // =========================================================================
  // Memory tiering (optional)
  // =========================================================================
  if (nc.memoryTiering && nc.memoryTiering.enabled) {
    const mt = nc.memoryTiering;
    out.push(s('Add NVMe tier VMDKs to nested hosts (Phase 1)', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push(`.\\configure-memory-tiering.ps1 -PhysicalESXiHost <host-ip-or-fqdn> -Datastore <datastore-name>`);
    out.push('```');
    out.push('');
    out.push(
      `Adds a ${mt.nvmeSizeGB}GB virtual NVMe disk to each of the ${nc.hostCount} nested host VMs ` +
      `(total ${nc.hostCount * mt.nvmeSizeGB}GB from the physical host datastore). ` +
      'This runs against the **physical** ESXi host, not vCenter.'
    );
    out.push('');

    out.push(s('Configure ESXi memory tiering on each nested host (Phase 2)', 'MANUAL'));
    out.push('');
    out.push('Repeat for each nested host:');
    out.push('');
    out.push('1. In vCenter, put the host into **maintenance mode**.');
    out.push('2. SSH into the nested host and run:');
    out.push('   ```bash');
    out.push('   # Enable early memory reservation');
    out.push('   esxcli system settings advanced set -o /Mem/MemEarlyReserve -i 1');
    out.push('');
    out.push(`   # Find the NVMe device path (look for the ~${mt.nvmeSizeGB}GB device)`);
    out.push('   esxcli storage core device list | grep -B2 -A8 NVMe');
    out.push('');
    out.push('   # Add device as memory tier');
    out.push('   esxcli system memtiering add --device /vmfs/devices/disks/<naa.xxxxx>');
    out.push('');
    out.push(`   # Enable tiering with ${mt.tierNvmePct}% of host memory backed by NVMe`);
    out.push(`   esxcli system memtiering set --enable 1 --tier-nvme-pct ${mt.tierNvmePct}`);
    out.push('   ```');
    out.push('3. Exit maintenance mode. The host will reboot to activate the NVMe tier.');
    out.push('');
    out.push(
      '> **Note:** After running `esxcli system memtiering set`, the status will show ' +
      '`Configured: TRUE` but `Runtime: FALSE`. This is expected and correct — ' +
      'the **Runtime** value only becomes `TRUE` after the maintenance-mode reboot.'
    );
    out.push('');
  }

  // =========================================================================
  // Jumpbox / WireGuard VM
  // =========================================================================
  if (hasJumpboxVm) {
    const role = ra.method === 'ssh_jump' ? 'SSH jump host' : 'WireGuard VPN server';
    out.push(s(`Deploy ${role} VM`, 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push(`.\\jumpbox-deploy.ps1 -VCenterServer <vcsa-ip>`);
    out.push('```');
    out.push('');
    out.push(`Creates \`${jumpVmName}\` (1 vCPU / 1GB / 20GB) and generates an ed25519 SSH keypair:`);
    out.push('');
    out.push(`- Private key: \`%USERPROFILE%\\.ssh\\${jumpKeyName}\``);
    out.push(`- Public key:  \`%USERPROFILE%\\.ssh\\${jumpKeyName}.pub\``);
    out.push('');
    out.push('The public key is also stored in the VM\'s Notes field in vCenter.');
    out.push('');

    out.push(s(`Install Ubuntu Server 22.04 LTS on ${jumpVmName}`, 'MANUAL'));
    out.push('');
    out.push(`1. In vCenter, edit \`${jumpVmName}\` → Add device → CD/DVD Drive → attach the Ubuntu Server ISO.`);
    out.push('2. Power on and open the console.');
    out.push('3. Install Ubuntu Server — accept defaults. When asked about SSH, select **Install OpenSSH server**.');
    out.push('4. Assign a static IP in the management network during or after install.');
    out.push('5. After reboot, log in via the vCenter console.');
    out.push('');
    out.push('Add the SSH public key to the VM:');
    out.push('');
    out.push('```bash');
    out.push('mkdir -p ~/.ssh && chmod 700 ~/.ssh');
    out.push(`cat <<\'EOF\' >> ~/.ssh/authorized_keys`);
    out.push(`<paste contents of %USERPROFILE%\\.ssh\\${jumpKeyName}.pub here>`);
    out.push('EOF');
    out.push('chmod 600 ~/.ssh/authorized_keys');
    out.push('```');
    out.push('');
    out.push('Test the keypair from your workstation:');
    out.push('```bash');
    out.push(`ssh -i %USERPROFILE%\\.ssh\\${jumpKeyName} ubuntu@<${jumpVmName}-ip>`);
    out.push('```');
    out.push('');
  }

  if (ra.method === 'ssh_jump') {
    out.push(s('Verify jump host access to lab VMs', 'MANUAL'));
    out.push('');
    out.push('Use ProxyJump (`-J`) to reach nested ESXi hosts or vCenter through the jumpbox:');
    out.push('');
    out.push('```bash');
    out.push(`# Connect to a nested ESXi host via the jumpbox`);
    out.push(`ssh -i %USERPROFILE%\\.ssh\\${jumpKeyName} -J ubuntu@<jumpbox-ip> root@<nested-esxi-ip>`);
    out.push('');
    out.push('# Or add to ~/.ssh/config for convenience:');
    out.push('# Host lab-jump');
    out.push('#   HostName <jumpbox-ip>');
    out.push('#   User ubuntu');
    out.push(`#   IdentityFile %USERPROFILE%\\.ssh\\${jumpKeyName}`);
    out.push('#');
    out.push('# Host 192.168.10.*');
    out.push('#   ProxyJump lab-jump');
    out.push('#   User root');
    out.push('```');
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push(s('Run WireGuard server setup script', 'MANUAL'));
    out.push('');
    out.push(`Copy \`wireguard-server.sh\` to the VM and run it as root:`);
    out.push('');
    out.push('```bash');
    out.push(`# From your workstation (requires SSH key to be set up from the previous step)`);
    out.push(`scp -i %USERPROFILE%\\.ssh\\${jumpKeyName} wireguard-server.sh ubuntu@<wireguard-vm-ip>:~/`);
    out.push(`ssh -i %USERPROFILE%\\.ssh\\${jumpKeyName} ubuntu@<wireguard-vm-ip> "sudo bash ~/wireguard-server.sh"`);
    out.push('```');
    out.push('');
    out.push(
      'The script installs WireGuard, generates the server keypair, writes `/etc/wireguard/wg0.conf`, ' +
      'enables IP forwarding, and starts `wg-quick@wg0`. When it finishes, it prints the **server public key**. ' +
      'Copy that — you need it to configure each client.'
    );
    out.push('');

    out.push(s('Add WireGuard client peers', 'MANUAL'));
    out.push('');
    out.push('Repeat once per device that needs VPN access:');
    out.push('');
    out.push('**On the client device:**');
    out.push('```bash');
    out.push('# Generate a client keypair');
    out.push('wg genkey | tee client.key | wg pubkey > client.pub');
    out.push('cat client.pub   # share this with the server');
    out.push('```');
    out.push('');
    out.push('**On the WireGuard server VM** (edit `/etc/wireguard/wg0.conf`):');
    out.push('```ini');
    out.push('[Peer]');
    out.push('# Description: <device name>');
    out.push('PublicKey = <client.pub contents>');
    out.push('AllowedIPs = 10.200.0.X/32   # next available client IP');
    out.push('```');
    out.push('');
    out.push('Reload WireGuard without dropping other connections:');
    out.push('```bash');
    out.push('sudo wg syncconf wg0 <(sudo wg-quick strip wg0)');
    out.push('```');
    out.push('');
    out.push('**Client `wg0.conf`:**');
    out.push('```ini');
    out.push('[Interface]');
    out.push('PrivateKey = <client.key contents>');
    out.push('Address = 10.200.0.X/24');
    out.push('DNS = ' + (dc.enabled && dc.ipAddress ? dc.ipAddress : '8.8.8.8'));
    out.push('');
    out.push('[Peer]');
    out.push('PublicKey = <server-public-key>');
    out.push('Endpoint = <wireguard-vm-external-ip>:51820');
    out.push(`AllowedIPs = ${mgmtCidr}, 10.200.0.0/24`);
    out.push('PersistentKeepalive = 25');
    out.push('```');
    out.push('');
  }

  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push(s('Configure VyOS site-to-site WireGuard tunnel', 'MANUAL'));
    out.push('');
    out.push('Open `vyos-site-to-site.conf` — it contains ready-to-paste VyOS CLI commands. Before pasting:');
    out.push('');
    out.push('1. Generate a WireGuard keypair on this VyOS router:');
    out.push('   ```');
    out.push('   run generate pki wireguard key-pair');
    out.push('   ```');
    out.push('   Copy the **Private Key** output. Paste it into the `private-key` placeholder in the config.');
    out.push('   Share the **Public Key** with the operator at the remote site.');
    out.push('');
    out.push('2. Get the remote site\'s WireGuard public key and public IP.');
    out.push('   Fill in `<remote-public-key>` and `<remote-endpoint-ip>` in the config.');
    out.push('');
    out.push('3. Update `192.168.100.0/24` with the actual subnet range at the remote site.');
    out.push('');
    out.push('4. Paste the edited config into the VyOS CLI (it enters configure mode, commits, and saves).');
    out.push('');
    out.push('**Verify both sides are connected:**');
    out.push('```');
    out.push('run show interfaces wireguard wg0');
    out.push('run ping 10.201.0.2      # remote tunnel endpoint');
    out.push('```');
    out.push('');
  }

  // =========================================================================
  // Workload VMs
  // =========================================================================
  if (wl.enabled && wl.count > 0) {
    out.push(s('Deploy test workload VMs', 'AUTOMATED'));
    out.push('');
    out.push('```powershell');
    out.push('.\\deploy-workloads.ps1 -VCenterServer <vcsa-ip>');
    out.push('```');
    out.push('');
    out.push(
      `Creates ${wl.count} blank VM shell${wl.count === 1 ? '' : 's'} (${wl.vcpu} vCPU / ${wl.vramGB}GB each) on the vSAN cluster. ` +
      'No OS is installed. These are useful for practising vMotion, DRS placement, HA failover, and storage policy assignment.'
    );
    out.push('');
    out.push('To use a workload VM: power it on in vCenter and attach an OS ISO via **Edit Settings → CD/DVD Drive**.');
    out.push('');
  }

  // =========================================================================
  // Done
  // =========================================================================
  out.push('## Build complete');
  out.push('');
  out.push('If you made it here without errors, the lab is up. A few things to confirm before handing it over:');
  out.push('');
  out.push('- [ ] All nested ESXi hosts show as Connected in vCenter');
  if (nc.vsanEnabled) {
    out.push('- [ ] vSAN health checks all green (no red or yellow items)');
    out.push('- [ ] vSAN datastore visible and showing capacity');
  }
  if (dc.enabled) {
    out.push('- [ ] DC is resolving FQDNs correctly (run `Resolve-DnsName <vcsa-fqdn>` from a lab machine)');
  }
  if (ra.method === 'ssh_jump') {
    out.push('- [ ] SSH jump host reachable and key-based auth working');
  }
  if (ra.method === 'vpn' && ra.vpnType === 'wireguard') {
    out.push('- [ ] WireGuard tunnel up (`wg show` on server shows a peer with a recent handshake)');
  }
  if (ra.method === 'vpn' && ra.vpnType === 'vyos_site_to_site') {
    out.push('- [ ] Site-to-site tunnel up and remote subnet pingable through it');
  }
  out.push('- [ ] vCenter UI accessible from your workstation');
  out.push('');

  return out.join('\n');
}

module.exports = { buildBuildGuide };
