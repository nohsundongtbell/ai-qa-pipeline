import { defineConfig, devices } from '@playwright/test';
import { MAIN, ISO_API, ISO_UI } from './tests/helpers/env';

const server = (s: { port: number; db: string }) => ({
  command: 'node tests/helpers/start-server.js',
  url: `http://localhost:${s.port}/api/me`,
  env: { PORT: String(s.port), DB_PATH: s.db, SESSION_SECRET: 'test-secret' },
  reuseExistingServer: false,
  timeout: 30_000,
});

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    // test-results/는 실행마다 정리되므로 밖에 둔다 (scripts/report.js가 읽는다)
    ['json', { outputFile: 'test-report.json' }],
    ['junit', { outputFile: 'junit.xml' }], // GitLab의 테스트 결과 탭용
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [server(MAIN), server(ISO_API), server(ISO_UI)],
  projects: [
    {
      name: 'main',
      testIgnore: '**/*.iso.spec.ts',
      fullyParallel: true,
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${MAIN.port}` },
    },
    {
      // 전체 글 개수에 의존하는 API 테스트: 파일 1개라 순차 실행된다
      name: 'iso-api',
      testMatch: '**/api/*.iso.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${ISO_API.port}` },
    },
    {
      // 전체 글 개수에 의존하는 UI 테스트: 파일 1개라 순차 실행된다
      name: 'iso-ui',
      testMatch: '**/ui/*.iso.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${ISO_UI.port}` },
    },
  ],
});
