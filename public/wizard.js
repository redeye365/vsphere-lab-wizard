// public/wizard.js
// No build step, no dependencies. Runs entirely against the Express API.

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Basic structural check — a valid spec must be a plain object with at least
// the top-level keys the wizard generates. Rejects arrays, strings, or
// completely unrelated JSON files.
function isValidSpecStructure(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const required = ['nestedCluster', 'networks', 'esxiVersion'];
  return required.every((k) => k in obj);
}

const TOTAL_STEPS = 15;
const DEPOT_STEP = 10;      // skipped when vSAN + local datastore not both configured
const NSX_STEP = 8;         // always shown
const TROUBLESHOOT_STEP = 14; // only reachable when troubleshooting mode is active

const USE_CASE_LABELS = {
  certification: 'Certification study',
  feature_testing: 'Feature testing',
  homelab: 'General homelab',
  demo: 'Customer demo',
  devtest: 'Dev/test sandbox'
};

const DEVICE_TYPE_LABELS = { nvme: 'NVMe', sata_ssd: 'SATA SSD', sas_ssd: 'SAS SSD', spinning_disk: 'Spinning disk' };
const NESTED_DISK_PURPOSE_LABELS = {
  vsan_storage_pool: 'vSAN storage pool (ESA)',
  vsan_capacity:     'vSAN capacity tier (OSA)',
  vsan_cache:        'vSAN cache / perf tier (OSA)',
  local_datastore:   'Local datastore (host 1 only)',
  data:              'Additional data disk'
};
const NETTYPE_LABELS = { flat: 'Flat, no VLANs', vlans: 'VLANs configured', unsure: 'Not sure' };
const FIREWALL_LABELS = { allow_all: 'Allow all', restricted: 'Restricted to needed ports', isolated: 'Fully isolated' };
const REMOTE_LABELS = { vpn: 'VPN', ssh_jump: 'SSH jump host', none: 'Local only', reverse_proxy: 'Reverse proxy' };
const VPN_TYPE_LABELS = { wireguard: 'WireGuard server VM', vyos_site_to_site: 'VyOS site-to-site' };

const ESXI_VERSION_LABELS = {
  '9.1':   'ESXi 9.1',
  '9.0u2': 'ESXi 9.0 U2',
  '9.0u1': 'ESXi 9.0 U1',
  '9.0':   'ESXi 9.0',
  '8.0u3': 'ESXi 8.0 U3',
  '8.0u2': 'ESXi 8.0 U2',
  '8.0u1': 'ESXi 8.0 U1'
};

// Minimum vRAM per nested host by ESXi version
const ESXI_MIN_VRAM = { '9.1': 8, '9.0u2': 8, '9.0u1': 8, '9.0': 8, '8.0u3': 8, '8.0u2': 8, '8.0u1': 8 };
const ESXI9X_VERSIONS = new Set(['9.1', '9.0u2', '9.0u1', '9.0']);
const VCENTER_TINY_RAM_GB = 14;
const DC_RAM_GB_SIZING = 4;
const VYOS_RAM_GB_SIZING = 1;
const ESXI_OVERHEAD_GB = 4;

const NET_COLORS = {
  management: '#4fb3a4',
  vMotion: '#5b8fd9',
  vsan: '#d99a4e',
  vmTraffic: '#9b86d9'
};

const NSX_TOPOLOGY_LABELS = {
  T0T1:    'T0 + T1 Gateways',
  T0T1DFW: 'T0 + T1 + DFW',
  full:    'Full (T0/T1/DFW/LB)'
};

const SCRIPT_LABELS = {
  'spec':             'lab-spec.json',
  'design-doc':       'design-doc.md',
  'build-guide':      'build-guide.md',
  'prerequisites':    'PREREQUISITES.md',
  'diagram-html':     'diagram.html',
  'network-diagram':  'network-diagram.svg',
  'deploy-lab':       'deploy-lab.ps1',
  'vyos-deploy': 'vyos-deploy.ps1',
  'dc-deploy': 'dc-deploy.ps1',
  'vcenter-deploy': 'vcenter-deploy.ps1',
  'vsan-cluster': 'vsan-cluster.ps1',
  'deploy-workloads': 'deploy-workloads.ps1',
  'jumpbox-deploy': 'jumpbox-deploy.ps1',
  'wireguard-server': 'wireguard-server.sh',
  'vyos-site-to-site': 'vyos-site-to-site.conf',
  'memory-tiering': 'configure-memory-tiering.ps1',
  'depot-deploy':       'depot-deploy.ps1',
  'depot-configure':    'depot-configure.sh',
  'depot-iis':          'depot-iis.ps1',
  'depot-instructions': 'depot-instructions.md',
  'nsx-deploy':     'nsx-deploy.ps1',
  'nsx-configure':  'nsx-configure.ps1',
  'nsx-bgp':        'nsx-bgp.ps1'
};

const state = {
  step: 0,
  troubleshootingMode: false,
  troubleshootPhase: 1,
  troubleshootSpec: null,
  troubleshootTopics: [],
  troubleshootExamObjectives: [],
  troubleshootDifficulty: 'medium',
  troubleshootFileTopics: [],
  troubleshootToken: null,
  troubleshootScenario: null,
  troubleshootClueText: null,
  troubleshootClueUsed: false,
  troubleshootNotes: '',
  troubleshootTicket: null,
  troubleshootTicketSubmitted: false,
  troubleshootHintLevel: 0,
  troubleshootHints: {},
  troubleshootResolved: false,
  troubleshootSessionData: null,
  extendMode: false,
  originalSpec: null,           // spec loaded from file in extend mode
  answers: {
    discovery: { useCase: null, networkType: null, vlanCapable: null, dhcpAvailable: null },
    hardware: {
      hostCount: 1,
      ipAddress: null,
      cpuCores: null, ramGB: null,
      storageDevices: [{ type: '', capacityGB: null, capacityUnit: 'GB' }],
      nicCount: null, nicSpeed: null,
      additionalHosts: []
    },
    design: {
      esxiVersion: null,
      esxiDeployMethod: 'ova',
      vyosEnabled: false, vyosNetworkMode: null,
      dcEnabled: false, dcDomainName: null, dcIpAddress: null,
      mgmtCidr: null, mgmtVlan: null, mgmtVlanMode: 'untagged',
      vmotionCidr: null, vmotionVlan: null,
      vmCidr: null, vmVlan: null,
      vsanEnabled: false, vsanCidr: null, vsanVlan: null,
      nsxEnabled: false, nsxSize: 'small', nsxTopology: 'T0T1',
      nsxIpAddress: null, nsxBgpLocalAs: 65001, nsxBgpPeerAs: 65002,
      depotEnabled: false, depotMode: 'linux', depotIpAddress: null,
      nestedHostCount: 3, vcpuPerHost: 4, vramPerHostGB: 16, nestedDiskGB: 32,
      clusterName: 'mgmt-cluster', datacenterName: 'Lab-DC', ssoDomain: 'vsphere.local',
      vsanArch: 'esa',
      legacyCpuCompat: false,
      memTieringEnabled: false, nvmeSizeGB: 100, tierNvmePct: 25, nvmeTieringDiskIndex: null,
      workloadVmsEnabled: false, workloadVmCount: 3, workloadVmSize: 'small',
      nestedDisks: [],
      nestedHostPlacement: 'auto', nestedHostAssignments: [],
      isolateLab: false, firewallPolicy: null, internetAccess: false,
      remoteAccessMethod: null, vpnType: null, vcenterSize: null
    }
  },
  generated: null
};

function val(v, suffix = '') {
  return (v === null || v === undefined || v === '') ? '—' : `${v}${suffix}`;
}

// --- Field binding ---

function bindNumber(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    obj[key] = el.value === '' ? null : Number(el.value);
    onChange();
  });
}
function bindText(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    obj[key] = el.value.trim() === '' ? null : el.value.trim();
    onChange();
  });
}
function bindSelect(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    obj[key] = el.value === '' ? null : el.value;
    onChange();
  });
}
function bindCheckbox(id, obj, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    obj[key] = el.checked;
    onChange();
  });
}
function bindRadio(name, obj, key, onChange, transform) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        obj[key] = transform ? transform(el.value) : el.value;
        onChange();
      }
    });
  });
}

// ── ESXi 9.x sizing helpers ───────────────────────────────────────────────────

function updateHostCountWarning() {
  const warn = document.getElementById('host-count-warning');
  if (warn) warn.hidden = (state.answers.hardware.hostCount || 1) <= 3;
}

function updateEsxi9Notices() {
  const notices = document.getElementById('esxi9-notices');
  if (notices) notices.hidden = !ESXI9X_VERSIONS.has(state.answers.design.esxiVersion);
}

function updateVramWarning() {
  const g = state.answers.design;
  const warn = document.getElementById('vram-min-warning');
  if (!warn) return;
  const minVram = g.esxiVersion ? (ESXI_MIN_VRAM[g.esxiVersion] || null) : null;
  if (minVram && g.vramPerHostGB > 0 && g.vramPerHostGB < minVram) {
    warn.hidden = false;
    warn.textContent = `Below minimum recommended for ESXi ${ESXI_VERSION_LABELS[g.esxiVersion] || g.esxiVersion} — ${minVram} GB vRAM per host is the minimum. Nested hosts may be unstable or fail to boot.`;
  } else {
    warn.hidden = true;
  }
}

function calcHostTiers(physRamGB, esxiVer) {
  const g = state.answers.design;
  const perHostMin = ESXI_MIN_VRAM[esxiVer] || 8;
  const fixedRam = ESXI_OVERHEAD_GB + VCENTER_TINY_RAM_GB
    + (g.dcEnabled   ? DC_RAM_GB_SIZING   : 0)
    + (g.vyosEnabled ? VYOS_RAM_GB_SIZING : 0);
  const available = Math.max(0, physRamGB - fixedRam);
  const maxHosts = Math.min(Math.floor(available / perHostMin), 12);
  return {
    perHostMin, fixedRam, available, maxHosts,
    tiers: [
      { id: 'minimal',  hosts: 1,        vsanCapable: false,         ramNeeded: fixedRam + perHostMin,           feasible: physRamGB >= fixedRam + perHostMin },
      { id: 'standard', hosts: 3,        vsanCapable: true,          ramNeeded: fixedRam + 3 * perHostMin,       feasible: physRamGB >= fixedRam + 3 * perHostMin },
      { id: 'maximum',  hosts: maxHosts, vsanCapable: maxHosts >= 3, ramNeeded: fixedRam + maxHosts * perHostMin, feasible: maxHosts >= 1 }
    ]
  };
}

function renderSizingRecommendations() {
  const g = state.answers.design;
  const h = state.answers.hardware;
  const panel = document.getElementById('sizing-recommendations');
  if (!panel) return;

  const physRam = h.ramGB;
  const esxiVer = g.esxiVersion;
  const show = physRam && esxiVer && ESXI9X_VERSIONS.has(esxiVer);
  panel.hidden = !show;
  if (!show) return;

  const t = calcHostTiers(physRam, esxiVer);
  const tierLabels = [
    'Minimal — 1 host, learn vSphere basics',
    'Standard — 3 hosts, enables vSAN',
    `Maximum — ${t.maxHosts} host${t.maxHosts !== 1 ? 's' : ''} on your hardware`
  ];

  const grid = document.getElementById('sizing-tier-grid');
  grid.innerHTML = '';

  t.tiers.forEach((tier, i) => {
    const card = document.createElement('div');
    const isSelected = Number(g.nestedHostCount) === tier.hosts && tier.feasible;
    card.className = 'sizing-tier-card' + (isSelected ? ' selected' : '') + (tier.feasible ? '' : ' infeasible');

    const hostNum = document.createElement('div');
    hostNum.className = 'tier-host-count';
    hostNum.textContent = tier.feasible ? tier.hosts : '—';

    const label = document.createElement('div');
    label.className = 'tier-label';
    label.textContent = tierLabels[i];

    const ramLine = document.createElement('div');
    ramLine.className = 'tier-ram-line';
    ramLine.textContent = tier.feasible
      ? `Needs ${tier.ramNeeded} GB of ${physRam} GB`
      : `Needs ${tier.ramNeeded} GB — you have ${physRam} GB`;

    card.append(hostNum, label, ramLine);

    if (tier.vsanCapable && tier.feasible) {
      const badge = document.createElement('div');
      badge.className = 'tier-vsan-badge';
      badge.textContent = 'vSAN capable';
      card.appendChild(badge);
    }

    if (!tier.feasible) {
      const note = document.createElement('div');
      note.className = 'tier-infeasible-note';
      note.textContent = `Need ${tier.ramNeeded - physRam} GB more RAM`;
      card.appendChild(note);
    }

    if (tier.feasible) {
      card.addEventListener('click', () => {
        g.nestedHostCount = tier.hosts;
        g.vcpuPerHost = Math.max(g.vcpuPerHost || 0, 4);
        g.vramPerHostGB = Math.max(g.vramPerHostGB || 0, tier.perHostMin);
        const hostEl = document.getElementById('nestedHostCount');
        const vcpuEl = document.getElementById('vcpuPerHost');
        const vramEl = document.getElementById('vramPerHostGB');
        if (hostEl) hostEl.value = tier.hosts;
        if (vcpuEl) vcpuEl.value = g.vcpuPerHost;
        if (vramEl) vramEl.value = g.vramPerHostGB;
        renderSizingRecommendations();
        renderResourceTips();
        updateVramWarning();
      });
    }

    grid.appendChild(card);
  });
}

function renderResourceTips() {
  const g = state.answers.design;
  const h = state.answers.hardware;
  const panel  = document.getElementById('resource-tips-panel');
  const list   = document.getElementById('resource-tips-list');
  const sub    = document.getElementById('resource-tips-subtitle');
  if (!panel || !list) return;

  const physRam = h.ramGB || 0;
  const esxiVer = g.esxiVersion;
  if (!physRam || !ESXI9X_VERSIONS.has(esxiVer)) { panel.hidden = true; return; }

  const t = calcHostTiers(physRam, esxiVer);
  const standardNeed = t.tiers[1].ramNeeded;
  if (physRam >= standardNeed + 16) { panel.hidden = true; return; }

  panel.hidden = false;
  if (sub) sub.textContent = `— ${physRam} GB available, ${standardNeed} GB needed for 3-host setup`;

  const tips = [];

  if (g.esxiDeployMethod !== 'ova') {
    tips.push({ saving: 'time', text: "Use William Lam's nested ESXi OVA — pre-built appliance, automated deployment, no manual ISO install." });
  }

  tips.push({ saving: '7 GB', text: 'Use vCenter Tiny deployment size (2 vCPU, 14 GB) instead of Small (4 vCPU, 21 GB) — fully adequate for a lab with fewer than 10 hosts.' });

  if (g.dcEnabled) {
    tips.push({ saving: '0–8 GB', text: 'Keep DC at minimum spec — 2 vCPU / 4 GB is sufficient for lab DNS and Active Directory.' });
  }

  tips.push({ saving: 'overhead', text: 'Disable memory reservation on nested ESXi VMs and rely on the memory balloon driver — lets the physical host reclaim idle guest RAM.' });

  if (g.workloadVmsEnabled) {
    tips.push({ saving: `${(g.workloadVmCount || 3) * 4}+ GB`, text: 'Defer workload VMs until the base cluster is healthy. Each small VM adds 4+ GB; deploy after vSAN health checks pass.' });
  }

  const hasNvme = (h.storageDevices || []).some((d) => d.type === 'nvme');
  if (hasNvme && !g.memTieringEnabled) {
    tips.push({ saving: 'up to 2×', text: 'Enable NVMe memory tiering (ESXi 9.1) — extends effective RAM using NVMe as a memory tier. Set <code>sched.mem.enableNestedTiering = true</code> on each nested host before first power-on.' });
  }

  list.innerHTML = '';
  tips.forEach((tip) => {
    const item = document.createElement('div');
    item.className = 'resource-tip-item';
    const badge = document.createElement('span');
    badge.className = 'resource-tip-saving';
    badge.textContent = tip.saving;
    const text = document.createElement('span');
    text.className = 'resource-tip-text';
    text.innerHTML = tip.text;
    item.append(badge, text);
    list.appendChild(item);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

// Depot step is only relevant when vSAN is enabled AND a local_datastore disk is configured.
function depotStepVisible() {
  const g = state.answers.design;
  const hasLocalDs = (g.nestedDisks || []).some((d) => d.purpose === 'local_datastore');
  return !!g.vsanEnabled && hasLocalDs;
}

function wireForm() {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;
  const onChange = () => {
    renderTopology();
    updateWorkloadNote();
    updateDcNotice();
    updateEsxi9Notices();
    renderSizingRecommendations();
    renderResourceTips();
    updateVramWarning();
  };

  bindRadio('useCase', d, 'useCase', onChange);

  bindText('host1Ip', h, 'ipAddress', onChange);
  document.getElementById('hostCount').addEventListener('input', () => {
    h.hostCount = Number(document.getElementById('hostCount').value) || 1;
    updateHostCountWarning();
    syncAdditionalHosts();
    renderAdditionalHosts(onChange);
    renderPlacementRows(onChange);
    onChange();
  });
  // initial render for multi-host sections
  syncAdditionalHosts();
  renderAdditionalHosts(onChange);

  bindNumber('cpuCores', h, 'cpuCores', onChange);
  bindNumber('ramGB', h, 'ramGB', onChange);

  // --- Storage device list ---
  renderStorageDevices(onChange);
  document.getElementById('add-storage-device').addEventListener('click', () => {
    h.storageDevices.push({ type: '', capacityGB: null, capacityUnit: 'GB' });
    renderStorageDevices(onChange);
    onChange();
  });

  bindNumber('nicCount', h, 'nicCount', onChange);
  bindSelect('nicSpeed', h, 'nicSpeed', onChange);

  document.getElementById('esxiVersion').addEventListener('change', (e) => {
    g.esxiVersion = e.target.value || null;
    if (g.esxiVersion && ESXI9X_VERSIONS.has(g.esxiVersion)) {
      const minVram = ESXI_MIN_VRAM[g.esxiVersion] || 8;
      if ((g.vramPerHostGB || 0) < minVram) {
        g.vramPerHostGB = minVram;
        const vramEl = document.getElementById('vramPerHostGB');
        if (vramEl) vramEl.value = minVram;
      }
      if ((g.vcpuPerHost || 0) < 4) {
        g.vcpuPerHost = 4;
        const vcpuEl = document.getElementById('vcpuPerHost');
        if (vcpuEl) vcpuEl.value = 4;
      }
    }
    onChange();
  });

  // OVA vs ISO deploy method
  document.querySelectorAll('input[name="esxiDeployMethod"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.esxiDeployMethod = el.value;
        document.getElementById('esxi-ova-hint').hidden = el.value !== 'ova';
        document.getElementById('esxi-iso-hint').hidden = el.value !== 'iso';
        onChange();
      }
    });
  });

  // VyOS
  const vyosCheckbox = document.getElementById('vyosEnabled');
  vyosCheckbox.addEventListener('change', () => {
    g.vyosEnabled = vyosCheckbox.checked;
    document.getElementById('vyos-mode-field').hidden = !g.vyosEnabled;
    onChange();
  });
  bindRadio('vyosNetworkMode', g, 'vyosNetworkMode', onChange);

  // DC
  const dcCheckbox = document.getElementById('dcEnabled');
  dcCheckbox.addEventListener('change', () => {
    g.dcEnabled = dcCheckbox.checked;
    document.getElementById('dc-fields').hidden = !g.dcEnabled;
    onChange();
  });
  bindText('dcDomainName', g, 'dcDomainName', () => { checkSsoCollision(); onChange(); });
  bindText('dcIpAddress', g, 'dcIpAddress', onChange);

  bindRadio('networkType', d, 'networkType', onChange);
  bindRadio('vlanCapable', d, 'vlanCapable', onChange, (v) => (v === 'yes' ? true : v === 'no' ? false : null));
  bindRadio('dhcpAvailable', d, 'dhcpAvailable', onChange, (v) => v === 'yes');

  bindText('mgmtCidr', g, 'mgmtCidr', onChange);

  // VLAN mode radio — toggles VLAN ID field visibility
  document.querySelectorAll('input[name="mgmtVlanMode"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.mgmtVlanMode = el.value;
        const tagged = el.value === 'tagged';
        document.getElementById('mgmt-vlan-id-field').hidden = !tagged;
        document.getElementById('mgmt-vlan-hint-untagged').hidden = tagged;
        document.getElementById('mgmt-vlan-hint-tagged').hidden = !tagged;
        if (!tagged) g.mgmtVlan = null;
        onChange();
      }
    });
  });
  bindNumber('mgmtVlan', g, 'mgmtVlan', onChange);
  bindText('vmotionCidr', g, 'vmotionCidr', onChange);
  bindNumber('vmotionVlan', g, 'vmotionVlan', onChange);
  bindText('vmCidr', g, 'vmCidr', onChange);
  bindNumber('vmVlan', g, 'vmVlan', onChange);
  bindText('vsanCidr', g, 'vsanCidr', onChange);
  bindNumber('vsanVlan', g, 'vsanVlan', onChange);

  bindNumber('nestedHostCount', g, 'nestedHostCount', onChange);
  bindNumber('vcpuPerHost', g, 'vcpuPerHost', onChange);
  bindNumber('vramPerHostGB', g, 'vramPerHostGB', onChange);
  bindNumber('nestedDiskGB', g, 'nestedDiskGB', onChange);

  document.getElementById('vsanEnabled').addEventListener('change', (e) => {
    g.vsanEnabled = e.target.checked;
    document.getElementById('vsan-network-row').hidden = !g.vsanEnabled;
    document.getElementById('vsan-network-hint').hidden = !g.vsanEnabled;
    document.getElementById('vsan-arch-field').hidden = !g.vsanEnabled;
    onChange();
  });
  bindRadio('vsanArch', g, 'vsanArch', () => {
    const esa = g.vsanArch !== 'osa';
    document.getElementById('vsan-esa-hint').hidden = !esa;
    document.getElementById('vsan-osa-hint').hidden = esa;
    // Migrate existing disk purposes to match the new architecture
    (g.nestedDisks || []).forEach((disk) => {
      if (esa) {
        if (disk.purpose === 'vsan_capacity') disk.purpose = 'vsan_storage_pool';
        else if (disk.purpose === 'vsan_cache') disk.purpose = '';
      } else {
        if (disk.purpose === 'vsan_storage_pool') disk.purpose = 'vsan_capacity';
      }
    });
    renderNestedDisks(onChange);
    onChange();
  });

  bindText('clusterName', g, 'clusterName', onChange);

  function checkSsoCollision() {
    const sso = (g.ssoDomain || '').toLowerCase().trim();
    const ad = (g.dcDomainName || '').toLowerCase().trim();
    const collides = ad.length > 0 && (
      sso === ad || sso.endsWith('.' + ad) || ad.endsWith('.' + sso)
    );
    document.getElementById('sso-collision-warning').hidden = !collides;
  }
  const ssoDomainEl = document.getElementById('ssoDomain');
  ssoDomainEl.addEventListener('input', () => {
    g.ssoDomain = ssoDomainEl.value.trim() || 'vsphere.local';
    checkSsoCollision();
    onChange();
  });

  // host count → VCF headroom note
  document.getElementById('nestedHostCount').addEventListener('input', () => {
    const note = document.getElementById('host-count-vcf-note');
    if (note) note.hidden = (g.nestedHostCount || 0) >= 3;
    renderPlacementRows(onChange);
  });

  // Nested host placement (step 7, shown when physCount > 1)
  document.querySelectorAll('input[name="nestedHostPlacement"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.nestedHostPlacement = el.value;
        renderPlacementRows(onChange);
        onChange();
      }
    });
  });
  renderPlacementRows(onChange);

  bindCheckbox('legacyCpuCompat', g, 'legacyCpuCompat', onChange);

  // Memory tiering (step 7)
  document.getElementById('memTieringEnabled').addEventListener('change', (e) => {
    g.memTieringEnabled = e.target.checked;
    document.getElementById('mem-tiering-fields').hidden = !g.memTieringEnabled;
    if (g.memTieringEnabled) renderNvmeDiskPicker(onChange);
    onChange();
  });
  bindNumber('tierNvmePct', g, 'tierNvmePct', onChange);

  // NSX step (step 8)
  const nsxCheckbox = document.getElementById('nsxEnabled');
  if (nsxCheckbox) {
    nsxCheckbox.addEventListener('change', () => {
      g.nsxEnabled = nsxCheckbox.checked;
      document.getElementById('nsx-fields').hidden = !g.nsxEnabled;
      updateNsxBgpVisibility();
      onChange();
    });
  }
  bindRadio('nsxSize', g, 'nsxSize', onChange);
  bindRadio('nsxTopology', g, 'nsxTopology', onChange);
  bindText('nsxIpAddress', g, 'nsxIpAddress', onChange);
  bindNumber('nsxBgpLocalAs', g, 'nsxBgpLocalAs', onChange);
  bindNumber('nsxBgpPeerAs', g, 'nsxBgpPeerAs', onChange);

  function updateNsxBgpVisibility() {
    const bgpSection = document.getElementById('nsx-bgp-section');
    if (!bgpSection) return;
    const show = g.nsxEnabled && g.vyosEnabled && g.vyosNetworkMode === 'bgp';
    bgpSection.hidden = !show;
  }
  // Re-run when VyOS BGP changes
  const origVyosHandler = () => { updateNsxBgpVisibility(); };
  document.querySelectorAll('input[name="vyosNetworkMode"]').forEach((el) => {
    el.addEventListener('change', origVyosHandler);
  });
  document.getElementById('vyosEnabled').addEventListener('change', origVyosHandler);

  // Spec versioning — "Extend existing lab" file picker
  const extendRadios = document.querySelectorAll('input[name="labMode"]');
  const specFileField = document.getElementById('spec-file-field');
  const specFileInput = document.getElementById('spec-file-input');
  if (extendRadios.length && specFileField && specFileInput) {
    extendRadios.forEach((el) => {
      el.addEventListener('change', () => {
        state.extendMode = el.value === 'extend';
        document.getElementById('extend-mode-indicator').hidden = !state.extendMode;
        specFileField.hidden = !state.extendMode;
        if (!state.extendMode) {
          state.originalSpec = null;
          state.answers.extendMode = false;
        }
        onChange();
      });
    });
    specFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById('spec-load-status');
      if (file.size > 512 * 1024) {
        statusEl.textContent = 'File too large — spec.json must be under 512 KB.';
        statusEl.className = 'spec-load-error';
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const spec = JSON.parse(ev.target.result);
          if (!isValidSpecStructure(spec)) {
            statusEl.textContent = 'Not a valid lab spec file.';
            statusEl.className = 'spec-load-error';
            return;
          }
          state.originalSpec = spec;
          state.answers.extendMode = true;
          loadSpecIntoState(spec);
          statusEl.textContent = `Loaded: ${file.name}`;
          statusEl.className = 'spec-load-ok';
        } catch {
          statusEl.textContent = 'Invalid JSON — could not load spec.';
          statusEl.className = 'spec-load-error';
        }
      };
      reader.readAsText(file);
    });
  }

  // Nested disk list (step 9)
  renderNestedDisks(onChange);
  document.getElementById('add-nested-disk').addEventListener('click', () => {
    g.nestedDisks.push({ sizeGB: null, purpose: '' });
    renderNestedDisks(onChange);
    onChange();
  });

  // Workload VMs (step 9)
  const wlCheckbox = document.getElementById('workloadVmsEnabled');
  wlCheckbox.addEventListener('change', () => {
    g.workloadVmsEnabled = wlCheckbox.checked;
    document.getElementById('workload-fields').hidden = !g.workloadVmsEnabled;
    onChange();
  });
  bindNumber('workloadVmCount', g, 'workloadVmCount', onChange);
  bindRadio('workloadVmSize', g, 'workloadVmSize', onChange);

  bindCheckbox('isolateLab', g, 'isolateLab', onChange);
  bindRadio('firewallPolicy', g, 'firewallPolicy', onChange);
  bindCheckbox('internetAccess', g, 'internetAccess', onChange);
  const remoteMethodEl = document.getElementById('remoteAccessMethod');
  const vpnTypeField = document.getElementById('vpn-type-field');
  remoteMethodEl.addEventListener('change', () => {
    g.remoteAccessMethod = remoteMethodEl.value || null;
    const isVpn = g.remoteAccessMethod === 'vpn';
    vpnTypeField.hidden = !isVpn;
    if (!isVpn) {
      g.vpnType = null;
      vpnTypeField.querySelectorAll('input[type=radio]').forEach((r) => { r.checked = false; });
    }
    onChange();
  });
  bindRadio('vpnType', g, 'vpnType', onChange);
  bindSelect('vcenterSize', g, 'vcenterSize', onChange);

  // Bundle depot (step 9)
  const depotCheckbox = document.getElementById('depotEnabled');
  depotCheckbox.addEventListener('change', () => {
    g.depotEnabled = depotCheckbox.checked;
    document.getElementById('depot-fields').hidden = !g.depotEnabled;
    onChange();
  });
  document.querySelectorAll('input[name="depotMode"]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.checked) {
        g.depotMode = el.value;
        const isIis = el.value === 'iis';
        document.getElementById('depot-linux-hint').hidden = isIis;
        document.getElementById('depot-iis-hint').hidden = !isIis;
        document.getElementById('depot-iis-no-dc-warning').hidden = !(isIis && !g.dcEnabled);
        onChange();
      }
    });
  });
  bindText('depotIpAddress', g, 'depotIpAddress', onChange);
}

function renderStorageDevices(onChange) {
  const h = state.answers.hardware;
  const devices = h.storageDevices;
  const listEl = document.getElementById('storage-device-list');
  listEl.innerHTML = '';

  if (devices.length > 0) {
    const header = document.createElement('div');
    header.className = 'storage-device-list-header';
    ['Type', 'Size', 'Unit', ''].forEach((label) => {
      const s = document.createElement('span');
      s.textContent = label;
      header.appendChild(s);
    });
    listEl.appendChild(header);
  }

  devices.forEach((dev, idx) => {
    const entry = document.createElement('div');
    entry.className = 'storage-device-entry';

    const typeSelect = document.createElement('select');
    [['', 'Type…'], ['nvme', 'NVMe'], ['sata_ssd', 'SATA SSD'], ['sas_ssd', 'SAS SSD'], ['spinning_disk', 'Spinning disk']]
      .forEach(([v, label]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = label; o.selected = dev.type === v;
        typeSelect.appendChild(o);
      });
    typeSelect.addEventListener('change', () => { devices[idx].type = typeSelect.value || ''; if (onChange) onChange(); });

    const capacityInput = document.createElement('input');
    capacityInput.type = 'number'; capacityInput.min = '1'; capacityInput.placeholder = 'e.g. 2';
    if (dev.capacityGB) capacityInput.value = dev.capacityGB;
    capacityInput.addEventListener('input', () => { devices[idx].capacityGB = Number(capacityInput.value) || null; if (onChange) onChange(); });

    const unitSelect = document.createElement('select');
    [['GB', 'GB'], ['TB', 'TB']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label; o.selected = (dev.capacityUnit || 'GB') === v;
      unitSelect.appendChild(o);
    });
    unitSelect.addEventListener('change', () => { devices[idx].capacityUnit = unitSelect.value; if (onChange) onChange(); });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'btn-remove'; removeBtn.textContent = '×';
    removeBtn.title = 'Remove this device'; removeBtn.disabled = devices.length <= 1;
    removeBtn.addEventListener('click', () => {
      if (devices.length > 1) {
        devices.splice(idx, 1);
        renderStorageDevices(onChange);
        if (onChange) onChange();
      }
    });

    entry.append(typeSelect, capacityInput, unitSelect, removeBtn);
    listEl.appendChild(entry);
  });

  // Keep the memory-tiering disk picker in sync when the hardware list changes
  if (state.answers.design.memTieringEnabled) renderNvmeDiskPicker(onChange);
}

function syncAdditionalHosts() {
  const h = state.answers.hardware;
  const count = Number(h.hostCount) || 1;
  const target = Math.max(0, count - 1);
  while (h.additionalHosts.length < target) {
    h.additionalHosts.push({
      ipAddress: null, sameAsFirst: true,
      cpuCores: null, ramGB: null,
      storageDevices: [{ type: '', capacityGB: null, capacityUnit: 'GB' }],
      nicCount: null, nicSpeed: null
    });
  }
  h.additionalHosts.length = target;
}

function renderAdditionalHosts(onChange) {
  const h = state.answers.hardware;
  const section = document.getElementById('additional-hosts-section');
  const list = document.getElementById('additional-hosts-list');
  if (!section || !list) return;

  const count = Number(h.hostCount) || 1;
  section.hidden = count < 2;
  if (count < 2) return;

  list.innerHTML = '';
  h.additionalHosts.forEach((host, idx) => {
    const hostNum = idx + 2;
    const block = document.createElement('div');
    block.style.cssText = 'border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:14px;';

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;';
    const title = document.createElement('strong');
    title.style.cssText = 'font-size:13px;color:var(--text);';
    title.textContent = `Physical host ${hostNum}`;
    titleRow.appendChild(title);
    block.appendChild(titleRow);

    // IP address
    const ipRow = document.createElement('div');
    ipRow.style.cssText = 'margin-bottom:10px;';
    const ipLabel = document.createElement('label');
    ipLabel.textContent = `Host ${hostNum} management IP`;
    ipLabel.style.cssText = 'display:block;font-size:12px;margin-bottom:4px;color:var(--text-muted);';
    const ipInput = document.createElement('input');
    ipInput.type = 'text'; ipInput.placeholder = 'e.g. 192.168.1.11';
    ipInput.style.cssText = 'width:220px;';
    if (host.ipAddress) ipInput.value = host.ipAddress;
    ipInput.addEventListener('input', () => {
      h.additionalHosts[idx].ipAddress = ipInput.value.trim() || null;
      onChange();
    });
    ipRow.append(ipLabel, ipInput);
    block.appendChild(ipRow);

    // Same specs checkbox
    const sameRow = document.createElement('label');
    sameRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);cursor:pointer;';
    const sameCheck = document.createElement('input');
    sameCheck.type = 'checkbox'; sameCheck.checked = host.sameAsFirst !== false;
    const sameLabel = document.createElement('span');
    sameLabel.textContent = 'Same CPU, RAM, storage, and NIC specs as host 1';
    sameRow.append(sameCheck, sameLabel);
    block.appendChild(sameRow);

    // Extra specs section (hidden unless sameAsFirst = false)
    const extraSpecs = document.createElement('div');
    extraSpecs.hidden = host.sameAsFirst !== false;
    extraSpecs.style.cssText = 'margin-top:12px;';

    const extraCpuRam = document.createElement('div');
    extraCpuRam.style.cssText = 'display:flex;gap:12px;margin-bottom:10px;';

    const cpuF = document.createElement('div');
    const cpuL = document.createElement('label');
    cpuL.textContent = 'CPU cores'; cpuL.style.cssText = 'display:block;font-size:12px;margin-bottom:3px;color:var(--text-muted);';
    const cpuI = document.createElement('input');
    cpuI.type = 'number'; cpuI.min = '1'; cpuI.placeholder = 'e.g. 36'; cpuI.style.width = '100px';
    if (host.cpuCores) cpuI.value = host.cpuCores;
    cpuI.addEventListener('input', () => { h.additionalHosts[idx].cpuCores = Number(cpuI.value) || null; onChange(); });
    cpuF.append(cpuL, cpuI);

    const ramF = document.createElement('div');
    const ramL = document.createElement('label');
    ramL.textContent = 'RAM (GB)'; ramL.style.cssText = 'display:block;font-size:12px;margin-bottom:3px;color:var(--text-muted);';
    const ramI = document.createElement('input');
    ramI.type = 'number'; ramI.min = '1'; ramI.placeholder = 'e.g. 256'; ramI.style.width = '100px';
    if (host.ramGB) ramI.value = host.ramGB;
    ramI.addEventListener('input', () => { h.additionalHosts[idx].ramGB = Number(ramI.value) || null; onChange(); });
    ramF.append(ramL, ramI);

    extraCpuRam.append(cpuF, ramF);
    extraSpecs.appendChild(extraCpuRam);

    sameCheck.addEventListener('change', () => {
      h.additionalHosts[idx].sameAsFirst = sameCheck.checked;
      extraSpecs.hidden = sameCheck.checked;
      onChange();
    });

    block.append(extraSpecs);
    list.appendChild(block);
  });
}

function renderPlacementRows(onChange) {
  const h = state.answers.hardware;
  const g = state.answers.design;
  const physCount = Number(h.hostCount) || 1;
  const nestedCount = Number(g.nestedHostCount) || 0;
  const placementSection = document.getElementById('placement-section');
  const manualRows = document.getElementById('manual-placement-rows');
  if (!placementSection || !manualRows) return;

  placementSection.hidden = physCount < 2;
  if (physCount < 2) return;

  const isManual = g.nestedHostPlacement === 'manual';
  manualRows.hidden = !isManual;
  if (!isManual) return;

  // Ensure assignments array is sized correctly
  while (g.nestedHostAssignments.length < nestedCount) g.nestedHostAssignments.push(0);
  g.nestedHostAssignments.length = nestedCount;

  manualRows.innerHTML = '';
  for (let i = 0; i < nestedCount; i++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px;';
    const lbl = document.createElement('span');
    lbl.textContent = `nested-esxi-${String(i + 1).padStart(2, '0')}`;
    lbl.style.cssText = 'min-width:140px;color:var(--text);';
    const sel = document.createElement('select');
    sel.style.width = '180px';
    for (let p = 0; p < physCount; p++) {
      const o = document.createElement('option');
      o.value = p; o.textContent = `Physical host ${p + 1}`;
      o.selected = (g.nestedHostAssignments[i] === p);
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { g.nestedHostAssignments[i] = Number(sel.value); onChange(); });
    row.append(lbl, sel);
    manualRows.appendChild(row);
  }
}

function renderNvmeDiskPicker(onChange) {
  const container = document.getElementById('nvme-disk-options');
  const warningEl = document.getElementById('nvme-disk-warning');
  if (!container) return;

  const g = state.answers.design;
  const h = state.answers.hardware;
  const nvmeDisks = (h.storageDevices || [])
    .map((dev, idx) => ({ dev, idx }))
    .filter(({ dev }) => dev.type === 'nvme' && dev.capacityGB);

  container.innerHTML = '';

  if (nvmeDisks.length === 0) {
    if (warningEl) warningEl.hidden = false;
    return;
  }
  if (warningEl) warningEl.hidden = true;

  // Auto-select first NVMe if nothing selected (or selection no longer valid)
  if (g.nvmeTieringDiskIndex === null || !nvmeDisks.find(({ idx }) => idx === g.nvmeTieringDiskIndex)) {
    g.nvmeTieringDiskIndex = nvmeDisks[0].idx;
  }

  nvmeDisks.forEach(({ dev, idx }) => {
    const raw = Number(dev.capacityGB) || 0;
    const sizeGB = dev.capacityUnit === 'TB' ? raw * 1000 : raw;
    const sizeLabel = sizeGB >= 1000
      ? (sizeGB / 1000).toFixed(1).replace(/\.0$/, '') + ' TB'
      : sizeGB + ' GB';

    const label = document.createElement('label');
    label.className = 'nvme-disk-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'nvmeTieringDisk';
    radio.value = String(idx);
    radio.checked = g.nvmeTieringDiskIndex === idx;
    radio.addEventListener('change', () => {
      g.nvmeTieringDiskIndex = idx;
      if (onChange) onChange();
    });

    const badge = document.createElement('span');
    badge.className = 'nvme-disk-badge';
    badge.textContent = 'NVMe';

    const size = document.createElement('span');
    size.className = 'nvme-disk-size';
    size.textContent = sizeLabel;

    const desc = document.createElement('span');
    desc.className = 'nvme-disk-desc';
    desc.textContent = `Disk #${idx + 1} — memory tiering VMDKs will be provisioned from this device`;

    label.append(radio, badge, size, desc);
    container.appendChild(label);
  });
}

function renderNestedDisks(onChange) {
  const g = state.answers.design;
  const disks = g.nestedDisks;
  const listEl = document.getElementById('nested-disk-list');
  listEl.innerHTML = '';

  if (disks.length > 0) {
    const header = document.createElement('div');
    header.className = 'nested-disk-list-header';
    ['Size (GB)', 'Purpose', ''].forEach((label) => {
      const s = document.createElement('span');
      s.textContent = label;
      header.appendChild(s);
    });
    listEl.appendChild(header);
  }

  disks.forEach((disk, idx) => {
    const entry = document.createElement('div');
    entry.className = 'nested-disk-entry';

    const sizeInput = document.createElement('input');
    sizeInput.type = 'number'; sizeInput.min = '1'; sizeInput.placeholder = 'e.g. 200';
    if (disk.sizeGB) sizeInput.value = disk.sizeGB;
    sizeInput.addEventListener('input', () => { disks[idx].sizeGB = Number(sizeInput.value) || null; if (onChange) onChange(); });

    const purposeSelect = document.createElement('select');
    const isEsa = state.answers.design.vsanArch !== 'osa';
    const purposeOpts = isEsa
      ? [['', 'Purpose…'], ['vsan_storage_pool', 'vSAN storage pool (ESA)'], ['local_datastore', 'Local datastore (host 1 only)'], ['data', 'Additional data disk']]
      : [['', 'Purpose…'], ['vsan_capacity', 'vSAN capacity tier'], ['vsan_cache', 'vSAN cache / perf tier'], ['local_datastore', 'Local datastore (host 1 only)'], ['data', 'Additional data disk']];
    purposeOpts.forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label; o.selected = disk.purpose === v;
      purposeSelect.appendChild(o);
    });
    purposeSelect.addEventListener('change', () => { disks[idx].purpose = purposeSelect.value || ''; if (onChange) onChange(); });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'btn-remove'; removeBtn.textContent = '×';
    removeBtn.title = 'Remove this disk';
    removeBtn.addEventListener('click', () => {
      disks.splice(idx, 1);
      renderNestedDisks(onChange);
      if (onChange) onChange();
    });

    entry.append(sizeInput, purposeSelect, removeBtn);
    listEl.appendChild(entry);
  });

  updateEsaNvmeWarning();
}

function updateEsaNvmeWarning() {
  const warn = document.getElementById('vsan-esa-nvme-warn');
  if (!warn) return;
  const g = state.answers.design;
  const h = state.answers.hardware;
  const isEsa = g.vsanEnabled && g.vsanArch !== 'osa';
  const hasNvme = (h.storageDevices || []).some((d) => d.type === 'nvme');
  warn.hidden = !(isEsa && !hasNvme);
}

function updateWorkloadNote() {
  const g = state.answers.design;
  const note = document.getElementById('workload-sizing-note');
  if (!note || !g.workloadVmsEnabled) return;
  const size = g.workloadVmSize === 'medium' ? { vcpu: 4, vram: 8 } : { vcpu: 2, vram: 4 };
  const count = g.workloadVmCount || 0;
  const totalVcpu = count * size.vcpu;
  const totalVram = count * size.vram;
  note.textContent = count
    ? `${count} VM${count === 1 ? '' : 's'} × ${size.vcpu} vCPU / ${size.vram}GB = ${totalVcpu} vCPU and ${totalVram}GB vRAM added to the sizing total.`
    : '';
}

function updateDcNotice() {
  const g = state.answers.design;
  const notice = document.getElementById('dc-ip-notice');
  if (!notice) return;
  if (g.dcEnabled && g.dcIpAddress) {
    notice.hidden = false;
    notice.textContent = `DC IP ${g.dcIpAddress} is planned for this lab. Make sure it falls inside the management CIDR below and doesn’t conflict with any DHCP range.`;
  } else {
    notice.hidden = true;
  }
}

// --- Step navigation ---

function validateStep(n) {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;

  switch (n) {
    case 0:
      return d.useCase ? null : 'Pick a use case to continue.';
    case 1: {
      if (!h.cpuCores || !h.ramGB) {
        return 'CPU cores and RAM are needed to size the nested cluster.';
      }
      const devs = h.storageDevices || [];
      if (devs.length === 0) return 'Add at least one storage device.';
      if (devs.some((d) => !d.type || !d.capacityGB)) {
        return 'Each storage device needs a type and capacity before continuing.';
      }
      if ((h.hostCount || 1) > 1) {
        const addl = h.additionalHosts || [];
        for (let i = 0; i < addl.length; i++) {
          if (!addl[i].ipAddress) return `Enter an IP address for physical host ${i + 2}.`;
        }
      }
      return null;
    }
    case 2:
      return g.esxiVersion ? null : 'Select an ESXi version to continue.';
    case 3:
      if (g.vyosEnabled && !g.vyosNetworkMode) {
        return 'Select a VyOS network mode.';
      }
      return null;
    case 4:
      if (g.dcEnabled) {
        if (!g.dcDomainName) return 'Enter a domain name for the DC.';
        if (!g.dcIpAddress) return 'Enter an IP address for the DC.';
      }
      return null;
    case 6:
      if (!g.mgmtCidr) return 'Management CIDR is needed at minimum.';
      if (g.mgmtVlanMode === 'tagged' && !g.mgmtVlan) return 'Tagged mode requires a management VLAN ID.';
      return null;
    case 7:
      if (!g.nestedHostCount || !g.vcpuPerHost || !g.vramPerHostGB) {
        return 'Nested host count, vCPU, and vRAM per host are all needed.';
      }
      if (g.vsanEnabled && !g.vsanCidr) {
        return 'vSAN is switched on, so it needs a CIDR too.';
      }
      return null;
    case 8:
      // NSX step — no required fields (nsxEnabled is optional)
      return null;
    case 9: {
      const ndisks = g.nestedDisks || [];
      if (g.vsanEnabled) {
        const isEsa = g.vsanArch !== 'osa';
        const hasStorageDisk = isEsa
          ? ndisks.some((d) => d.purpose === 'vsan_storage_pool')
          : ndisks.some((d) => d.purpose === 'vsan_capacity');
        if (!hasStorageDisk) {
          return isEsa
            ? 'vSAN ESA is enabled — add at least one vSAN storage pool disk to the nested host disk layout.'
            : 'vSAN OSA is enabled — add at least one vSAN capacity disk to the nested host disk layout.';
        }
      }
      if (ndisks.some((d) => !d.sizeGB || !d.purpose)) {
        return 'Each nested disk needs a size and purpose before continuing.';
      }
      return null;
    }
    case 10:
      // Depot step — only reached when depotStepVisible(); no required fields
      return null;
    case 11:
      if (g.workloadVmsEnabled) {
        if (!g.workloadVmCount || g.workloadVmCount < 1) return 'Enter the number of workload VMs.';
        if (!g.workloadVmSize) return 'Select a workload VM size.';
      }
      return null;
    case 12:
      if (g.remoteAccessMethod === 'vpn' && !g.vpnType) {
        return 'Select a VPN type (WireGuard or VyOS site-to-site) to continue.';
      }
      return null;
    default:
      return null;
  }
}

function showStep(n) {
  state.step = n;
  document.querySelectorAll('.step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) === n);
  });
  document.querySelectorAll('#rail-steps li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n && s !== TROUBLESHOOT_STEP);
  });

  document.getElementById('btn-back').style.visibility = n === 0 ? 'hidden' : 'visible';

  // The review step (TOTAL_STEPS-2) is the effective last step in normal mode.
  // When troubleshootingMode is on, the user can navigate one step further to TROUBLESHOOT_STEP.
  const reviewStep = TOTAL_STEPS - 2;  // step 13
  const isLastVisible = state.troubleshootingMode ? n === TROUBLESHOOT_STEP : n === reviewStep;
  document.getElementById('btn-next').style.display = isLastVisible ? 'none' : 'inline-flex';
  document.getElementById('step-error').textContent = '';

  if (n === reviewStep) renderReview();
  if (n === TROUBLESHOOT_STEP) initTroubleshootStep();
  if (n === 7) { renderSizingRecommendations(); renderResourceTips(); updateVramWarning(); }
  updateDcNotice();
  updateEsxi9Notices();
}

function getNextStep(n) {
  const next = n + 1;
  if (next === DEPOT_STEP && !depotStepVisible()) return next + 1;
  return next;
}

function getPrevStep(n) {
  const prev = n - 1;
  if (prev === DEPOT_STEP && !depotStepVisible()) return prev - 1;
  return prev;
}

function wireNav() {
  document.getElementById('btn-next').addEventListener('click', () => {
    const err = validateStep(state.step);
    if (err) {
      document.getElementById('step-error').textContent = err;
      return;
    }
    if (state.step < TOTAL_STEPS - 1) showStep(getNextStep(state.step));
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    if (state.step > 0) showStep(getPrevStep(state.step));
  });

  document.querySelectorAll('#rail-steps li').forEach((li) => {
    li.addEventListener('click', () => {
      const target = Number(li.dataset.step);
      if (target <= state.step) showStep(target);
    });
  });
}

// --- Live topology ---

function netRow(name, cidr, vlanId, color) {
  const parts = [];
  if (cidr) parts.push(cidr);
  if (vlanId !== null && vlanId !== undefined) parts.push(`VLAN ${vlanId}`);
  const value = parts.length ? parts.join(' · ') : 'not set';

  const row = document.createElement('div');
  row.className = 'topo-net-row';

  const dot = document.createElement('span');
  dot.className = 'topo-net-dot';
  dot.style.background = color;

  const label = document.createElement('span');
  label.className = 'topo-net-name';
  label.textContent = name;

  const v = document.createElement('span');
  v.className = 'topo-net-value';
  v.textContent = value;

  row.append(dot, label, v);
  return row;
}

function renderTopology() {
  const h = state.answers.hardware;
  const g = state.answers.design;

  const stats = document.getElementById('topo-host-stats');
  stats.innerHTML = '';
  const storageChipText = (() => {
    const devs = h.storageDevices || [];
    if (!devs.length || devs.every((d) => !d.capacityGB)) return '– storage';
    const totalGB = devs.reduce((s, d) => s + (d.capacityUnit === 'TB' ? (d.capacityGB || 0) * 1000 : (d.capacityGB || 0)), 0);
    if (devs.length === 1) {
      const d = devs[0];
      return `${d.capacityGB || '?'}${d.capacityUnit || 'GB'} ${DEVICE_TYPE_LABELS[d.type] || ''}`.trim();
    }
    return `${devs.length} disks${totalGB ? ' · ' + (totalGB >= 1000 ? (totalGB / 1000).toFixed(1) + 'TB' : totalGB + 'GB') : ''}`;
  })();
  [
    h.cpuCores ? `${h.cpuCores} cores` : '– cores',
    h.ramGB ? `${h.ramGB}GB RAM` : '– RAM',
    storageChipText
  ].forEach((text) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = text;
    stats.appendChild(chip);
  });

  // Appliance VMs (VyOS, DC)
  const appliancesEl = document.getElementById('topo-appliances');
  appliancesEl.innerHTML = '';
  if (g.vyosEnabled) {
    const a = document.createElement('div');
    a.className = 'topo-appliance';
    a.textContent = `vyos${g.vyosNetworkMode === 'bgp' ? ' (BGP)' : ''}`;
    appliancesEl.appendChild(a);
  }
  if (g.dcEnabled) {
    const a = document.createElement('div');
    a.className = 'topo-appliance';
    a.textContent = `dc${g.dcDomainName ? ' · ' + g.dcDomainName : ''}`;
    appliancesEl.appendChild(a);
  }
  if (g.depotEnabled && depotStepVisible()) {
    const a = document.createElement('div');
    a.className = 'topo-appliance';
    a.textContent = `depot${g.depotIpAddress ? ' · ' + g.depotIpAddress : ''} (${g.depotMode === 'iis' ? 'IIS' : 'nginx'})`;
    appliancesEl.appendChild(a);
  }

  // Nested hosts
  const nested = document.getElementById('topo-nested');
  nested.innerHTML = '';
  const count = g.nestedHostCount || 0;
  if (count === 0) {
    const empty = document.createElement('div');
    empty.className = 'topo-empty';
    empty.textContent = 'No nested hosts yet';
    nested.appendChild(empty);
  } else {
    const shown = Math.min(count, 9);
    for (let i = 1; i <= shown; i++) {
      const vm = document.createElement('div');
      vm.className = 'topo-vm';
      const name = document.createElement('span');
      name.className = 'topo-vm-name';
      name.textContent = `esxi-${String(i).padStart(2, '0')}`;
      const spec = document.createElement('span');
      spec.className = 'topo-vm-spec';
      spec.textContent = `${val(g.vcpuPerHost)}vCPU/${val(g.vramPerHostGB)}GB`;
      vm.append(name, spec);
      nested.appendChild(vm);
    }
    if (count > shown) {
      const more = document.createElement('div');
      more.className = 'topo-more';
      more.textContent = `+${count - shown} more`;
      nested.appendChild(more);
    }
  }

  const nets = document.getElementById('topo-networks');
  nets.innerHTML = '';
  nets.appendChild(netRow('Mgmt', g.mgmtCidr, g.mgmtVlan, NET_COLORS.management));
  nets.appendChild(netRow('vMotion', g.vmotionCidr, g.vmotionVlan, NET_COLORS.vMotion));
  if (g.vsanEnabled) nets.appendChild(netRow('vSAN', g.vsanCidr, g.vsanVlan, NET_COLORS.vsan));
  nets.appendChild(netRow('VM traffic', g.vmCidr, g.vmVlan, NET_COLORS.vmTraffic));
}

// --- Review ---

function reviewCard(title, rows) {
  const card = document.createElement('div');
  card.className = 'review-card';

  const header = document.createElement('div');
  header.className = 'review-card-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'review-card-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'review-card-body';

  rows.forEach(([label, value, opts]) => {
    const full = opts?.full;
    const dim = value === '—' || value === 'Disabled' || value === 'No' || value === 'Local only';
    const kv = document.createElement('div');
    kv.className = full ? 'review-kv review-kv-full' : 'review-kv';

    const labelEl = document.createElement('div');
    labelEl.className = 'review-kv-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'review-kv-value' + (dim ? ' value-dim' : '');
    valueEl.textContent = value;

    kv.append(labelEl, valueEl);
    body.appendChild(kv);
  });

  card.appendChild(body);
  return card;
}

function renderReview() {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;

  const container = document.getElementById('review-summary');
  container.innerHTML = '';

  // --- Use case + Hardware ---
  const hwRows = [
    ['Use case', USE_CASE_LABELS[d.useCase] || val(d.useCase)],
    ['Physical hosts', val(h.hostCount)],
    ['Host 1 IP', val(h.ipAddress)],
    ['CPU cores / host', val(h.cpuCores)],
    ['RAM / host', val(h.ramGB, 'GB')],
    ...((h.storageDevices || []).map((dev, i) => [
      `Disk ${i + 1}`,
      `${dev.capacityGB || '?'}${dev.capacityUnit || 'GB'} ${DEVICE_TYPE_LABELS[dev.type] || '?'}`
    ])),
    ['NICs / host', h.nicCount ? `${h.nicCount} × ${h.nicSpeed || '?'}` : '—'],
    ...((h.additionalHosts || []).map((ah, i) => [
      `Host ${i + 2} IP`,
      val(ah.ipAddress) + (ah.sameAsFirst !== false ? ' (same specs as host 1)' : ` — ${ah.cpuCores || '?'} cores / ${ah.ramGB || '?'}GB`)
    ]))
  ];
  container.appendChild(reviewCard('Hardware', hwRows));

  // --- ESXi version + deploy method ---
  const deployLabel = g.esxiDeployMethod === 'ova' ? 'William Lam OVA (automated)' : 'ISO (interactive install)';
  container.appendChild(reviewCard('ESXi', [
    ['Version', ESXI_VERSION_LABELS[g.esxiVersion] || val(g.esxiVersion)],
    ['Deploy method', deployLabel]
  ]));

  // --- Infrastructure: VyOS, DC ---
  const infraComponents = [];
  infraComponents.push(['VyOS router', g.vyosEnabled ? (g.vyosNetworkMode === 'bgp' ? 'Enabled (BGP)' : 'Enabled') : 'No']);
  if (g.vyosEnabled && g.vyosNetworkMode) {
    infraComponents.push(['VyOS mode', g.vyosNetworkMode === 'bgp' ? 'Basic + BGP' : 'Basic (NAT, DHCP, DNS)']);
  }
  infraComponents.push(['Domain controller', g.dcEnabled ? 'Yes' : 'No']);
  if (g.dcEnabled) {
    infraComponents.push(['DC domain', val(g.dcDomainName)]);
    infraComponents.push(['DC IP', val(g.dcIpAddress)]);
  }
  const localDsEnabled = (g.nestedDisks || []).some((dd) => dd.purpose === 'local_datastore');
  infraComponents.push(['Local datastore (host 1)', localDsEnabled ? 'Yes' : 'No']);
  if (depotStepVisible() && g.depotEnabled) {
    infraComponents.push(['Bundle depot', g.depotMode === 'iis' ? 'IIS on DC' : 'Linux/nginx VM']);
    infraComponents.push(['Depot IP', val(g.depotIpAddress)]);
  }
  container.appendChild(reviewCard('Infrastructure', infraComponents));

  // --- Network ---
  const netRows = [
    ['Existing network', NETTYPE_LABELS[d.networkType] || val(d.networkType)],
    ['VLAN capable', d.vlanCapable === null ? '—' : (d.vlanCapable ? 'Yes' : 'No')],
    ['Management', `${val(g.mgmtCidr)} ${g.mgmtVlanMode === 'tagged' ? `VLAN ${g.mgmtVlan || '?'}` : '(untagged)'}`.trim()],
    ['vMotion', `${val(g.vmotionCidr)}${g.vmotionVlan != null ? ` VLAN ${g.vmotionVlan}` : ''}`.trim()]
  ];
  if (g.vsanEnabled) {
    netRows.push(['vSAN net', `${val(g.vsanCidr)}${g.vsanVlan != null ? ` VLAN ${g.vsanVlan}` : ''}`.trim()]);
  }
  netRows.push(['VM traffic', `${val(g.vmCidr)}${g.vmVlan != null ? ` VLAN ${g.vmVlan}` : ''}`.trim()]);
  container.appendChild(reviewCard('Networking', netRows));

  // --- Cluster ---
  container.appendChild(reviewCard('Nested cluster', [
    ['Hosts', val(g.nestedHostCount)],
    ['vCPU / host', val(g.vcpuPerHost)],
    ['vRAM / host', val(g.vramPerHostGB, 'GB')],
    ['Boot disk', val(g.nestedDiskGB, 'GB')],
    ['Cluster name', val(g.clusterName)],
    ['SSO domain', val(g.ssoDomain)],
    ['vSAN', g.vsanEnabled ? `Enabled — ${g.vsanArch === 'osa' ? 'OSA' : 'ESA'}` : 'Disabled'],
    ['Legacy CPU compat', g.legacyCpuCompat ? 'Enabled' : 'Disabled'],
    ['Memory tiering', g.memTieringEnabled ? (() => {
      const devs = state.answers.hardware.storageDevices || [];
      const disk = g.nvmeTieringDiskIndex != null ? devs[g.nvmeTieringDiskIndex] : null;
      if (disk && disk.capacityGB) {
        const raw = Number(disk.capacityGB) || 0;
        const sizeGB = disk.capacityUnit === 'TB' ? raw * 1000 : raw;
        const lbl = sizeGB >= 1000 ? (sizeGB / 1000).toFixed(1).replace(/\.0$/, '') + ' TB' : sizeGB + ' GB';
        return `Disk #${g.nvmeTieringDiskIndex + 1} (NVMe ${lbl}) · ${g.tierNvmePct}%`;
      }
      return `${g.nvmeSizeGB || 100}GB NVMe · ${g.tierNvmePct}%`;
    })() : 'Disabled']
  ]));

  // --- Nested disks ---
  const ndisks = g.nestedDisks || [];
  if (ndisks.length > 0) {
    container.appendChild(reviewCard('Nested host disks',
      ndisks.map((dd, i) => [
        `Disk ${i + 1}`,
        `${dd.sizeGB || '?'}GB — ${NESTED_DISK_PURPOSE_LABELS[dd.purpose] || dd.purpose || '?'}`
      ])
    ));
  }

  // --- Workload VMs ---
  if (g.workloadVmsEnabled) {
    const wlSpec = g.workloadVmSize === 'medium' ? '4 vCPU / 8GB' : '2 vCPU / 4GB';
    container.appendChild(reviewCard('Workload VMs', [
      ['Count', val(g.workloadVmCount)],
      ['Size', `${g.workloadVmSize || '—'} (${wlSpec})`]
    ]));
  }

  // --- NSX ---
  if (g.nsxEnabled) {
    const bgpLabel = (g.vyosEnabled && g.vyosNetworkMode === 'bgp')
      ? `AS ${g.nsxBgpLocalAs} ↔ VyOS AS ${g.nsxBgpPeerAs}`
      : 'Disabled';
    container.appendChild(reviewCard('NSX-T', [
      ['Size', g.nsxSize === 'medium' ? 'Medium (6 vCPU / 24GB)' : 'Small (3 vCPU / 12GB)'],
      ['Topology', NSX_TOPOLOGY_LABELS[g.nsxTopology] || val(g.nsxTopology)],
      ['Manager IP', val(g.nsxIpAddress)],
      ['BGP peering', bgpLabel]
    ]));
  }

  // --- Security & access ---
  const accessRows = [
    ['Isolated segment', g.isolateLab ? 'Yes' : 'No'],
    ['Firewall policy', FIREWALL_LABELS[g.firewallPolicy] || val(g.firewallPolicy)],
    ['Internet access', g.internetAccess ? 'Yes' : 'No'],
    ['Remote access', REMOTE_LABELS[g.remoteAccessMethod] || val(g.remoteAccessMethod)]
  ];
  if (g.remoteAccessMethod === 'vpn') {
    accessRows.push(['VPN type', VPN_TYPE_LABELS[g.vpnType] || val(g.vpnType)]);
  }
  accessRows.push(['vCenter size', val(g.vcenterSize)]);
  container.appendChild(reviewCard('Security & access', accessRows));

  // --- Inline warnings ---
  if (g.vsanEnabled) {
    const isEsa = g.vsanArch !== 'osa';
    const hasStorageDisk = isEsa
      ? ndisks.some((dd) => dd.purpose === 'vsan_storage_pool')
      : ndisks.some((dd) => dd.purpose === 'vsan_capacity');
    if (!hasStorageDisk) {
      const warn = document.createElement('div');
      warn.className = 'review-warn';
      warn.textContent = isEsa
        ? '⚠ vSAN ESA is enabled but no storage pool disk is defined. Go back to Nested disks and add a vSAN storage pool (ESA) disk.'
        : '⚠ vSAN OSA is enabled but no capacity disk is defined. Go back to Nested disks and add a vSAN capacity tier disk.';
      container.appendChild(warn);
    }
  }

  if (g.depotEnabled && g.depotMode === 'iis' && !g.dcEnabled) {
    const warn = document.createElement('div');
    warn.className = 'review-warn';
    warn.textContent = '⚠ Bundle depot is set to IIS mode but no domain controller is included. Enable the DC (step 4) or switch to Linux/nginx mode.';
    container.appendChild(warn);
  }

  document.getElementById('results').hidden = true;

  renderReviewDiagram();
}

// ── Live diagram preview on review screen ─────────────────────────────────

let reviewMermaidInit = false;
let reviewDiagramPending = false;

function renderReviewDiagram() {
  const section = document.getElementById('review-diagram-section');
  const inner   = document.getElementById('review-diagram-inner');
  const empty   = document.getElementById('review-diagram-empty');

  section.hidden = false;
  inner.innerHTML = '';
  empty.textContent = 'Rendering…';
  empty.style.display = 'flex';

  if (!reviewMermaidInit) {
    if (typeof mermaid === 'undefined') return;
    mermaid.initialize({ startOnLoad: false, theme: 'dark', darkMode: true, securityLevel: 'strict' });
    reviewMermaidInit = true;
  }

  // Build spec from current state and request mermaid source from server
  fetch('/api/diagram/from-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: buildReviewSpec() })
  })
    .then((r) => r.json())
    .then(async (data) => {
      if (!data.mermaid) throw new Error('No mermaid source returned');
      const id = 'review-diag-' + Date.now();
      const { svg } = await mermaid.render(id, data.mermaid);
      inner.innerHTML = svg;
      const svgEl = inner.querySelector('svg');
      if (svgEl) { svgEl.style.maxWidth = '100%'; svgEl.style.height = 'auto'; }
      empty.style.display = 'none';
    })
    .catch((err) => {
      empty.textContent = 'Diagram preview unavailable';
    });
}

function buildReviewSpec() {
  // Minimal spec build from current answers — mirrors what the server does in generateSpec.js
  // We only need enough for buildMermaidDiagram; full spec is built server-side on generate.
  const h = state.answers.hardware || {};
  const g = state.answers.design || {};

  const host1 = {
    ipAddress: h.ipAddress || null,
    cpuCores: Number(h.cpuCores) || null,
    ramGB: Number(h.ramGB) || null
  };
  const physicalHosts = [
    host1,
    ...(h.additionalHosts || []).map((ah) => ({
      ipAddress: ah.ipAddress || null,
      cpuCores: ah.sameAsFirst !== false ? host1.cpuCores : (Number(ah.cpuCores) || null),
      ramGB: ah.sameAsFirst !== false ? host1.ramGB : (Number(ah.ramGB) || null)
    }))
  ];
  const physCount = physicalHosts.length;
  const nestedCount = Number(g.nestedHostCount) || 0;
  let placement;
  if (g.nestedHostPlacement === 'manual' && Array.isArray(g.nestedHostAssignments)
      && g.nestedHostAssignments.length === nestedCount) {
    placement = g.nestedHostAssignments.map((v) => Math.min(Number(v) || 0, physCount - 1));
  } else {
    placement = Array.from({ length: nestedCount }, (_, i) => i % physCount);
  }

  return {
    physicalHost: host1,
    physicalHosts,
    esxiVersion: { label: ESXI_VERSION_LABELS[g.esxiVersion] || 'ESXi' },
    vyos: { enabled: !!g.vyosEnabled, networkMode: g.vyosNetworkMode || 'basic' },
    domainController: { enabled: !!g.dcEnabled, domainName: g.dcDomainName || null, ipAddress: g.dcIpAddress || null },
    networks: {
      management: { cidr: g.mgmtCidr || null, vlanId: g.mgmtVlan != null ? Number(g.mgmtVlan) : null, mode: g.mgmtVlanMode || 'untagged' },
      vMotion: { cidr: g.vmotionCidr || null, vlanId: g.vmotionVlan != null ? Number(g.vmotionVlan) : null },
      vsan: g.vsanEnabled ? { cidr: g.vsanCidr || null, vlanId: g.vsanVlan != null ? Number(g.vsanVlan) : null } : null,
      vmTraffic: { cidr: g.vmCidr || null, vlanId: g.vmVlan != null ? Number(g.vmVlan) : null }
    },
    nestedCluster: {
      hostCount: nestedCount,
      vcpuPerHost: Number(g.vcpuPerHost) || 0,
      vramPerHostGB: Number(g.vramPerHostGB) || 0,
      vsanEnabled: !!g.vsanEnabled,
      clusterName: g.clusterName || 'mgmt-cluster',
      hosts: placement.map((pi, i) => ({ index: i + 1, physicalHostIndex: pi }))
    },
    workloadVms: { enabled: !!g.workloadVmsEnabled, count: Number(g.workloadVmCount) || 0, vcpu: 2, vramGB: 4 },
    remoteAccess: { method: g.remoteAccessMethod || null },
    nsx: { enabled: !!g.nsxEnabled, bgpEnabled: !!(g.nsxEnabled && g.vyosEnabled && g.vyosNetworkMode === 'bgp') }
  };
}

// --- Spec loading (extend mode) ---

function loadSpecIntoState(spec) {
  const d = state.answers.discovery;
  const h = state.answers.hardware;
  const g = state.answers.design;

  if (spec.useCase) d.useCase = spec.useCase;
  if (spec.existingNetwork) {
    if (spec.existingNetwork.type) d.networkType = spec.existingNetwork.type;
    if (spec.existingNetwork.vlanCapableRouter != null) d.vlanCapable = spec.existingNetwork.vlanCapableRouter;
    if (spec.existingNetwork.dhcpAvailable != null) d.dhcpAvailable = spec.existingNetwork.dhcpAvailable;
  }
  if (spec.physicalHosts && spec.physicalHosts.length) {
    // New multi-host format
    h.hostCount = spec.physicalHosts.length;
    const ph0 = spec.physicalHosts[0];
    if (ph0.ipAddress) h.ipAddress = ph0.ipAddress;
    if (ph0.cpuCores) h.cpuCores = ph0.cpuCores;
    if (ph0.ramGB) h.ramGB = ph0.ramGB;
    if (ph0.nicCount) h.nicCount = ph0.nicCount;
    if (ph0.nicSpeed) h.nicSpeed = ph0.nicSpeed;
    if (ph0.storageDevices && ph0.storageDevices.length) {
      h.storageDevices = ph0.storageDevices.map((d) => ({
        type: d.type || '', capacityGB: d.capacityGB || null, capacityUnit: 'GB'
      }));
    }
    h.additionalHosts = spec.physicalHosts.slice(1).map((ph) => ({
      ipAddress: ph.ipAddress || null,
      sameAsFirst: false,
      cpuCores: ph.cpuCores || null,
      ramGB: ph.ramGB || null,
      storageDevices: (ph.storageDevices || []).map((d) => ({
        type: d.type || '', capacityGB: d.capacityGB || null, capacityUnit: 'GB'
      })),
      nicCount: ph.nicCount || null,
      nicSpeed: ph.nicSpeed || null
    }));
  } else if (spec.physicalHost) {
    // Legacy single-host format
    const ph = spec.physicalHost;
    if (ph.hostCount) h.hostCount = ph.hostCount;
    if (ph.cpuCores) h.cpuCores = ph.cpuCores;
    if (ph.ramGB) h.ramGB = ph.ramGB;
    if (ph.nicCount) h.nicCount = ph.nicCount;
    if (ph.nicSpeed) h.nicSpeed = ph.nicSpeed;
    if (ph.storageDevices && ph.storageDevices.length) {
      h.storageDevices = ph.storageDevices.map((d) => ({
        type: d.type || '', capacityGB: d.capacityGB || null, capacityUnit: 'GB'
      }));
    }
  }
  if (spec.esxiVersion?.version) g.esxiVersion = spec.esxiVersion.version;
  if (spec.esxiDeployMethod) g.esxiDeployMethod = spec.esxiDeployMethod;
  if (spec.vyos) {
    g.vyosEnabled = !!spec.vyos.enabled;
    if (spec.vyos.networkMode) g.vyosNetworkMode = spec.vyos.networkMode;
  }
  if (spec.domainController) {
    g.dcEnabled = !!spec.domainController.enabled;
    if (spec.domainController.domainName) g.dcDomainName = spec.domainController.domainName;
    if (spec.domainController.ipAddress) g.dcIpAddress = spec.domainController.ipAddress;
  }
  if (spec.networks) {
    const nets = spec.networks;
    if (nets.management) {
      if (nets.management.cidr) g.mgmtCidr = nets.management.cidr;
      if (nets.management.vlanId != null) g.mgmtVlan = nets.management.vlanId;
      if (nets.management.mode) g.mgmtVlanMode = nets.management.mode;
    }
    if (nets.vMotion) {
      if (nets.vMotion.cidr) g.vmotionCidr = nets.vMotion.cidr;
      if (nets.vMotion.vlanId != null) g.vmotionVlan = nets.vMotion.vlanId;
    }
    if (nets.vsan) {
      g.vsanEnabled = true;
      if (nets.vsan.cidr) g.vsanCidr = nets.vsan.cidr;
      if (nets.vsan.vlanId != null) g.vsanVlan = nets.vsan.vlanId;
    }
    if (nets.vmTraffic) {
      if (nets.vmTraffic.cidr) g.vmCidr = nets.vmTraffic.cidr;
      if (nets.vmTraffic.vlanId != null) g.vmVlan = nets.vmTraffic.vlanId;
    }
  }
  if (spec.nestedCluster) {
    const nc = spec.nestedCluster;
    if (nc.hostCount) g.nestedHostCount = nc.hostCount;
    if (nc.vcpuPerHost) g.vcpuPerHost = nc.vcpuPerHost;
    if (nc.vramPerHostGB) g.vramPerHostGB = nc.vramPerHostGB;
    if (nc.bootDiskGB) g.nestedDiskGB = nc.bootDiskGB;
    if (nc.clusterName) g.clusterName = nc.clusterName;
    if (nc.datacenterName) g.datacenterName = nc.datacenterName;
    if (nc.ssoDomain) g.ssoDomain = nc.ssoDomain;
    if (nc.vsanArchitecture) g.vsanArch = nc.vsanArchitecture;
    g.legacyCpuCompat = !!nc.legacyCpuCompatibility;
    if (nc.memoryTiering) {
      g.memTieringEnabled = !!nc.memoryTiering.enabled;
      if (nc.memoryTiering.nvmeSizeGB) g.nvmeSizeGB = nc.memoryTiering.nvmeSizeGB;
      if (nc.memoryTiering.tierNvmePct) g.tierNvmePct = nc.memoryTiering.tierNvmePct;
      if (nc.memoryTiering.physicalDiskIndex != null) g.nvmeTieringDiskIndex = nc.memoryTiering.physicalDiskIndex;
    }
    if (nc.additionalDisks && nc.additionalDisks.length) {
      g.nestedDisks = nc.additionalDisks.map((d) => ({ sizeGB: d.sizeGB, purpose: d.purpose }));
    }
    g.vsanEnabled = !!nc.vsanEnabled;
  }
  if (spec.nsx) {
    g.nsxEnabled = !!spec.nsx.enabled;
    if (spec.nsx.size) g.nsxSize = spec.nsx.size;
    if (spec.nsx.topology) g.nsxTopology = spec.nsx.topology;
    if (spec.nsx.ipAddress) g.nsxIpAddress = spec.nsx.ipAddress;
    if (spec.nsx.bgpLocalAs) g.nsxBgpLocalAs = spec.nsx.bgpLocalAs;
    if (spec.nsx.bgpPeerAs) g.nsxBgpPeerAs = spec.nsx.bgpPeerAs;
  }
  if (spec.workloadVms) {
    g.workloadVmsEnabled = !!spec.workloadVms.enabled;
    if (spec.workloadVms.count) g.workloadVmCount = spec.workloadVms.count;
    if (spec.workloadVms.size) g.workloadVmSize = spec.workloadVms.size;
  }
  if (spec.security) {
    g.isolateLab = !!spec.security.isolateLabSegment;
    if (spec.security.firewallPolicy) g.firewallPolicy = spec.security.firewallPolicy;
    g.internetAccess = !!spec.security.internetAccess;
  }
  if (spec.remoteAccess) {
    if (spec.remoteAccess.method) g.remoteAccessMethod = spec.remoteAccess.method;
    if (spec.remoteAccess.vpnType) g.vpnType = spec.remoteAccess.vpnType;
    if (spec.remoteAccess.vcenterDeploymentSize) g.vcenterSize = spec.remoteAccess.vcenterDeploymentSize;
  }
  if (spec.bundleDepot) {
    g.depotEnabled = !!spec.bundleDepot.enabled;
    if (spec.bundleDepot.mode) g.depotMode = spec.bundleDepot.mode;
    if (spec.bundleDepot.ipAddress) g.depotIpAddress = spec.bundleDepot.ipAddress;
  }
  renderStorageDevices(() => {});
  renderNestedDisks(() => {});
}

// --- Troubleshooting mode ---

function toggleTroubleshootingMode() {
  state.troubleshootingMode = !state.troubleshootingMode;
  const badge = document.getElementById('ts-badge');
  if (badge) badge.hidden = !state.troubleshootingMode;

  // Show/hide the troubleshoot rail item
  const tsRailItem = document.querySelector('#rail-steps li[data-step="' + TROUBLESHOOT_STEP + '"]');
  if (tsRailItem) tsRailItem.hidden = !state.troubleshootingMode;

  // If deactivating while on troubleshoot step, go back to review
  if (!state.troubleshootingMode && state.step === TROUBLESHOOT_STEP) {
    showStep(TOTAL_STEPS - 2);
  }
  // Update btn-next visibility if currently on review step
  if (state.step === TOTAL_STEPS - 2) {
    const isLastVisible = !state.troubleshootingMode;
    document.getElementById('btn-next').style.display = isLastVisible ? 'none' : 'inline-flex';
  }
}

// ── Topic / exam definitions ────────────────────────────────────────────────

const TS_TOPICS = [
  { id: 'vsphere-networking', label: 'vSphere Networking' },
  { id: 'vsan',               label: 'vSAN' },
  { id: 'nsx-routing',        label: 'NSX Routing (T0/T1)' },
  { id: 'nsx-dfw',            label: 'NSX DFW' },
  { id: 'bgp',                label: 'BGP Peering' },
  { id: 'vcf-bringup',        label: 'VCF Bring-up' },
  { id: 'dns-ntp',            label: 'DNS / NTP' },
  { id: 'certificate-management', label: 'Certificate Management' },
  { id: 'storage',            label: 'Storage' },
  { id: 'security',           label: 'Security' }
];

const TS_EXAMS = [
  { id: 'VCP-DCV',          label: 'VCP-DCV' },
  { id: 'VCAP-DCV',         label: 'VCAP-DCV' },
  { id: 'VCP-NV',           label: 'VCP-NV' },
  { id: 'VCAP-NV',          label: 'VCAP-NV' },
  { id: 'VCF 3V0-25.25',   label: 'VCF 3V0-25.25' }
];

// ── Troubleshoot entry point ────────────────────────────────────────────────

function initTroubleshootStep() {
  state.troubleshootPhase = 1;
  state.troubleshootSpec = null;
  state.troubleshootTopics = [];
  state.troubleshootExamObjectives = [];
  state.troubleshootDifficulty = 'medium';
  state.troubleshootFileTopics = [];
  state.troubleshootToken = null;
  state.troubleshootScenario = null;
  state.troubleshootClueText = null;
  state.troubleshootClueUsed = false;
  state.troubleshootNotes = '';
  state.troubleshootTicket = null;
  state.troubleshootTicketSubmitted = false;
  state.troubleshootHintLevel = 0;
  state.troubleshootHints = {};
  state.troubleshootResolved = false;
  state.troubleshootSessionData = null;

  tsShowPhase(1);
  tsWirePhase1();
}


// ── Phase helpers ───────────────────────────────────────────────────────────

function tsShowPhase(n) {
  state.troubleshootPhase = n;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`ts-phase-${i}`);
    if (el) el.hidden = i !== n;
  }
}

// ── Phase 1: Lab confirmation ───────────────────────────────────────────────

function tsWirePhase1() {
  const check1   = document.getElementById('ts-check-1');
  const check2   = document.getElementById('ts-check-2');
  const startBtn = document.getElementById('ts-start-btn');
  const specFile = document.getElementById('ts-spec-file-input');
  const specStatus = document.getElementById('ts-spec-status');
  const specName = document.getElementById('ts-spec-loaded-name');

  if (check1) check1.checked = false;
  if (check2) check2.checked = false;
  if (specName) specName.textContent = '';
  if (startBtn) startBtn.disabled = true;

  const updateStart = () => {
    if (startBtn) startBtn.disabled = !(check1?.checked && check2?.checked);
  };
  if (check1) check1.addEventListener('change', updateStart);
  if (check2) check2.addEventListener('change', updateStart);

  if (specFile) {
    specFile.value = '';
    specFile.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        if (specStatus) specStatus.textContent = 'File too large (max 1 MB).';
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const spec = JSON.parse(ev.target.result);
          if (!isValidSpecStructure(spec)) {
            if (specStatus) specStatus.textContent = 'Not a valid lab-spec.json.';
            return;
          }
          state.troubleshootSpec = spec;
          if (specStatus) specStatus.textContent = '';
          if (specName) specName.textContent = file.name;
        } catch {
          if (specStatus) specStatus.textContent = 'Invalid JSON.';
        }
      };
      reader.readAsText(file);
    };
  }

  if (startBtn) {
    startBtn.onclick = () => { tsShowPhase(2); tsWirePhase2(); };
  }
}

// ── Phase 2: Learning goals ─────────────────────────────────────────────────

function tsWirePhase2() {
  const topicGrid = document.getElementById('ts-topic-grid');
  const examGrid  = document.getElementById('ts-exam-grid');

  if (topicGrid) {
    topicGrid.innerHTML = '';
    TS_TOPICS.forEach(t => {
      const label = document.createElement('label');
      label.className = 'ts-topic-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = t.id;
      cb.checked = state.troubleshootTopics.includes(t.id);
      cb.addEventListener('change', () => {
        if (cb.checked) { if (!state.troubleshootTopics.includes(t.id)) state.troubleshootTopics.push(t.id); }
        else state.troubleshootTopics = state.troubleshootTopics.filter(x => x !== t.id);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + t.label));
      topicGrid.appendChild(label);
    });
  }

  if (examGrid) {
    examGrid.innerHTML = '';
    TS_EXAMS.forEach(e => {
      const label = document.createElement('label');
      label.className = 'ts-topic-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = e.id;
      cb.checked = state.troubleshootExamObjectives.includes(e.id);
      cb.addEventListener('change', () => {
        if (cb.checked) { if (!state.troubleshootExamObjectives.includes(e.id)) state.troubleshootExamObjectives.push(e.id); }
        else state.troubleshootExamObjectives = state.troubleshootExamObjectives.filter(x => x !== e.id);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + e.label));
      examGrid.appendChild(label);
    });
  }

  document.querySelectorAll('input[name="ts-difficulty"]').forEach(r => {
    r.checked = r.value === state.troubleshootDifficulty;
    r.addEventListener('change', () => { if (r.checked) state.troubleshootDifficulty = r.value; });
  });

  const goalsFile = document.getElementById('ts-goals-file');
  const preview   = document.getElementById('ts-file-topics-preview');
  if (goalsFile) {
    goalsFile.value = '';
    goalsFile.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.troubleshootFileTopics = tsExtractTopicsFromText(ev.target.result);
        if (preview) {
          preview.hidden = false;
          preview.innerHTML = state.troubleshootFileTopics.length > 0
            ? '<strong>Topics extracted:</strong> ' + state.troubleshootFileTopics.map(t => `<span class="ts-topic-chip-inline">${t}</span>`).join(' ')
            : 'No specific topics detected — will use list selections.';
        }
      };
      reader.readAsText(file);
    };
  }

  const backBtn = document.getElementById('ts-goals-back');
  const nextBtn = document.getElementById('ts-goals-next');
  if (backBtn) backBtn.onclick = () => tsShowPhase(1);
  if (nextBtn) nextBtn.onclick = () => tsGenerateScenario();
}

function tsExtractTopicsFromText(text) {
  const lower = text.toLowerCase();
  const found = [];
  const checks = [
    { terms: ['vsphere', 'vswitch', 'port group', 'dvs', 'distributed switch', 'vmnic', 'vmk'], id: 'vsphere-networking' },
    { terms: ['vsan', 'storage policy'], id: 'vsan' },
    { terms: ['nsx routing', 't0', 't1', 'tier-0', 'tier-1', 'overlay', 'geneve'], id: 'nsx-routing' },
    { terms: ['dfw', 'distributed firewall', 'microsegmentation', 'security group'], id: 'nsx-dfw' },
    { terms: ['bgp', 'as number', 'autonomous system', 'peering'], id: 'bgp' },
    { terms: ['vcf', 'vmware cloud foundation', 'sddc manager', 'bring-up', 'bringup'], id: 'vcf-bringup' },
    { terms: ['dns', 'ntp', 'name resolution', 'time sync', 'ptr record'], id: 'dns-ntp' },
    { terms: ['certificate', 'ssl', 'tls', 'cert', 'pki'], id: 'certificate-management' },
    { terms: ['storage', 'datastore', 'vmfs', 'nfs', 'vvols'], id: 'storage' },
    { terms: ['security', 'hardening', 'firewall', 'lockdown mode', 'rbac'], id: 'security' }
  ];
  checks.forEach(({ terms, id }) => {
    if (terms.some(t => lower.includes(t)) && !found.includes(id)) found.push(id);
  });
  return found;
}

async function tsGenerateScenario() {
  const nextBtn = document.getElementById('ts-goals-next');
  const errEl   = document.getElementById('ts-goals-error');
  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = 'Generating…'; }
  if (errEl) errEl.textContent = '';

  const allTopics = [...new Set([...state.troubleshootTopics, ...(state.troubleshootFileTopics || [])])];

  try {
    const res = await fetch('/api/troubleshoot/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: state.troubleshootSpec || null,
        topics: allTopics,
        examObjectives: state.troubleshootExamObjectives,
        difficulty: state.troubleshootDifficulty
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scenario generation failed');
    state.troubleshootToken    = data.token;
    state.troubleshootScenario = data.scenario;
    tsShowPhase(3);
    tsWirePhase3();
  } catch (err) {
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Generate scenario'; }
    if (errEl) errEl.textContent = 'Could not generate scenario: ' + err.message;
  }
}

// ── Phase 3: Investigation ──────────────────────────────────────────────────

function tsWirePhase3() {
  const scenario = state.troubleshootScenario;
  if (!scenario) return;

  const headerEl  = document.getElementById('ts-scenario-header');
  const messageEl = document.getElementById('ts-scenario-message');
  if (headerEl) headerEl.innerHTML = `<span class="ts-caller-icon">&#128222;</span><strong class="ts-caller-name">${escHtml(scenario.callerName)}</strong><span class="ts-caller-company">&nbsp;from ${escHtml(scenario.company)}</span>`;
  if (messageEl) messageEl.textContent = scenario.message;

  const notesEl = document.getElementById('ts-notes');
  if (notesEl) {
    notesEl.value = state.troubleshootNotes;
    notesEl.oninput = () => { state.troubleshootNotes = notesEl.value; };
  }

  const askBtn = document.getElementById('ts-ask-customer');
  if (askBtn) {
    askBtn.disabled = state.troubleshootClueUsed;
    askBtn.onclick = () => tsAskCustomer();
  }

  const logTicketBtn = document.getElementById('ts-log-ticket-btn');
  const ticketPanel  = document.getElementById('ts-ticket-panel');
  if (logTicketBtn) {
    logTicketBtn.hidden = state.troubleshootTicketSubmitted;
    logTicketBtn.onclick = () => {
      if (ticketPanel) ticketPanel.hidden = false;
      logTicketBtn.hidden = true;
    };
  }

  const cancelBtn = document.getElementById('ts-ticket-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (ticketPanel) ticketPanel.hidden = true;
      if (logTicketBtn) logTicketBtn.hidden = false;
    };
  }

  const submitBtn = document.getElementById('ts-ticket-submit');
  if (submitBtn) submitBtn.onclick = () => tsSubmitTicket();

  const hintBtn = document.getElementById('ts-request-hint');
  if (hintBtn) {
    hintBtn.disabled = !state.troubleshootTicketSubmitted;
    hintBtn.title = state.troubleshootTicketSubmitted ? 'Request the next hint' : 'Submit a ticket first to unlock hints';
    hintBtn.onclick = () => tsRequestHint();
  }

  const resolvedBtn = document.getElementById('ts-mark-resolved');
  if (resolvedBtn) resolvedBtn.onclick = () => tsMarkResolved();

  if (state.troubleshootClueText) {
    const clueEl = document.getElementById('ts-scenario-clue');
    if (clueEl) { clueEl.hidden = false; clueEl.textContent = state.troubleshootClueText; }
  }
  if (state.troubleshootTicketSubmitted) tsShowTicketConfirm();
  if (state.troubleshootHintLevel > 0) {
    const panel = document.getElementById('ts-hints-panel');
    if (panel) panel.hidden = false;
    tsRenderHints();
  }
}

async function tsAskCustomer() {
  const askBtn = document.getElementById('ts-ask-customer');
  if (askBtn) { askBtn.disabled = true; askBtn.textContent = 'Asking…'; }
  try {
    const res = await fetch('/api/troubleshoot/customer-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.troubleshootToken })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.troubleshootClueText = data.clue;
    state.troubleshootClueUsed = true;
    const clueEl = document.getElementById('ts-scenario-clue');
    if (clueEl) { clueEl.hidden = false; clueEl.textContent = data.clue; }
    if (askBtn) askBtn.textContent = 'Ask customer for more info';
  } catch {
    if (askBtn) { askBtn.disabled = false; askBtn.textContent = 'Ask customer for more info'; }
  }
}

function tsSubmitTicket() {
  const symptom = document.getElementById('ts-symptom')?.value.trim();
  const tried   = document.getElementById('ts-tried')?.value.trim();
  const cause   = document.getElementById('ts-cause')?.value.trim();
  const impact  = document.getElementById('ts-impact')?.value.trim();
  const errEl   = document.getElementById('ts-ticket-error');

  if (!symptom) { if (errEl) errEl.textContent = 'Symptom is required.'; return; }
  if (errEl) errEl.textContent = '';

  state.troubleshootTicket = { symptom, tried, cause, impact };
  state.troubleshootTicketSubmitted = true;

  fetch('/api/troubleshoot/ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: state.troubleshootToken, ticket: state.troubleshootTicket })
  });

  const ticketPanel  = document.getElementById('ts-ticket-panel');
  const logTicketBtn = document.getElementById('ts-log-ticket-btn');
  if (ticketPanel) ticketPanel.hidden = true;
  if (logTicketBtn) logTicketBtn.hidden = true;
  tsShowTicketConfirm();

  const hintBtn = document.getElementById('ts-request-hint');
  if (hintBtn) { hintBtn.disabled = false; hintBtn.title = 'Request the next hint'; }
}

function tsShowTicketConfirm() {
  let confirm = document.getElementById('ts-ticket-logged-confirm');
  if (!confirm) {
    confirm = document.createElement('p');
    confirm.id = 'ts-ticket-logged-confirm';
    confirm.className = 'ts-ticket-logged hint';
    document.querySelector('.ts-action-row')?.insertAdjacentElement('afterend', confirm);
  }
  confirm.textContent = 'Ticket logged — hints are now available.';
}

async function tsRequestHint() {
  const nextLevel = state.troubleshootHintLevel + 1;
  if (nextLevel > 5) return;
  const hintBtn = document.getElementById('ts-request-hint');
  if (hintBtn) { hintBtn.disabled = true; hintBtn.textContent = 'Loading…'; }
  try {
    const res = await fetch('/api/troubleshoot/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.troubleshootToken, level: nextLevel })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.troubleshootHintLevel = nextLevel;
    state.troubleshootHints[nextLevel] = data.hint;
    const panel = document.getElementById('ts-hints-panel');
    if (panel) panel.hidden = false;
    tsRenderHints();
    if (hintBtn) {
      hintBtn.disabled = nextLevel >= 5;
      hintBtn.textContent = nextLevel >= 5 ? 'No more hints' : 'Request hint';
    }
  } catch (err) {
    if (hintBtn) { hintBtn.disabled = false; hintBtn.textContent = 'Request hint'; }
    console.error('Hint request failed:', err.message);
  }
}

function tsRenderHints() {
  const container = document.getElementById('ts-hints-container');
  const badge     = document.getElementById('ts-hint-level-badge');
  if (!container) return;

  if (badge) badge.textContent = `Level ${state.troubleshootHintLevel} of 5`;

  const levelLabels = ['Customer nudge', 'Technical nudge', 'Specific direction', 'Near-answer', 'Full solution'];
  container.innerHTML = '';

  Object.entries(state.troubleshootHints).forEach(([level, text]) => {
    const i    = Number(level) - 1;
    const card = document.createElement('div');
    card.className = 'ts-hint-card revealed';
    const hdr  = document.createElement('div');
    hdr.className = 'ts-hint-header';
    const lbadge = document.createElement('span');
    lbadge.className = 'ts-hint-level-badge';
    lbadge.textContent = `Level ${level}: ${levelLabels[i] || ''}`;
    hdr.appendChild(lbadge);
    const body = document.createElement('div');
    body.className = 'ts-hint-body';
    body.textContent = text;
    card.append(hdr, body);
    container.appendChild(card);
  });
}

async function tsMarkResolved() {
  state.troubleshootResolved = true;
  try {
    const res = await fetch('/api/troubleshoot/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.troubleshootToken,
        ticket: state.troubleshootTicket,
        hintsUsed: state.troubleshootHintLevel,
        notes: state.troubleshootNotes
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state.troubleshootSessionData = data;
    tsShowPhase(4);
    tsWirePhase4(data);
  } catch (err) {
    console.error('Debrief failed:', err.message);
    tsShowPhase(4);
    tsWirePhase4(null);
  }
}

// ── Phase 4: Debrief ────────────────────────────────────────────────────────

function tsWirePhase4(data) {
  const faultEl      = document.getElementById('ts-debrief-fault');
  const statsEl      = document.getElementById('ts-debrief-stats');
  const ticketEl     = document.getElementById('ts-debrief-ticket');
  const objectivesEl = document.getElementById('ts-debrief-objectives');

  if (faultEl && data) {
    faultEl.innerHTML = `
      <h3 class="ts-debrief-heading">What the fault was</h3>
      <p class="ts-debrief-fault-text">${escHtml(data.faultDescription)}</p>
      <div class="ts-fix-steps"><strong>Fix steps:</strong><ol>
        ${(data.fixSteps || []).map(s => `<li>${escHtml(s)}</li>`).join('' )}
      </ol></div>`;
  }

  if (statsEl && data) {
    const hintFeedback = [
      '', 'Excellent — solved without any hints.',
      'Strong — solved with just a gentle nudge.',
      'Good — needed some direction but got there.',
      'Getting there — needed specific guidance.',
      'Used the full hint chain — review this topic area.'
    ];
    statsEl.innerHTML = `
      <div class="ts-debrief-stat-grid">
        <div class="ts-debrief-stat"><span class="ts-stat-label">Hints used</span><span class="ts-stat-value">${state.troubleshootHintLevel} of 5</span></div>
        <div class="ts-debrief-stat"><span class="ts-stat-label">Ticket quality</span><span class="ts-stat-value">${data.ticketScore || '—'}</span></div>
        <div class="ts-debrief-stat"><span class="ts-stat-label">Customer info</span><span class="ts-stat-value">${state.troubleshootClueUsed ? 'Used' : 'Not used'}</span></div>
      </div>
      ${hintFeedback[state.troubleshootHintLevel] ? `<p class="ts-hint-feedback">${hintFeedback[state.troubleshootHintLevel]}</p>` : ''}
      ${data.ticketAnalysis ? `<p class="ts-ticket-analysis">${escHtml(data.ticketAnalysis)}</p>` : ''}`;
  }

  if (ticketEl && state.troubleshootTicket) {
    const t = state.troubleshootTicket;
    ticketEl.innerHTML = `
      <h3 class="ts-debrief-heading">Your ticket</h3>
      <table class="ts-debrief-table">
        <tr><td>Symptom</td><td>${escHtml(t.symptom || '—')}</td></tr>
        <tr><td>Steps tried</td><td>${escHtml(t.tried || '—')}</td></tr>
        <tr><td>Suspected cause</td><td>${escHtml(t.cause || '—')}</td></tr>
        <tr><td>Impact</td><td>${escHtml(t.impact || '—')}</td></tr>
      </table>`;
  }

  if (objectivesEl && data) {
    objectivesEl.innerHTML = `
      <h3 class="ts-debrief-heading">Learning objective covered</h3>
      <p>${escHtml(data.objectives || '—')}</p>`;
  }

  const anotherBtn  = document.getElementById('ts-another-fault');
  const endBtn      = document.getElementById('ts-end-session');
  const downloadBtn = document.getElementById('ts-download-summary');

  if (anotherBtn) {
    anotherBtn.onclick = () => {
      state.troubleshootToken = null;
      state.troubleshootScenario = null;
      state.troubleshootClueText = null;
      state.troubleshootClueUsed = false;
      state.troubleshootNotes = '';
      state.troubleshootTicket = null;
      state.troubleshootTicketSubmitted = false;
      state.troubleshootHintLevel = 0;
      state.troubleshootHints = {};
      state.troubleshootResolved = false;
      state.troubleshootSessionData = null;
      tsShowPhase(2);
      tsWirePhase2();
    };
  }
  if (endBtn) endBtn.onclick = () => initTroubleshootStep();
  if (downloadBtn) downloadBtn.onclick = () => tsDownloadSummary(data);
}

function tsDownloadSummary(data) {
  if (!data) return;
  const t = state.troubleshootTicket || {};
  const lines = [
    '# Troubleshooting Session Summary',
    '',
    `Date: ${new Date().toLocaleDateString()}`,
    '',
    '## Fault',
    data.faultDescription || '—',
    '',
    '## Fix steps',
    ...(data.fixSteps || []).map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Learning objective',
    data.objectives || '—',
    '',
    '## Performance',
    `- Hints used: ${state.troubleshootHintLevel} of 5`,
    `- Ticket quality: ${data.ticketScore || '—'}`,
    `- Customer info used: ${state.troubleshootClueUsed ? 'Yes' : 'No'}`,
    '',
    '## Your ticket',
    `- Symptom: ${t.symptom || '—'}`,
    `- Steps tried: ${t.tried || '—'}`,
    `- Suspected cause: ${t.cause || '—'}`,
    `- Impact: ${t.impact || '—'}`
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'troubleshoot-session.md';
  a.click();
}

// --- Generate ---

function renderWarnings(warnings) {
  const block = document.getElementById('warnings-block');
  block.innerHTML = '';
  if (!warnings || !warnings.length) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  const h3 = document.createElement('h3');
  h3.textContent = 'Sizing warnings';
  const ul = document.createElement('ul');
  warnings.forEach((w) => {
    const li = document.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  });
  block.append(h3, ul);
}

function renderDownloads(id, generatedScripts, svgGenerated) {
  const container = document.getElementById('downloads');
  container.innerHTML = '';

  function makeLink(kind) {
    const a = document.createElement('a');
    a.className = 'btn btn-secondary';
    a.href = `/api/download/${id}/${kind}`;
    a.download = SCRIPT_LABELS[kind];
    a.textContent = SCRIPT_LABELS[kind];
    return a;
  }

  // Always-present reference files
  container.appendChild(makeLink('prerequisites'));
  container.appendChild(makeLink('spec'));
  container.appendChild(makeLink('design-doc'));
  container.appendChild(makeLink('build-guide'));
  container.appendChild(makeLink('diagram-html'));
  if (generatedScripts.includes('depot-instructions')) {
    container.appendChild(makeLink('depot-instructions'));
  }

  // SVG diagram — only when mmdc rendered it successfully
  if (svgGenerated) {
    container.appendChild(makeLink('network-diagram'));
  }

  // Script files in deployment order
  const scriptOrder = [
    'vyos-deploy', 'dc-deploy', 'deploy-lab', 'vcenter-deploy',
    'vsan-cluster', 'memory-tiering',
    'depot-deploy', 'depot-configure', 'depot-iis',
    'deploy-workloads', 'jumpbox-deploy', 'wireguard-server', 'vyos-site-to-site',
    'nsx-deploy', 'nsx-configure', 'nsx-bgp'
  ];
  for (const kind of scriptOrder) {
    if (generatedScripts.includes(kind)) container.appendChild(makeLink(kind));
  }
}

function wireGenerate() {
  const btn = document.getElementById('btn-generate');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Generating…';

    const errBlock = document.getElementById('generate-error-block');
    errBlock.hidden = true;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.answers)
      });
      const data = await res.json();
      if (!res.ok) {
        const details = Array.isArray(data.details) && data.details.length ? data.details : null;
        if (details) {
          // step: data-step value (0-indexed); railNum: user-visible step number shown in rail
          const sectionHint = (msg) => {
            const map = [
              [/^(cpuCores|ramGB|nicCount|nicSpeed|hostCount|storageDevice)/,  {label: 'Hardware',          step: 1,  railNum: 2}],
              [/^(mgmtCidr|mgmtVlan|vmotionCidr|vmotionVlan|vsanCidr|vsanVlan|vmCidr|vmVlan)/, {label: 'Lab networks',     step: 6,  railNum: 7}],
              [/^(dcIpAddress|dcDomainName)/,                                  {label: 'Domain controller', step: 4,  railNum: 5}],
              [/^(vyosNetworkMode)/,                                            {label: 'Virtual router',    step: 3,  railNum: 4}],
              [/^(nestedHostCount|vcpuPerHost|vramPerHostGB|vsanArch|clusterName|datacenterName|ssoDomain|nvmeSizeGB|Memory tiering)/, {label: 'Nested cluster',    step: 7,  railNum: 8}],
              [/^(nsxSize|nsxTopology|nsxIpAddress|nsxBgp)/,                   {label: 'NSX-T',             step: 8,  railNum: 9}],
              [/^nestedDisk/,                                                   {label: 'Nested disks',      step: 9,  railNum: 10}],
              [/^depot/,                                                        {label: 'Bundle depot',      step: 10, railNum: 11}],
              [/^workloadVm/,                                                   {label: 'Workload VMs',      step: 11, railNum: 12}],
              [/^(firewallPolicy|remoteAccess|vpnType|vcenterSize)/,            {label: 'Security & access', step: 12, railNum: 13}],
            ];
            for (const [re, hint] of map) {
              if (re.test(msg)) return hint;
            }
            return null;
          };

          const groups = {};
          for (const msg of details) {
            const hint = sectionHint(msg);
            const key = hint ? hint.label : 'General';
            if (!groups[key]) groups[key] = { step: hint ? hint.step : null, railNum: hint ? hint.railNum : null, msgs: [] };
            groups[key].msgs.push(msg);
          }

          let html = '<strong>Fix the following before generating:</strong><ul>';
          for (const [sectionLabel, {step, railNum, msgs}] of Object.entries(groups)) {
            const goLink = step !== null
              ? ` — <a href="#" onclick="showStep(${step});return false;" class="geb-step-link">go to step ${railNum}</a>`
              : '';
            html += `<li class="geb-section">${escHtml(sectionLabel)}${goLink}<ul>`;
            for (const m of msgs) {
              // strip internal field name prefix (e.g. "fieldName: ") added for regex matching
              const display = m.replace(/^\w+:\s*/, '');
              html += `<li>${escHtml(display)}</li>`;
            }
            html += '</ul></li>';
          }
          html += '</ul>';
          errBlock.innerHTML = html;
        } else {
          errBlock.textContent = data.error || 'Generation failed.';
        }
        errBlock.hidden = false;
        errBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        throw new Error('');
      }

      errBlock.hidden = true;
      state.generated = data;

      renderWarnings(data.warnings);
      renderDownloads(data.id, data.generatedScripts || [], !!data.svgGenerated);
      document.getElementById('markdown-preview').textContent = data.markdownPreview;
      document.getElementById('results').hidden = false;
      document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Update "View Diagram" rail button to link directly to this session
      const railDiagramBtn = document.getElementById('rail-diagram-btn');
      if (railDiagramBtn && data.id) {
        railDiagramBtn.href = `/diagram?id=${data.id}`;
      }
    } catch (err) {
      if (err.message) document.getElementById('step-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// --- Keyboard shortcut: Ctrl+Shift+X / Cmd+Shift+X → toggle troubleshooting mode ---
// X is not reserved by any major browser on any platform.

document.addEventListener('keydown', (e) => {
  const modifier = e.ctrlKey || e.metaKey;
  if (modifier && e.shiftKey && e.key.toLowerCase() === 'x') {
    e.preventDefault();
    toggleTroubleshootingMode();
  }
});

// --- Init ---

wireForm();
wireNav();
wireGenerate();
showStep(0);
renderTopology();
