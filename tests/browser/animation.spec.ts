import { expect, test, type Locator, type Page } from '@playwright/test';

import { transparentAnimation } from '@/tests/browser/fixtures/animation';

const red = [255, 0, 0, 255, 255, 0, 0, 255];
const cleared = [0, 0, 0, 0, 0, 0, 255, 255];
const translucent = [0, 255, 0, 128, 0, 255, 0, 128];

async function readPixels(canvas: Locator) {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) { throw new Error('Canvas not found'); }
    const context = element.getContext('2d');
    if (!context) { throw new Error('Canvas context not found'); }
    return Array.from(context.getImageData(0, 0, element.width, element.height).data);
  });
}

async function seek(page: Page, time: number) {
  const progress = page.locator('[data-dynamic-side="left"]');
  await progress.evaluate((element, value) => {
    // 绕过 React 的值追踪器，以真实 input 事件触发受控进度条更新。
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(time));
}

test.beforeEach(async({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'en'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '中', exact: true })).toBeVisible();
});

test('replaces transparent and translucent pixels when seeking in either direction', async({ page }) => {
  await page.locator('input[type="file"]').first().setInputFiles(transparentAnimation());
  const canvas = page.locator('canvas[aria-label="A"]');
  await expect.poll(() => readPixels(canvas)).toEqual(red);

  for (const [time, expected] of [[1.5, cleared], [2.5, translucent], [0, red], [2.5, translucent], [1.5, cleared]] as const) {
    await seek(page, time);
    await expect.poll(() => readPixels(canvas)).toEqual(expected);
  }
});

test('clears disposed pixels during playback', async({ page }) => {
  await page.locator('input[type="file"]').first().setInputFiles(transparentAnimation());
  const canvas = page.locator('canvas[aria-label="A"]');
  await expect.poll(() => readPixels(canvas)).toEqual(red);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => readPixels(canvas), { intervals: [50] }).toEqual(cleared);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(() => readPixels(canvas)).toEqual(cleared);
});

test('replaces the first frame when a new animation reuses the display canvas', async({ page }) => {
  await page.locator('input[type="file"]').first().setInputFiles(transparentAnimation());
  const canvas = page.locator('canvas[aria-label="A"]');
  await expect.poll(() => readPixels(canvas)).toEqual(red);
  const originalCanvas = await canvas.elementHandle();
  const replacement = transparentAnimation({ translucentFirstFrame: true });
  const dataTransfer = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(bytes)], 'replacement.apng', { type: 'image/apng' }));
    return transfer;
  }, [...replacement.buffer]);
  try {
    await canvas.dispatchEvent('drop', { dataTransfer });
    await expect.poll(() => readPixels(canvas)).toEqual(translucent);
    expect(await originalCanvas!.evaluate((element) => element.isConnected)).toBe(true);
  } finally {
    await dataTransfer.dispose();
    await originalCanvas?.dispose();
  }
});

test('keeps paused first and later frames ready when switching languages on both panels', async({ page }) => {
  await page.locator('input[type="file"]').first().setInputFiles(transparentAnimation());
  await expect.poll(() => readPixels(page.locator('canvas[aria-label="A"]'))).toEqual(red);
  await page.locator('input[type="file"]').first().setInputFiles(transparentAnimation());
  const canvases = [page.locator('canvas[aria-label="A"]'), page.locator('canvas[aria-label="B"]')];

  for (const [time, expected] of [[0, red], [2.5, translucent]] as const) {
    await seek(page, time);
    for (const canvas of canvases) {
      await expect.poll(() => readPixels(canvas)).toEqual(expected);
    }
    await expect(page.getByText('Processing...', { exact: true })).toHaveCount(0);

    for (const language of ['中', 'EN']) {
      await page.getByRole('button', { name: language, exact: true }).click();
      // 超过遮罩的延迟展示及最短展示时间，捕获延迟出现的卡死遮罩。
      await page.waitForTimeout(750);
      await expect(page.getByText(/^(Processing|正在处理)\.\.\.$/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^(Play|播放)$/ })).toHaveCount(2);
      await expect(page.locator('[data-dynamic-side="left"]')).toHaveValue(String(time));
      await expect(page.locator('[data-dynamic-side="right"]')).toHaveValue(String(time));
      for (const canvas of canvases) {
        expect(await readPixels(canvas)).toEqual(expected);
      }
    }
  }
});

test('uses the latest error callback after switching languages', async({ page }) => {
  await page.locator('input[type="file"]').first().setInputFiles(transparentAnimation({ corruptLastFrame: true }));
  await expect.poll(() => readPixels(page.locator('canvas[aria-label="A"]'))).toEqual(red);
  await page.getByRole('button', { name: '中', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await seek(page, 2.5);

  await expect(page.getByText('动图解码失败，已保留原媒体', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(page.getByText('正在处理...', { exact: true })).toHaveCount(0);
});
