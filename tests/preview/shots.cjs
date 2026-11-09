// Capturas de tela da prévia (Puppeteer). Uso no contêiner zenika/alpine-chrome:with-puppeteer.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE || 'http://lo-web:8080/tests/preview/index.html';
const shots = JSON.parse(process.env.SHOTS);
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'], executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 1, isMobile: s.w < 600, hasTouch: s.w < 600 });
    if (s.dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    page.on('pageerror', (e) => console.log('pageerror', s.name, e.message));
    await page.goto(BASE + '#' + s.path, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.page h1, .auth h1', { timeout: 10000 }).catch(() => console.log('sem h1', s.name));
    await new Promise((r) => setTimeout(r, 500));
    if (s.click) { await page.click(s.click).catch((e) => console.log('click', e.message)); await new Promise((r) => setTimeout(r, 600)); }
    await page.screenshot({ path: `/out/${s.name}.png`, fullPage: !!s.full });
    console.log('ok', s.name);
    await page.close();
  }
  await browser.close();
})();
