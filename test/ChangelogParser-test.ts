import { ChangelogParser } from '../lib/ChangelogParser';
import type { IRepositoryId } from '../lib/IGitHubClient';

const CORE: IRepositoryId = { owner: 'CyclopsMC', name: 'CyclopsCore' };

describe('ChangelogParser', () => {
  let parser: ChangelogParser;

  beforeEach(() => {
    parser = new ChangelogParser('CyclopsMC');
  });

  describe('parseReferences', () => {
    it('should handle an empty changelog', () => {
      expect(parser.parseReferences('', CORE)).toEqual([]);
    });

    it('should handle a changelog without references', () => {
      expect(parser.parseReferences(`As always, don't forget to backup your world before updating!

Fixes:
* Fix capacity-based fluid capability not taking into account stack size
`, CORE)).toEqual([]);
    });

    it('should find pull requests and closed issues, and ignore advisories and related issues', () => {
      expect(parser.parseReferences(`As always, don't forget to backup your world before updating!

Fixes:
* Fix loot registry corruption when mods load in parallel (#263)
* Fix duplicate packet IDs when mods load in parallel (#262), Closes #258
* Restrict recipe display regex requests from clients (#261), Closes GHSA-8469-hgvj-5g4r
* Limit list and map sizes and avoid class init when decoding packets (#260), Closes GHSA-4jfp-83qj-mr8r
* Improve concurrency robustness of Map packet codec
  This also adds more detailed error logging for when it fails again.
  Related to #258
`, CORE)).toEqual([
        { repository: CORE, number: 263 },
        { repository: CORE, number: 262 },
        { repository: CORE, number: 258 },
        { repository: CORE, number: 261 },
        { repository: CORE, number: 260 },
      ]);
    });

    it('should find closed issues in other repositories', () => {
      expect(parser.parseReferences(`Fixes:
* Fix Forge configurable type actions not always being set (#253)
  Closes CyclopsMC/EverlastingAbilities#329
* Fix crash when registering GUIs on Fabric, Closes CyclopsMC/ColossalChests#200
`, CORE)).toEqual([
        { repository: CORE, number: 253 },
        { repository: { owner: 'CyclopsMC', name: 'EverlastingAbilities' }, number: 329 },
        { repository: { owner: 'CyclopsMC', name: 'ColossalChests' }, number: 200 },
      ]);
    });

    it('should ignore regressions that are mentioned', () => {
      expect(parser.parseReferences(`Fixes:
* Fix EntityHelpers not spawning any entities
  Closes CyclopsMC/EvilCraft#1239
  Regression due to CyclopsMC/EvilCraft#1102
`, CORE)).toEqual([
        { repository: { owner: 'CyclopsMC', name: 'EvilCraft' }, number: 1239 },
      ]);
    });

    it('should handle all closing keywords in any case', () => {
      expect(parser.parseReferences(`
close #1, closes #2, closed #3, fix #4, fixes #5, fixed #6, resolve #7, resolves #8, RESOLVED #9, Fixes: #10
`, CORE).map(reference => reference.number)).toEqual([ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]);
    });

    it('should handle lists of closed issues', () => {
      expect(parser.parseReferences('Closes #1, #2 and CyclopsMC/EvilCraft#3 & #4', CORE)).toEqual([
        { repository: CORE, number: 1 },
        { repository: CORE, number: 2 },
        { repository: { owner: 'CyclopsMC', name: 'EvilCraft' }, number: 3 },
        { repository: CORE, number: 4 },
      ]);
    });

    it('should handle issue and pull request URLs', () => {
      expect(parser.parseReferences(`
* Fix a crash (https://github.com/CyclopsMC/CyclopsCore/pull/12)
  Closes https://github.com/CyclopsMC/IntegratedDynamics/issues/1695
`, CORE)).toEqual([
        { repository: CORE, number: 12 },
        { repository: { owner: 'CyclopsMC', name: 'IntegratedDynamics' }, number: 1695 },
      ]);
    });

    it('should ignore references outside the organization', () => {
      expect(parser.parseReferences(`
* Fix compatibility (#12), Closes someone/SomeMod#5, Closes https://github.com/someone/SomeMod/issues/6
`, CORE)).toEqual([
        { repository: CORE, number: 12 },
      ]);
    });

    it('should match the organization case-insensitively', () => {
      expect(parser.parseReferences('Closes cyclopsmc/evilcraft#3', CORE)).toEqual([
        { repository: { owner: 'cyclopsmc', name: 'evilcraft' }, number: 3 },
      ]);
    });

    it('should return each reference once', () => {
      expect(parser.parseReferences(`
* Fix a crash (#12), Closes #11
* Fix another crash (#12), Closes #11, Closes CyclopsMC/CyclopsCore#11
`, CORE)).toEqual([
        { repository: CORE, number: 12 },
        { repository: CORE, number: 11 },
      ]);
    });

    it('should ignore closing keywords that are part of other words', () => {
      expect(parser.parseReferences('Hotfixes #1, prefix #2, enclosed #3', CORE)).toEqual([]);
    });

    it('should ignore hashes within other words and URLs', () => {
      expect(parser.parseReferences('Closes https://example.org/page#12, (https://example.org/#13)', CORE)).toEqual([]);
    });
  });

  describe('extractSection', () => {
    const changelog = `# Changelog for Minecraft 26.1.2
All notable changes to this project will be documented in this file.

<a name="26.1.2-1.31.5"></a>
## [26.1.2-1.31.5](https://github.com/CyclopsMC/CyclopsCore/compare/26.1.2-1.31.4...26.1.2-1.31.5) - 2026-11-15 10:02:47

### Fixed
* Fix duplicate packet IDs when mods load in parallel (#262), Closes #258

<a name="26.1.2-1.31.4"></a>
## [26.1.2-1.31.4](https://github.com/CyclopsMC/CyclopsCore/compare/26.1.2-1.31.3...26.1.2-1.31.4) - 2026-10-31 13:33:20 +0100

### Fixed
* Make SingleCache#get thread-safe to fix random crashes (#257), Closes #256
`;

    it('should extract a section followed by another section', () => {
      expect(parser.extractSection(changelog, '26.1.2-1.31.5')).toBe(`
## [26.1.2-1.31.5](https://github.com/CyclopsMC/CyclopsCore/compare/26.1.2-1.31.4...26.1.2-1.31.5) - 2026-11-15 10:02:47

### Fixed
* Fix duplicate packet IDs when mods load in parallel (#262), Closes #258

`);
    });

    it('should extract the last section', () => {
      expect(parser.extractSection(changelog, '26.1.2-1.31.4')).toBe(`
## [26.1.2-1.31.4](https://github.com/CyclopsMC/CyclopsCore/compare/26.1.2-1.31.3...26.1.2-1.31.4) - 2026-10-31 13:33:20 +0100

### Fixed
* Make SingleCache#get thread-safe to fix random crashes (#257), Closes #256
`);
    });

    it('should return undefined for an unknown tag', () => {
      expect(parser.extractSection(changelog, '26.1.2-1.31.6')).toBeUndefined();
    });

    it('should only include the references of the extracted section', () => {
      expect(parser.parseReferences(parser.extractSection(changelog, '26.1.2-1.31.5')!, CORE)).toEqual([
        { repository: CORE, number: 262 },
        { repository: CORE, number: 258 },
      ]);
    });
  });

  describe('getItemKey', () => {
    it('should produce lowercase keys', () => {
      expect(ChangelogParser.getItemKey({ repository: CORE, number: 12 })).toBe('cyclopsmc/cyclopscore#12');
    });
  });

  describe('getItemName', () => {
    it('should keep the original case', () => {
      expect(ChangelogParser.getItemName({ repository: CORE, number: 12 })).toBe('CyclopsMC/CyclopsCore#12');
    });
  });
});
