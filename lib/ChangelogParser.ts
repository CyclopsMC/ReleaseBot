import type { IItemId, IRepositoryId } from './IGitHubClient';

const OWNER = '[A-Za-z\\d-]+';
const REPOSITORY = '[\\w.-]+';
const URL_REFERENCE = `https:\\/\\/github\\.com\\/(${OWNER})\\/(${REPOSITORY})\\/(?:issues|pull)\\/(\\d+)`;
const SHORT_REFERENCE = `(?<![\\w#/.-])(?:(${OWNER})\\/(${REPOSITORY}))?#(\\d+)`;
const REFERENCE = `(?:${URL_REFERENCE}|${SHORT_REFERENCE})`;
const REFERENCE_NON_CAPTURING = REFERENCE.replaceAll(/\((?!\?)/gu, '(?:');
const REFERENCE_SEPARATOR = '(?:\\s*,\\s*|\\s*&\\s*|\\s+and\\s+)';
const CLOSING_KEYWORD = '\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b:?';

// Matches the references after a closing keyword, such as 'Closes #1, #2 and CyclopsMC/CyclopsCore#3'.
const CLOSING_REFERENCES = new RegExp(
  `${CLOSING_KEYWORD}\\s+(${REFERENCE_NON_CAPTURING}(?:${REFERENCE_SEPARATOR}${REFERENCE_NON_CAPTURING})*)`,
  'giu',
);
// Matches a reference between brackets, such as '(#12)', which is how pull requests are referenced in commits.
const CHANGE_REFERENCE = new RegExp(`\\(\\s*(${REFERENCE_NON_CAPTURING})\\s*\\)`, 'gu');
// Matches a single reference.
const SINGLE_REFERENCE = new RegExp(REFERENCE, 'gu');

/**
 * Determines which issues and pull requests are included in a changelog.
 */
export class ChangelogParser {
  private readonly organization: string;

  /**
   * @param organization Only references to repositories of this organization will be returned.
   */
  public constructor(organization: string) {
    this.organization = organization.toLowerCase();
  }

  /**
   * Find all issues and pull requests a changelog includes.
   * These are references within brackets, such as '(#12)', and references after a closing keyword,
   * such as 'Closes #12'.
   * Other mentions, such as 'Related to #12', are ignored.
   * @param changelog A changelog text.
   * @param repository The repository the changelog belongs to, used for references without a repository.
   * @return The unique referenced issues and pull requests within the organization, in order of appearance.
   */
  public parseReferences(changelog: string, repository: IRepositoryId): IItemId[] {
    const references = new Map<string, IItemId & { index: number }>();
    for (const regex of [ CHANGE_REFERENCE, CLOSING_REFERENCES ]) {
      for (const match of changelog.matchAll(regex)) {
        for (const reference of match[1].matchAll(SINGLE_REFERENCE)) {
          const owner = reference[1] ?? reference[4];
          const name = reference[2] ?? reference[5];
          const id: IItemId = {
            repository: owner ? { owner, name } : repository,
            number: Number.parseInt(reference[3] ?? reference[6], 10),
          };
          const key = ChangelogParser.getItemKey(id);
          if (id.repository.owner.toLowerCase() === this.organization && !references.has(key)) {
            references.set(key, { ...id, index: match.index + match[0].indexOf(match[1]) + reference.index });
          }
        }
      }
    }
    return [ ...references.values() ]
      .sort((left, right) => left.index - right.index)
      .map(({ repository: itemRepository, number }) => ({ repository: itemRepository, number }));
  }

  /**
   * Extract the section of a single release from a composite changelog,
   * which has sections that start with anchors such as '<a name="1.21.1-1.30.2"></a>'.
   * @param changelog A composite changelog.
   * @param tag The release tag.
   * @return The section, or undefined if the changelog has no section for the tag.
   */
  public extractSection(changelog: string, tag: string): string | undefined {
    const anchor = `<a name="${tag}"></a>`;
    const start = changelog.indexOf(anchor);
    if (start < 0) {
      return undefined;
    }
    const section = changelog.slice(start + anchor.length);
    const end = section.indexOf('<a name="');
    return end < 0 ? section : section.slice(0, end);
  }

  /**
   * @param id An issue or pull request identifier.
   * @return A case-insensitive key for the identifier.
   */
  public static getItemKey(id: IItemId): string {
    return ChangelogParser.getItemName(id).toLowerCase();
  }

  /**
   * @param id An issue or pull request identifier.
   * @return A human-readable name for the identifier, such as 'CyclopsMC/CyclopsCore#12'.
   */
  public static getItemName(id: IItemId): string {
    return `${id.repository.owner}/${id.repository.name}#${id.number}`;
  }
}
