// public/wizard.js
// No build step, no dependencies. Runs entirely against the Express API.

const TOTAL_STEPS = 13;
const DEPOT_STEP = 9; // skipped when vSAN + local datastore not both configured

const USE_CASE_LABELS = {
  certification: 'Certification study',
  feature_testing: 'Feature testing',
  homelab: 'General homelab',
  demo: 'Customer demo',
  devtest: 'Dev/test sandbox'
};

const DEVICE_TYPE_LABELS = { nvme: 'NVMe', sata_ssd: 'SATA SSD', sas_ssd: 'SAS SSD', spinning_disk: 'Spinning disk' };
const NESTED_DISK_PURPOSE_LABELS = {
  vsan_capacity:   'vSAN capacity',
  vsan_cache:      'vSAN cache / perf tier',
  local_datastore: 'Local datastore (host 1 only)',
  data:            'Additional data disk'
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

const NET_COLORS = {
  management: '#4fb3a4',
  vMotion: '#5b8fd9',
  vsan: '#d99a4e',
  vmTraffic: '#9b86d9'
};

const SCRIPT_LABELS = {
  'spec':             'lab-spec.json',
  'design-doc':       'design-doc.md',
  'build-guide':      'build-guide.md',
  'prerequisites':    'PREREQUISITES.md',
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
  'depot-instructions': 'depot-instructions.md'
};

const state = {
  step: 0,
  answers: {
    discovery: { useCase: null, networkType: null, vlanCapable: null, dhcpAvailable: null },
    hardware: {
      hostCount: 1, cpuCores: null, ramGB: null,
      storageDevices: [{ type: '', capacityGB: null, capacityUnit: 'GB' }],
      nicCount: null, nicSpeed: null
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
      depotEnabled: false, depotMode: 'linux', depotIpAddress: null,
      nestedHostCount: 3, vcpuPerHost: 4, vramPerHostGB: 16, nestedDiskGB: 32,
      clusterName: 'mgmt-cluster', datacenterName: 'Lab-DC', ssoDomain: 'vsphere.local',
      vsanArch: 'esa',
      legacyCpuCompat: false,
      memTieringEnabled: false, nvmeSizeGB: 100, tierNvmePct: 25,
      workloadVmsEnabled: false, workloadVmCount: 3, workloadVmSize: 'small',
      nestedDisks: [],
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
  const onChange = () => { renderTopology(); updateWorkloadNote(); updateDcNotice(); };

  bindRadio('useCase', d, 'useCase', onChange);

  bindNumber('hostCount', h, 'hostCount', onChange);
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

  bindSelect('esxiVersion', g, 'esxiVersion', onChange);

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
  });
  bindCheckbox('legacyCpuCompat', g, 'legacyCpuCompat', onChange);

  // Memory tiering (step 7)
  document.getElementById('memTieringEnabled').addEventListener('change', (e) => {
    g.memTieringEnabled = e.target.checked;
    document.getElementById('mem-tiering-fields').hidden = !g.memTieringEnabled;
    onChange();
  });
  bindNumber('nvmeSizeGB', g, 'nvmeSizeGB', onChange);
  bindNumber('tierNvmePct', g, 'tierNvmePct', onChange);

  // Nested disk list (step 8)
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
    [
      ['', 'Purpose…'],
      ['vsan_capacity', 'vSAN capacity'],
      ['vsan_cache', 'vSAN cache / perf tier'],
      ['local_datastore', 'Local datastore (host 1 only)'],
      ['data', 'Additional data disk']
    ].forEach(([v, label]) => {
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
      // Version minimum check
      if (g.esxiVersion && ESXI_MIN_VRAM[g.esxiVersion]) {
        const minVram = ESXI_MIN_VRAM[g.esxiVersion];
        if (g.vramPerHostGB < minVram) {
          return `${ESXI_VERSION_LABELS[g.esxiVersion]} requires at least ${minVram}GB vRAM per nested host. Current setting: ${g.vramPerHostGB}GB.`;
        }
      }
      return null;
    case 8: {
      const ndisks = g.nestedDisks || [];
      if (g.vsanEnabled) {
        const hasCapacity = ndisks.some((d) => d.purpose === 'vsan_capacity');
        if (!hasCapacity) {
          return 'vSAN is enabled — add at least one vSAN capacity disk to the nested host disk layout.';
        }
      }
      if (ndisks.some((d) => !d.sizeGB || !d.purpose)) {
        return 'Each nested disk needs a size and purpose before continuing.';
      }
      return null;
    }
    case 9:
      // Depot step — only reached when depotStepVisible(); no required fields
      return null;
    case 10:
      if (g.workloadVmsEnabled) {
        if (!g.workloadVmCount || g.workloadVmCount < 1) return 'Enter the number of workload VMs.';
        if (!g.workloadVmSize) return 'Select a workload VM size.';
      }
      return null;
    case 11:
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
    li.classList.toggle('done', s < n);
  });

  document.getElementById('btn-back').style.visibility = n === 0 ? 'hidden' : 'visible';
  document.getElementById('btn-next').style.display = n === TOTAL_STEPS - 1 ? 'none' : 'inline-flex';
  document.getElementById('step-error').textContent = '';

  if (n === TOTAL_STEPS - 1) renderReview();
  updateDcNotice();
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
    ['CPU cores', val(h.cpuCores)],
    ['RAM', val(h.ramGB, 'GB')],
    ...((h.storageDevices || []).map((dev, i) => [
      `Disk ${i + 1}`,
      `${dev.capacityGB || '?'}${dev.capacityUnit || 'GB'} ${DEVICE_TYPE_LABELS[dev.type] || '?'}`
    ])),
    ['NICs', h.nicCount ? `${h.nicCount} × ${h.nicSpeed || '?'}` : '—']
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
    ['Memory tiering', g.memTieringEnabled ? `${g.nvmeSizeGB}GB NVMe / ${g.tierNvmePct}%` : 'Disabled']
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
    const hasVsanCapacity = ndisks.some((dd) => dd.purpose === 'vsan_capacity');
    if (!hasVsanCapacity) {
      const warn = document.createElement('div');
      warn.className = 'review-warn';
      warn.textContent = '⚠ vSAN is enabled but no vSAN capacity disk is defined. The cluster formation script will fail. Go back to step 8 (Nested disks) and add a vSAN capacity disk.';
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
    'deploy-workloads', 'jumpbox-deploy', 'wireguard-server', 'vyos-site-to-site'
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

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.answers)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed.');

      state.generated = data;

      renderWarnings(data.warnings);
      renderDownloads(data.id, data.generatedScripts || [], !!data.svgGenerated);
      document.getElementById('markdown-preview').textContent = data.markdownPreview;
      document.getElementById('results').hidden = false;
      document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      document.getElementById('step-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// --- Init ---

wireForm();
wireNav();
wireGenerate();
showStep(0);
renderTopology();
