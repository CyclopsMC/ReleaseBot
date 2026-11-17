/* eslint-disable ts/naming-convention */
// The GitHub API uses snake_case parameters and properties
import type { Octokit } from '@octokit/rest';
import type {
  IGitHubClient,
  IItem,
  IItemId,
  ILabel,
  IRelease,
  IRepositoryId,
  WorkflowRunState,
} from './IGitHubClient';

const ITEM_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        url
        author { __typename login }
        labels(first: 100) { nodes { name } }
        comments(last: 100) { nodes { body } }
      }
      ... on PullRequest {
        url
        author { __typename login }
        labels(first: 100) { nodes { name } }
        comments(last: 100) { nodes { body } }
        closingIssuesReferences(first: 25) { nodes { number repository { name owner { login } } } }
      }
    }
  }
}`;

/**
 * A GitHub client on top of Octokit.
 */
export class GitHubClient implements IGitHubClient {
  private readonly octokit: Octokit;

  /**
   * @param octokit An Octokit instance, preferably with the throttling plugin.
   */
  public constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  public async listRepositories(organization: string): Promise<IRepositoryId[]> {
    const repositories = await this.octokit.paginate(this.octokit.rest.repos.listForOrg, {
      org: organization,
      type: 'sources',
      per_page: 100,
    });
    return repositories
      .filter(repository => !repository.archived)
      .map(repository => ({ owner: repository.owner.login, name: repository.name }));
  }

  public async listReleases(repository: IRepositoryId): Promise<IRelease[]> {
    const { data } = await this.octokit.rest.repos.listReleases({
      ...this.getRepositoryParams(repository),
      per_page: 100,
    });
    return data.map(release => ({
      tag: release.tag_name,
      url: release.html_url,
      body: release.body ?? '',
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt: release.published_at ? new Date(release.published_at) : undefined,
    }));
  }

  public async getWorkflowRunState(
    repository: IRepositoryId,
    workflow: string,
    tag: string,
  ): Promise<WorkflowRunState> {
    const response = await GitHubClient.ignoreNotFound(this.octokit.rest.actions.listWorkflowRuns({
      ...this.getRepositoryParams(repository),
      workflow_id: workflow,
      event: 'push',
      branch: tag,
      per_page: 1,
    }));
    const run = response?.data.workflow_runs[0];
    if (!run) {
      return 'none';
    }
    if (run.status !== 'completed') {
      return 'pending';
    }
    return run.conclusion === 'success' ? 'success' : 'failure';
  }

  public async getFileContents(repository: IRepositoryId, path: string, ref?: string): Promise<string | undefined> {
    const response = await GitHubClient.ignoreNotFound(this.octokit.rest.repos.getContent({
      ...this.getRepositoryParams(repository),
      path,
      ref,
      mediaType: { format: 'raw' },
    }));
    // The raw format returns the file contents as a string, which the generated types do not reflect
    return response ? String(response.data) : undefined;
  }

  public async getItem(id: IItemId): Promise<IItem | undefined> {
    let data: IGraphQlItemData;
    try {
      data = await this.octokit.graphql<IGraphQlItemData>(ITEM_QUERY, {
        owner: id.repository.owner,
        name: id.repository.name,
        number: id.number,
      });
    } catch (error: unknown) {
      // Missing repositories and items are reported as NOT_FOUND errors
      const errors = (<{ errors?: { type?: string }[] }> error).errors;
      if (errors && errors.length > 0 && errors.every(entry => entry.type === 'NOT_FOUND')) {
        return undefined;
      }
      throw error;
    }
    const item = data.repository?.issueOrPullRequest;
    if (!item) {
      return undefined;
    }
    return {
      repository: id.repository,
      number: id.number,
      type: item.__typename,
      url: item.url,
      authorLogin: item.author?.login,
      authorIsBot: item.author?.__typename === 'Bot',
      labels: item.labels.nodes.map(label => label.name),
      commentBodies: item.comments.nodes.map(comment => comment.body),
      closingIssues: (item.closingIssuesReferences?.nodes ?? []).map(issue => ({
        repository: { owner: issue.repository.owner.login, name: issue.repository.name },
        number: issue.number,
      })),
    };
  }

  public async ensureLabel(repository: IRepositoryId, label: ILabel): Promise<void> {
    const params = this.getRepositoryParams(repository);
    if (await GitHubClient.ignoreNotFound(this.octokit.rest.issues.getLabel({ ...params, name: label.name }))) {
      return;
    }
    await this.octokit.rest.issues.createLabel({ ...params, ...label });
  }

  public async addLabel(id: IItemId, label: string): Promise<void> {
    await this.octokit.rest.issues.addLabels({ ...this.getItemParams(id), labels: [ label ]});
  }

  public async addComment(id: IItemId, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ ...this.getItemParams(id), body });
  }

  protected getRepositoryParams(repository: IRepositoryId): { owner: string; repo: string } {
    return { owner: repository.owner, repo: repository.name };
  }

  protected getItemParams(id: IItemId): { owner: string; repo: string; issue_number: number } {
    return { ...this.getRepositoryParams(id.repository), issue_number: id.number };
  }

  /**
   * @param promise A request promise.
   * @return The response, or undefined if the request failed because the resource does not exist.
   */
  public static async ignoreNotFound<T>(promise: Promise<T>): Promise<T | undefined> {
    try {
      return await promise;
    } catch (error: unknown) {
      if ((<{ status?: number }> error).status === 404) {
        return undefined;
      }
      throw error;
    }
  }
}

interface IGraphQlItemData {
  repository: {
    issueOrPullRequest: {
      __typename: 'Issue' | 'PullRequest';
      url: string;
      author: { __typename: string; login: string } | null;
      labels: { nodes: { name: string }[] };
      comments: { nodes: { body: string }[] };
      closingIssuesReferences?: {
        nodes: { number: number; repository: { name: string; owner: { login: string }}}[];
      };
    } | null;
  } | null;
}
