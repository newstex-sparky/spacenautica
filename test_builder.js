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

    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(err.message));

    console.log('📄 Navigating to game...');
    await page.goto('http://127.0.0.1:8000/index.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Screenshot 1: Main game
    console.log('📸 1: Main game...');
    await page.screenshot({ path: path.join(screenshotDir, '01_main_game.png') });

    // Extract DOM content before pressing B
    const domBefore = await page.evaluate(() => {
        const menu = document.getElementById('station-builder-menu');
        return {
            menuExists: !!menu,
            menuDisplay: menu ? menu.style.display : 'N/A',
            menuInnerHTML: menu ? menu.innerHTML.substring(0, 200) : 'N/A',
            ironDisplay: document.getElementById('iron-display')?.textContent,
            iceDisplay: document.getElementById('ice-display')?.textContent,
        };
    });
    console.log('DOM before B:', JSON.stringify(domBefore, null, 2));

    // Press B to open builder
    console.log('📸 2: Opening builder (B)...');
    await page.keyboard.press('b');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '02_builder_menu.png') });

    // Extract DOM content after pressing B
    const domAfter = await page.evaluate(() => {
        const menu = document.getElementById('station-builder-menu');
        const btns = document.querySelectorAll('.module-select-btn');
        const btnInfo = Array.from(btns).map(b => ({
            text: b.textContent.replace(/\s+/g, ' ').trim(),
            module: b.dataset.module,
        }));
        return {
            menuExists: !!menu,
            menuDisplay: menu ? menu.style.display : 'N/A',
            moduleButtons: btnInfo,
            costText: document.getElementById('cost-text')?.innerHTML,
            placementStatus: document.getElementById('placement-status')?.textContent,
            ironDisplay: document.getElementById('iron-display')?.textContent,
            iceDisplay: document.getElementById('ice-display')?.textContent,
        };
    });
    console.log('DOM after B:', JSON.stringify(domAfter, null, 2));

    // Press 1 for Habitat
    console.log('📸 3: Habitat (1)...');
    await page.keyboard.press('1');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '03_habitat.png') });

    // Press 3 for Refinery
    console.log('📸 4: Refinery (3)...');
    await page.keyboard.press('3');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '04_refinery.png') });

    // Move ghost with WASD
    console.log('📸 5: Move ghost (WASD)...');
    await page.keyboard.press('1');
    for (let i = 0; i < 5; i++) await page.keyboard.press('w');
    for (let i = 0; i < 3; i++) await page.keyboard.press('d');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '05_ghost_moved.png') });

    // Close builder
    console.log('📸 6: Close builder (B)...');
    await page.keyboard.press('b');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '06_closed.png') });

    // Errors
    console.log('\n❌ JS Errors:', consoleErrors.length ? consoleErrors : 'None');

    // File listing
    console.log('\n📸 Screenshots:');
    fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png')).forEach(f => {
        const s = fs.statSync(path.join(screenshotDir, f));
        console.log(`  ${f} (${(s.size/1024).toFixed(1)} KB)`);
    });

    await browser.close();
    console.log('\n✅ Done!');
})();