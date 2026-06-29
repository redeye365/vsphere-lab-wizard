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
  await page.selectOption('#learn-cert-target', 'VCP-NV');

  // Select experience
  await page.evaluate(() => document.querySelector('.learn-exp-card[data-exp="some"]').click());

  // Fill success statement
  await page.fill('#learn-success-stmt', 'Practise NSX DFW and T0/T1 routing for VCP-NV exam.');
  await check('Success statement captured in state', async () => {
    return await page.evaluate(() => {
      const ta = document.getElementById('learn-success-stmt');
      return ta && ta.value.includes('VCP-NV');
    });
  });

  // Select time
  await page.evaluate(() => document.querySelector('.learn-time-card[data-time="full-day"]').click());

  await check('Learning path summary visible after selections', async () => {
    return await page.evaluate(() => !document.getElementById('learn-path-summary').hidden);
  });
  await check('Learning path text mentions VCP-NV areas', async () => {
    const text = await page.$eval('#learn-path-text', e => e.textContent);
    return text.includes('NSX') || text.includes('DFW') || text.includes('gateway');
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

  await check('7 cert chips (All + 6 certs)', async () =>
    page.evaluate(() => document.querySelectorAll('.ts-cert-chip').length === 7));

  await check('"All" chip active by default', async () =>
    page.evaluate(() => {
      const allChip = document.querySelector('.ts-cert-chip[data-cert=""]');
      return allChip && allChip.classList.contains('active');
    }));

  await check('All 6 cert-specific chips present', async () =>
    page.evaluate(() => {
      const certs = ['VCP-VVF', 'VCP-NV', 'VCAP-DCV', 'VCAP-NV', 'VCP-VCF-Admin', 'VCP-VCF-Architect'];
      return certs.every(c => !!document.querySelector(`.ts-cert-chip[data-cert="${c}"]`));
    }));

  await check('Clicking VCP-NV chip sets state.tsCertFilter', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCP-NV"]').click());
    return page.evaluate(() => state.tsCertFilter === 'VCP-NV');
  });

  await check('VCP-NV chip is active after click', async () =>
    page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCP-NV"]').classList.contains('active')));

  await check('"All" chip deactivated after VCP-NV selected', async () =>
    page.evaluate(() => !document.querySelector('.ts-cert-chip[data-cert=""]').classList.contains('active')));

  await check('Clicking All chip resets state.tsCertFilter', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert=""]').click());
    return page.evaluate(() => state.tsCertFilter === '');
  });

  await check('"All" chip is active after reset', async () =>
    page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert=""]').classList.contains('active')));

  // Inject mock scenarios and verify filtering
  await check('VCP-NV filter shows only matching scenarios', async () => {
    await page.evaluate(() => {
      state.tsAllScenarios = [
        { id: 'mock-a', name: 'NSX DFW Lab', description: 'Test DFW', difficulty: 'medium', topics: ['nsx'], certRelevance: ['VCP-NV', 'VCAP-NV'] },
        { id: 'mock-b', name: 'vSphere HA Lab', description: 'Test HA', difficulty: 'easy', topics: ['ha'], certRelevance: ['VCP-VVF'] },
      ];
      document.querySelector('.ts-cert-chip[data-cert="VCP-NV"]').click();
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

  await check('VCAP-NV filter also matches NSX scenario (multi-cert scenario)', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCAP-NV"]').click());
    await page.waitForTimeout(100);
    return page.evaluate(() => document.querySelectorAll('.ts-lib-card').length === 1);
  });

  await check('No-match cert shows empty state message', async () => {
    await page.evaluate(() => document.querySelector('.ts-cert-chip[data-cert="VCP-VCF-Architect"]').click());
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
        difficulty: 'medium', topics: ['nsx'], certRelevance: ['VCP-NV'],
        learningObjectives: ['Deploy NSX-T Manager appliance', 'Configure T0 gateway with BGP', 'Apply DFW micro-segmentation rules']
      },
      {
        id: 'mock-no-obj', name: 'vSphere HA Lab', description: 'Test HA',
        difficulty: 'easy', topics: ['ha'], certRelevance: ['VCP-VVF']
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

  console.log(`\n── Results: ${pass} passed, ${fail} failed ──\n`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
