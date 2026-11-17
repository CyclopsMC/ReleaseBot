import { CommentBuilder } from '../lib/CommentBuilder';
import type {
  IGitHubClient,
  IItem,
  IItemId,
  ILabel,
  IRelease,
  IRepositoryId,
  WorkflowRunState,
} from '../lib/IGitHubClient';
import type { IReleaseBotOptions } from '../lib/ReleaseBot';
import { ReleaseBot } from '../lib/ReleaseBot';

const CORE: IRepositoryId = { owner: 'CyclopsMC', name: 'CyclopsCore' };
const ABILITIES: IRepositoryId = { owner: 'CyclopsMC', name: 'EverlastingAbilities' };
const EVILCRAFT: IRepositoryId = { owner: 'CyclopsMC', name: 'EvilCraft' };

const GRADLE_PROPERTIES = `mod_version=1.31.5
minecraft_version=26.1.2
mod_name=Cyclops Core
display_url=https://www.curseforge.com/minecraft/mc-mods/cyclops-core
modrinth_project_id=Z9DM0LJ4
`;

const CHANGELOGS: Record<string, string> = {
  '1.20.1-1.22.5': `As always, don't forget to backup your world before updating!

Changes:
* Limit list and map sizes and avoid class init when decoding packets (#260), Closes GHSA-4jfp-83qj-mr8r

Fixes:
* Fix loot registry corruption when mods load in parallel (#263)
* Fix duplicate packet IDs when mods load in parallel (#262), Closes #258
`,
  '1.21.1-1.30.2': `As always, don't forget to backup your world before updating!

Fixes:
* Fix loot registry corruption when mods load in parallel (#263)
* Fix duplicate packet IDs when mods load in parallel (#262), Closes #258
* Limit list and map sizes and avoid class init when decoding packets (#260), Closes GHSA-4jfp-83qj-mr8r
* Improve concurrency robustness of Map packet codec
  This also adds more detailed error logging for when it fails again.
  Related to #258
`,
  '26.1.2-1.31.5': `As always, don't forget to backup your world before updating!

Fixes:
* Fix loot registry corruption when mods load in parallel (#263)
* Fix duplicate packet IDs when mods load in parallel (#262), Closes #258
* Restrict recipe display regex requests from clients (#261), Closes GHSA-8469-hgvj-5g4r
* Limit list and map sizes and avoid class init when decoding packets (#260), Closes GHSA-4jfp-83qj-mr8r
* Improve concurrency robustness of Map packet codec
  This also adds more detailed error logging for when it fails again.
  Related to #258
`,
};

function key(repository: IRepositoryId): string {
  return `${repository.owner}/${repository.name}`.toLowerCase();
}

function itemKey(id: IItemId): string {
  return `${key(id.repository)}#${id.number}`;
}

function release(repository: IRepositoryId, tag: string, publishedAt: string, extra: Partial<IRelease> = {}): IRelease {
  return {
    tag,
    url: `https://github.com/${repository.owner}/${repository.name}/releases/tag/${tag}`,
    body: '',
    draft: false,
    prerelease: false,
    publishedAt: new Date(publishedAt),
    ...extra,
  };
}

function item(
  repository: IRepositoryId,
  number: number,
  type: 'Issue' | 'PullRequest',
  author: string,
  extra: Partial<IItem> = {},
): IItem {
  return {
    repository,
    number,
    type,
    url: `https://github.com/${repository.owner}/${repository.name}/${type === 'Issue' ? 'issues' : 'pull'}/${number}`,
    authorLogin: author,
    authorIsBot: false,
    labels: [],
    commentBodies: [],
    closingIssues: [],
    ...extra,
  };
}

/**
 * An in-memory GitHub client.
 */
class FakeGitHubClient implements IGitHubClient {
  public repositories: IRepositoryId[] = [];
  public releases = new Map<string, IRelease[]>();
  public workflowStates = new Map<string, WorkflowRunState>();
  public files = new Map<string, string>();
  public items = new Map<string, IItem>();

  public listRepositories = jest.fn(async(_organization: string): Promise<IRepositoryId[]> => this.repositories);
  public listReleases = jest.fn(async(repository: IRepositoryId): Promise<IRelease[]> =>
    this.releases.get(key(repository)) ?? []);

  public getWorkflowRunState = jest.fn(async(repository: IRepositoryId, workflow: string, tag: string):
  Promise<WorkflowRunState> => this.workflowStates.get(`${key(repository)}/${workflow}@${tag}`) ?? 'success');

  public getFileContents = jest.fn(async(repository: IRepositoryId, path: string, ref?: string):
  Promise<string | undefined> => this.files.get(`${key(repository)}/${path}@${ref ?? ''}`));

  public getItem = jest.fn(async(id: IItemId): Promise<IItem | undefined> => this.items.get(itemKey(id)));
  public ensureLabel = jest.fn(async(_repository: IRepositoryId, _label: ILabel): Promise<void> => {});
  public addLabel = jest.fn(async(_id: IItemId, _label: string): Promise<void> => {});
  public addComment = jest.fn(async(_id: IItemId, _body: string): Promise<void> => {});

  public addRelease(repository: IRepositoryId, value: IRelease, changelog?: string): void {
    this.releases.set(key(repository), [ ...this.releases.get(key(repository)) ?? [], value ]);
    if (changelog !== undefined) {
      this.files.set(`${key(repository)}/resources/changelog/${value.tag}.txt@${value.tag}`, changelog);
    }
  }

  public addItem(value: IItem): void {
    this.items.set(itemKey(value), value);
  }
}

describe('ReleaseBot', () => {
  let client: FakeGitHubClient;
  let options: IReleaseBotOptions;
  let logger: jest.Mock;

  function createBot(overrides: Partial<IReleaseBotOptions> = {}): ReleaseBot {
    return new ReleaseBot({ ...options, ...overrides });
  }

  function comments(): Record<string, string> {
    return Object.fromEntries(client.addComment.mock.calls.map(([ id, body ]) => [ itemKey(id), body ]));
  }

  beforeEach(() => {
    logger = jest.fn();
    client = new FakeGitHubClient();
    options = {
      client,
      organization: 'CyclopsMC',
      dryRun: false,
      now: new Date('2026-11-16T12:00:00Z'),
      notBefore: new Date('2026-11-01T00:00:00Z'),
      lookbackDays: 14,
      settleMinutes: 30,
      skipPullRequestAuthors: [ 'rubensworks' ],
      label: { name: 'released', color: '0e8a16', description: 'Included in a published release' },
      maxComments: 50,
      ciWorkflow: 'ci.yml',
      logger,
    };

    // The CyclopsCore releases of November 2026
    client.repositories = [ CORE, ABILITIES ];
    client.files.set('cyclopsmc/cyclopscore/gradle.properties@', GRADLE_PROPERTIES);
    client.addRelease(CORE, release(CORE, '26.1.2-1.31.5', '2026-11-15T09:03:11Z'), CHANGELOGS['26.1.2-1.31.5']);
    client.addRelease(CORE, release(CORE, '1.21.1-1.30.2', '2026-11-15T08:58:18Z'), CHANGELOGS['1.21.1-1.30.2']);
    client.addRelease(CORE, release(CORE, '1.20.1-1.22.5', '2026-11-14T08:51:34Z'), CHANGELOGS['1.20.1-1.22.5']);
    client.addRelease(CORE, release(CORE, '26.1.2-1.31.4', '2026-10-31T12:33:36Z'), 'Closes #256');
    client.addRelease(CORE, release(CORE, '1.21.1-1.26.2', '2026-11-10T18:05:19Z', {
      url: 'https://github.com/CyclopsMC/CyclopsCore/releases/tag/untagged-95d9855a685da7f2fa01',
    }), 'Closes #1');
    client.addRelease(CORE, release(CORE, 'draft', '2026-11-10T18:05:19Z', { draft: true }), 'Closes #2');
    client.addRelease(CORE, release(CORE, 'prerelease', '2026-11-10T18:05:19Z', { prerelease: true }), 'Closes #3');
    client.addRelease(CORE, release(CORE, 'unpublished', '2026-11-10T18:05:19Z', { publishedAt: undefined }), '#4');
    client.addItem(item(CORE, 258, 'Issue', 'phrostt', {
      commentBodies: [ 'Thanks for reporting!' ],
      labels: [ 'bug' ],
    }));
    client.addItem(item(CORE, 260, 'PullRequest', 'rubensworks'));
    client.addItem(item(CORE, 261, 'PullRequest', 'rubensworks'));
    client.addItem(item(CORE, 262, 'PullRequest', 'rubensworks'));
    client.addItem(item(CORE, 263, 'PullRequest', 'rubensworks'));
  });

  describe('run', () => {
    it('should throw when not in dry-run mode without a not-before date', async() => {
      await expect(createBot({ notBefore: undefined }).run()).rejects
        .toThrow('A not-before date must be configured when not running in dry-run mode');
    });

    it('should announce all settled releases in a single comment per issue', async() => {
      const report = await createBot().run();

      expect(report.errors).toEqual([]);
      expect(report.windowStart).toEqual(new Date('2026-11-02T12:00:00Z'));
      expect(report.windowEnd).toEqual(new Date('2026-11-16T11:30:00Z'));
      expect(report.releases.map(info => info.tag)).toEqual([ '1.20.1-1.22.5', '1.21.1-1.30.2', '26.1.2-1.31.5' ]);
      expect(report.deferred).toEqual([]);
      expect(report.skipped).toEqual([]);
      expect(report.actions.map(action => [ itemKey(action.item), action.label, Boolean(action.comment) ])).toEqual([
        [ 'cyclopsmc/cyclopscore#260', true, false ],
        [ 'cyclopsmc/cyclopscore#263', true, false ],
        [ 'cyclopsmc/cyclopscore#262', true, false ],
        [ 'cyclopsmc/cyclopscore#258', true, true ],
        [ 'cyclopsmc/cyclopscore#261', true, false ],
      ]);

      expect(comments()).toEqual({
        'cyclopsmc/cyclopscore#258': `This is included in the following releases:

* [Cyclops Core 26.1.2-1.31.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5) for Minecraft 26.1.2
* [Cyclops Core 1.21.1-1.30.2](https://github.com/CyclopsMC/CyclopsCore/releases/tag/1.21.1-1.30.2) for Minecraft 1.21.1
* [Cyclops Core 1.20.1-1.22.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/1.20.1-1.22.5) for Minecraft 1.20.1

Download Cyclops Core from [CurseForge](https://www.curseforge.com/minecraft/mc-mods/cyclops-core) or [Modrinth](https://modrinth.com/mod/Z9DM0LJ4).

<!-- release-bot: CyclopsMC/CyclopsCore@26.1.2-1.31.5 CyclopsMC/CyclopsCore@1.21.1-1.30.2 CyclopsMC/CyclopsCore@1.20.1-1.22.5 -->
`,
      });
      expect(client.ensureLabel).toHaveBeenCalledTimes(1);
      expect(client.ensureLabel).toHaveBeenCalledWith(CORE, options.label);
      expect(client.addLabel.mock.calls.map(([ id, label ]) => `${itemKey(id)} ${label}`)).toEqual([
        'cyclopsmc/cyclopscore#260 released',
        'cyclopsmc/cyclopscore#263 released',
        'cyclopsmc/cyclopscore#262 released',
        'cyclopsmc/cyclopscore#258 released',
        'cyclopsmc/cyclopscore#261 released',
      ]);
      expect(logger).toHaveBeenCalledWith('Added comment to CyclopsMC/CyclopsCore#258');
      expect(client.getFileContents).toHaveBeenCalledWith(CORE, 'gradle.properties');
      expect(client.getFileContents.mock.calls.filter(([ , path ]) => path === 'gradle.properties')).toHaveLength(1);
    });

    it('should not write anything in dry-run mode', async() => {
      const report = await createBot({ dryRun: true, notBefore: undefined }).run();

      expect(report.dryRun).toBe(true);
      expect(report.actions).toHaveLength(5);
      expect(client.ensureLabel).not.toHaveBeenCalled();
      expect(client.addLabel).not.toHaveBeenCalled();
      expect(client.addComment).not.toHaveBeenCalled();
    });

    it('should only announce releases that were not announced before', async() => {
      const previous = new CommentBuilder().build({ repository: CORE, number: 258 }, [{
        repository: CORE,
        tag: '1.20.1-1.22.5',
        url: 'https://github.com/CyclopsMC/CyclopsCore/releases/tag/1.20.1-1.22.5',
        mod: { name: 'Cyclops Core' },
      }]);
      client.addItem(item(CORE, 258, 'Issue', 'phrostt', { commentBodies: [ previous ], labels: [ 'released' ]}));

      const report = await createBot().run();

      const action = report.actions.find(entry => entry.item.number === 258)!;
      expect(action.label).toBe(false);
      expect(action.releases.map(info => info.tag)).toEqual([ '1.21.1-1.30.2', '26.1.2-1.31.5' ]);
      expect(comments()['cyclopsmc/cyclopscore#258']).toContain(
        '<!-- release-bot: CyclopsMC/CyclopsCore@26.1.2-1.31.5 CyclopsMC/CyclopsCore@1.21.1-1.30.2 -->',
      );
    });

    it('should do nothing if everything was announced and labelled', async() => {
      const all = new CommentBuilder().build(
        { repository: CORE, number: 258 },
        [ '1.20.1-1.22.5', '1.21.1-1.30.2', '26.1.2-1.31.5' ]
          .map(tag => ({ repository: CORE, tag, url: '', mod: { name: 'Cyclops Core' }})),
      );
      for (const number of [ 260, 261, 262, 263 ]) {
        client.addItem(item(CORE, number, 'PullRequest', 'rubensworks', { labels: [ 'Released' ]}));
      }
      client.addItem(item(CORE, 258, 'Issue', 'phrostt', { commentBodies: [ all ], labels: [ 'released' ]}));

      const report = await createBot().run();

      expect(report.releases).toHaveLength(3);
      expect(report.actions).toEqual([]);
      expect(client.ensureLabel).not.toHaveBeenCalled();
    });

    it('should defer all releases of a repository while a release was published recently', async() => {
      const report = await createBot({ now: new Date('2026-11-15T09:20:00Z') }).run();

      expect(report.releases).toEqual([]);
      expect(report.actions).toEqual([]);
      expect(report.deferred).toEqual([ '1.20.1-1.22.5', '1.21.1-1.30.2', '26.1.2-1.31.5' ].map(tag => ({
        repository: CORE,
        tag,
        reason: 'release 26.1.2-1.31.5 was published less than 30 minutes ago',
      })));
      expect(client.getWorkflowRunState).not.toHaveBeenCalled();
    });

    it('should defer all releases of a repository while a CI workflow is running', async() => {
      client.workflowStates.set('cyclopsmc/cyclopscore/ci.yml@1.21.1-1.30.2', 'pending');

      const report = await createBot().run();

      expect(report.releases).toEqual([]);
      expect(report.deferred).toHaveLength(3);
      expect(report.deferred[0].reason).toBe('the ci.yml workflow of release 1.21.1-1.30.2 is still running');
    });

    it('should skip releases whose CI workflow failed', async() => {
      client.workflowStates.set('cyclopsmc/cyclopscore/ci.yml@1.20.1-1.22.5', 'failure');
      client.workflowStates.set('cyclopsmc/cyclopscore/ci.yml@26.1.2-1.31.5', 'none');

      const report = await createBot().run();

      expect(report.skipped).toEqual([
        { repository: CORE, tag: '1.20.1-1.22.5', reason: 'the ci.yml workflow did not succeed' },
      ]);
      expect(report.releases.map(info => info.tag)).toEqual([ '1.21.1-1.30.2', '26.1.2-1.31.5' ]);
    });

    it('should fall back to the release body, and skip releases without changelog', async() => {
      client.releases.set(key(CORE), [
        release(CORE, '26.1.2-1.31.5', '2026-11-15T09:03:11Z', {
          body: `<a name="26.1.2-1.31.5"></a>\n${CHANGELOGS['26.1.2-1.31.5']}\n<a name="26.1.2-1.31.4"></a>\nCloses #256\n`,
        }),
        release(CORE, '1.21.1-1.30.2', '2026-11-15T08:58:18Z', { body: 'Closes #258' }),
      ]);
      client.files.delete('cyclopsmc/cyclopscore/resources/changelog/26.1.2-1.31.5.txt@26.1.2-1.31.5');
      client.files.delete('cyclopsmc/cyclopscore/resources/changelog/1.21.1-1.30.2.txt@1.21.1-1.30.2');

      const report = await createBot().run();

      expect(report.skipped).toEqual([{ repository: CORE, tag: '1.21.1-1.30.2', reason: 'no changelog was found' }]);
      expect(report.releases.map(info => info.tag)).toEqual([ '26.1.2-1.31.5' ]);
      expect(report.actions.map(action => action.item.number)).toEqual([ 263, 262, 258, 261, 260 ]);
    });

    it('should use the repository name without gradle.properties', async() => {
      client.files.delete('cyclopsmc/cyclopscore/gradle.properties@');

      await createBot().run();

      expect(comments()['cyclopsmc/cyclopscore#258']).toContain('* [CyclopsCore 26.1.2-1.31.5]');
      expect(comments()['cyclopsmc/cyclopscore#258']).not.toContain('Download');
    });

    it('should comment on issues in other repositories', async() => {
      client.releases.set(key(CORE), [ release(CORE, '26.1.2-1.31.3', '2026-11-10T06:37:54Z') ]);
      client.files.set('cyclopsmc/cyclopscore/resources/changelog/26.1.2-1.31.3.txt@26.1.2-1.31.3', `Fixes:
* Fix Forge configurable type actions not always being set (#253)
  Closes CyclopsMC/EverlastingAbilities#329
`);
      client.addItem(item(CORE, 253, 'PullRequest', 'rubensworks'));
      client.addItem(item(ABILITIES, 329, 'Issue', 'someone'));

      const report = await createBot().run();

      expect(report.actions.map(action => itemKey(action.item))).toEqual([
        'cyclopsmc/cyclopscore#253',
        'cyclopsmc/everlastingabilities#329',
      ]);
      expect(comments()['cyclopsmc/everlastingabilities#329'])
        .toContain('This change is part of Cyclops Core, so make sure to update that mod.');
      expect(client.ensureLabel.mock.calls.map(([ repository ]) => key(repository)))
        .toEqual([ 'cyclopsmc/cyclopscore', 'cyclopsmc/everlastingabilities' ]);
    });

    it('should include issues closed by included pull requests', async() => {
      client.addItem(item(CORE, 262, 'PullRequest', 'rubensworks', {
        closingIssues: [
          { repository: CORE, number: 258 },
          { repository: EVILCRAFT, number: 5 },
          { repository: { owner: 'someone', name: 'SomeMod' }, number: 6 },
        ],
      }));
      client.addItem(item(CORE, 263, 'PullRequest', 'GnomoMuitoLoco', {
        closingIssues: [{ repository: CORE, number: 259 }],
      }));
      client.addItem(item(CORE, 259, 'Issue', 'someone'));
      client.addItem(item(EVILCRAFT, 5, 'Issue', 'someone'));

      const report = await createBot().run();

      expect(report.actions.map(action => [ itemKey(action.item), action.releases.length ])).toEqual([
        [ 'cyclopsmc/cyclopscore#260', 3 ],
        [ 'cyclopsmc/cyclopscore#263', 3 ],
        [ 'cyclopsmc/cyclopscore#262', 3 ],
        [ 'cyclopsmc/cyclopscore#258', 3 ],
        [ 'cyclopsmc/cyclopscore#261', 1 ],
        [ 'cyclopsmc/cyclopscore#259', 3 ],
        [ 'cyclopsmc/evilcraft#5', 3 ],
      ]);
      expect(Object.keys(comments())).toEqual([
        'cyclopsmc/cyclopscore#263',
        'cyclopsmc/cyclopscore#258',
        'cyclopsmc/cyclopscore#259',
        'cyclopsmc/evilcraft#5',
      ]);
      expect(client.getItem).not.toHaveBeenCalledWith({ repository: { owner: 'someone', name: 'SomeMod' }, number: 6 });
    });

    it('should not comment on pull requests by bots or skipped authors', async() => {
      client.addItem(item(CORE, 260, 'PullRequest', 'Copilot', { authorIsBot: true }));
      client.addItem(item(CORE, 261, 'PullRequest', 'RubensWorks'));
      client.addItem(item(CORE, 262, 'PullRequest', 'Vonr'));
      client.addItem(item(CORE, 263, 'PullRequest', 'BlaiseBaptist', { authorLogin: undefined }));

      await createBot().run();

      expect(Object.keys(comments())).toEqual([
        'cyclopsmc/cyclopscore#263',
        'cyclopsmc/cyclopscore#262',
        'cyclopsmc/cyclopscore#258',
      ]);
    });

    it('should only handle the configured repositories', async() => {
      await createBot({ repositories: [ 'everlastingabilities' ]}).run();

      expect(client.listReleases).toHaveBeenCalledTimes(1);
      expect(client.listReleases).toHaveBeenCalledWith(ABILITIES);
    });

    it('should use the lookback window if it starts after the not-before date', async() => {
      const report = await createBot({ notBefore: new Date('2026-10-01T00:00:00Z'), lookbackDays: 1 }).run();

      expect(report.windowStart).toEqual(new Date('2026-11-15T12:00:00Z'));
      expect(report.releases).toEqual([]);
    });

    it('should not handle releases before the not-before date', async() => {
      const report = await createBot({ notBefore: new Date('2026-11-15T09:00:00Z') }).run();

      expect(report.windowStart).toEqual(new Date('2026-11-15T09:00:00Z'));
      expect(report.releases.map(info => info.tag)).toEqual([ '26.1.2-1.31.5' ]);
    });

    it('should skip items that do not exist', async() => {
      client.items.delete('cyclopsmc/cyclopscore#258');

      const report = await createBot().run();

      expect(report.errors).toEqual([]);
      expect(report.actions.map(action => action.item.number)).toEqual([ 260, 263, 262, 261 ]);
    });

    it('should report errors and continue', async() => {
      client.repositories = [ ABILITIES, CORE ];
      client.listReleases.mockImplementationOnce(async() => {
        throw new Error('Server error');
      });
      client.getItem.mockImplementationOnce(async() => {
        throw new Error('GraphQL error');
      });
      client.addComment.mockImplementationOnce(async() => {
        // eslint-disable-next-line ts/no-throw-literal
        throw 'Locked';
      });

      const report = await createBot().run();

      expect(report.errors).toEqual([
        'Failed to handle repository CyclopsMC/EverlastingAbilities: Server error',
        'Failed to load CyclopsMC/CyclopsCore#260: GraphQL error',
        'Failed to update CyclopsMC/CyclopsCore#258: Locked',
      ]);
      expect(report.actions.map(action => action.item.number)).toEqual([ 263, 262, 258, 261 ]);
      expect(client.addLabel).toHaveBeenCalledTimes(4);
      expect(logger).toHaveBeenCalledWith('Failed to update CyclopsMC/CyclopsCore#258: Locked');
    });

    it('should not write anything when there are too many comments', async() => {
      const report = await createBot({ maxComments: 0 }).run();

      expect(report.errors).toEqual([ 'Refusing to post 1 comments, as this exceeds the maximum of 0' ]);
      expect(report.actions).toHaveLength(5);
      expect(client.addLabel).not.toHaveBeenCalled();
      expect(client.addComment).not.toHaveBeenCalled();
    });
  });
});
