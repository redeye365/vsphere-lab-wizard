// server.js
//
// Local-only server for the vSphere Lab Wizard. Run with `npm start`,
// then open http://localhost:3000

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const os = require('os');

// pkg bundles the app as a standalone executable. Detect that mode so we can
// resolve writable output dirs relative to the executable rather than __dirname
// (which points into the read-only snapshot FS when running under pkg).
const IS_PKG = typeof process.pkg !== 'undefined';
const BASE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

const { buildSpec } = require('./lib/generateSpec');
const { buildPowerShellScripts } = require('./lib/generatePowerShell');
const { buildMarkdown } = require('./lib/generateMarkdown');
const { buildBuildGuide } = require('./lib/generateBuildGuide');
const { buildPrerequisites } = require('./lib/generatePrerequisites');
const { buildDepotFiles } = require('./lib/generateDepot');
const { buildNsxScripts } = require('./lib/generateNsx');
const { buildMermaidDiagram } = require('./lib/generateNetworkDiagram');
const { evaluateSizing } = require('./lib/sizing');
const { validateAnswers } = require('./lib/validateAnswers');

// Locate mmdc (mermaid-cli) — checks local node_modules first, then PATH.
// Returns the path string if found and executable, otherwise null.
function findMmdc() {
  const candidates = [
    path.join(__dirname, 'node_modules', '.bin', 'mmdc'),
    'mmdc'
  ];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['--version'], { timeout: 5000, encoding: 'utf8' });
    if (result.status === 0) return cmd;
  }
  return null;
}

const MMDC = findMmdc();
if (MMDC) {
  console.log('Network diagram: SVG generation enabled (mmdc found)');
} else {
  // mmdc/mermaid-cli uses Puppeteer (headless Chromium) and cannot be bundled
  // into the standalone executable — it must be installed separately.
  // The Mermaid diagram source is always included in build-guide.md regardless.
  const installHint = IS_PKG
    ? 'npm install -g @mermaid-js/mermaid-cli'
    : 'npm install (already in devDependencies) or npm install -g @mermaid-js/mermaid-cli';
  console.log(`Network diagram: SVG export unavailable — mmdc not found.`);
  console.log(`  The Mermaid diagram source is included in build-guide.md and can be`);
  console.log(`  pasted into mermaid.live for a visual preview.`);
  console.log(`  To enable SVG export: ${installHint}`);
}

// Attempt to render a Mermaid string to SVG via mmdc.
// Returns true if the SVG was written, false otherwise.
function renderSvg(mermaidContent, outputPath) {
  if (!MMDC) return false;
  const tmpInput = path.join(os.tmpdir(), `mermaid-${Date.now()}.mmd`);
  try {
    fs.writeFileSync(tmpInput, mermaidContent, 'utf8');
    const result = spawnSync(
      MMDC,
      ['-i', tmpInput, '-o', outputPath, '--theme', 'neutral', '--quiet'],
      { timeout: 30000 }
    );
    return result.status === 0 && fs.existsSync(outputPath);
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpInput); } catch { /* ignore */ }
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

const OUTPUT_DIR = path.join(BASE_DIR, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'start' : platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

// Static files always present in every output
const FIXED_OUTPUT_FILES = {
  spec:              'lab-spec.json',
  'design-doc':      'design-doc.md',
  'build-guide':     'build-guide.md',
  'prerequisites':   'PREREQUISITES.md',
  'network-diagram': 'network-diagram.svg'
};

// Dynamic script filenames -- the key is the download URL kind
const SCRIPT_KINDS = {
  'deploy-lab':          'deploy-lab.ps1',
  'vyos-deploy':         'vyos-deploy.ps1',
  'dc-deploy':           'dc-deploy.ps1',
  'vcenter-deploy':      'vcenter-deploy.ps1',
  'vsan-cluster':        'vsan-cluster.ps1',
  'deploy-workloads':    'deploy-workloads.ps1',
  'jumpbox-deploy':      'jumpbox-deploy.ps1',
  'wireguard-server':    'wireguard-server.sh',
  'vyos-site-to-site':   'vyos-site-to-site.conf',
  'memory-tiering':      'configure-memory-tiering.ps1',
  'depot-deploy':        'depot-deploy.ps1',
  'depot-configure':     'depot-configure.sh',
  'depot-iis':           'depot-iis.ps1',
  'depot-instructions':  'depot-instructions.md',
  'nsx-deploy':          'nsx-deploy.ps1',
  'nsx-configure':       'nsx-configure.ps1',
  'nsx-bgp':             'nsx-bgp.ps1'
};

const ALL_OUTPUT_FILES = { ...FIXED_OUTPUT_FILES, ...SCRIPT_KINDS };

app.post('/api/generate', (req, res) => {
  try {
    const answers = req.body || {};

    const validationErrors = validateAnswers(answers);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const sizing = evaluateSizing(answers);
    const spec = buildSpec(answers, sizing);
    const scripts = buildPowerShellScripts(spec);
    const designDoc = buildMarkdown(spec);
    const buildGuide = buildBuildGuide(spec);

    const id = crypto.randomBytes(4).toString('hex');
    const dir = path.join(OUTPUT_DIR, id);
    fs.mkdirSync(dir, { recursive: true });

    const prerequisites = buildPrerequisites(spec);
    const depotFiles = buildDepotFiles(spec);
    const generatedScripts = [];

    fs.writeFileSync(path.join(dir, 'lab-spec.json'), JSON.stringify(spec, null, 2));
    fs.writeFileSync(path.join(dir, 'design-doc.md'), designDoc);
    fs.writeFileSync(path.join(dir, 'build-guide.md'), buildGuide);
    fs.writeFileSync(path.join(dir, 'PREREQUISITES.md'), prerequisites);

    // Attempt SVG network diagram (requires mmdc / @mermaid-js/mermaid-cli)
    const mermaidDiagram = buildMermaidDiagram(spec);
    const svgGenerated = renderSvg(mermaidDiagram, path.join(dir, 'network-diagram.svg'));

    // Write each generated PowerShell/bash script
    for (const [filename, content] of Object.entries(scripts)) {
      fs.writeFileSync(path.join(dir, filename), content);
      const kind = Object.entries(SCRIPT_KINDS).find(([, fn]) => fn === filename)?.[0];
      if (kind) generatedScripts.push(kind);
    }

    // Depot files (only when depot is enabled and conditions met in spec)
    for (const [filename, content] of Object.entries(depotFiles)) {
      fs.writeFileSync(path.join(dir, filename), content);
      const kind = Object.entries(SCRIPT_KINDS).find(([, fn]) => fn === filename)?.[0];
      if (kind) generatedScripts.push(kind);
    }

    // NSX scripts (only when NSX is enabled)
    const nsxFiles = buildNsxScripts(spec);
    for (const [filename, content] of Object.entries(nsxFiles)) {
      fs.writeFileSync(path.join(dir, filename), content);
      const kind = Object.entries(SCRIPT_KINDS).find(([, fn]) => fn === filename)?.[0];
      if (kind) generatedScripts.push(kind);
    }

    res.json({
      id,
      warnings: sizing.warnings,
      spec,
      markdownPreview: designDoc,
      svgGenerated,
      generatedScripts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Generation failed. Check the server log for details.' });
  }
});

app.get('/api/download/:id/:kind', (req, res) => {
  const { id, kind } = req.params;

  if (!/^[a-f0-9]{8}$/.test(id)) return res.status(400).send('Invalid id');
  const filename = ALL_OUTPUT_FILES[kind];
  if (!filename) return res.status(404).send('Unknown file kind');

  const filePath = path.join(OUTPUT_DIR, id, filename);

  // Defense in depth: verify the resolved path hasn't escaped OUTPUT_DIR.
  // The regex on id and allowlist on kind already prevent this, but be explicit.
  const resolvedOutput = path.resolve(OUTPUT_DIR);
  if (!path.resolve(filePath).startsWith(resolvedOutput + path.sep)) {
    return res.status(400).send('Invalid path');
  }

  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

  res.download(filePath, filename);
});

// ── Troubleshooting mode endpoints ─────────────────────────────────────────
// These endpoints are intentionally not documented in README/UI — they are
// activated via a hidden keyboard shortcut (Ctrl+Shift+T / Cmd+Shift+T).

app.post('/api/troubleshoot/generate-quiz', (req, res) => {
  try {
    const { spec } = req.body || {};
    if (!spec || typeof spec !== 'object') {
      return res.status(400).json({ error: 'spec object required' });
    }
    const questions = buildQuizFromSpec(spec);
    res.json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Quiz generation failed.' });
  }
});

function buildQuizFromSpec(spec) {
  const questions = [];
  const nc  = spec.nestedCluster || {};
  const nets = spec.networks || {};
  const dc  = spec.domainController || {};
  const vyos = spec.vyos || {};
  const nsx = spec.nsx || {};
  const ra  = spec.remoteAccess || {};
  const ntp = spec.ntp || {};

  function distractVlan(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return [];
    return [n + 10, n - 10, n + 20, n + 5].filter((x) => x > 0 && x < 4095 && x !== n).slice(0, 3);
  }
  function distract4(correct, pool) {
    const others = pool.filter((x) => x !== correct).slice(0, 3);
    return shuffle([correct, ...others]);
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function q(question, correct, distractors, explanation) {
    const opts = shuffle([correct, ...distractors.slice(0, 3)]);
    questions.push({ question, options: opts.map((t) => ({ text: String(t), correct: t === correct })), explanation });
  }

  // Q: How many nested ESXi hosts?
  if (nc.hostCount) {
    const n = nc.hostCount;
    q(`How many nested ESXi hosts does this design deploy?`,
      String(n),
      [String(n + 1), String(Math.max(1, n - 1)), String(n + 2)],
      `The wizard was configured for ${n} nested ESXi host${n === 1 ? '' : 's'} in the ${nc.clusterName || 'mgmt-cluster'} cluster.`
    );
  }

  // Q: vRAM per host
  if (nc.vramPerHostGB) {
    const v = nc.vramPerHostGB;
    q(`How much vRAM is assigned to each nested ESXi host?`,
      `${v}GB`,
      [`${v * 2}GB`, `${Math.max(8, v - 8)}GB`, `${v + 16}GB`],
      `Each nested host gets ${v}GB vRAM. This was set in the nested cluster step.`
    );
  }

  // Q: vCPU per host
  if (nc.vcpuPerHost) {
    const v = nc.vcpuPerHost;
    q(`How many vCPUs is each nested ESXi host configured with?`,
      String(v),
      [String(v * 2), String(Math.max(1, v - 2)), String(v + 4)],
      `Each nested host gets ${v} vCPUs.`
    );
  }

  // Q: Management CIDR
  if (nets.management?.cidr) {
    const c = nets.management.cidr;
    const parts = c.split('.');
    const alt1 = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}.0/24`;
    const alt2 = `10.0.0.0/24`;
    const alt3 = `172.16.0.0/24`;
    q(`What is the management network CIDR?`, c, [alt1, alt2, alt3],
      `The management network is ${c}. All control-plane components (ESXi hosts, vCenter, DC) use this subnet.`
    );
  }

  // Q: Management VLAN
  if (nets.management?.vlanId != null) {
    const v = nets.management.vlanId;
    const d = distractVlan(v);
    q(`What VLAN ID is assigned to management traffic?`,
      String(v),
      d.map(String),
      `Management VLAN is ${v}. This ID must match on the physical port group, VyOS sub-interface, and nested vmk0.`
    );
  }

  // Q: Cluster name
  if (nc.clusterName) {
    q(`What is the vSphere cluster name?`,
      nc.clusterName,
      ['management', 'lab-cluster', 'nested-cluster'],
      `The cluster name is "${nc.clusterName}". This propagates through all generated scripts and is visible in SDDC Manager if VCF is layered on top.`
    );
  }

  // Q: SSO domain
  if (nc.ssoDomain) {
    q(`What is the vCenter SSO domain?`,
      nc.ssoDomain,
      ['vsphere.lab', dc.domainName || 'lab.local', 'administrator.local'],
      `The SSO domain is "${nc.ssoDomain}". It must stay distinct from the AD domain to avoid VCF bring-up failures.`
    );
  }

  // Q: NTP source
  if (ntp.source) {
    q(`What NTP server do all lab components reference?`,
      ntp.source,
      ['pool.ntp.org', '8.8.8.8', '1.1.1.1', '192.168.0.1'].filter((x) => x !== ntp.source).slice(0, 3),
      `All lab components use "${ntp.source}" as their NTP source. Time consistency is required for cert validation and SSO.`
    );
  }

  // Q: vSAN architecture
  if (nc.vsanEnabled && nc.vsanArchitecture) {
    const correct = nc.vsanArchitecture === 'esa' ? 'ESA (Express Storage Architecture)' : 'OSA (Original Storage Architecture)';
    q(`Which vSAN storage architecture is this design using?`,
      correct,
      ['OSA (Original Storage Architecture)', 'ESA (Express Storage Architecture)', 'vSAN Stretched Cluster', 'vSAN 2-Node'].filter((x) => x !== correct).slice(0, 3),
      `This design uses vSAN ${nc.vsanArchitecture.toUpperCase()}. ESA is single-tier (all-flash only); OSA uses cache + capacity tiers.`
    );
  }

  // Q: ESXi version
  if (spec.esxiVersion?.label) {
    q(`What ESXi version is this lab deploying?`,
      spec.esxiVersion.label,
      ['ESXi 8.0 U3', 'ESXi 9.0', 'ESXi 8.0 U2', 'ESXi 9.1'].filter((x) => x !== spec.esxiVersion.label).slice(0, 3),
      `This lab deploys ${spec.esxiVersion.label}.`
    );
  }

  // Q: NSX topology (if NSX enabled)
  if (nsx.enabled && nsx.topology) {
    const topLabels = { T0T1: 'T0 and T1 Gateways only', T0T1DFW: 'T0, T1 Gateways + Distributed Firewall', full: 'Full (T0/T1/DFW + Advanced LB)' };
    const correct = topLabels[nsx.topology] || nsx.topology;
    q(`What NSX-T gateway topology was configured?`,
      correct,
      Object.values(topLabels).filter((x) => x !== correct).slice(0, 3),
      `NSX topology: ${correct}.`
    );
  }

  return questions.slice(0, 10);
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`vSphere Lab Wizard running at ${url}`);
  if (IS_PKG) {
    console.log('Opening browser...');
    openBrowser(url);
  }
});
