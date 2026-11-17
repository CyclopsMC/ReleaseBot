import type { IItemId, IRepositoryId } from './IGitHubClient';
import type { IModMetadata } from './ModMetadata';

// Matches the hidden marker that lists the releases a comment announced.
const MARKER = /<!-- release-bot: ([^>]*?) -->/gu;

/**
 * A release that was found to include certain issues and pull requests.
 */
export interface IReleaseInfo {
  repository: IRepositoryId;
  tag: string;
  url: string;
  minecraftVersion?: string;
  mod: IModMetadata;
}

/**
 * Builds the comments that announce releases,
 * and determines which releases were already announced in existing comments.
 */
export class CommentBuilder {
  /**
   * @param release A release.
   * @return A case-insensitive key that identifies the release within comment markers.
   */
  public static getReleaseKey(release: IReleaseInfo): string {
    return `${release.repository.owner}/${release.repository.name}@${release.tag}`.toLowerCase();
  }

  /**
   * @param commentBodies The bodies of the existing comments on an issue or pull request.
   * @return The keys of all releases that were already announced.
   */
  public getAnnouncedReleaseKeys(commentBodies: string[]): Set<string> {
    const keys = new Set<string>();
    for (const body of commentBodies) {
      for (const match of body.matchAll(MARKER)) {
        for (const key of match[1].split(/\s+/u)) {
          keys.add(key.toLowerCase());
        }
      }
    }
    return keys;
  }

  /**
   * Build a comment that announces that an issue or pull request is included in the given releases.
   * @param item The issue or pull request the comment will be placed on.
   * @param releases The releases to announce.
   * @return The markdown comment body.
   */
  public build(item: IItemId, releases: IReleaseInfo[]): string {
    const sorted = [ ...releases ].sort((left, right) => left.mod.name.localeCompare(right.mod.name) ||
      CommentBuilder.compareVersions(right.minecraftVersion ?? '', left.minecraftVersion ?? ''));
    const lines = [
      `🎉 This is included in the following ${sorted.length === 1 ? 'release' : 'releases'}:`,
      '',
      ...sorted.map(release => `* [${release.mod.name} ${release.tag}](${release.url})${release.minecraftVersion ?
        ` for Minecraft ${release.minecraftVersion}` :
        ''}`),
    ];

    const mods = new Map<string, IReleaseInfo>();
    for (const release of sorted) {
      mods.set(`${release.repository.owner}/${release.repository.name}`.toLowerCase(), release);
    }
    for (const release of mods.values()) {
      const paragraph: string[] = [];
      if (release.repository.owner.toLowerCase() !== item.repository.owner.toLowerCase() ||
        release.repository.name.toLowerCase() !== item.repository.name.toLowerCase()) {
        paragraph.push(`This change is part of ${release.mod.name}, so make sure to update that mod.`);
      }
      const downloads = [
        ...release.mod.curseForgeUrl ? [ `[CurseForge](${release.mod.curseForgeUrl})` ] : [],
        ...release.mod.modrinthUrl ? [ `[Modrinth](${release.mod.modrinthUrl})` ] : [],
      ];
      if (downloads.length > 0) {
        paragraph.push(`⬇️ Download ${release.mod.name} from ${downloads.join(' or ')}.`);
      }
      if (paragraph.length > 0) {
        lines.push('', ...paragraph);
      }
    }

    lines.push('', `<!-- release-bot: ${sorted.map(release => `${release.repository.owner}/${release.repository.name}@${release.tag}`).join(' ')} -->`);
    return `${lines.join('\n')}\n`;
  }

  /**
   * Compare two dot-separated version strings numerically.
   * @param left A version, such as '1.21.1'.
   * @param right A version, such as '26.1.2'.
   * @return A negative number if left is lower, a positive number if left is higher, zero if equal.
   */
  public static compareVersions(left: string, right: string): number {
    const leftParts = left.split('.').map(part => Number.parseInt(part, 10) || 0);
    const rightParts = right.split('.').map(part => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i++) {
      const difference = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  }
}
