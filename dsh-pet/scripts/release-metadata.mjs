/** Derive package versions and npm channels from release tags, with optional stamping in the build checkout. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Tag builds use the selected tag; manual branch builds keep the source version. */
export function releaseMetadata({ name, version, eventName, ref, requestedRef }) {
  if (name !== 'dsh-pet-powercontext') throw new Error(`Unexpected package name: ${name}`);
  const selectedRef = eventName === 'push' ? ref : requestedRef || ref;
  if (eventName === 'push' && !selectedRef?.startsWith('refs/tags/v')) {
    throw new Error(`Publication requires a version-tag push; received ${selectedRef}`);
  }
  if (selectedRef?.startsWith('refs/tags/')) {
    if (!selectedRef.startsWith('refs/tags/v')) throw new Error(`Expected a v-prefixed release tag: ${selectedRef}`);
    version = selectedRef.slice('refs/tags/v'.length);
  } else if (/^v\d/.test(selectedRef ?? '')) {
    version = selectedRef.slice(1);
  }
  const match =
    typeof version === 'string' &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(alpha|beta|rc)\.(?:0|[1-9]\d*))?$/.exec(version);
  if (!match || match[0] !== version)
    throw new Error(`Expected a stable version or alpha.N, beta.N, rc.N prerelease: ${version}`);
  return {
    version,
    archive: `${name}-${version}.tgz`,
    npm_tag: match[1] ?? 'latest',
    prerelease: String(Boolean(match[1])),
  };
}

/** Update only info.version in the repository's block-style OpenAPI document, preserving the rest byte for byte. */
function versionedOpenApi(source, version) {
  const info = /^info:\r?\n(?:[ \t][^\r\n]*(?:\r?\n|$)|\r?\n)*/m.exec(source);
  if (!info || [...info[0].matchAll(/^  version:[^\r\n]*/gm)].length !== 1)
    throw new Error('Expected exactly one info.version in openapi.yaml');
  return (
    source.slice(0, info.index) +
    info[0].replace(/^  version:[^\r\n]*/m, `  version: ${version}`) +
    source.slice(info.index + info[0].length)
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { write: { type: 'boolean', default: false } } });
  const packageFile = new URL('../package.json', import.meta.url);
  const specFile = new URL('../../openapi.yaml', import.meta.url);
  const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
  const metadata = releaseMetadata({
    name: pkg.name,
    version: pkg.version,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    requestedRef: process.env.RELEASE_REF,
  });
  if (values.write) {
    // Validate both inputs before changing either file. No lifecycle scripts or git commits are invoked.
    const spec = versionedOpenApi(readFileSync(specFile, 'utf8'), metadata.version);
    writeFileSync(packageFile, JSON.stringify({ ...pkg, version: metadata.version }, null, 2) + '\n');
    writeFileSync(specFile, spec);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(metadata)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }
  console.log(JSON.stringify(metadata));
}
