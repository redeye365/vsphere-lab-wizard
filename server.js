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

// ── Troubleshoot session store ─────────────────────────────────────────────
// token → { scenario, createdAt, clueUsed, ticket, hintsGiven }
const tsSessions = new Map();

setInterval(() => {
  const cutoff = Date.now() - 7200000; // 2 hours
  for (const [token, session] of tsSessions) {
    if (session.createdAt < cutoff) tsSessions.delete(token);
  }
}, 300000); // prune every 5 minutes

const { buildSpec } = require('./lib/generateSpec');
const { buildPowerShellScripts } = require('./lib/generatePowerShell');
const { buildMarkdown } = require('./lib/generateMarkdown');
const { buildBuildGuide } = require('./lib/generateBuildGuide');
const { buildPrerequisites } = require('./lib/generatePrerequisites');
const { buildDepotFiles } = require('./lib/generateDepot');
const { buildNsxScripts } = require('./lib/generateNsx');
const { buildVcfFiles }  = require('./lib/generateVcf');
const { buildMermaidDiagram } = require('./lib/generateNetworkDiagram');
const { buildDiagramHtml } = require('./lib/generateDiagramHtml');
const { evaluateSizing } = require('./lib/sizing');
const { loadScenarios, getScenario, saveScenario, deleteScenario, getVerifyScript, saveVerifyScript, getActive, setActive, nameToId } = require('./lib/scenarioLibrary');
const { validateAnswers } = require('./lib/validateAnswers');
const { revertAllToSnapshot, createSnapshotsOnAllVMs, testConnection: vcenterTestConnection } = require('./lib/vcenterClient');
const vcenterConfig = require('./lib/vcenterConfig');

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

// Serve mermaid.js locally so wizard pages don't depend on CDN
app.get('/vendor/mermaid.min.js', (req, res) => {
  const localPath = path.join(__dirname, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
  if (fs.existsSync(localPath)) {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(localPath);
  } else {
    res.status(404).send('mermaid not found');
  }
});

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
  'network-diagram': 'network-diagram.svg',
  'diagram-html':    'diagram.html'
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

    // Standalone diagram.html (renders from CDN, no server required)
    fs.writeFileSync(path.join(dir, 'diagram.html'), buildDiagramHtml(spec, mermaidDiagram));

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

    // VCF bring-up files (only when VCF is enabled)
    const vcfFiles = buildVcfFiles(spec);
    for (const [filename, content] of Object.entries(vcfFiles)) {
      fs.writeFileSync(path.join(dir, filename), content);
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
    console.error('Generate failed:', err.message);
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

// ── Diagram endpoints ──────────────────────────────────────────────────────

// GET /api/diagram/:id — returns { mermaid: "...", spec: {...} } for a saved output
app.get('/api/diagram/:id', (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{8}$/.test(id)) return res.status(400).json({ error: 'Invalid id' });

  const specPath = path.join(OUTPUT_DIR, id, 'lab-spec.json');
  const resolvedOutput = path.resolve(OUTPUT_DIR);
  if (!path.resolve(specPath).startsWith(resolvedOutput + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(specPath)) return res.status(404).json({ error: 'Not found' });

  try {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const mermaid = buildMermaidDiagram(spec);
    // Return only the fields the viewer needs for its status line — not the full spec.
    const nc = spec.nestedCluster || {};
    const meta = {
      nestedHostCount:   nc.hostCount    || 0,
      physicalHostCount: (spec.physicalHosts || []).length || 1,
      esxiVersionLabel:  spec.esxiVersion?.label || '',
      clusterName:       nc.clusterName  || ''
    };
    res.json({ mermaid, meta });
  } catch {
    res.status(500).json({ error: 'Failed to read spec' });
  }
});

// POST /api/diagram/from-spec — build mermaid source from a posted spec object
app.post('/api/diagram/from-spec', (req, res) => {
  try {
    const { spec } = req.body || {};
    if (!spec || typeof spec !== 'object') {
      return res.status(400).json({ error: 'spec object required' });
    }
    const mermaid = buildMermaidDiagram(spec);
    res.json({ mermaid });
  } catch (err) {
    res.status(500).json({ error: 'Diagram generation failed' });
  }
});

// GET /diagram — serve the standalone diagram viewer page
app.get('/diagram', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'diagram.html'));
});

// ── Admin: Scenario Library endpoints ──────────────────────────────────────
// Activated via Cmd+Shift+X — not documented in README or public UI.

// GET /api/admin/scenario-list — return all scenarios in the library
app.get('/api/admin/scenario-list', (req, res) => {
  try { res.json({ scenarios: loadScenarios() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/scenario-active — return the currently loaded scenario (if any)
app.get('/api/admin/scenario-active', (req, res) => {
  try {
    const active = getActive();
    if (!active) return res.json({ active: null });
    const scenario = getScenario(active.id);
    res.json({ active: scenario ? { ...active, scenario } : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-load — set the active scenario and revert the vCenter snapshot
app.post('/api/admin/scenario-load', async (req, res) => {
  const { id } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    setActive(id);

    if (!scenario.snapshotName) {
      return res.json({ ok: true, scenario, snapshotNote: 'No snapshot captured yet — introduce the fault manually in the lab.' });
    }

    const cfg = vcenterConfig.load(BASE_DIR);
    if (!cfg || !cfg.server) {
      return res.json({ ok: true, scenario, snapshotNote: `vCenter not configured — revert snapshot '${scenario.snapshotName}' manually, or save vCenter credentials using the vCenter Settings button.` });
    }

    try {
      const reverted = await revertAllToSnapshot(cfg, scenario.snapshotName);
      res.json({ ok: true, scenario, reverted, snapshotNote: `Reverted ${reverted.length} VM(s) to snapshot '${scenario.snapshotName}'.` });
    } catch (vcErr) {
      res.json({ ok: true, scenario, snapshotError: vcErr.message });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-unload — clear the active scenario
app.post('/api/admin/scenario-unload', (req, res) => {
  try { setActive(null); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/vcenter-config — return saved vCenter settings (password redacted)
app.get('/api/admin/vcenter-config', (req, res) => {
  const cfg = vcenterConfig.load(BASE_DIR);
  if (!cfg) return res.json({ configured: false });
  const { password: _pw, ...safe } = cfg;
  res.json({ configured: true, ...safe });
});

// POST /api/admin/vcenter-config — save vCenter connection settings
app.post('/api/admin/vcenter-config', (req, res) => {
  const { server, user, password, insecure } = req.body || {};
  if (!server || typeof server !== 'string') return res.status(400).json({ error: 'server is required' });
  if (!user   || typeof user   !== 'string') return res.status(400).json({ error: 'user is required' });
  try {
    vcenterConfig.save(BASE_DIR, {
      server:   server.trim(),
      user:     user.trim(),
      password: password || '',
      insecure: !!insecure
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/vcenter-test — authenticate and immediately log out to verify credentials
app.post('/api/admin/vcenter-test', async (req, res) => {
  const cfg = vcenterConfig.load(BASE_DIR);
  if (!cfg || !cfg.server) return res.status(400).json({ error: 'No vCenter configuration saved — fill in the settings form first.' });
  try {
    await vcenterTestConnection(cfg);
    res.json({ ok: true, message: `Connected to ${cfg.server} as ${cfg.user}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/scenario-save — create or update a scenario + optional verify script
app.post('/api/admin/scenario-save', (req, res) => {
  const { scenario, verifyScriptContent } = req.body || {};
  if (!scenario || typeof scenario !== 'object') return res.status(400).json({ error: 'scenario object required' });
  if (!scenario.name) return res.status(400).json({ error: 'scenario.name required' });
  try {
    if (!scenario.id) scenario.id = nameToId(scenario.name);
    if (!scenario.created) scenario.created = new Date().toISOString().slice(0, 10);
    scenario.verifyScript = scenario.verifyScript || `verify-${scenario.id}.ps1`;
    saveScenario(scenario);
    if (verifyScriptContent && typeof verifyScriptContent === 'string') {
      saveVerifyScript(scenario.verifyScript, verifyScriptContent);
    }
    res.json({ ok: true, id: scenario.id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/admin/scenario/:id — delete a scenario from the library
app.delete('/api/admin/scenario/:id', (req, res) => {
  const { id } = req.params;
  try {
    deleteScenario(id);
    // Clear active if this was the loaded scenario
    const active = getActive();
    if (active && active.id === id) setActive(null);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/admin/scenario-export/:id — download scenario as .labscenario bundle
app.get('/api/admin/scenario-export/:id', (req, res) => {
  const { id } = req.params;
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const verifyScript = getVerifyScript(id) || '';
    const bundle = { version: '1', scenario, verifyScript };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.labscenario"`);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-import — import a .labscenario bundle
app.post('/api/admin/scenario-import', (req, res) => {
  const { bundle } = req.body || {};
  if (!bundle || typeof bundle !== 'object') return res.status(400).json({ error: 'bundle object required' });
  if (bundle.version !== '1') return res.status(400).json({ error: 'Unsupported bundle version' });
  const scenario = bundle.scenario;
  if (!scenario || !scenario.id || !scenario.name) return res.status(400).json({ error: 'Invalid scenario in bundle' });
  try {
    // Imported scenarios have no snapshot yet — clear snapshotName
    scenario.snapshotName = '';
    saveScenario(scenario);
    if (bundle.verifyScript && typeof bundle.verifyScript === 'string') {
      saveVerifyScript(scenario.verifyScript || `verify-${scenario.id}.ps1`, bundle.verifyScript);
    }
    res.json({ ok: true, id: scenario.id, name: scenario.name });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/admin/scenario-capture — create a vCenter snapshot on all VMs and record the name
app.post('/api/admin/scenario-capture', async (req, res) => {
  const { id, snapshotName: requestedName } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const snapshotName = (requestedName || '').trim() || `scenario-${id}-${Date.now()}`;

    const cfg = vcenterConfig.load(BASE_DIR);
    if (!cfg || !cfg.server) {
      // No vCenter config — record the name only; admin creates the snapshot manually
      scenario.snapshotName = snapshotName;
      saveScenario(scenario);
      return res.json({ ok: true, snapshotName, vcenterNote: 'vCenter not configured — create this snapshot manually in vCenter using the name above, then load the scenario to auto-revert.' });
    }

    try {
      const { created, errors } = await createSnapshotsOnAllVMs(cfg, snapshotName, `vSphere Lab Wizard — ${scenario.name}`);
      scenario.snapshotName = snapshotName;
      saveScenario(scenario);
      res.json({ ok: true, snapshotName, created, errors });
    } catch (vcErr) {
      // vCenter error — still record the name so admin can create manually and load later
      scenario.snapshotName = snapshotName;
      saveScenario(scenario);
      res.json({ ok: true, snapshotName, vcenterError: vcErr.message });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/scenario-verify — run the verify script and return result
app.post('/api/admin/scenario-verify', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const script = getVerifyScript(id);
    if (!script) return res.status(404).json({ error: 'Verify script not found for this scenario' });
    const scenario = getScenario(id);
    const scriptPath = path.join(__dirname, 'scenarios', 'verify', (scenario && scenario.verifyScript) || `verify-${id}.ps1`);
    const pwsh = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const result = require('child_process').spawnSync(pwsh, ['-NoProfile', '-File', scriptPath], { timeout: 30000, encoding: 'utf8' });
    if (result.status === null) return res.json({ result: 'ERROR', output: 'Script timed out or PowerShell not found. Install PowerShell Core (pwsh) to run verify scripts.' });
    const output = (result.stdout || '') + (result.stderr || '');
    const verified = output.includes('FAULT_RESOLVED') ? 'FAULT_RESOLVED' : output.includes('FAULT_PRESENT') ? 'FAULT_PRESENT' : 'UNKNOWN';
    res.json({ result: verified, output: output.trim() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Troubleshooting mode endpoints ─────────────────────────────────────────
// Activated via Cmd+Shift+X — not documented in README or public UI.

// POST /api/troubleshoot/start — begin a session with a specific scenario
app.post('/api/troubleshoot/start', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const scenario = getScenario(id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    const token = crypto.randomBytes(16).toString('hex');
    tsSessions.set(token, { scenario, createdAt: Date.now(), clueUsed: false, ticket: null, hintsGiven: 0 });
    res.json({
      token,
      callerName:      scenario.customerScenario ? 'Customer' : 'Lab',
      scenarioMessage: scenario.customerScenario || '',
      scenarioName:    scenario.name,
      difficulty:      scenario.difficulty,
      topics:          scenario.topics || []
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/troubleshoot/customer-info — return the follow-up clue (one-time)
app.post('/api/troubleshoot/customer-info', (req, res) => {
  const { token } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  session.clueUsed = true;
  res.json({ clue: session.scenario.customerFollowUp || 'No additional information available.' });
});

// POST /api/troubleshoot/ticket — record the support ticket (unlocks hints)
app.post('/api/troubleshoot/ticket', (req, res) => {
  const { token, ticket } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!ticket || !ticket.symptom) return res.status(400).json({ error: 'Symptom is required' });
  session.ticket = ticket;
  res.json({ ok: true });
});

// POST /api/troubleshoot/hint — return the hint at the requested level
app.post('/api/troubleshoot/hint', (req, res) => {
  const { token, level } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  if (typeof level !== 'number' || level < 1 || level > 5) return res.status(400).json({ error: 'level must be 1–5' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!session.ticket) return res.status(403).json({ error: 'Submit a ticket first to unlock hints' });
  const hint = (session.scenario.hints || [])[level - 1];
  if (!hint) return res.status(400).json({ error: 'Hint not found' });
  if (level > session.hintsGiven) session.hintsGiven = level;
  res.json({ hint, level });
});

// POST /api/troubleshoot/debrief — mark resolved and return full scenario data + ticket score
app.post('/api/troubleshoot/debrief', (req, res) => {
  const { token, ticket } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const t = session.ticket || ticket || {};
  let ticketScore = 'Not logged';
  let ticketAnalysis = '';
  if (t.symptom) {
    const fields = [t.symptom, t.tried, t.cause, t.impact].filter(Boolean).length;
    if (fields === 4) { ticketScore = 'Excellent'; ticketAnalysis = 'All four fields completed — thorough documentation.'; }
    else if (fields === 3) { ticketScore = 'Good';      ticketAnalysis = 'Three fields completed. Adding all four helps replicate issues faster.'; }
    else if (fields === 2) { ticketScore = 'Fair';      ticketAnalysis = 'Symptom plus one other field. More context speeds up triage.'; }
    else                   { ticketScore = 'Minimal';   ticketAnalysis = 'Only the symptom was captured. Document steps tried and suspected cause to build better habits.'; }
  }

  const s = session.scenario;
  res.json({
    scenarioName:    s.name,
    faultDescription: s.description,
    fixSteps:        s.fixSteps        || [],
    objectives:      (s.examObjectives || []).join(', '),
    topics:          (s.topics         || []).join(', '),
    difficulty:      s.difficulty,
    ticketScore,
    ticketAnalysis,
    hintsUsed:       session.hintsGiven,
    clueUsed:        session.clueUsed,
    verifyScript:    s.verifyScript    || null
  });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`vSphere Lab Wizard running at ${url}`);
  if (IS_PKG) {
    console.log('Opening browser...');
    openBrowser(url);
  }
});
