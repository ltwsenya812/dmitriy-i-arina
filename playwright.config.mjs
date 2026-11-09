import { defineConfig, devices } from '@playwright/test';

// Сайт статический: тесты поднимают простой локальный сервер из tests/serve.mjs.
// Замер плавности идёт отдельным проектом после остальных тестов, чтобы параллельные тесты не сбивали цифры.
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173/', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/serve.mjs 4173', url: 'http://127.0.0.1:4173/', reuseExistingServer: true },
  projects: [
    { name: 'телефон', testIgnore: /perf\.spec/, use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'компьютер', testIgnore: /perf\.spec/, use: { viewport: { width: 1366, height: 820 } } },
    { name: 'плавность', testMatch: /perf\.spec/, dependencies: ['телефон', 'компьютер'], use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
