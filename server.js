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

// ── Troubleshoot scenario session store ────────────────────────────────────
const tsScenarioSessions = new Map(); // token → { fault, spec, createdAt, clueUsed, ticket, hintsGiven }

setInterval(() => {
  const cutoff = Date.now() - 7200000; // 2 hours
  for (const [token, session] of tsScenarioSessions) {
    if (session.createdAt < cutoff) tsScenarioSessions.delete(token);
  }
}, 300000); // prune every 5 minutes

const { buildSpec } = require('./lib/generateSpec');
const { buildPowerShellScripts } = require('./lib/generatePowerShell');
const { buildMarkdown } = require('./lib/generateMarkdown');
const { buildBuildGuide } = require('./lib/generateBuildGuide');
const { buildPrerequisites } = require('./lib/generatePrerequisites');
const { buildDepotFiles } = require('./lib/generateDepot');
const { buildNsxScripts } = require('./lib/generateNsx');
const { buildMermaidDiagram } = require('./lib/generateNetworkDiagram');
const { buildDiagramHtml } = require('./lib/generateDiagramHtml');
const { evaluateSizing } = require('./lib/sizing');
const { selectFault } = require('./lib/faultLibrary');
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

// ── Troubleshooting mode endpoints ─────────────────────────────────────────
// These endpoints are intentionally not documented in README/UI — they are
// activated via a hidden keyboard shortcut (Ctrl+Shift+X / Cmd+Shift+X).

// POST /api/troubleshoot/scenario
// Selects a fault from the library matching the given topics/difficulty,
// creates a scenario session, and returns the customer-facing scenario text.
app.post('/api/troubleshoot/scenario', (req, res) => {
  try {
    const { spec, topics, examObjectives, difficulty } = req.body || {};
    const fault = selectFault(
      Array.isArray(topics) ? topics : [],
      Array.isArray(examObjectives) ? examObjectives : [],
      typeof difficulty === 'string' ? difficulty : 'medium'
    );
    const token = crypto.randomBytes(16).toString('hex');
    tsScenarioSessions.set(token, {
      fault,
      spec: spec && typeof spec === 'object' ? spec : null,
      createdAt: Date.now(),
      clueUsed: false,
      ticket: null,
      hintsGiven: 0
    });
    res.json({
      token,
      scenario: {
        callerName: fault.customer.callerName,
        company: fault.customer.company,
        message: fault.customer.message
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Scenario generation failed.' });
  }
});

// POST /api/troubleshoot/customer-info
// Returns the additional clue the customer can provide (one-time per session).
app.post('/api/troubleshoot/customer-info', (req, res) => {
  const { token } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsScenarioSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  session.clueUsed = true;
  res.json({ clue: session.fault.customer.clue });
});

// POST /api/troubleshoot/ticket
// Records the support ticket — required before hints are unlocked.
app.post('/api/troubleshoot/ticket', (req, res) => {
  const { token, ticket } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsScenarioSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!ticket || !ticket.symptom) return res.status(400).json({ error: 'Symptom is required' });
  session.ticket = ticket;
  res.json({ ok: true });
});

// POST /api/troubleshoot/hint
// Returns the hint for the requested level. Ticket must be submitted first.
app.post('/api/troubleshoot/hint', (req, res) => {
  const { token, level } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  if (typeof level !== 'number' || level < 1 || level > 5) return res.status(400).json({ error: 'level must be 1–5' });
  const session = tsScenarioSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  if (!session.ticket) return res.status(403).json({ error: 'Submit a ticket first to unlock hints' });
  const hint = session.fault.hints[level - 1];
  if (!hint) return res.status(400).json({ error: 'Hint not found' });
  if (level > session.hintsGiven) session.hintsGiven = level;
  res.json({ hint, level });
});

// POST /api/troubleshoot/debrief
// Called when the user marks the fault as resolved.
// Returns the full fault description, fix steps, and a basic ticket quality score.
app.post('/api/troubleshoot/debrief', (req, res) => {
  const { token, ticket, hintsUsed } = req.body || {};
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });
  const session = tsScenarioSessions.get(token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  const t = session.ticket || ticket || {};
  let ticketScore = 'Not logged';
  let ticketAnalysis = '';
  if (t.symptom) {
    const fields = [t.symptom, t.tried, t.cause, t.impact].filter(Boolean).length;
    if (fields === 4) { ticketScore = 'Excellent'; ticketAnalysis = 'All four fields completed — thorough documentation.'; }
    else if (fields === 3) { ticketScore = 'Good'; ticketAnalysis = 'Three fields completed. Adding all four helps replicate issues faster.'; }
    else if (fields === 2) { ticketScore = 'Fair'; ticketAnalysis = 'Symptom plus one other field. More context speeds up triage.'; }
    else { ticketScore = 'Minimal'; ticketAnalysis = 'Only the symptom was captured. Document steps tried and suspected cause to build better habits.'; }
  }

  res.json({
    faultDescription: session.fault.faultDescription,
    fixSteps: session.fault.fixSteps,
    objectives: session.fault.objectives,
    topic: session.fault.topic,
    difficulty: session.fault.difficulty,
    ticketScore,
    ticketAnalysis,
    hintsUsed: session.hintsGiven,
    clueUsed: session.clueUsed
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
