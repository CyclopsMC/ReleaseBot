import type { IReleaseInfo } from '../lib/CommentBuilder';
import { CommentBuilder } from '../lib/CommentBuilder';
import type { IItemId, IRepositoryId } from '../lib/IGitHubClient';

const CORE: IRepositoryId = { owner: 'CyclopsMC', name: 'CyclopsCore' };
const EVILCRAFT: IRepositoryId = { owner: 'CyclopsMC', name: 'EvilCraft' };
const CORE_MOD = {
  name: 'Cyclops Core',
  curseForgeUrl: 'https://www.curseforge.com/minecraft/mc-mods/cyclops-core',
  modrinthUrl: 'https://modrinth.com/mod/Z9DM0LJ4',
};

function coreRelease(tag: string, minecraftVersion?: string): IReleaseInfo {
  return {
    repository: CORE,
    tag,
    url: `https://github.com/CyclopsMC/CyclopsCore/releases/tag/${tag}`,
    minecraftVersion,
    mod: CORE_MOD,
  };
}

describe('CommentBuilder', () => {
  let builder: CommentBuilder;
  const coreIssue: IItemId = { repository: CORE, number: 258 };

  beforeEach(() => {
    builder = new CommentBuilder();
  });

  describe('build', () => {
    it('should announce a single release', () => {
      expect(builder.build(coreIssue, [ coreRelease('26.1.2-1.31.5', '26.1.2') ])).toBe(`This is included in the following release:

* [Cyclops Core 26.1.2-1.31.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5) for Minecraft 26.1.2

Download Cyclops Core from [CurseForge](https://www.curseforge.com/minecraft/mc-mods/cyclops-core) or [Modrinth](https://modrinth.com/mod/Z9DM0LJ4).

<!-- release-bot: CyclopsMC/CyclopsCore@26.1.2-1.31.5 -->
`);
    });

    it('should announce multiple releases with the newest Minecraft version first', () => {
      expect(builder.build(coreIssue, [
        coreRelease('1.20.1-1.22.5', '1.20.1'),
        coreRelease('26.1.2-1.31.5', '26.1.2'),
        coreRelease('1.21.1-1.30.2', '1.21.1'),
      ])).toBe(`This is included in the following releases:

* [Cyclops Core 26.1.2-1.31.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5) for Minecraft 26.1.2
* [Cyclops Core 1.21.1-1.30.2](https://github.com/CyclopsMC/CyclopsCore/releases/tag/1.21.1-1.30.2) for Minecraft 1.21.1
* [Cyclops Core 1.20.1-1.22.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/1.20.1-1.22.5) for Minecraft 1.20.1

Download Cyclops Core from [CurseForge](https://www.curseforge.com/minecraft/mc-mods/cyclops-core) or [Modrinth](https://modrinth.com/mod/Z9DM0LJ4).

<!-- release-bot: CyclopsMC/CyclopsCore@26.1.2-1.31.5 CyclopsMC/CyclopsCore@1.21.1-1.30.2 CyclopsMC/CyclopsCore@1.20.1-1.22.5 -->
`);
    });

    it('should mention that a release of another mod must be updated', () => {
      expect(builder.build({ repository: EVILCRAFT, number: 1239 }, [ coreRelease('26.1.2-1.30.2', '26.1.2') ]))
        .toBe(`This is included in the following release:

* [Cyclops Core 26.1.2-1.30.2](https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.30.2) for Minecraft 26.1.2

This change is part of Cyclops Core, so make sure to update that mod.
Download Cyclops Core from [CurseForge](https://www.curseforge.com/minecraft/mc-mods/cyclops-core) or [Modrinth](https://modrinth.com/mod/Z9DM0LJ4).

<!-- release-bot: CyclopsMC/CyclopsCore@26.1.2-1.30.2 -->
`);
    });

    it('should handle releases of multiple mods without download links or Minecraft versions', () => {
      expect(builder.build({ repository: EVILCRAFT, number: 1 }, [
        { repository: EVILCRAFT, tag: 'v2', url: 'https://example.org/v2', mod: { name: 'EvilCraft' }},
        { repository: CORE, tag: 'v1', url: 'https://example.org/v1', mod: { name: 'Cyclops Core' }},
      ])).toBe(`This is included in the following releases:

* [Cyclops Core v1](https://example.org/v1)
* [EvilCraft v2](https://example.org/v2)

This change is part of Cyclops Core, so make sure to update that mod.

<!-- release-bot: CyclopsMC/CyclopsCore@v1 CyclopsMC/EvilCraft@v2 -->
`);
    });

    it('should handle a mod with only a Modrinth link', () => {
      expect(builder.build(coreIssue, [{
        ...coreRelease('26.1.2-1.31.5', '26.1.2'),
        mod: { name: 'Cyclops Core', modrinthUrl: 'https://modrinth.com/mod/Z9DM0LJ4' },
      }])).toContain('Download Cyclops Core from [Modrinth](https://modrinth.com/mod/Z9DM0LJ4).');
    });
  });

  describe('getAnnouncedReleaseKeys', () => {
    it('should handle no comments', () => {
      expect(builder.getAnnouncedReleaseKeys([])).toEqual(new Set());
    });

    it('should handle comments without markers', () => {
      expect(builder.getAnnouncedReleaseKeys([ 'Thanks for reporting!' ])).toEqual(new Set());
    });

    it('should return the releases of all markers', () => {
      expect(builder.getAnnouncedReleaseKeys([
        'Thanks for reporting!',
        builder.build(coreIssue, [ coreRelease('1.20.1-1.22.5'), coreRelease('1.21.1-1.30.2') ]),
        builder.build(coreIssue, [ coreRelease('26.1.2-1.31.5') ]),
      ])).toEqual(new Set([
        'cyclopsmc/cyclopscore@1.20.1-1.22.5',
        'cyclopsmc/cyclopscore@1.21.1-1.30.2',
        'cyclopsmc/cyclopscore@26.1.2-1.31.5',
      ]));
    });

    it('should match keys produced by getReleaseKey', () => {
      const release = coreRelease('26.1.2-1.31.5');
      expect(builder.getAnnouncedReleaseKeys([ builder.build(coreIssue, [ release ]) ])
        .has(CommentBuilder.getReleaseKey(release))).toBe(true);
    });
  });

  describe('compareVersions', () => {
    it('should compare versions numerically', () => {
      expect(CommentBuilder.compareVersions('1.21.1', '26.1.2')).toBeLessThan(0);
      expect(CommentBuilder.compareVersions('1.21.10', '1.21.9')).toBeGreaterThan(0);
      expect(CommentBuilder.compareVersions('1.21', '1.21.0')).toBe(0);
      expect(CommentBuilder.compareVersions('1.21.1', '1.21')).toBeGreaterThan(0);
      expect(CommentBuilder.compareVersions('', 'a')).toBe(0);
    });
  });
});
