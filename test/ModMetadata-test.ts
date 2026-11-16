import { parseMinecraftVersion, parseModMetadata, parseProperties } from '../lib/ModMetadata';

const CORE = { owner: 'CyclopsMC', name: 'CyclopsCore' };

describe('ModMetadata', () => {
  describe('parseModMetadata', () => {
    it('should parse a gradle.properties file', () => {
      expect(parseModMetadata(CORE, `# Project
mod_version=1.31.5
group=org.cyclops.cyclopscore

# Common
minecraft_version=26.1.2
mod_name=Cyclops Core
display_url=https://www.curseforge.com/minecraft/mc-mods/cyclops-core
modrinth_project_id=Z9DM0LJ4

cyclopscore_version=
`)).toEqual({
        name: 'Cyclops Core',
        curseForgeUrl: 'https://www.curseforge.com/minecraft/mc-mods/cyclops-core',
        modrinthUrl: 'https://modrinth.com/mod/Z9DM0LJ4',
      });
    });

    it('should fall back to the repository name without properties', () => {
      expect(parseModMetadata(CORE)).toEqual({ name: 'CyclopsCore' });
    });

    it('should ignore display URLs that are not on CurseForge', () => {
      expect(parseModMetadata(CORE, 'display_url=https://example.org/')).toEqual({ name: 'CyclopsCore' });
    });
  });

  describe('parseProperties', () => {
    it('should parse key-value pairs and skip comments, continuations and empty values', () => {
      expect(parseProperties(`# Comment
a=b
 c = d e \r
empty=
org.gradle.jvmargs=--add-exports jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED \\
  --add-exports jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED
`)).toEqual({
        a: 'b',
        c: 'd e',
        'org.gradle.jvmargs': '--add-exports jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED \\',
      });
    });
  });

  describe('parseMinecraftVersion', () => {
    it('should parse tags of the form <minecraft version>-<mod version>', () => {
      expect(parseMinecraftVersion('26.1.2-1.31.5')).toBe('26.1.2');
      expect(parseMinecraftVersion('1.21.1-1.30.2')).toBe('1.21.1');
      expect(parseMinecraftVersion('1.21-pre1-1.0.0')).toBe('1.21-pre1');
    });

    it('should return undefined for other tags', () => {
      expect(parseMinecraftVersion('v1.0.0')).toBeUndefined();
      expect(parseMinecraftVersion('1.21.1-1.30')).toBeUndefined();
    });
  });
});
