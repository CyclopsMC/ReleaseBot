import { ChangelogParser } from './ChangelogParser';
import type { IReleaseInfo } from './CommentBuilder';
import { CommentBuilder } from './CommentBuilder';
import type {
  IGitHubClient,
  IItem,
  IItemId,
  ILabel,
  IRelease,
  IRepositoryId,
  WorkflowRunState,
} from './IGitHubClient';
import type { IModMetadata } from './ModMetadata';
import { parseMinecraftVersion, parseModMetadata } from './ModMetadata';

/**
 * Comments on issues and pull requests once they are included in a release, and labels them.
 *
 * Releases are only handled once all releases of a repository have settled,
 * meaning that no release was published recently and that the CI workflow of each release has finished.
 * This makes sure that releases for different Minecraft versions that are published together
 * are announced in a single comment, and that the mod files have been uploaded before announcing them.
 *
 * Comments contain a hidden marker that lists the announced releases,
 * so that runs can safely overlap without announcing a release twice.
 */
export class ReleaseBot {
  private readonly options: IReleaseBotOptions;
  private readonly changelogParser: ChangelogParser;
  private readonly commentBuilder: CommentBuilder;

  public constructor(options: IReleaseBotOptions) {
    this.options = options;
    this.changelogParser = new ChangelogParser(options.organization);
    this.commentBuilder = new CommentBuilder();
  }

  /**
   * Run the bot once.
   * @return A report of everything that was done, or would be done in dry-run mode.
   */
  public async run(): Promise<IReport> {
    const { dryRun, notBefore, now, lookbackDays, settleMinutes } = this.options;
    if (!dryRun && !notBefore) {
      throw new Error('A not-before date must be configured when not running in dry-run mode');
    }
    const lookbackStart = new Date(now.getTime() - (lookbackDays * 24 * 60 * 60 * 1_000));
    const report: IReport = {
      dryRun,
      windowStart: notBefore && notBefore > lookbackStart ? notBefore : lookbackStart,
      windowEnd: new Date(now.getTime() - (settleMinutes * 60 * 1_000)),
      releases: [],
      deferred: [],
      skipped: [],
      actions: [],
      errors: [],
    };

    const releases: IIncludedItems[] = [];
    for (const repository of await this.getRepositories()) {
      try {
        releases.push(...await this.handleRepository(repository, report));
      } catch (error: unknown) {
        this.addError(report, `Failed to handle repository ${repository.owner}/${repository.name}`, error);
      }
    }

    report.actions = await this.planActions(releases, report);
    const comments = report.actions.filter(action => action.comment).length;
    if (comments > this.options.maxComments) {
      report.errors.push(`Refusing to post ${comments} comments, as this exceeds the maximum of ${this.options.maxComments}`);
    } else if (!dryRun) {
      await this.executeActions(report);
    }
    return report;
  }

  /**
   * @return The repositories to check for releases.
   */
  protected async getRepositories(): Promise<IRepositoryId[]> {
    const repositories = await this.options.client.listRepositories(this.options.organization);
    const allowed = this.options.repositories?.map(name => name.toLowerCase());
    return allowed ? repositories.filter(repository => allowed.includes(repository.name.toLowerCase())) : repositories;
  }

  /**
   * Determine the settled releases of a repository within the time window, and what they include.
   * @param repository A repository.
   * @param report The report to add deferred, skipped and handled releases to.
   */
  protected async handleRepository(repository: IRepositoryId, report: IReport): Promise<IIncludedItems[]> {
    const releases = (await this.options.client.listReleases(repository))
      .filter((release): release is IRelease & { publishedAt: Date } => !release.draft && !release.prerelease &&
        Boolean(release.publishedAt) && !release.url.includes('/releases/tag/untagged-'))
      .filter(release => release.publishedAt >= report.windowStart)
      .sort((left, right) => left.publishedAt.getTime() - right.publishedAt.getTime());
    if (releases.length === 0) {
      return [];
    }

    // Wait until all releases of this repository have settled
    const latest = releases.at(-1)!;
    if (latest.publishedAt > report.windowEnd) {
      this.defer(report, repository, releases, `release ${latest.tag} was published less than ${this.options.settleMinutes} minutes ago`);
      return [];
    }
    const states: WorkflowRunState[] = [];
    for (const release of releases) {
      states.push(await this.options.client.getWorkflowRunState(repository, this.options.ciWorkflow, release.tag));
    }
    const pending = releases.find((release, index) => states[index] === 'pending');
    if (pending) {
      this.defer(report, repository, releases, `the ${this.options.ciWorkflow} workflow of release ${pending.tag} is still running`);
      return [];
    }

    let mod: IModMetadata | undefined;
    const included: IIncludedItems[] = [];
    for (const [ index, release ] of releases.entries()) {
      if (states[index] === 'failure') {
        report.skipped.push({ repository, tag: release.tag, reason: `the ${this.options.ciWorkflow} workflow did not succeed` });
        continue;
      }
      const changelog = await this.options.client.getFileContents(repository, `resources/changelog/${release.tag}.txt`, release.tag) ??
        this.changelogParser.extractSection(release.body, release.tag);
      if (changelog === undefined) {
        report.skipped.push({ repository, tag: release.tag, reason: 'no changelog was found' });
        continue;
      }
      mod ??= parseModMetadata(repository, await this.options.client.getFileContents(repository, 'gradle.properties'));
      const info: IReleaseInfo = {
        repository,
        tag: release.tag,
        url: release.url,
        minecraftVersion: parseMinecraftVersion(release.tag),
        mod,
      };
      report.releases.push(info);
      included.push({ release: info, items: this.changelogParser.parseReferences(changelog, repository) });
    }
    return included;
  }

  protected defer(report: IReport, repository: IRepositoryId, releases: IRelease[], reason: string): void {
    for (const release of releases) {
      report.deferred.push({ repository, tag: release.tag, reason });
    }
  }

  /**
   * Determine which comments and labels to add.
   * Issues that are closed by included pull requests are considered included as well.
   * @param included The issues and pull requests included in each release.
   * @param report The report to add errors to.
   */
  protected async planActions(included: IIncludedItems[], report: IReport): Promise<IAction[]> {
    const targets = new Map<string, ITarget>();
    const queue: ITarget[] = [];
    const addTarget = (id: IItemId, releases: IReleaseInfo[]): void => {
      const key = ChangelogParser.getItemKey(id);
      let target = targets.get(key);
      if (!target) {
        target = { id, releases: []};
        targets.set(key, target);
        queue.push(target);
      }
      for (const release of releases) {
        if (!target.releases.includes(release)) {
          target.releases.push(release);
        }
      }
    };
    for (const { release, items } of included) {
      for (const id of items) {
        addTarget(id, [ release ]);
      }
    }

    // Resolve all targets, including issues closed by pull requests, which are appended to the queue
    for (const target of queue) {
      try {
        target.item = await this.options.client.getItem(target.id);
      } catch (error: unknown) {
        this.addError(report, `Failed to load ${ChangelogParser.getItemName(target.id)}`, error);
      }
      for (const issue of target.item?.closingIssues ?? []) {
        if (issue.repository.owner.toLowerCase() === this.options.organization.toLowerCase()) {
          addTarget(issue, target.releases);
        }
      }
    }

    const actions: IAction[] = [];
    const labelName = this.options.label.name.toLowerCase();
    for (const { item, releases } of queue) {
      if (!item) {
        continue;
      }
      const announced = this.commentBuilder.getAnnouncedReleaseKeys(item.commentBodies);
      const newReleases = releases.filter(release => !announced.has(CommentBuilder.getReleaseKey(release)));
      if (newReleases.length === 0) {
        continue;
      }
      const comment = this.shouldComment(item) ? this.commentBuilder.build(item, newReleases) : undefined;
      const label = !item.labels.some(name => name.toLowerCase() === labelName);
      if (comment !== undefined || label) {
        actions.push({ item, releases: newReleases, comment, label });
      }
    }
    return actions;
  }

  /**
   * @param item An issue or pull request.
   * @return If a comment should be placed, which is not the case for pull requests by bots or skipped authors.
   */
  protected shouldComment(item: IItem): boolean {
    if (item.type === 'Issue') {
      return true;
    }
    const author = item.authorLogin?.toLowerCase();
    return !item.authorIsBot && !this.options.skipPullRequestAuthors.some(login => login.toLowerCase() === author);
  }

  /**
   * Add the planned labels and comments.
   * @param report The report containing the planned actions, to which errors are added.
   */
  protected async executeActions(report: IReport): Promise<void> {
    const labelledRepositories = new Set<string>();
    for (const action of report.actions) {
      const name = ChangelogParser.getItemName(action.item);
      try {
        if (action.label) {
          const repositoryKey = `${action.item.repository.owner}/${action.item.repository.name}`.toLowerCase();
          if (!labelledRepositories.has(repositoryKey)) {
            await this.options.client.ensureLabel(action.item.repository, this.options.label);
            labelledRepositories.add(repositoryKey);
          }
          await this.options.client.addLabel(action.item, this.options.label.name);
          this.options.logger(`Added label to ${name}`);
        }
        if (action.comment) {
          await this.options.client.addComment(action.item, action.comment);
          this.options.logger(`Added comment to ${name}`);
          await this.options.sleep(this.options.commentDelay);
        }
      } catch (error: unknown) {
        this.addError(report, `Failed to update ${name}`, error);
      }
    }
  }

  protected addError(report: IReport, message: string, error: unknown): void {
    const fullMessage = `${message}: ${error instanceof Error ? error.message : String(error)}`;
    report.errors.push(fullMessage);
    this.options.logger(fullMessage);
  }
}

export interface IReleaseBotOptions {
  /**
   * The GitHub client to use.
   */
  client: IGitHubClient;
  /**
   * The organization whose repositories to handle.
   */
  organization: string;
  /**
   * If only a report should be produced, without adding comments or labels.
   */
  dryRun: boolean;
  /**
   * The current time.
   */
  now: Date;
  /**
   * Releases published before this date are ignored. Required when not in dry-run mode.
   */
  notBefore?: Date;
  /**
   * Releases published more than this number of days ago are ignored.
   */
  lookbackDays: number;
  /**
   * The number of minutes after the latest release of a repository before its releases are handled.
   */
  settleMinutes: number;
  /**
   * If defined, only repositories with these names are handled.
   */
  repositories?: string[];
  /**
   * Logins of authors whose pull requests will be labelled, but will not receive comments.
   */
  skipPullRequestAuthors: string[];
  /**
   * The label to add to included issues and pull requests.
   */
  label: ILabel;
  /**
   * The maximum number of comments in a single run. If more comments are planned, nothing is done.
   */
  maxComments: number;
  /**
   * The file name of the workflow that must succeed for a release before it is handled.
   */
  ciWorkflow: string;
  /**
   * The number of milliseconds to wait after each comment.
   */
  commentDelay: number;
  /**
   * Function to wait for the given number of milliseconds.
   */
  sleep: (ms: number) => Promise<void>;
  /**
   * Function to log progress messages.
   */
  logger: (message: string) => void;
}

/**
 * The issues and pull requests a release includes.
 */
export interface IIncludedItems {
  release: IReleaseInfo;
  items: IItemId[];
}

/**
 * A release that was not handled.
 */
export interface IReleaseNote {
  repository: IRepositoryId;
  tag: string;
  reason: string;
}

/**
 * A comment and/or label to add to an issue or pull request.
 */
export interface IAction {
  item: IItem;
  releases: IReleaseInfo[];
  comment?: string;
  label: boolean;
}

/**
 * The result of a run.
 */
export interface IReport {
  dryRun: boolean;
  windowStart: Date;
  windowEnd: Date;
  /**
   * The handled releases.
   */
  releases: IReleaseInfo[];
  /**
   * Releases that will be handled in a later run.
   */
  deferred: IReleaseNote[];
  /**
   * Releases that will not be handled.
   */
  skipped: IReleaseNote[];
  actions: IAction[];
  errors: string[];
}

interface ITarget {
  id: IItemId;
  releases: IReleaseInfo[];
  item?: IItem;
}
