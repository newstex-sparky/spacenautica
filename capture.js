const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const dir = path.join(__dirname, 'screenshots', 'm2');
    fs.mkdirSync(dir, { recursive: true });

    console.log('🚀 Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('http://127.0.0.1:8000/index.html', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);

    // 1. Main game
    await page.screenshot({ path: path.join(dir, '01_main_game.png') });
    console.log('✅ 01_main_game.png');

    // 2. Open builder
    await page.keyboard.press('b');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(dir, '02_builder_menu.png') });

    // Verify button count
    const btnCount = await page.evaluate(() => document.querySelectorAll('.module-select-btn').length);
    console.log(`✅ 02_builder_menu.png (buttons: ${btnCount})`);

    // 3. Habitat
    await page.keyboard.press('1');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, '03_habitat.png') });
    console.log('✅ 03_habitat.png');

    // 4. Refinery
    await page.keyboard.press('3');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, '04_refinery.png') });
    console.log('✅ 04_refinery.png');

    // 5. Move ghost
    await page.keyboard.press('1');
    for (let i = 0; i < 5; i++) await page.keyboard.press('w');
    for (let i = 0; i < 3; i++) await page.keyboard.press('d');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, '05_ghost_moved.png') });
    console.log('✅ 05_ghost_moved.png');

    // 6. Close
    await page.keyboard.press('b');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dir, '06_closed.png') });
    console.log('✅ 06_closed.png');

    console.log(`\n❌ JS Errors: ${errors.length ? errors : 'None'}`);
    await browser.close();
    console.log('✅ Done!');
})();