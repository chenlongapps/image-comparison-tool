import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'en-US',
    serviceWorkers: 'block',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  // 使用已构建的静态导出，不启动或占用开发服务器。
  webServer: {
    command: 'npm run start -- --listen tcp://127.0.0.1:4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false
  }
});
