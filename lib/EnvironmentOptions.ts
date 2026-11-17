import type { IReleaseBotOptions } from './ReleaseBot';

/**
 * The release bot options that can be configured via environment variables.
 */
export type IEnvironmentOptions = Omit<IReleaseBotOptions, 'client' | 'logger'> & { token: string };

/**
 * Determine the release bot options from environment variables.
 * Dry-run mode is enabled unless RELEASE_BOT_DRY_RUN is set to 'false'.
 * @param env The environment variables.
 * @param now The current time.
 * @return The options.
 */
export function getEnvironmentOptions(env: Record<string, string | undefined>, now: Date): IEnvironmentOptions {
  const get = (name: string): string | undefined => env[name] === '' ? undefined : env[name];
  const token = get('GITHUB_TOKEN');
  const repositories = get('RELEASE_BOT_REPOSITORIES');
  if (!token) {
    throw new Error('The GITHUB_TOKEN environment variable must be set');
  }
  return {
    token,
    organization: get('RELEASE_BOT_ORGANIZATION') ?? 'CyclopsMC',
    dryRun: get('RELEASE_BOT_DRY_RUN') !== 'false',
    now,
    notBefore: parseDate('RELEASE_BOT_NOT_BEFORE', get('RELEASE_BOT_NOT_BEFORE')),
    lookbackDays: parseNumber('RELEASE_BOT_LOOKBACK_DAYS', get('RELEASE_BOT_LOOKBACK_DAYS'), 14),
    settleMinutes: parseNumber('RELEASE_BOT_SETTLE_MINUTES', get('RELEASE_BOT_SETTLE_MINUTES'), 30),
    repositories: repositories === undefined ? undefined : parseList(repositories),
    skipPullRequestAuthors: parseList(get('RELEASE_BOT_SKIP_PR_AUTHORS') ?? 'rubensworks'),
    label: {
      name: get('RELEASE_BOT_LABEL') ?? 'released',
      color: '0e8a16',
      description: 'Included in a published release',
    },
    maxComments: parseNumber('RELEASE_BOT_MAX_COMMENTS', get('RELEASE_BOT_MAX_COMMENTS'), 50),
    ciWorkflow: get('RELEASE_BOT_CI_WORKFLOW') ?? 'ci.yml',
  };
}

function parseNumber(name: string, value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!/^\d+(?:\.\d+)?$/u.test(value)) {
    throw new Error(`The ${name} environment variable must be a non-negative number, but got '${value}'`);
  }
  return Number(value);
}

function parseDate(name: string, value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`The ${name} environment variable must be a date, but got '${value}'`);
  }
  return date;
}

function parseList(value: string): string[] {
  return value.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0);
}
