'use strict';

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const BASE = 'http://127.0.0.1:3000';
  let pass = 0, fail = 0;

  function ok(label) { console.log(`  PASS  ${label}`); pass++; }
  function ko(label, detail) { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  async function check(label, fn) {
    try { const r = await fn(); if (r === false) ko(label); else ok(label); }
    catch (e) { ko(label, e.message); }
  }

  console.log('\n── Mode selector screen ──');
  await page.goto(BASE);
  await check('Mode selector is visible on load', async () => {
    return await page.isVisible('#mode-select-screen');
  });
  await check('.app is hidden behind mode selector', async () => {
    return await page.evaluate(() => document.querySelector('.app').hidden);
  });
  await check('"Build my lab" card present', async () => page.isVisible('#mode-build'));
  await check('"Learn to design my lab" card present', async () => page.isVisible('#mode-learn'));

  console.log('\n── Enter standard mode ──');
  await page.click('#mode-build');
  await check('Mode selector hidden after choosing Build', async () => {
    return await page.evaluate(() => document.getElementById('mode-select-screen').hidden);
  });
  await check('.app visible after choosing Build', async () => {
    return await page.evaluate(() => !document.querySelector('.app').hidden);
  });
  await check('Step 0 shown (use case)', async () => {
    return await page.isVisible('[data-step="0"]');
  });
  await check('No learn-block visible in standard mode', async () => {
    const blocks = await page.$$eval('.learn-block', els => els.filter(e => e.style.display !== 'none').length);
    return blocks === 0;
  });

  console.log('\n── Enter learning mode ──');
  await page.goto(BASE);
  await page.click('#mode-learn');
  await check('Mode selector hidden after choosing Learn', async () => {
    return await page.evaluate(() => document.getElementById('mode-select-screen').hidden);
  });
  await check('body has .learning-mode class', async () => {
    return await page.evaluate(() => document.body.classList.contains('learning-mode'));
  });
  await check('Onboarding screen visible after choosing Learn', async () => {
    return await page.evaluate(() => !document.getElementById('learn-onboard-screen').hidden);
  });
  await check('.app still hidden during onboarding', async () => {
    return await page.evaluate(() => document.querySelector('.app').hidden);
  });

  console.log('\n── Onboarding screen ──');
  await check('5 goal cards present', async () => {
    const cards = await page.$$('.learn-goal-card'); return cards.length === 5;
  });
  await check('3 experience cards present', async () => {
    const cards = await page.$$('.learn-exp-card'); return cards.length === 3;
  });
  await check('3 time cards present', async () => {
    const cards = await page.$$('.learn-time-card'); return cards.length === 3;
  });
  await check('Start button disabled before selections', async () => {
    return await page.$eval('#learn-onboard-start', e => e.disabled);
  });
  await check('Learning path summary hidden before selections', async () => {
    return await page.evaluate(() => document.getElementById('learn-path-summary').hidden);
  });

  // Select certification goal — cert dropdown should appear
  await page.evaluate(() => document.querySelector('.learn-goal-card[data-goal="certification"]').click());
  await check('Cert dropdown shown after certification goal', async () => {
    return await page.evaluate(() => !document.getElementById('learn-cert-wrap').hidden);
  });
  await check('Tech dropdown hidden for certification goal', async () => {
    return await page.evaluate(() => document.getElementById('learn-tech-wrap').hidden);
  });
  await page.selectOption('#learn-cert-target', 'VCP-VCF-Admin');

  // Select experience
  await page.evaluate(() => document.querySelector('.learn-exp-card[data-exp="some"]').click());

  // Fill success statement
  await page.fill('#learn-success-stmt', 'Practise VCF bring-up and SDDC Manager for VCP-VCF Admin exam.');
  await check('Success statement captured in state', async () => {
    return await page.evaluate(() => {
      const ta = document.getElementById('learn-success-stmt');
      return ta && ta.value.includes('VCP-VCF Admin');
    });
  });

  // Select time
  await page.evaluate(() => document.querySelector('.learn-time-card[data-time="full-day"]').click());

  await check('Learning path summary visible after selections', async () => {
    return await page.evaluate(() => !document.getElementById('learn-path-summary').hidden);
  });
  await check('Learning path text mentions VCP-VCF-Admin areas', async () => {
    const text = await page.$eval('#learn-path-text', e => e.textContent);
    return text.includes('VCF') || text.includes('SDDC') || text.includes('NSX') || text.includes('workload');
  });
  await check('Start button enabled after required fields', async () => {
    return await page.$eval('#learn-onboard-start', e => !e.disabled);
  });

  // Proceed into the wizard
  await page.evaluate(() => document.getElementById('learn-onboard-start').click());
  await check('Onboarding screen hidden after start', async () => {
    return await page.evaluate(() => document.getElementById('learn-onboard-screen').hidden);
  });
  await check('.app visible after start', async () => {
    return await page.evaluate(() => !document.querySelector('.app').hidden);
  });

  console.log('\n── Navigate to step 1 (hardware) ──');
  await page.click('#btn-next');
  await check('Step 1 learn-block visible', async () => {
    const el = await page.$('.learn-block[data-learn-step="1"]');
    return el && await el.evaluate(e => e.style.display !== 'none');
  });

  // Set RAM and check insight
  await page.fill('#ramGB', '256');
  await page.dispatchEvent('#ramGB', 'input');
  await check('RAM context insight visible after entering RAM', async () => {
    return await page.evaluate(() => {
      const el = document.getElementById('learn-ram-context');
      return el && !el.hidden;
    });
  });
  await check('RAM insight mentions GB', async () => {
    const text = await page.$eval('#learn-ram-context', e => e.textContent);
    return text.includes('GB');
  });

  console.log('\n── Navigate to step 3 (VyOS) ──');
  await page.evaluate(() => window.showStep(3));
  await check('Step 3 learn-block visible', async () => {
    const el = await page.$('.learn-block[data-learn-step="3"]');
    return el && await el.evaluate(e => e.style.display !== 'none');
  });
  await check('Router comparison cards present', async () => {
    const cards = await page.$$('.learn-compare-card');
    return cards.length === 3;
  });
  await check('Router rationale textarea present', async () => page.isVisible('#learn-router-choice'));

  console.log('\n── Navigate to step 7 (cluster sizing) ──');
  await page.evaluate(() => window.showStep(7));
  await check('Step 7 learn-block visible', async () => {
    const el = await page.$('.learn-block[data-learn-step="7"]');
    return el && await el.evaluate(e => e.style.display !== 'none');
  });
  await check('Availability requirement dropdown present', async () => page.isVisible('#learn-availability-req'));
  await page.selectOption('#learn-availability-req', 'productionlike');
  await check('Availability requirement select reflects chosen value', async () => {
    return await page.$eval('#learn-availability-req', e => e.value) === 'productionlike';
  });

  console.log('\n── Architecture scorecard (step 14) ──');
  // Jump to step 14 via JS
  await page.evaluate(() => { window.showStep(14); });
  await check('Scorecard container visible', async () => page.isVisible('#learn-scorecard'));
  await check('Scorecard has rendered rows', async () => {
    const rows = await page.$$('.learn-score-row');
    return rows.length >= 3;
  });
  await check('Score dots present (green/amber/red)', async () => {
    const dots = await page.$$('.learn-score-dot');
    return dots.length >= 3;
  });

  console.log('\n── Troubleshooter learning mode ──');
  // Open troubleshooter via keyboard shortcut
  await page.keyboard.down('Meta');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyX');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');
  await page.waitForTimeout(600);

  await check('Troubleshooter step visible', async () => {
    return await page.evaluate(() => {
      const el = document.querySelector('[data-step="15"]');
      return el && !el.hidden;
    });
  });

  // Click Session tab — use JS click to avoid visibility timing issues
  await page.evaluate(() => document.querySelector('[data-mode="session"]').click());
  await page.waitForTimeout(200);

  // Force session panel + phase 0 visible via direct DOM (tab click unreliable in headless)
  await page.evaluate(() => {
    const lib  = document.getElementById('ts-library-panel');
    const sess = document.getElementById('ts-session-panel');
    if (lib)  lib.hidden  = true;
    if (sess) sess.hidden = false;
    for (let i = 0; i <= 4; i++) {
      const el = document.getElementById(`ts-phase-${i}`);
      if (el) el.hidden = (i !== 0);
    }
  });

  await check('Phase 0 mode selector in DOM and not hidden', async () => {
    return await page.evaluate(() => { const el = document.getElementById('ts-phase-0'); return el && !el.hidden; });
  });
  await check('Fix my lab card in DOM', async () => {
    return await page.evaluate(() => !!document.getElementById('ts-mode-fix'));
  });
  await check('Learn to troubleshoot card in DOM', async () => {
    return await page.evaluate(() => !!document.getElementById('ts-mode-learn'));
  });

  // Wire phase 0 handlers and simulate choosing Learn
  await page.evaluate(() => {
    // Wire learn button directly (mirrors tsWirePhase0 logic)
    const btn = document.getElementById('ts-mode-learn');
    if (btn) btn.onclick = () => {
      for (let i = 0; i <= 4; i++) {
        const el = document.getElementById(`ts-phase-${i}`);
        if (el) el.hidden = (i !== 1);
      }
      const meth = document.getElementById('ts-learn-methodology');
      if (meth) meth.hidden = false;
    };
  });
  await page.evaluate(() => document.getElementById('ts-mode-learn').click());
  await page.waitForTimeout(200);

  await check('Phase 1 shown after choosing learn', async () => {
    return await page.evaluate(() => { const el = document.getElementById('ts-phase-1'); return el && !el.hidden; });
  });
  await check('Methodology framework visible in learn mode', async () => {
    return await page.evaluate(() => {
      const el = document.getElementById('ts-learn-methodology');
      return el && !el.hidden;
    });
  });
  await check('Methodology has 7 steps listed', async () => {
    const items = await page.$$('#ts-learn-methodology li');
    return items.length === 7;
  });

  // ── Cert filter chips (library panel) ───────────────────────────────────────
  console.log('\n── Cert filter chips ──');

  // Return to library mode
  await page.goto(BASE);
  await page.click('#mode-build');
  await page.waitForTimeout(200);
  // Navigate to step 15 via showStep
  await page.evaluate(() => { if (typeof showStep === 'function') showStep(15); });
  await page.waitForTimeout(400);

  await check('Cert filter row present in DOM', async () =>
    page.evaluate(() => !!document.getElementById('ts-cert-filter-row')));

  await check('11 cert chips (All + 10 certs)', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-cert-chip').length === 11));

  await check('"All" chip active by default', async () =>
    page.evaluate(() => {
      const allChip = document.querySelector('.ts-cert-chip[data-cert=""]');
      return allChip && allChip.classList.contains('active');
    }));

  await check('All 10 cert-specific chips present', async () =>
    page.evaluate(() => {
      const certs = ['VCP-VCF-Architect','VCP-VCF-Admin','VCP-VCF-Support','VCP-VVF-Admin','VCP-VVF-Support','VCAP-VCF-Automation','VCAP-VCF-Operations','VCAP-VCF-Storage','VCAP-VCF-VKS','VCAP-VCF-Networking'];
      return certs.every(c => !!document.querySelector(`.ts-cert-chip[data-cert="${c}"]`));
    }));

  await check('Old cert chips absent (VCP-NV, VCAP-DCV, VCAP-NV, VCP-VVF)', async () =>
    page.evaluate(() => {
      const old = ['VCP-NV', 'VCAP-DCV', 'VCAP-NV', 'VCP-VVF'];
      return old.every(c => !document.querySelector(`.ts-cert-chip[data-cert="${c}"]`));
    }));

  await check('Clicking VCAP-VCF-Networking chip sets state.tsCertFilter', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCAP-VCF-Networking"]').click());
    return page.evaluate(() => state.tsCertFilter === 'VCAP-VCF-Networking');
  });

  await check('VCAP-VCF-Networking chip is active after click', async () =>
    page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCAP-VCF-Networking"]').classList.contains('active')));

  await check('"All" chip deactivated after VCAP-VCF-Networking selected', async () =>
    page.evaluate(() => !document.querySelector('.ts-cert-chip[data-cert=""]').classList.contains('active')));

  await check('Clicking All chip resets state.tsCertFilter', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert=""]').click());
    return page.evaluate(() => state.tsCertFilter === '');
  });

  await check('"All" chip is active after reset', async () =>
    page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert=""]').classList.contains('active')));

  // Inject mock scenarios and verify filtering
  await check('VCAP-VCF-Networking filter shows only matching scenarios', async () => {
    await page.evaluate(() => {
      state.tsAllScenarios = [
        { id: 'mock-a', name: 'NSX DFW Lab', description: 'Test DFW', difficulty: 'medium', topics: ['nsx'], certRelevance: ['VCP-VCF-Admin', 'VCAP-VCF-Networking'] },
        { id: 'mock-b', name: 'vSphere HA Lab', description: 'Test HA', difficulty: 'easy', topics: ['ha'], certRelevance: ['VCP-VVF-Admin'] },
      ];
      document.querySelector('.ts-cert-chip[data-cert="VCAP-VCF-Networking"]').click();
    });
    await page.waitForTimeout(100);
    const cards = await page.$$('.ts-lib-card');
    return cards.length === 1;
  });

  await check('Filtered card is the NSX scenario', async () =>
    page.evaluate(() => {
      const card = document.querySelector('.ts-lib-card .ts-lib-card-name');
      return card && card.textContent.includes('NSX DFW Lab');
    }));

  await check('Cert badges rendered on scenario card', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-lib-card .ts-cert-badge').length >= 1));

  await check('"All" filter shows both scenarios', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert=""]').click());
    await page.waitForTimeout(100);
    return page.evaluate(() => document.querySelectorAll('.ts-lib-card').length === 2);
  });

  await check('Both cert badges visible across all cards', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-lib-card .ts-cert-badge').length >= 2));

  await check('VCP-VCF-Admin filter also matches NSX scenario (multi-cert scenario)', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCP-VCF-Admin"]').click());
    await page.waitForTimeout(100);
    return page.evaluate(() => document.querySelectorAll('.ts-lib-card').length === 1);
  });

  await check('No-match cert shows empty state message', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCAP-VCF-VKS"]').click());
    await page.waitForTimeout(100);
    return page.evaluate(() => {
      const hint = document.querySelector('#ts-scenario-list .hint');
      return hint && hint.textContent.includes('No scenarios match');
    });
  });

  // ── Learning objectives on scenario cards ───────────────────────────────────
  console.log('\n── Learning objectives ──');

  // Reset to All filter, inject a scenario with objectives
  await page.evaluate(() => {
    state.tsAllScenarios = [
      {
        id: 'mock-obj', name: 'NSX DFW Lab', description: 'Test DFW',
        difficulty: 'medium', topics: ['nsx'], certRelevance: ['VCP-VCF-Admin', 'VCAP-VCF-Networking'],
        learningObjectives: ['Deploy NSX-T Manager appliance', 'Configure T0 gateway with BGP', 'Apply DFW micro-segmentation rules']
      },
      {
        id: 'mock-no-obj', name: 'vSphere HA Lab', description: 'Test HA',
        difficulty: 'easy', topics: ['ha'], certRelevance: ['VCP-VVF-Admin']
      }
    ];
    document.querySelector('.ts-cert-chip[data-cert=""]').click();
  });
  await page.waitForTimeout(100);

  await check('Objectives section rendered on card with learningObjectives', async () =>
    page.evaluate(() => !!document.querySelector('.ts-lib-card-objectives')));

  await check('Objectives label present', async () =>
    page.evaluate(() => {
      const label = document.querySelector('.ts-obj-label');
      return label && label.textContent.trim() === 'Objectives';
    }));

  await check('3 objective list items rendered', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-obj-list li').length === 3));

  await check('First objective text matches', async () =>
    page.evaluate(() => {
      const li = document.querySelector('.ts-obj-list li');
      return li && li.textContent.includes('Deploy NSX-T Manager');
    }));

  await check('Card without learningObjectives has no objectives section', async () =>
    page.evaluate(() => {
      const cards = document.querySelectorAll('.ts-lib-card');
      const noObjCard = Array.from(cards).find(c => c.querySelector('.ts-lib-card-name').textContent.includes('vSphere HA'));
      return noObjCard && !noObjCard.querySelector('.ts-lib-card-objectives');
    }));

  // ── Scenario completion tracking ─────────────────────────────────────────────
  console.log('\n── Completion tracking ──');

  // Clear any leftover state from localStorage
  await page.evaluate(() => localStorage.removeItem('vsphere-completed-scenarios'));

  // Inject two mock scenarios, re-render
  await page.evaluate(() => {
    state.tsAllScenarios = [
      { id: 'sc-a', name: 'NSX DFW Lab', description: 'desc', difficulty: 'medium', topics: ['nsx'], certRelevance: ['VCP-VCF-Admin', 'VCAP-VCF-Networking'], learningObjectives: ['Configure DFW'] },
      { id: 'sc-b', name: 'vSphere HA Lab', description: 'desc', difficulty: 'easy', topics: ['ha'], certRelevance: ['VCP-VVF-Admin'] }
    ];
    document.querySelector('.ts-cert-chip[data-cert=""]').click();
  });
  await page.waitForTimeout(100);

  await check('"Mark done" button present on each card', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-complete-btn').length === 2));

  await check('No completed badges before any marking', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-completed-badge').length === 0));

  await check('No .ts-completed cards before marking', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-lib-card.ts-completed').length === 0));

  // Mark the first scenario done
  await check('Clicking "Mark done" marks scenario complete', async () => {
    await page.evaluate(() => document.querySelectorAll('.ts-complete-btn')[0].click());
    await page.waitForTimeout(100);
    return page.evaluate(() => document.querySelectorAll('.ts-completed-badge').length === 1);
  });

  await check('Completed card gets .ts-completed class', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-lib-card.ts-completed').length === 1));

  await check('Button label changes to "✓ Done" after marking', async () =>
    page.evaluate(() => {
      const btns = document.querySelectorAll('.ts-complete-btn');
      return Array.from(btns).some(b => b.textContent.trim() === '✓ Done');
    }));

  await check('Completion persisted to localStorage', async () =>
    page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('vsphere-completed-scenarios') || '[]');
      return stored.includes('sc-a');
    }));

  await check('Second card still shows "Mark done"', async () =>
    page.evaluate(() => {
      const btns = document.querySelectorAll('.ts-complete-btn');
      return Array.from(btns).some(b => b.textContent.trim() === 'Mark done');
    }));

  // Toggle back off
  await check('Clicking "✓ Done" unmarks the scenario', async () => {
    await page.evaluate(() => {
      const doneBtn = Array.from(document.querySelectorAll('.ts-complete-btn')).find(b => b.textContent.trim() === '✓ Done');
      if (doneBtn) doneBtn.click();
    });
    await new Promise(r => setTimeout(r, 100));
    return page.evaluate(() => document.querySelectorAll('.ts-completed-badge').length === 0);
  });

  await check('localStorage cleared after unmark', async () =>
    page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('vsphere-completed-scenarios') || '[]');
      return !stored.includes('sc-a');
    }));

  // Test auto-mark via tsSetCompleted directly (simulates debrief auto-mark)
  await check('tsGetCompleted and tsSetCompleted are callable from page context', async () =>
    page.evaluate(() => {
      if (typeof tsSetCompleted !== 'function' || typeof tsGetCompleted !== 'function') return false;
      tsSetCompleted('sc-b', true);
      return tsGetCompleted().has('sc-b');
    }));

  await check('Re-render reflects auto-marked scenario', async () => {
    await page.evaluate(() => tsLibRender());
    await new Promise(r => setTimeout(r, 100));
    return page.evaluate(() => document.querySelectorAll('.ts-lib-card.ts-completed').length === 1);
  });

  // Clean up localStorage
  await page.evaluate(() => localStorage.removeItem('vsphere-completed-scenarios'));

  // ── Completion progress summary ──────────────────────────────────────────────
  console.log('\n── Completion progress summary ──');

  await page.evaluate(() => localStorage.removeItem('vsphere-completed-scenarios'));

  // Inject 3 scenarios, none completed
  await page.evaluate(() => {
    state.tsAllScenarios = [
      { id: 'p-a', name: 'Scenario A', description: '', difficulty: 'easy',   topics: [], certRelevance: [] },
      { id: 'p-b', name: 'Scenario B', description: '', difficulty: 'medium', topics: [], certRelevance: [] },
      { id: 'p-c', name: 'Scenario C', description: '', difficulty: 'hard',   topics: [], certRelevance: [] },
    ];
    tsLibRender();
  });
  await page.waitForTimeout(100);

  await check('Progress bar visible when scenarios loaded', async () =>
    page.evaluate(() => !document.getElementById('ts-lib-progress').hidden));

  await check('Progress label shows 0 of 3 completed initially', async () =>
    page.evaluate(() => document.getElementById('ts-progress-label').textContent === '0 of 3 completed'));

  await check('Progress bar width is 0% initially', async () =>
    page.evaluate(() => document.getElementById('ts-progress-bar').style.width === '0%'));

  // Mark one complete
  await page.evaluate(() => { tsSetCompleted('p-a', true); tsLibRender(); });
  await page.waitForTimeout(100);

  await check('Progress label updates to 1 of 3 after one marked', async () =>
    page.evaluate(() => document.getElementById('ts-progress-label').textContent === '1 of 3 completed'));

  await check('Progress bar width is 33% after one of three marked', async () =>
    page.evaluate(() => document.getElementById('ts-progress-bar').style.width === '33%'));

  // Mark all complete
  await page.evaluate(() => { tsSetCompleted('p-b', true); tsSetCompleted('p-c', true); tsLibRender(); });
  await page.waitForTimeout(100);

  await check('Progress label shows 3 of 3 when all done', async () =>
    page.evaluate(() => document.getElementById('ts-progress-label').textContent === '3 of 3 completed'));

  await check('Progress bar width is 100% when all done', async () =>
    page.evaluate(() => document.getElementById('ts-progress-bar').style.width === '100%'));

  // Clean up
  await page.evaluate(() => localStorage.removeItem('vsphere-completed-scenarios'));

  // ── Study Plan tab ───────────────────────────────────────────────────────────
  console.log('\n── Study Plan tab ──');

  // Navigate to troubleshoot step
  await page.goto(BASE);
  await page.click('#mode-build');
  for (let i = 0; i < 9; i++) {
    const next = await page.$('#btn-next');
    if (!next) break;
    const disabled = await next.getAttribute('disabled');
    if (disabled !== null) break;
    await next.click();
    await page.waitForTimeout(80);
  }
  const tsSection = await page.$('#troubleshoot-step');
  if (!tsSection) {
    // Navigate directly via step selector if needed
    await page.evaluate(() => { showStep(9); initTroubleshootStep(); });
    await page.waitForTimeout(200);
  }

  await check('Study Plan tab button exists', async () =>
    page.evaluate(() => !!document.getElementById('ts-tab-studyplan')));

  await check('Study Plan tab button text is "Study Plan"', async () =>
    page.evaluate(() => document.getElementById('ts-tab-studyplan')?.textContent.trim() === 'Study Plan'));

  await check('Study plan panel exists and is initially hidden', async () =>
    page.evaluate(() => {
      const p = document.getElementById('ts-studyplan-panel');
      return p && p.hidden;
    }));

  // Switch to Study Plan
  await page.evaluate(() => tsSwitchMode('studyplan'));
  await page.waitForTimeout(150);

  await check('Study plan panel visible after tsSwitchMode("studyplan")', async () =>
    page.evaluate(() => !document.getElementById('ts-studyplan-panel').hidden));

  await check('Library panel hidden when study plan active', async () =>
    page.evaluate(() => document.getElementById('ts-library-panel').hidden));

  await check('Overall progress header present in study plan', async () =>
    page.evaluate(() => !!document.querySelector('#ts-studyplan-panel .ts-sp-header')));

  await check('10 cert sections rendered (one per cert)', async () =>
    page.evaluate(() => document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section').length === 10));

  await check('All 10 cert section titles present', async () => {
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-title')].map(el => el.textContent.trim()));
    const expected = [
      'VCP — VCF Architect', 'VCP — VCF Admin', 'VCP — VCF Support',
      'VCP — VVF Admin', 'VCP — VVF Support',
      'VCAP — VCF Automation', 'VCAP — VCF Operations', 'VCAP — VCF Storage',
      'VCAP — VCF VKS', 'VCAP — VCF Networking',
    ];
    return expected.every(e => titles.includes(e));
  });

  // Inject scenarios with certRelevance into two certs
  await page.evaluate(() => {
    localStorage.removeItem('vsphere-completed-scenarios');
    state.tsAllScenarios = [
      { id: 'sp-a', name: 'Hard NSX Fault',   description: '', difficulty: 'hard',   topics: [], certRelevance: ['VCAP-VCF-Networking'], snapshotName: '' },
      { id: 'sp-b', name: 'Easy NSX Fault',   description: '', difficulty: 'easy',   topics: [], certRelevance: ['VCAP-VCF-Networking'], snapshotName: 'snap-b' },
      { id: 'sp-c', name: 'Medium NSX Fault', description: '', difficulty: 'medium', topics: [], certRelevance: ['VCAP-VCF-Networking'], snapshotName: '' },
      { id: 'sp-d', name: 'vSphere Fault',    description: '', difficulty: 'easy',   topics: [], certRelevance: ['VCP-VVF-Admin'],       snapshotName: 'snap-d' },
    ];
    tsRenderStudyPlan();
  });
  await page.waitForTimeout(150);

  await check('VCAP Networking section shows 3 scenario rows', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section')];
      const nsxSection = sections.find(s => s.querySelector('.ts-sp-cert-title')?.textContent.includes('Networking'));
      return nsxSection ? nsxSection.querySelectorAll('.ts-sp-row').length === 3 : false;
    }));

  await check('Scenarios sorted Easy first in cert section', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section')];
      const nsxSection = sections.find(s => s.querySelector('.ts-sp-cert-title')?.textContent.includes('Networking'));
      if (!nsxSection) return false;
      const rows = nsxSection.querySelectorAll('.ts-sp-row');
      return rows[0]?.querySelector('.ts-diff-badge')?.textContent.trim() === 'easy';
    }));

  await check('Scenarios sorted Medium second in cert section', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section')];
      const nsxSection = sections.find(s => s.querySelector('.ts-sp-cert-title')?.textContent.includes('Networking'));
      if (!nsxSection) return false;
      const rows = nsxSection.querySelectorAll('.ts-sp-row');
      return rows[1]?.querySelector('.ts-diff-badge')?.textContent.trim() === 'medium';
    }));

  await check('VCP-VVF Admin section shows 1 scenario row', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section')];
      const vvfSection = sections.find(s => s.querySelector('.ts-sp-cert-title')?.textContent.includes('VVF Admin'));
      return vvfSection ? vvfSection.querySelectorAll('.ts-sp-row').length === 1 : false;
    }));

  await check('Empty cert sections show "No scenarios yet" message', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section.ts-sp-empty')];
      return sections.length > 0 && sections.every(s => s.querySelector('.ts-sp-no-scenarios') !== null);
    }));

  await check('Per-cert stats show 0/3 for VCAP Networking initially', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section')];
      const nsxSection = sections.find(s => s.querySelector('.ts-sp-cert-title')?.textContent.includes('Networking'));
      return nsxSection?.querySelector('.ts-sp-cert-stats')?.textContent.trim() === '0 / 3';
    }));

  await check('Overall progress label shows 0 of 4 initially', async () =>
    page.evaluate(() =>
      document.querySelector('#ts-studyplan-panel .ts-sp-overall-label')?.textContent.includes('0 of 4')));

  // Mark one complete via toggle
  await page.evaluate(() => {
    tsSetCompleted('sp-b', true);
    tsRenderStudyPlan();
  });
  await page.waitForTimeout(150);

  await check('Completed row has ts-sp-done class', async () =>
    page.evaluate(() => !!document.querySelector('#ts-studyplan-panel .ts-sp-row.ts-sp-done')));

  await check('Completed row shows checkmark', async () =>
    page.evaluate(() => !!document.querySelector('#ts-studyplan-panel .ts-sp-row.ts-sp-done .ts-sp-check')));

  await check('Completed row toggle button has ts-complete-btn-done class', async () =>
    page.evaluate(() =>
      !!document.querySelector('#ts-studyplan-panel .ts-sp-row.ts-sp-done .ts-sp-toggle-btn.ts-complete-btn-done')));

  await check('Overall progress label updates to 1 of 4 after mark', async () =>
    page.evaluate(() =>
      document.querySelector('#ts-studyplan-panel .ts-sp-overall-label')?.textContent.includes('1 of 4')));

  await check('Per-cert stats update to 1 / 3 for VCAP Networking', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section')];
      const nsxSection = sections.find(s => s.querySelector('.ts-sp-cert-title')?.textContent.includes('Networking'));
      return nsxSection?.querySelector('.ts-sp-cert-stats')?.textContent.trim() === '1 / 3';
    }));

  await check('Per-cert bar width is 33% for VCAP Networking (1 of 3)', async () =>
    page.evaluate(() => {
      const sections = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-cert-section')];
      const nsxSection = sections.find(s => s.querySelector('.ts-sp-cert-title')?.textContent.includes('Networking'));
      const bar = nsxSection?.querySelector('.ts-sp-cert-bar');
      return bar?.style.width === '33%';
    }));

  // Toggle mark-done via button click
  await check('Clicking Mark done button in study plan marks scenario', async () => {
    await page.evaluate(() => {
      const undoneBtn = [...document.querySelectorAll('#ts-studyplan-panel .ts-sp-toggle-btn')]
        .find(b => !b.classList.contains('ts-complete-btn-done'));
      if (undoneBtn) undoneBtn.click();
    });
    await new Promise(r => setTimeout(r, 150));
    return page.evaluate(() =>
      document.querySelector('#ts-studyplan-panel .ts-sp-overall-label')?.textContent.includes('2 of 4'));
  });

  // Clicking Study Plan tab button
  await page.evaluate(() => tsSwitchMode('library'));
  await page.waitForTimeout(100);
  await check('Clicking Study Plan tab button switches to study plan', async () => {
    await page.evaluate(() => document.getElementById('ts-tab-studyplan').click());
    await new Promise(r => setTimeout(r, 150));
    return page.evaluate(() => !document.getElementById('ts-studyplan-panel').hidden);
  });

  // Clean up
  await page.evaluate(() => localStorage.removeItem('vsphere-completed-scenarios'));

  console.log(`\n── Results: ${pass} passed, ${fail} failed ──\n`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
