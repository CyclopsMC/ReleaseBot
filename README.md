# Release Bot

[![Build status](https://github.com/CyclopsMC/ReleaseBot/workflows/CI/badge.svg)](https://github.com/CyclopsMC/ReleaseBot/actions?query=workflow%3ACI)
[![Coverage Status](https://coveralls.io/repos/github/CyclopsMC/ReleaseBot/badge.svg?branch=master)](https://coveralls.io/github/CyclopsMC/ReleaseBot?branch=master)

This repository contains a bot that comments on issues and pull requests of [CyclopsMC](https://github.com/CyclopsMC) mods once they are included in a release.
It runs every hour as a [GitHub Actions workflow](.github/workflows/release-bot.yml), and covers all repositories of the organization.

Concretely, for each new release, it does the following:

* Find the included issues and pull requests in the changelog of the release (`resources/changelog/<tag>.txt`): references between brackets such as `(#262)`, and references after a closing keyword such as `Closes #258` or `Closes CyclopsMC/EverlastingAbilities#329`. Other mentions, such as `Related to #258`, are ignored.
* Also include the issues that are closed by included pull requests.
* Add a comment to each included issue, and to each included pull request that is not authored by a bot or by a maintainer.
* Add the `released` label to each included issue and pull request.

For example, an issue that was fixed for three Minecraft versions receives the following comment:

```markdown
🎉 This is included in the following releases:

* [Cyclops Core 26.1.2-1.31.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5) for Minecraft 26.1.2
* [Cyclops Core 1.21.1-1.30.2](https://github.com/CyclopsMC/CyclopsCore/releases/tag/1.21.1-1.30.2) for Minecraft 1.21.1
* [Cyclops Core 1.20.1-1.22.5](https://github.com/CyclopsMC/CyclopsCore/releases/tag/1.20.1-1.22.5) for Minecraft 1.20.1

⬇️ Download Cyclops Core from [CurseForge](https://www.curseforge.com/minecraft/mc-mods/cyclops-core) or [Modrinth](https://modrinth.com/mod/Z9DM0LJ4).

<!-- release-bot: CyclopsMC/CyclopsCore@26.1.2-1.31.5 CyclopsMC/CyclopsCore@1.21.1-1.30.2 CyclopsMC/CyclopsCore@1.20.1-1.22.5 -->
```

If an issue of one mod is fixed in a release of another mod (such as Cyclops Core),
the comment also mentions that the other mod must be updated.

## Installation

The bot authenticates as a GitHub App, so that its comments are clearly automated and not tied to a personal account.

### Creating the GitHub App

1. Create a new GitHub App in the [organization settings](https://github.com/organizations/CyclopsMC/settings/apps/new):
   * Name: for example `CyclopsMC Release Bot`. Comments will be posted by the corresponding `[bot]` account.
   * Homepage URL: `https://github.com/CyclopsMC/ReleaseBot`
   * Webhook: disable _Active_, as the bot does not use webhooks.
   * Repository permissions:
     * Actions: _Read-only_ (to check if the CI workflow of a release succeeded)
     * Contents: _Read-only_ (to read changelogs)
     * Issues: _Read and write_ (to comment and label)
     * Pull requests: _Read and write_ (to comment and label)
   * Where can this GitHub App be installed: _Only on this account_
2. After creating the app, note its _Client ID_, and generate a private key.
3. Install the app on the CyclopsMC organization, for _All repositories_, so that new repositories are covered automatically.

### Configuring this repository

In _Settings > Secrets and variables > Actions_ of this repository, add:

| Name | Type | Value |
| --- | --- | --- |
| `RELEASE_BOT_CLIENT_ID` | Variable | The Client ID of the GitHub App. The workflow is skipped until this is set. |
| `RELEASE_BOT_PRIVATE_KEY` | Secret | The contents of the private key file of the GitHub App. |
| `RELEASE_BOT_NOT_BEFORE` | Variable | The date from which releases are handled, such as `2026-11-20`. Older releases never receive comments. |
| `RELEASE_BOT_REPOSITORIES` | Variable | Optional: comma-separated names of the only repositories to handle, such as `CyclopsCore,EverlastingAbilities`. |
| `RELEASE_BOT_LIVE` | Variable | Set to `true` to let scheduled runs add comments and labels. Until then, scheduled runs are dry runs. |

### Going live

1. Run the [Release Bot workflow](https://github.com/CyclopsMC/ReleaseBot/actions/workflows/release-bot.yml) manually as a dry run, optionally with a larger number of lookback days, and check the planned comments in the job summary.
2. Set the `RELEASE_BOT_NOT_BEFORE` variable, and optionally `RELEASE_BOT_REPOSITORIES` to start with a few repositories.
3. Set the `RELEASE_BOT_LIVE` variable to `true`.

## Usage

### How releases are handled

Each run considers the releases of the last 14 days that were published after `RELEASE_BOT_NOT_BEFORE`.
Drafts, prereleases, and releases whose tag no longer exists are ignored.

Releases of a repository are only handled once they have settled:

* The latest release of the repository was published at least 30 minutes ago.
  This makes sure that releases for different Minecraft versions that are published together are announced in a single comment.
* The `ci.yml` workflow of each release has finished, so that the mod files have been uploaded to CurseForge and Modrinth.
  Releases whose workflow did not succeed are skipped, until a rerun of the workflow succeeds.

The mod name and download links are taken from the `mod_name`, `display_url`, and `modrinth_project_id` properties in `gradle.properties` on the default branch.
If the changelog file of a release does not exist, the section of the release in the release description is used instead.

Each comment contains a hidden marker that lists the announced releases.
This makes runs idempotent: a release is never announced twice on the same issue or pull request,
and a later release (for example, for another Minecraft version) results in a new comment that only lists the new release.

Requests to GitHub go through [Octokit](https://github.com/octokit/rest.js) with its [throttling plugin](https://github.com/octokit/plugin-throttling.js),
which handles rate limits and waits a few seconds between comments.
As a safety measure, a run that would post more than 50 comments does not post anything.
If anything fails, the workflow run fails, and the job summary lists all errors.

### Running manually

The workflow can be started manually from the _Actions_ tab, with the following inputs:

* `dry_run`: Only report what would be done, without adding comments or labels. Enabled by default.
* `not_before`: Ignore releases published before this date. Defaults to the `RELEASE_BOT_NOT_BEFORE` variable.
* `lookback_days`: Ignore releases published more than this number of days ago. Defaults to `14`.
* `repositories`: Comma-separated names of the only repositories to handle. Defaults to the `RELEASE_BOT_REPOSITORIES` variable.

### Running locally

The bot can also be run locally with any token that can read the organization's repositories:

```bash
$ yarn install
$ GITHUB_TOKEN=<token> yarn run start
```

This performs a dry run by default, and prints the report as markdown.

The following environment variables can be used:

| Variable | Default | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | | The token to authenticate with. Required. |
| `GITHUB_API_URL` | `https://api.github.com` | The GitHub API URL. |
| `GITHUB_STEP_SUMMARY` | | A file to append the report to. Set automatically in GitHub Actions. |
| `RELEASE_BOT_ORGANIZATION` | `CyclopsMC` | The organization whose repositories to handle. |
| `RELEASE_BOT_DRY_RUN` | `true` | Set to `false` to add comments and labels. |
| `RELEASE_BOT_NOT_BEFORE` | | Ignore releases published before this date. Required when not in dry-run mode. |
| `RELEASE_BOT_LOOKBACK_DAYS` | `14` | Ignore releases published more than this number of days ago. |
| `RELEASE_BOT_SETTLE_MINUTES` | `30` | The number of minutes after the latest release of a repository before its releases are handled. |
| `RELEASE_BOT_REPOSITORIES` | | Comma-separated names of the only repositories to handle. |
| `RELEASE_BOT_SKIP_PR_AUTHORS` | `rubensworks` | Comma-separated logins of authors whose pull requests are labelled, but receive no comment. |
| `RELEASE_BOT_LABEL` | `released` | The label to add. It is created if it does not exist yet. |
| `RELEASE_BOT_MAX_COMMENTS` | `50` | The maximum number of comments in a single run. |
| `RELEASE_BOT_CI_WORKFLOW` | `ci.yml` | The workflow that must succeed for a release before it is handled. |

## Development

```bash
$ yarn install
$ yarn run build
$ yarn run lint
$ yarn test
```

## License
This software is written by [Ruben Taelman](http://rubensworks.net/).

This code is released under the [MIT license](http://opensource.org/licenses/MIT).
