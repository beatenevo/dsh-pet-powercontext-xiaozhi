/** Behavior constraints between the release version and the npm tag to prevent the test version from covering latest or being released with the wrong tag. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { releaseMetadata } from '../release-metadata.mjs';

const candidate = {
  name: 'dsh-pet-powercontext',
  version: '0.1.0-beta.1',
  eventName: 'push',
  ref: 'refs/tags/v0.1.0-beta.1',
};

test('The release tag selects the version and archive name even when the source version differs', () => {
  assert.deepEqual(releaseMetadata(candidate), {
    version: '0.1.0-beta.1',
    archive: 'dsh-pet-powercontext-0.1.0-beta.1.tgz',
    npm_tag: 'beta',
    prerelease: 'true',
  });
  assert.deepEqual(releaseMetadata({ ...candidate, ref: 'refs/tags/v0.1.1' }), {
    version: '0.1.1',
    archive: 'dsh-pet-powercontext-0.1.1.tgz',
    npm_tag: 'latest',
    prerelease: 'false',
  });
});

test('The official version uses latest, other pre-release versions maintain their own channels', () => {
  for (const [version, npmTag] of [
    ['1.0.0', 'latest'],
    ['1.1.0-alpha.2', 'alpha'],
    ['1.1.0-rc.1', 'rc'],
  ]) {
    const metadata = releaseMetadata({ ...candidate, version, ref: `refs/tags/v${version}` });
    assert.equal(metadata.npm_tag, npmTag);
    assert.equal(metadata.prerelease, String(npmTag !== 'latest'));
  }
});

test('Push events require a version tag and cannot override it with a manual ref', () => {
  for (const ref of ['refs/heads/main', 'refs/tags/0.1.0', undefined]) {
    assert.throws(() => releaseMetadata({ ...candidate, ref }), /Publication requires a version-tag push/);
  }
  assert.equal(releaseMetadata({ ...candidate, requestedRef: 'v9.0.0' }).version, '0.1.0-beta.1');
});

test('Manual tag selections use the tag while branch and PR selections use the source version', () => {
  const manual = { ...candidate, eventName: 'workflow_dispatch', ref: 'refs/heads/master' };
  for (const requestedRef of ['v1.2.0-rc.3', 'refs/tags/v1.2.0-rc.3']) {
    assert.equal(releaseMetadata({ ...manual, requestedRef }).version, '1.2.0-rc.3');
  }
  assert.equal(releaseMetadata({ ...manual, ref: 'refs/tags/v1.2.0' }).version, '1.2.0');
  for (const requestedRef of ['master', 'refs/heads/v1.2.0', 'version/update', 'refs/pull/12/merge']) {
    assert.equal(releaseMetadata({ ...manual, ref: 'refs/tags/v9.0.0', requestedRef }).version, candidate.version);
  }
  assert.equal(releaseMetadata(manual).version, candidate.version);
});

test('Reject old package names, invalid versions and versions that cannot map channels', () => {
  assert.throws(() => releaseMetadata({ ...candidate, name: 'dsh-pet' }), /Unexpected package name/);
  for (const version of ['01.0.0', '0.1.0-beta.01', '0.1.0-preview.1', '0.1.0\nnpm_tag=latest', '0.1.0\n', '']) {
    assert.throws(() => releaseMetadata({ ...candidate, ref: `refs/tags/v${version}` }), /Expected a stable version/);
  }
  assert.throws(
    () => releaseMetadata({ ...candidate, eventName: 'workflow_dispatch', ref: 'refs/tags/not-a-version' }),
    /Expected a v-prefixed release tag/,
  );
  assert.throws(
    () =>
      releaseMetadata({ ...candidate, eventName: 'workflow_dispatch', ref: 'refs/heads/master', version: undefined }),
    /Expected a stable version/,
  );
});

function releaseCheckout(t, spec) {
  const root = mkdtempSync(join(tmpdir(), 'pet-release-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'dsh-pet/scripts/release-metadata.mjs');
  mkdirSync(join(root, 'dsh-pet/scripts'), { recursive: true });
  copyFileSync(new URL('../release-metadata.mjs', import.meta.url), script);
  const packageFile = join(root, 'dsh-pet/package.json');
  const specFile = join(root, 'openapi.yaml');
  const output = join(root, 'github-output');
  writeFileSync(packageFile, JSON.stringify({ name: candidate.name, version: '0.1.0', private: true }) + '\n');
  writeFileSync(specFile, spec);
  return {
    packageFile,
    specFile,
    output,
    run: (env = {}, args = ['--write']) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/tags/v0.1.1',
          RELEASE_REF: '',
          GITHUB_OUTPUT: output,
          ...env,
        },
      }),
  };
}

const sourceSpec = 'openapi: 3.1.0\ninfo:\n  title: Pet\n  version: 0.1.0\nx-example:\n  version: unchanged\n';

for (const newline of ['\n', '\r\n']) {
  test(`The CLI stamps package and OpenAPI versions and emits matching metadata (${JSON.stringify(newline)})`, (t) => {
    const spec = sourceSpec.replaceAll('\n', newline);
    const checkout = releaseCheckout(t, spec);
    const result = checkout.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(checkout.packageFile, 'utf8')), {
      name: candidate.name,
      version: '0.1.1',
      private: true,
    });
    assert.equal(readFileSync(checkout.specFile, 'utf8'), spec.replace('version: 0.1.0', 'version: 0.1.1'));
    const metadata = JSON.parse(result.stdout);
    assert.equal(metadata.version, '0.1.1');
    assert.equal(metadata.archive, 'dsh-pet-powercontext-0.1.1.tgz');
    assert.equal(metadata.npm_tag, 'latest');
    assert.match(readFileSync(checkout.output, 'utf8'), /^version=0\.1\.1$/m);
  });
}

test('Manual desktop tag input stamps the requested prerelease instead of the workflow branch', (t) => {
  const checkout = releaseCheckout(t, sourceSpec);
  const result = checkout.run({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/master',
    RELEASE_REF: 'refs/tags/v0.2.0-beta.2',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(checkout.packageFile, 'utf8')).version, '0.2.0-beta.2');
  assert.equal(JSON.parse(result.stdout).npm_tag, 'beta');
});

test('Metadata inspection leaves source files unchanged unless --write is supplied', (t) => {
  const checkout = releaseCheckout(t, sourceSpec);
  const original = readFileSync(checkout.packageFile, 'utf8');
  const result = checkout.run({}, []);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).version, '0.1.1');
  assert.equal(readFileSync(checkout.packageFile, 'utf8'), original);
  assert.equal(readFileSync(checkout.specFile, 'utf8'), sourceSpec);
});

test('Invalid tags or missing OpenAPI version fail before changing files or emitting outputs', (t) => {
  for (const [spec, ref] of [
    [sourceSpec, 'refs/tags/v0.1.1\nnpm_tag=latest'],
    ['openapi: 3.1.0\ninfo:\n  title: Pet\n', 'refs/tags/v0.1.1'],
  ]) {
    const checkout = releaseCheckout(t, spec);
    const original = readFileSync(checkout.packageFile, 'utf8');
    const result = checkout.run({ GITHUB_REF: ref });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(checkout.packageFile, 'utf8'), original);
    assert.equal(readFileSync(checkout.specFile, 'utf8'), spec);
    assert.equal(existsSync(checkout.output), false);
  }
});
