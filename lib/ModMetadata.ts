import type { IRepositoryId } from './IGitHubClient';

/**
 * Information about a mod that is shown in comments.
 */
export interface IModMetadata {
  name: string;
  curseForgeUrl?: string;
  modrinthUrl?: string;
}

/**
 * Determine the metadata of a mod from its gradle.properties file.
 * @param repository The repository of the mod.
 * @param properties The contents of the gradle.properties file, if it exists.
 * @return The mod metadata, falling back to the repository name if no mod name is defined.
 */
export function parseModMetadata(repository: IRepositoryId, properties?: string): IModMetadata {
  const values = parseProperties(properties ?? '');
  const displayUrl = values.display_url;
  return {
    name: values.mod_name ?? repository.name,
    curseForgeUrl: displayUrl?.includes('curseforge.com') ? displayUrl : undefined,
    modrinthUrl: values.modrinth_project_id ? `https://modrinth.com/mod/${values.modrinth_project_id}` : undefined,
  };
}

/**
 * Parse a Java properties file.
 * Only simple 'key=value' lines are supported.
 * @param properties The contents of a properties file.
 * @return A record of the non-empty properties.
 */
export function parseProperties(properties: string): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (const line of properties.split(/\r?\n/u)) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/u.exec(line);
    if (match?.[2]) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

/**
 * Determine the Minecraft version from a release tag of the form '<minecraft version>-<mod version>'.
 * @param tag A release tag, such as '1.21.1-1.30.2'.
 * @return The Minecraft version, or undefined if the tag does not have the expected form.
 */
export function parseMinecraftVersion(tag: string): string | undefined {
  return /^(.+)-\d+\.\d+\.\d+$/u.exec(tag)?.[1];
}
