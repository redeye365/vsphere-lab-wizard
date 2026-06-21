// lib/sizing.js
//
// Works out whether the requested nested cluster fits on the physical hardware
// and flags the failure modes that show up in real nested labs. Accounts for
// all VMs in the design: nested ESXi hosts, lab appliances (VyOS, DC),
// workload VMs, and access VMs (jumpbox or WireGuard server).

const VYOS_VCPU = 1;
const VYOS_VRAM_GB = 1;
const DC_VCPU = 2;
const DC_VRAM_GB = 4;
const JUMPBOX_VCPU = 1;
const JUMPBOX_VRAM_GB = 1;   // Ubuntu jumpbox / WireGuard server: minimal footprint

// Minimum vRAM per nested ESXi host by version -- below these the host will
// either refuse to boot or thrash memory constantly.
const ESXI_MIN_VRAM_GB = {
  '9.0':   8,
  '8.0u3': 8,
  '8.0u2': 8,
  '8.0u1': 8
};

const WORKLOAD_VM_SIZES = {
  small:  { vcpu: 2, vramGB: 4 },
  medium: { vcpu: 4, vramGB: 8 }
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function evaluateSizing(answers) {
  const warnings = [];

  const physicalRamGB = toNumber(answers.hardware?.ramGB);
  const physicalCores = toNumber(answers.hardware?.cpuCores);
  const storageDevices = (answers.hardware?.storageDevices || [])
    .filter((d) => d.type && d.capacityGB)
    .map((d) => ({
      ...d,
      capacityGB: d.capacityUnit === 'TB'
        ? (Number(d.capacityGB) || 0) * 1000
        : Number(d.capacityGB) || 0
    }));
  const physicalStorageGB = storageDevices.reduce((s, d) => s + d.capacityGB, 0);

  const nestedDisks = (answers.design?.nestedDisks || [])
    .filter((d) => d.sizeGB && d.purpose);
  const vsanCapacityDisks = nestedDisks.filter((d) => d.purpose === 'vsan_capacity');

  const nestedHostCount = toNumber(answers.design?.nestedHostCount);
  const vcpuPerHost = toNumber(answers.design?.vcpuPerHost);
  const vramPerHostGB = toNumber(answers.design?.vramPerHostGB);
  const vsanEnabled = !!answers.design?.vsanEnabled;
  const vyosEnabled = !!answers.design?.vyosEnabled;
  const dcEnabled = !!answers.design?.dcEnabled;
  const esxiVersion = answers.design?.esxiVersion || null;
  const workloadVmsEnabled = !!answers.design?.workloadVmsEnabled;
  const workloadVmCount = toNumber(answers.design?.workloadVmCount);
  const workloadVmSize = answers.design?.workloadVmSize || 'small';
  const remoteMethod = answers.design?.remoteAccessMethod || null;
  const vpnType = answers.design?.vpnType || null;

  // ESXi version minimum vRAM check
  const minVramForVersion = esxiVersion ? (ESXI_MIN_VRAM_GB[esxiVersion] || null) : null;
  if (minVramForVersion !== null && vramPerHostGB > 0 && vramPerHostGB < minVramForVersion) {
    warnings.push(
      `${esxiVersion} requires at least ${minVramForVersion}GB vRAM per nested host. ` +
      `The current setting of ${vramPerHostGB}GB is below that minimum and the host will likely fail to boot.`
    );
  }

  const nestedVcpu = nestedHostCount * vcpuPerHost;
  const nestedVramGB = nestedHostCount * vramPerHostGB;

  const applianceVcpu = (vyosEnabled ? VYOS_VCPU : 0) + (dcEnabled ? DC_VCPU : 0);
  const applianceVramGB = (vyosEnabled ? VYOS_VRAM_GB : 0) + (dcEnabled ? DC_VRAM_GB : 0);

  const wlSpec = WORKLOAD_VM_SIZES[workloadVmSize] || WORKLOAD_VM_SIZES.small;
  const workloadVcpu = workloadVmsEnabled ? workloadVmCount * wlSpec.vcpu : 0;
  const workloadVramGB = workloadVmsEnabled ? workloadVmCount * wlSpec.vramGB : 0;

  // A jumpbox or dedicated WireGuard VM is a small Linux VM (1 vCPU / 1GB).
  // Count it when the user chose ssh_jump, or chose VPN + WireGuard (which
  // needs a server VM even if no separate jumpbox was selected).
  const needsAccessVm = remoteMethod === 'ssh_jump' ||
    (remoteMethod === 'vpn' && vpnType === 'wireguard');
  const accessVmVcpu = needsAccessVm ? JUMPBOX_VCPU : 0;
  const accessVmVramGB = needsAccessVm ? JUMPBOX_VRAM_GB : 0;
  const accessVmLabel = remoteMethod === 'ssh_jump' ? 'jumpbox' : 'WireGuard VM';

  const totalRequestedVcpu = nestedVcpu + applianceVcpu + workloadVcpu + accessVmVcpu;
  const totalRequestedVramGB = nestedVramGB + applianceVramGB + workloadVramGB + accessVmVramGB;

  // Reserve headroom for the physical ESXi host itself plus always-on infra
  // (vCenter, jump box, etc). 8% or 16GB, whichever is bigger.
  const reservedOverheadGB = Math.max(16, Math.round(physicalRamGB * 0.08));
  const usableRamGB = physicalRamGB > 0 ? physicalRamGB - reservedOverheadGB : 0;

  const ramOvercommitRatio = usableRamGB > 0
    ? +(totalRequestedVramGB / usableRamGB).toFixed(2)
    : null;
  const cpuOvercommitRatio = physicalCores > 0
    ? +(totalRequestedVcpu / physicalCores).toFixed(2)
    : null;

  const breakdownParts = [];
  if (applianceVramGB > 0) {
    const names = [vyosEnabled && 'VyOS', dcEnabled && 'DC'].filter(Boolean).join(', ');
    breakdownParts.push(`${applianceVramGB}GB for lab appliances (${names})`);
  }
  if (workloadVramGB > 0) {
    breakdownParts.push(`${workloadVramGB}GB for ${workloadVmCount} workload VM${workloadVmCount === 1 ? '' : 's'}`);
  }
  if (accessVmVramGB > 0) {
    breakdownParts.push(`${accessVmVramGB}GB for ${accessVmLabel}`);
  }
  const breakdownNote = breakdownParts.length ? ` (includes ${breakdownParts.join(' and ')})` : '';

  if (usableRamGB > 0 && totalRequestedVramGB > usableRamGB) {
    warnings.push(
      `The lab asks for ${totalRequestedVramGB}GB of vRAM${breakdownNote}, but only ${usableRamGB}GB is usable ` +
      `once ${reservedOverheadGB}GB is set aside for the physical host. Expect ballooning or swapping ` +
      `as soon as vCenter and any test workloads power on. Drop the per-host vRAM or the nested host count.`
    );
  } else if (usableRamGB > 0 && ramOvercommitRatio !== null && ramOvercommitRatio > 0.85) {
    warnings.push(
      `All lab VMs${breakdownNote} will claim ${Math.round(ramOvercommitRatio * 100)}% of usable physical RAM. ` +
      `There's not much room left for vCenter or anything else you power on alongside the lab.`
    );
  }

  if (physicalCores > 0 && totalRequestedVcpu > physicalCores * 4) {
    warnings.push(
      `vCPU overcommit sits at ${cpuOvercommitRatio}:1 across all lab VMs. That's fine while everything ` +
      `is idle, but running several nested hosts under load at the same time will feel sluggish.`
    );
  }

  if (vsanEnabled && nestedHostCount > 0 && nestedHostCount < 3) {
    warnings.push(
      'vSAN wants at least 3 hosts in the cluster. With fewer than that it will run in a degraded or ' +
      'single-host mode, which behaves nothing like a production vSAN cluster.'
    );
  }

  if (vsanEnabled) {
    if (vsanCapacityDisks.length === 0 && nestedDisks.length > 0) {
      warnings.push(
        'vSAN is enabled but no nested disk is designated as the vSAN capacity tier. ' +
        'The cluster formation script will fail without a disk to claim. ' +
        'Add a vSAN capacity disk in the nested host disk layout step.'
      );
    }
    const vsanOnHdd = vsanEnabled && storageDevices.some((d) => d.type === 'spinning_disk');
    if (vsanOnHdd) {
      warnings.push(
        'vSAN is enabled and at least one physical disk is a spinning disk. ' +
        'vSAN VMDKs land on the physical ESXi datastore, so performance will be poor if spinning disks are your only storage.'
      );
    }
    if (vsanCapacityDisks.length > 0 && nestedHostCount > 0) {
      const totalVsanCapGB = vsanCapacityDisks.reduce((s, d) => s + (Number(d.sizeGB) || 0), 0);
      const neededCapGB = nestedHostCount * totalVsanCapGB;
      if (physicalStorageGB > 0 && neededCapGB > physicalStorageGB) {
        warnings.push(
          `vSAN capacity VMDKs would need ${neededCapGB}GB total (${nestedHostCount} hosts × ${totalVsanCapGB}GB each), ` +
          `but total physical storage is only ${physicalStorageGB}GB.`
        );
      }
    }
  }

  if (physicalStorageGB > 0 && nestedHostCount > 0 && nestedDisks.length > 0) {
    const localDsDisk = nestedDisks.find((d) => d.purpose === 'local_datastore');
    const perHostDisks = nestedDisks.filter((d) => d.purpose !== 'local_datastore');
    const totalVirtualGB =
      nestedHostCount * perHostDisks.reduce((s, d) => s + (Number(d.sizeGB) || 0), 0) +
      (localDsDisk ? Number(localDsDisk.sizeGB) || 0 : 0);
    if (totalVirtualGB > physicalStorageGB) {
      warnings.push(
        `Virtual disk allocation across all nested hosts (${totalVirtualGB}GB total) exceeds total physical storage ` +
        `(${physicalStorageGB}GB). Reduce disk sizes in the nested host disk layout step or add more physical storage.`
      );
    }
  }

  if (nestedHostCount > 0 && vcpuPerHost === 0) {
    warnings.push('No vCPU count was set for the nested hosts, so the deployment script has nothing to size them with.');
  }

  if (remoteMethod === 'vpn' && vpnType === 'vyos_site_to_site' && !vyosEnabled) {
    warnings.push(
      'VyOS site-to-site VPN is selected but VyOS was not included in this design. ' +
      'The site-to-site config will be generated but you will need a VyOS router to apply it to.'
    );
  }

  return {
    totalRequestedVcpu,
    totalRequestedVramGB,
    nestedVcpu,
    nestedVramGB,
    applianceVcpu,
    applianceVramGB,
    workloadVcpu,
    workloadVramGB,
    accessVmVcpu,
    accessVmVramGB,
    reservedOverheadGB,
    usableRamGB,
    ramOvercommitRatio,
    cpuOvercommitRatio,
    warnings
  };
}

module.exports = { evaluateSizing, ESXI_MIN_VRAM_GB };
