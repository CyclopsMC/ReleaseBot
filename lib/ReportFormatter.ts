import { ChangelogParser } from './ChangelogParser';
import type { IReleaseNote, IReport } from './ReleaseBot';

/**
 * Formats a report as markdown, for use as a GitHub Actions job summary.
 */
export class ReportFormatter {
  /**
   * @param report A report.
   * @return A markdown representation of the report.
   */
  public format(report: IReport): string {
    const lines = [
      `## Release bot run${report.dryRun ? ' (dry run)' : ''}`,
      '',
      `Handled releases published between ${report.windowStart.toISOString()} and ${report.windowEnd.toISOString()}.`,
      '',
    ];

    lines.push(`### ${report.dryRun ? 'Planned actions' : 'Actions'}`, '');
    if (report.actions.length === 0) {
      lines.push('None', '');
    } else {
      lines.push('| Item | Releases | Comment | Label |', '| --- | --- | --- | --- |');
      for (const action of report.actions) {
        lines.push(`| [${ChangelogParser.getItemName(action.item)}](${action.item.url}) | ${action.releases
          .map(release => `${release.repository.name} ${release.tag}`).join(', ')} | ${action.comment ? 'yes' : 'no'} | ${action.label ? 'yes' : 'no'} |`);
      }
      lines.push('');
      for (const action of report.actions) {
        if (action.comment) {
          lines.push(
            `<details><summary>Comment on ${ChangelogParser.getItemName(action.item)}</summary>`,
            '',
            action.comment,
            '</details>',
            '',
          );
        }
      }
    }

    lines.push('### Handled releases', '');
    if (report.releases.length === 0) {
      lines.push('None');
    }
    for (const release of report.releases) {
      lines.push(`* [${release.repository.owner}/${release.repository.name} ${release.tag}](${release.url})`);
    }
    lines.push('');

    this.formatNotes(lines, 'Deferred releases', report.deferred);
    this.formatNotes(lines, 'Skipped releases', report.skipped);
    if (report.errors.length > 0) {
      lines.push('### Errors', '', ...report.errors.map(error => `* ${error}`), '');
    }
    return lines.join('\n');
  }

  protected formatNotes(lines: string[], title: string, notes: IReleaseNote[]): void {
    if (notes.length > 0) {
      lines.push(
        `### ${title}`,
        '',
        ...notes.map(note => `* ${note.repository.owner}/${note.repository.name} ${note.tag}: ${note.reason}`),
        '',
      );
    }
  }
}
