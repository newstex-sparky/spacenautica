const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const screenshotDir = path.join(__dirname, 'screenshots', 'm2');
    fs.mkdirSync(screenshotDir, { recursive: true });

    console.log('🚀 Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    // Collect console messages and errors
    const consoleMessages = [];
    const consoleErrors = [];
    page.on('console', msg => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });
    page.on('pageerror', err => {
        consoleErrors.push(`PAGE ERROR: ${err.message}`);
    });

    console.log('📄 Navigating to game...');
    await page.goto('http://127.0.0.1:8000/index.html', { waitUntil: 'networkidle', timeout: 15000 });

    // Wait for Three.js to initialize
    await page.waitForTimeout(3000);

    // Screenshot 1: Main game view (M1 survival)
    console.log('📸 Screenshot 1: Main game view...');
    await page.screenshot({ path: path.join(screenshotDir, '01_main_game.png'), fullPage: false });
    console.log('  ✅ Saved 01_main_game.png');

    // Screenshot 2: Open station builder (press B)
    console.log('📸 Screenshot 2: Opening station builder (press B)...');
    await page.keyboard.press('b');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '02_builder_menu.png'), fullPage: false });
    console.log('  ✅ Saved 02_builder_menu.png');

    // Screenshot 3: Module selection (press 1 for Habitat)
    console.log('📸 Screenshot 3: Module selection (press 1)...');
    await page.keyboard.press('1');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '03_module_selection.png'), fullPage: false });
    console.log('  ✅ Saved 03_module_selection.png');

    // Screenshot 4: Select Smelter (press 2)
    console.log('📸 Screenshot 4: Smelter selection (press 2)...');
    await page.keyboard.press('2');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '04_smelter_selection.png'), fullPage: false });
    console.log('  ✅ Saved 04_smelter_selection.png');

    // Screenshot 5: Move ghost module with WASD
    console.log('📸 Screenshot 5: Moving ghost module (WASD)...');
    await page.keyboard.press('1'); // Back to Habitat
    await page.waitForTimeout(200);
    for (let i = 0; i < 5; i++) {
        await page.keyboard.press('w');
        await page.waitForTimeout(100);
    }
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('d');
        await page.waitForTimeout(100);
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '05_ghost_moved.png'), fullPage: false });
    console.log('  ✅ Saved 05_ghost_moved.png');

    // Screenshot 6: Select Refinery (press 3) and show cost
    console.log('📸 Screenshot 6: Refinery cost display (press 3)...');
    await page.keyboard.press('3');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '06_refinery_cost.png'), fullPage: false });
    console.log('  ✅ Saved 06_refinery_cost.png');

    // Screenshot 7: Select Solar (press 4)
    console.log('📸 Screenshot 7: Solar panel selection (press 4)...');
    await page.keyboard.press('4');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '07_solar_selection.png'), fullPage: false });
    console.log('  ✅ Saved 07_solar_selection.png');

    // Screenshot 8: Select Comms Array (press 6)
    console.log('📸 Screenshot 8: Comms Array selection (press 6)...');
    await page.keyboard.press('6');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '08_comms_selection.png'), fullPage: false });
    console.log('  ✅ Saved 08_comms_selection.png');

    // Screenshot 9: Exit builder (press B to toggle off)
    console.log('📸 Screenshot 9: Exit builder (press B)...');
    await page.keyboard.press('b');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '09_builder_closed.png'), fullPage: false });
    console.log('  ✅ Saved 09_builder_closed.png');

    // Print console messages
    console.log('\n📋 CONSOLE MESSAGES:');
    consoleMessages.forEach(msg => console.log(`  ${msg}`));

    // Print errors
    console.log('\n❌ CONSOLE ERRORS:');
    if (consoleErrors.length === 0) {
        console.log('  None — no JavaScript errors detected!');
    } else {
        consoleErrors.forEach(err => console.log(`  ${err}`));
    }

    // List screenshots
    console.log('\n📸 SCREENSHOTS CAPTURED:');
    const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png'));
    files.forEach(f => {
        const stat = fs.statSync(path.join(screenshotDir, f));
        console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
    });
    console.log(`\nTotal: ${files.length} screenshots in ${screenshotDir}`);

    await browser.close();
    console.log('\n✅ Done!');
})();