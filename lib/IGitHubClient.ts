/**
 * Identifies a GitHub repository.
 */
export interface IRepositoryId {
  owner: string;
  name: string;
}

/**
 * Identifies an issue or pull request.
 */
export interface IItemId {
  repository: IRepositoryId;
  number: number;
}

/**
 * A GitHub release.
 */
export interface IRelease {
  tag: string;
  url: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt?: Date;
}

/**
 * The state of the latest run of a workflow for a given tag.
 * 'none' indicates that the workflow did not run for that tag.
 */
export type WorkflowRunState = 'success' | 'failure' | 'pending' | 'none';

/**
 * An issue or pull request, together with the data needed to decide how to act on it.
 */
export interface IItem extends IItemId {
  type: 'Issue' | 'PullRequest';
  url: string;
  authorLogin?: string;
  authorIsBot: boolean;
  labels: string[];
  commentBodies: string[];
  /**
   * The issues that a pull request closes. Always empty for issues.
   */
  closingIssues: IItemId[];
}

/**
 * A label definition.
 */
export interface ILabel {
  name: string;
  color: string;
  description: string;
}

/**
 * The subset of GitHub operations the release bot needs.
 */
export interface IGitHubClient {
  /**
   * @param organization An organization name.
   * @return The non-archived source repositories of the organization.
   */
  listRepositories: (organization: string) => Promise<IRepositoryId[]>;
  /**
   * @param repository A repository.
   * @return The latest releases of the repository.
   */
  listReleases: (repository: IRepositoryId) => Promise<IRelease[]>;
  /**
   * @param repository A repository.
   * @param workflow The file name of a workflow, such as 'ci.yml'.
   * @param tag A tag name.
   * @return The state of the latest run of the given workflow for a push of the given tag.
   */
  getWorkflowRunState: (repository: IRepositoryId, workflow: string, tag: string) => Promise<WorkflowRunState>;
  /**
   * @param repository A repository.
   * @param path A file path within the repository.
   * @param ref An optional git ref, defaults to the default branch.
   * @return The file contents, or undefined if the file does not exist.
   */
  getFileContents: (repository: IRepositoryId, path: string, ref?: string) => Promise<string | undefined>;
  /**
   * @param id An issue or pull request identifier.
   * @return The issue or pull request, or undefined if it does not exist.
   */
  getItem: (id: IItemId) => Promise<IItem | undefined>;
  /**
   * Create the given label in the repository if it does not exist yet.
   * @param repository A repository.
   * @param label A label definition.
   */
  ensureLabel: (repository: IRepositoryId, label: ILabel) => Promise<void>;
  /**
   * @param id An issue or pull request identifier.
   * @param label A label name.
   */
  addLabel: (id: IItemId, label: string) => Promise<void>;
  /**
   * @param id An issue or pull request identifier.
   * @param body The markdown body of the comment.
   */
  addComment: (id: IItemId, body: string) => Promise<void>;
}
