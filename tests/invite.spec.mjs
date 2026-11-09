import { test, expect } from '@playwright/test';

// Базу Supabase в тестах подменяем: настоящие ответы гостей не трогаем.
async function setup(page, { rsvp = 'ok' } = {}) {
  const errors = [];
  const sent = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/supabase\.co\/rest\/v1\/rpc\/submit_rsvp/, async r => {
    sent.push(new URLSearchParams(r.request().postData() || ''));
    if (rsvp === 'fail') return r.abort('failed');
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return { errors, sent };
}

async function openEnvelope(page) {
  await page.click('#seal');
  await expect(page.locator('#veil')).toBeHidden({ timeout: 6000 });
}

async function scrollToEl(page, sel, frac = 0) {
  await page.evaluate(([s, f]) => {
    const el = document.querySelector(s);
    const top = el.getBoundingClientRect().top + scrollY;
    window.scrollTo({ top: top + f * Math.max(0, el.offsetHeight - innerHeight), behavior: 'instant' });
  }, [sel, frac]);
  await page.waitForTimeout(300);
}

test.describe('Приглашение', () => {
  test('открывается без ошибок, конверт на месте', async ({ page }) => {
    const { errors } = await setup(page);
    await page.goto('/');
    await expect(page).toHaveTitle('Сказка до полуночи');
    await expect(page.locator('#seal')).toBeVisible();
    await expect(page.locator('.letter')).toContainText('ДМИТРИЙ');
    await expect(page.locator('.letter')).toContainText('АРИНА');
    await expect(page.locator('body')).toHaveClass(/locked/);
    expect(errors).toEqual([]);
  });

  test('печать открывает конверт и всегда показывает начало', async ({ page }) => {
    const { errors } = await setup(page);
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 99999));
    await openEnvelope(page);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.locator('body')).not.toHaveClass(/locked/);
    await expect(page.locator('#music')).toBeVisible();
    await expect(page.locator('#castle .eyebrow')).toHaveText('Свадебное приглашение');
    expect(errors).toEqual([]);
  });

  test('тексты заказчика на месте', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    const text = await page.locator('main').innerText();
    for (const s of [
      '31.07.2027', 'Вы в их числе', 'приглашаем Вас разделить',
      'Банкетный зал «Весенний»', 'Санкт-Петербург, набережная реки Фонтанки, 108',
      '16:30', 'Сбор гостей в банкетном зале и фуршет', '17:00', 'Выездная церемония', '17:45', 'до 23:00',
      'Дресс-код свободный', 'за исключением мужских чёрных костюмов',
      'денежный вклад', 'прекрасного шоколада',
      'С радостью буду', 'К сожалению, не смогу',
    ]) expect(text).toContain(s);
    await expect(page.locator('input[name=go]')).toHaveCount(2);
  });

  test('«Вы» везде с большой буквы', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    const text = await page.evaluate(() => document.body.innerText);
    const lower = text.match(/(?<![А-Яа-яЁё])(вы|вас|вам|вами|ваш[а-яё]*)(?![А-Яа-яЁё])/g) || [];
    expect(lower).toEqual([]);
  });

  test('имена помещаются в строку, по горизонтали ничего не вылезает', async ({ page }) => {
    await setup(page);
    for (const width of [320, 390, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const r = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        names: [...document.querySelectorAll('.split')].filter(e => /[А-Я]{4}/.test(e.getAttribute('aria-label')))
          .map(e => { const lh = parseFloat(getComputedStyle(e).fontSize) * 1.5; return { name: e.getAttribute('aria-label'), oneLine: e.getBoundingClientRect().height < lh }; }),
      }));
      expect(r.overflow, `ширина ${width}`).toBeLessThanOrEqual(0);
      for (const n of r.names) expect(n.oneLine, `${n.name} при ширине ${width}`).toBe(true);
    }
  });

  test('двери открываются при прокрутке, тайминг загорается', async ({ page }) => {
    const { errors } = await setup(page);
    await page.goto('/');
    await openEnvelope(page);
    await scrollToEl(page, '#hall', 0);
    expect(+(await page.locator('#stage').evaluate(e => e.style.getPropertyValue('--d') || 0))).toBeLessThan(0.1);
    await scrollToEl(page, '#hall', 0.9);
    await expect.poll(() => page.locator('#stage').evaluate(e => +e.style.getPropertyValue('--d'))).toBeGreaterThan(0.95);
    await expect(page.locator('#hallcard')).toHaveClass(/in/);
    await scrollToEl(page, '#timing', 1);
    await page.evaluate(() => window.scrollBy(0, 400));
    await expect(page.locator('.ev.lit')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('анкета: без имени не отправляется, с именем уходит в базу', async ({ page }) => {
    const { sent } = await setup(page);
    await page.goto('/');
    await openEnvelope(page);
    await scrollToEl(page, '#rsvp');
    await page.click('#f .btn');
    await page.waitForTimeout(300);
    expect(sent).toHaveLength(0);
    await expect(page.locator('#thanks')).toBeHidden();

    await page.fill('#nm', 'Анна Петрова');
    await page.check('#go3');
    await page.check('#d2');
    await page.click('#f .btn');
    await expect(page.locator('#thanks')).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].get('name')).toBe('Анна Петрова');
    expect(sent[0].get('attend')).toBe('no');
    expect(sent[0].get('drinks')).toBe('Шампанское');
  });

  test('анкета: при ошибке сети гость видит сообщение и может повторить', async ({ page }) => {
    await setup(page, { rsvp: 'fail' });
    await page.goto('/');
    await openEnvelope(page);
    await scrollToEl(page, '#rsvp');
    await page.fill('#nm', 'Сергей Иванов');
    await page.click('#f .btn');
    await expect(page.locator('#rsvpErr')).toBeVisible();
    await expect(page.locator('#f .btn')).toBeEnabled();
    await expect(page.locator('#thanks')).toBeHidden();
  });

  test('обратный отсчёт идёт', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    const days = await page.locator('#cd').innerText();
    expect(+days).toBeGreaterThan(0);
    const s1 = await page.locator('#csec').innerText();
    await page.waitForTimeout(1300);
    expect(await page.locator('#csec').innerText()).not.toBe(s1);
  });

  test('на «Деталях» падают «Киндеры», потом перестают', async ({ page }) => {
    await setup(page);
    await page.goto('/');
    await openEnvelope(page);
    await scrollToEl(page, '#details');
    await expect.poll(() => page.locator('#candyfall img.candy').count(), { timeout: 4000 }).toBeGreaterThan(0);
    const ok = await page.locator('#candyfall img.candy').first().evaluate(img => img.complete && img.naturalWidth > 0);
    expect(ok).toBe(true);
    await scrollToEl(page, '#castle');
    await page.waitForTimeout(10000);
    expect(await page.locator('#candyfall img.candy').count()).toBe(0);
  });

  test('без анимаций (настройка «уменьшить движение») всё видно сразу', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const { errors } = await setup(page);
    await page.goto('/');
    await page.click('#seal');
    await expect(page.locator('#veil')).toBeHidden({ timeout: 5000 });
    const hidden = await page.evaluate(() => [...document.querySelectorAll('.rv,.w,.sheet')].filter(e => getComputedStyle(e).opacity === '0').length);
    expect(hidden).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('Админ-страница', () => {
  const rows = [
    { id: 1, name: 'Анна Петрова', attend: true, drinks: 'Вино, Шампанское', updated_at: '2026-11-09T10:12:00Z' },
    { id: 2, name: 'Ольга Смирнова', attend: false, drinks: '', updated_at: '2026-11-08T18:05:00Z' },
    { id: 3, name: 'Михаил Кузнецов', attend: true, drinks: 'Без алкоголя', updated_at: '2026-11-08T15:22:00Z' },
  ];
  async function mockAdmin(page) {
    const deleted = [];
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.route(/supabase\.co\/rest\/v1\/rpc\/admin_/, async r => {
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.pass !== 'тест') return r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"wrong password"}' });
      if (r.request().url().includes('admin_delete')) { deleted.push(body.rid); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.filter(x => !deleted.includes(x.id))) });
    });
    return deleted;
  }

  test('неверный пароль не пускает', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/admin.html');
    await page.fill('#pw', 'не тот');
    await page.click('#lf button');
    await expect(page.locator('#lerr')).toHaveText('Неверный пароль');
    await expect(page.locator('#app')).toBeHidden();
  });

  test('показывает гостей, считает и удаляет', async ({ page }) => {
    const deleted = await mockAdmin(page);
    await page.goto('/admin.html');
    await page.fill('#pw', 'тест');
    await page.click('#lf button');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#cYes')).toHaveText('2');
    await expect(page.locator('#cNo')).toHaveText('1');
    await expect(page.locator('#cAll')).toHaveText('3');
    await expect(page.locator('#drinks')).toContainText('Вино 1');
    await page.fill('#q', 'ольга');
    await expect(page.locator('.row')).toHaveCount(1);
    await page.fill('#q', '');
    await page.click('[data-f=yes]');
    await expect(page.locator('.row')).toHaveCount(2);
    await page.click('[data-f=all]');
    const del = page.locator('.row', { hasText: 'Ольга' }).locator('.del');
    await del.click();
    await expect(del).toHaveText('Удалить?');
    await del.click();
    await expect(page.locator('.row')).toHaveCount(2);
    expect(deleted).toEqual([2]);
  });
});
