# Publish a release

English · [简体中文](../../zh/guides/releases.md) · [Documentation](../README.md)

The package is `dsh-pet-powercontext`. The release tag determines its version: `v0.1.1` produces version `0.1.1`, and `v0.1.2-beta.1` produces version `0.1.2-beta.1`. You do not need to edit version fields before releasing. The [Release workflow](../../../.github/workflows/release.yml) runs only for pushed `v*` tags or manual dispatches. Pull requests and ordinary branch pushes do not trigger packaging. Only a pushed `v*` tag enters publication.

## Prepare

1. Merge the intended changes into `master`.
2. To publish npm, configure repository Actions variable `NPM_PUBLISH=true` and Actions secret `NPM_TOKEN` with publish access. Use an npm token suitable for unattended publication; never commit it to `.npmrc`. If the variable is absent or false, only GitHub Release and the desktop artifact are published.
3. Choose an unused version and push its tag from the intended commit, for example:

```sh
git switch master
git pull --ff-only origin master
git tag v0.1.1
git push origin v0.1.1
```

Before building, the workflows write the tag-derived version into `dsh-pet/package.json` and `openapi.yaml` in the runner checkout. The npm archive, Windows desktop application, and robot packages use that version. These changes are not committed or pushed back to the repository. The source version remains the fallback for local builds and manual branch builds.

## Automatic sequence

| Stage                   | Work                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Prepare version         | Validate the package name and tag format; apply the tag version to package and OpenAPI metadata                        |
| Build                   | Install locked dependencies; run unit tests and full `npm pack` prepack checks                                         |
| Exercise                | Run Chromium UI/script tests; install the archive and check CLI `--help` / `--check`                                   |
| Preserve                | Generate SHA256SUMS and upload the tested package as an Actions artifact for 14 days                                   |
| Publish npm, if enabled | Verify checksum, publish the same archive with lifecycle scripts disabled                                              |
| Create GitHub Release   | Generate notes and attach the archive and checksum                                                                     |
| Build desktop           | Call the Windows workflow and attach `dsh-pet-powercontext-<version>-desktop-windows-x64-standard.zip` to that release |

Versions ending in `alpha.N`, `beta.N` or `rc.N` use that npm dist-tag and a GitHub prerelease. Stable versions use `latest`. Manual runs of **Release** validate and package without publishing, even when selecting a tag. Use **Actions → Release → Run workflow** and optionally supply `ref` to check a branch, tag, or PR ref.

Manual tag builds use the selected tag's version. Manual branch or PR builds use the version committed in that checkout. Use `refs/tags/v0.1.1` for an explicit tag or `refs/heads/<branch>` for an explicit branch. Invalid release tags stop the build before version fields are changed.

The separate **Robot slim bundles** workflow also runs on pushed `v*` tags or manual dispatches. It produces platform packages as Actions artifacts without uploading them to a GitHub Release or publishing to npm.

## Failure and retry

Build/test failures stop publication. When npm is enabled, its failure prevents the GitHub Release step. A later Windows failure does not roll back npm or GitHub Release: rerun `release-app` manually with the existing tag to attach the ZIP.

A registry version is immutable. If npm succeeded but a later step failed, do not assume rerunning the whole release will skip npm; this workflow does not implement that recovery. Check which assets exist before choosing the retry step. Use a new version for changed package contents.

## Local package check

From the inner package directory, run `npm pack --pack-destination /absolute/path/outside/the/repository`. This runs the full prepack chain. Keep archives, smoke-test homes and logs outside the checkout; on local Linux use `/data/codex-tmp/` and set `TMPDIR` there.
