import { test, expect } from '@playwright/test';

// Бюджет плавности: процессор замедлен в 2 раза (как у недорогого телефона).
// До оптимизации экран с замком давал ~18 кадров/с и ~2 с подвисаний за 3 с.
test.describe('Плавность', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'замер работает только в Chromium');
  });

  async function frames(page, fn) {
    await page.evaluate(() => { window.__f = []; window.__lt = 0; });
    await fn();
    return page.evaluate(() => {
      const f = window.__f.slice(1), avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
      return { fps: 1000 / avg, janky: f.filter(x => x > 50).length / Math.max(1, f.length), longMs: window.__lt };
    });
  }

  test('замок в простое и прокрутка до конца без подвисаний', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.route(/supabase\.co/, r => r.fulfill({ status: 200, body: '{"ok":true}' }));
    await page.addInitScript(() => {
      window.__f = []; window.__lt = 0; let last = performance.now();
      const tick = t => { window.__f.push(t - last); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      new PerformanceObserver(l => l.getEntries().forEach(e => { window.__lt += e.duration; })).observe({ type: 'longtask', buffered: true });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
    await page.goto('/');
    await page.click('#seal');
    await page.waitForTimeout(4000);

    const idle = await frames(page, () => page.waitForTimeout(3000));
    console.log('замок:', JSON.stringify(idle));
    expect(idle.fps, 'кадров в секунду на экране с замком').toBeGreaterThan(35);
    expect(idle.longMs, 'подвисаний за 3 секунды, мс').toBeLessThan(400);

    const scroll = await frames(page, async () => {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += 120) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
      await page.waitForTimeout(500);
    });
    console.log('прокрутка:', JSON.stringify(scroll));
    expect(scroll.janky, 'доля рывков при прокрутке').toBeLessThan(0.1);
    expect(scroll.longMs, 'подвисаний при прокрутке, мс').toBeLessThan(1000);
  });
});
