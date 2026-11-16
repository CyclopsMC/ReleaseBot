import type { IReleaseInfo } from '../lib/CommentBuilder';
import type { IItem } from '../lib/IGitHubClient';
import type { IReport } from '../lib/ReleaseBot';
import { ReportFormatter } from '../lib/ReportFormatter';

const CORE = { owner: 'CyclopsMC', name: 'CyclopsCore' };
const RELEASE: IReleaseInfo = {
  repository: CORE,
  tag: '26.1.2-1.31.5',
  url: 'https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5',
  minecraftVersion: '26.1.2',
  mod: { name: 'Cyclops Core' },
};

function item(number: number): IItem {
  return {
    repository: CORE,
    number,
    type: 'Issue',
    url: `https://github.com/CyclopsMC/CyclopsCore/issues/${number}`,
    authorIsBot: false,
    labels: [],
    commentBodies: [],
    closingIssues: [],
  };
}

describe('ReportFormatter', () => {
  let formatter: ReportFormatter;
  let report: IReport;

  beforeEach(() => {
    formatter = new ReportFormatter();
    report = {
      dryRun: false,
      windowStart: new Date('2026-11-02T12:00:00Z'),
      windowEnd: new Date('2026-11-16T11:30:00Z'),
      releases: [],
      deferred: [],
      skipped: [],
      actions: [],
      errors: [],
    };
  });

  it('should format an empty report', () => {
    expect(formatter.format(report)).toBe(`## Release bot run

Handled releases published between 2026-11-02T12:00:00.000Z and 2026-11-16T11:30:00.000Z.

### Actions

None

### Handled releases

None
`);
  });

  it('should format a full dry-run report', () => {
    report.dryRun = true;
    report.releases = [ RELEASE ];
    report.actions = [
      { item: item(258), releases: [ RELEASE ], comment: 'Comment', label: true },
      { item: item(263), releases: [ RELEASE ], label: false },
    ];
    report.deferred = [{ repository: CORE, tag: '1.21.1-1.30.2', reason: 'waiting' }];
    report.skipped = [{ repository: CORE, tag: '1.20.1-1.22.5', reason: 'no changelog was found' }];
    report.errors = [ 'Something failed' ];
    expect(formatter.format(report)).toBe(`## Release bot run (dry run)

Handled releases published between 2026-11-02T12:00:00.000Z and 2026-11-16T11:30:00.000Z.

### Planned actions

| Item | Releases | Comment | Label |
| --- | --- | --- | --- |
| [CyclopsMC/CyclopsCore#258](https://github.com/CyclopsMC/CyclopsCore/issues/258) | CyclopsCore 26.1.2-1.31.5 | yes | yes |
| [CyclopsMC/CyclopsCore#263](https://github.com/CyclopsMC/CyclopsCore/issues/263) | CyclopsCore 26.1.2-1.31.5 | no | no |

<details><summary>Comment on CyclopsMC/CyclopsCore#258</summary>

Comment
</details>

### Handled releases

* [CyclopsMC/CyclopsCore 26.1.2-1.31.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5)

### Deferred releases

* CyclopsMC/CyclopsCore 1.21.1-1.30.2: waiting

### Skipped releases

* CyclopsMC/CyclopsCore 1.20.1-1.22.5: no changelog was found

### Errors

* Something failed
`);
  });
});
