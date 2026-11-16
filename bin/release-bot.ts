#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { getEnvironmentOptions, GitHubClient, ReleaseBot, ReportFormatter } from '..';

async function run(): Promise<void> {
  const { token, ...options } = getEnvironmentOptions(process.env, new Date());
  const sleep = async(ms: number): Promise<void> => {
    await setTimeout(ms);
  };
  const bot = new ReleaseBot({
    ...options,
    client: new GitHubClient({ token, sleep, apiUrl: process.env.GITHUB_API_URL }),
    sleep,
    logger: message => process.stderr.write(`${message}\n`),
  });
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
