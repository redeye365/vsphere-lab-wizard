// lib/generateSpec.js
//
// Turns the raw wizard answers into a clean, structured spec. This is the
// single source of truth that the PowerShell and markdown generators both
// read from, so it's worth keeping deliberately flat and explicit rather
// than passing the raw form payload around.

const ESXI_VERSION_LABELS = {
  '9.0':   'ESXi 9.0',
  '8.0u3': 'ESXi 8.0 Update 3',
  '8.0u2': 'ESXi 8.0 Update 2',
  '8.0u1': 'ESXi 8.0 Update 1',
  '8.0u1': 'ESXi 8.0 Update 1'
};

const WORKLOAD_VM_SIZES = {
  small:  { vcpu: 2, vramGB: 4 },
  medium: { vcpu: 4, vramGB: 8 }
};

function buildSpec(answers, sizing) {
  const hardware = answers.hardware || {};
  const discovery = answers.discovery || {};
  const design = answers.design || {};

  const wlSize = WORKLOAD_VM_SIZES[design.workloadVmSize] || WORKLOAD_VM_SIZES.small;
  const wlCount = Number(design.workloadVmCount) || 0;

  return {
    generatedAt: new Date().toISOString(),
    tool: 'vsphere-lab-wizard',
    schemaVersion: 2,
    scope: 'vsphere-only',

    useCase: discovery.useCase || null,

    physicalHost: {
      hostCount: Number(hardware.hostCount) || 1,
      cpuCores: Number(hardware.cpuCores) || null,
      ramGB: Number(hardware.ramGB) || null,
      storageDevices: (hardware.storageDevices || [])
        .map((d) => ({
          type: d.type || null,
          capacityGB: d.capacityUnit === 'TB'
            ? (Number(d.capacityGB) || 0) * 1000
            : Number(d.capacityGB) || null
        }))
        .filter((d) => d.type && d.capacityGB),
      nicCount: Number(hardware.nicCount) || null,
      nicSpeed: hardware.nicSpeed || null
    },

    esxiVersion: {
      version: design.esxiVersion || null,
      label: ESXI_VERSION_LABELS[design.esxiVersion] || null
    },

    existingNetwork: {
      type: discovery.networkType || null,
      vlanCapableRouter: discovery.vlanCapable || null,
      dhcpAvailable: discovery.dhcpAvailable || null
    },

    vyos: {
      enabled: !!design.vyosEnabled,
      networkMode: design.vyosNetworkMode || null
    },

    domainController: {
      enabled: !!design.dcEnabled,
      domainName: design.dcDomainName || null,
      ipAddress: design.dcIpAddress || null
    },

    networks: {
      management: {
        cidr: design.mgmtCidr || null,
        vlanId: numOrNull(design.mgmtVlan),
        mode: design.mgmtVlanMode === 'tagged' ? 'tagged' : 'untagged'
      },
      vMotion: { cidr: design.vmotionCidr || null, vlanId: numOrNull(design.vmotionVlan) },
      vsan: design.vsanEnabled
        ? { cidr: design.vsanCidr || null, vlanId: numOrNull(design.vsanVlan) }
        : null,
      vmTraffic: { cidr: design.vmCidr || null, vlanId: numOrNull(design.vmVlan) }
    },

    nestedCluster: {
      hostCount: Number(design.nestedHostCount) || 0,
      vcpuPerHost: Number(design.vcpuPerHost) || 0,
      vramPerHostGB: Number(design.vramPerHostGB) || 0,
      bootDiskGB: Number(design.nestedDiskGB) || 32,
      additionalDisks: (design.nestedDisks || [])
        .map((d) => ({ sizeGB: Number(d.sizeGB) || null, purpose: d.purpose || null }))
        .filter((d) => d.sizeGB && d.purpose),
      vsanEnabled: !!design.vsanEnabled,
      vsanArchitecture: !!design.vsanEnabled ? (design.vsanArch || 'esa') : null,
      legacyCpuCompatibility: !!design.legacyCpuCompat,
      memoryTiering: {
        enabled: !!design.memTieringEnabled,
        nvmeSizeGB: Number(design.nvmeSizeGB) || 100,
        tierNvmePct: Number(design.tierNvmePct) || 25
      },
      clusterName: design.clusterName || 'mgmt-cluster',
      datacenterName: design.datacenterName || 'Lab-DC',
      ssoDomain: design.ssoDomain || 'vsphere.local'
    },

    workloadVms: {
      enabled: !!design.workloadVmsEnabled,
      count: wlCount,
      size: design.workloadVmSize || null,
      vcpu: wlSize.vcpu,
      vramGB: wlSize.vramGB
    },

    localDatastore: {
      enabled: (design.nestedDisks || []).some((d) => d.purpose === 'local_datastore')
    },

    security: {
      isolateLabSegment: !!design.isolateLab,
      firewallPolicy: design.firewallPolicy || null,
      internetAccess: !!design.internetAccess
    },

    remoteAccess: {
      method: design.remoteAccessMethod || null,
      vpnType: design.vpnType || null,
      vcenterDeploymentSize: design.vcenterSize || null
    },

    bundleDepot: {
      enabled: !!design.depotEnabled,
      mode: design.depotMode || 'linux',
      ipAddress: design.depotIpAddress || null
    },

    ntp: {
      source: (!!design.dcEnabled && design.dcIpAddress) ? design.dcIpAddress : 'pool.ntp.org'
    },

    sizing
  };
}

function numOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

module.exports = { buildSpec, ESXI_VERSION_LABELS };
