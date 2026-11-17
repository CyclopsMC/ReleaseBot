import { getEnvironmentOptions } from '../lib/EnvironmentOptions';

describe('getEnvironmentOptions', () => {
  const now = new Date('2026-11-16T12:00:00Z');

  it('should throw without a token', () => {
    expect(() => getEnvironmentOptions({}, now)).toThrow('The GITHUB_TOKEN environment variable must be set');
    expect(() => getEnvironmentOptions({ GITHUB_TOKEN: '' }, now))
      .toThrow('The GITHUB_TOKEN environment variable must be set');
  });

  it('should use defaults', () => {
    expect(getEnvironmentOptions({ GITHUB_TOKEN: 'token' }, now)).toEqual({
      token: 'token',
      organization: 'CyclopsMC',
      dryRun: true,
      now,
      notBefore: undefined,
      lookbackDays: 14,
      settleMinutes: 30,
      repositories: undefined,
      skipPullRequestAuthors: [ 'rubensworks' ],
      label: { name: 'released', color: '0e8a16', description: 'Included in a published release' },
      maxComments: 50,
      ciWorkflow: 'ci.yml',
    });
  });

  it('should treat empty variables as unset', () => {
    expect(getEnvironmentOptions({
      GITHUB_TOKEN: 'token',
      RELEASE_BOT_DRY_RUN: '',
      RELEASE_BOT_NOT_BEFORE: '',
      RELEASE_BOT_REPOSITORIES: '',
      RELEASE_BOT_LOOKBACK_DAYS: '',
    }, now)).toMatchObject({
      dryRun: true,
      notBefore: undefined,
      repositories: undefined,
      lookbackDays: 14,
    });
  });

  it('should use all variables', () => {
    expect(getEnvironmentOptions({
      GITHUB_TOKEN: 'token',
      RELEASE_BOT_ORGANIZATION: 'Org',
      RELEASE_BOT_DRY_RUN: 'false',
      RELEASE_BOT_NOT_BEFORE: '2026-11-16',
      RELEASE_BOT_LOOKBACK_DAYS: '7',
      RELEASE_BOT_SETTLE_MINUTES: '0.5',
      RELEASE_BOT_REPOSITORIES: ' CyclopsCore, EvilCraft ,',
      RELEASE_BOT_SKIP_PR_AUTHORS: 'a,b',
      RELEASE_BOT_LABEL: 'shipped',
      RELEASE_BOT_MAX_COMMENTS: '5',
      RELEASE_BOT_CI_WORKFLOW: 'build.yml',
    }, now)).toEqual({
      token: 'token',
      organization: 'Org',
      dryRun: false,
      now,
      notBefore: new Date('2026-11-16T00:00:00Z'),
      lookbackDays: 7,
      settleMinutes: 0.5,
      repositories: [ 'CyclopsCore', 'EvilCraft' ],
      skipPullRequestAuthors: [ 'a', 'b' ],
      label: { name: 'shipped', color: '0e8a16', description: 'Included in a published release' },
      maxComments: 5,
      ciWorkflow: 'build.yml',
    });
  });

  it('should only disable dry-run mode for the value false', () => {
    expect(getEnvironmentOptions({ GITHUB_TOKEN: 'token', RELEASE_BOT_DRY_RUN: 'no' }, now).dryRun).toBe(true);
    expect(getEnvironmentOptions({ GITHUB_TOKEN: 'token', RELEASE_BOT_DRY_RUN: 'true' }, now).dryRun).toBe(true);
  });

  it('should throw on invalid numbers', () => {
    expect(() => getEnvironmentOptions({ GITHUB_TOKEN: 'token', RELEASE_BOT_MAX_COMMENTS: '-1' }, now))
      .toThrow(`The RELEASE_BOT_MAX_COMMENTS environment variable must be a non-negative number, but got '-1'`);
    expect(() => getEnvironmentOptions({ GITHUB_TOKEN: 'token', RELEASE_BOT_LOOKBACK_DAYS: 'abc' }, now))
      .toThrow(`The RELEASE_BOT_LOOKBACK_DAYS environment variable must be a non-negative number, but got 'abc'`);
  });

  it('should throw on invalid dates', () => {
    expect(() => getEnvironmentOptions({ GITHUB_TOKEN: 'token', RELEASE_BOT_NOT_BEFORE: 'yesterday' }, now))
      .toThrow(`The RELEASE_BOT_NOT_BEFORE environment variable must be a date, but got 'yesterday'`);
  });
});
