#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import { getEnvironmentOptions, GitHubClient, ReleaseBot, ReportFormatter } from '..';

const MAX_RETRIES = 3;

async function run(): Promise<void> {
  const { token, ...options } = getEnvironmentOptions(process.env, new Date());
  const logger = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const octokit = new (Octokit.plugin(throttling))({
    auth: token,
    ...process.env.GITHUB_API_URL ? { baseUrl: process.env.GITHUB_API_URL } : {},
    userAgent: 'CyclopsMC-ReleaseBot',
    // Failed requests are logged as errors, but 404s are expected, and other failures end up in the report
    log: { debug: () => {}, info: () => {}, warn: logger, error: () => {} },
    throttle: {
      onRateLimit: (retryAfter, requestOptions, client, retryCount) => {
        logger(`Rate limit hit for ${requestOptions.method} ${requestOptions.url}, retrying after ${retryAfter} seconds`);
        return retryCount < MAX_RETRIES;
      },
      onSecondaryRateLimit: (retryAfter, requestOptions, client, retryCount) => {
        logger(`Secondary rate limit hit for ${requestOptions.method} ${requestOptions.url}, retrying after ${retryAfter} seconds`);
        return retryCount < MAX_RETRIES;
      },
    },
  });
  const bot = new ReleaseBot({ ...options, client: new GitHubClient(octokit), logger });
  const report = await bot.run();
  const summary = new ReportFormatter().format(report);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
