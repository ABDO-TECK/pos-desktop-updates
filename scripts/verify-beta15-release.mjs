import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repository = 'ABDO-TECK/pos-desktop-updates';
const sourceRepository = 'ABDO-TECK/pos-desktop';
const tag = 'v0.0.15-beta.1';
const baseline = '0.0.14';
const target = tag.slice(1);
const draftId = 460797291;
const draftSlug = 'untagged-93051d264b68e8b62845';
const checksumName = 'SHA256SUMS.txt';
const notesName = 'release-notes.md';
const transitionStems = [
  'transition-0.0.14-to-beta-0.0.15-beta.1-delta',
  'transition-0.0.14-to-beta-0.0.15-beta.1-full',
  'transition-0.0.15-beta.1-to-stable-0.0.14-delta',
  'transition-0.0.15-beta.1-to-stable-0.0.14-full',
];
const required = [
  'channel-transitions.json', 'channel-transitions.sig',
  'deployment-inventory.json', 'source-provenance.json', notesName,
  'manifest.json', 'manifest.sig', 'delta.zip',
  'manifest-0.0.14.json', 'manifest-0.0.14.sig', 'delta-0.0.14-to-0.0.15-beta.1.zip',
  ...transitionStems.flatMap(stem => ['json', 'sig', 'zip'].map(extension => stem + '.' + extension)),
].sort();

const [, , mode, assetsDirectory, stageRunId, downloadsDirectory] = process.argv;
assert(['freeze', 'verify', 'publish'].includes(mode) && assetsDirectory && /^[0-9]+$/.test(stageRunId ?? ''));
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.match(process.env.SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);

const producerSha = mode === 'publish' ? process.env.STAGED_WORKFLOW_SHA : process.env.GITHUB_SHA;
assert.match(producerSha ?? '', /^[a-f0-9]{40}$/);

const read = (name, root = assetsDirectory) => readFileSync(path.join(root, name));
const json = name => JSON.parse(read(name));
const hash = (name, root) => createHash('sha256').update(read(name, root)).digest('hex');

const names = mode === 'freeze' ? required : [...required, checksumName].sort();
const actual = readdirSync(assetsDirectory, { withFileTypes: true });
assert(actual.every(entry => entry.isFile()), 'Release assets must be regular files.');
assert.deepEqual(actual.map(entry => entry.name).sort(), names);
assert.deepEqual(json('source-provenance.json'), {
  format: 1, tag, source_repository: sourceRepository, source_sha: process.env.SOURCE_SHA,
  merged_pr_sha: 'e98ed9f5a25305af8c147e73a9a9737d983f3839',
  setup_tag: 'v0.0.14', setup_source_sha: 'cee698f8b5d2cb8577a485f9a07330184986e9a5',
  setup_inventory_sha256: '1d65fabbc8ec83c7786bb94fd530f587e5065a6bd0b78139ac4a4f63af7fa0fd',
  updates_workflow_sha: producerSha, stage_run_id: stageRunId,
});

const hashes = new Map(required.map(name => [name, hash(name)]));
const checksums = [...hashes].map(([name, sha]) => sha + '  ' + name).join('\n') + '\n';
for (const [alias, canonical] of [
  ['manifest.json', 'manifest-0.0.14.json'], ['manifest.sig', 'manifest-0.0.14.sig'],
  ['delta.zip', 'delta-0.0.14-to-0.0.15-beta.1.zip'],
]) {
  assert.equal(hashes.get(alias), hashes.get(canonical), 'Changed alias: ' + alias);
}
const index = json('channel-transitions.json');
assert.equal(index.carrier_tag, tag);
assert.deepEqual(index.entries.map(entry => entry.descriptor).sort(), transitionStems.map(stem => stem + '.json').sort());
const ordinary = json('manifest.json');
assert.equal(ordinary.channel, 'beta');
assert.equal(ordinary.from_version, baseline);
assert.equal(ordinary.version, target);
assert.deepEqual(ordinary.migrations, []);
const stableInventory = '1d65fabbc8ec83c7786bb94fd530f587e5065a6bd0b78139ac4a4f63af7fa0fd';
const betaInventory = hashes.get('deployment-inventory.json');
for (const entry of index.entries) {
  const descriptor = json(entry.descriptor);
  const intoBeta = entry.from_version === baseline;
  assert.equal(entry.descriptor_sha256, hashes.get(entry.descriptor));
  assert.equal(descriptor.source_inventory_sha256, intoBeta ? stableInventory : betaInventory);
  assert.equal(descriptor.target_inventory_sha256, intoBeta ? betaInventory : stableInventory);
  assert.equal(descriptor.from_version, intoBeta ? baseline : target);
  assert.equal(descriptor.version, intoBeta ? target : baseline);
  assert.equal(descriptor.target_repo, intoBeta ? 'pos-desktop-updates' : 'pos-desktop');
  assert.equal(descriptor.package.sha256, hashes.get(descriptor.package.asset));
  assert.equal(descriptor.package.size, read(descriptor.package.asset).length);
}

if (mode === 'freeze') {
  writeFileSync(path.join(assetsDirectory, checksumName), checksums, { flag: 'wx' });
  console.log('Bound every verified beta release asset to its SHA-256.');
  process.exit(0);
}

assert.equal(read(checksumName).toString(), checksums);
if (mode === 'verify') {
  console.log('Verified the signed release assets stayed unchanged through acceptance.');
  process.exit(0);
}
assert(downloadsDirectory && !existsSync(downloadsDirectory), 'Expected a fresh public receipt directory.');
hashes.set(checksumName, hash(checksumName));

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function api(resource) {
  return JSON.parse(gh(['api', resource]));
}

function betaRelease() {
  const releases = api('repos/' + repository + '/releases?per_page=100');
  assert(releases.length < 100, 'Release enumeration exceeded the expected bound.');
  const matches = releases.filter(release => release.tag_name === tag);
  assert(matches.length <= 1, 'The beta tag has multiple release records.');
  return matches[0];
}

function betaTag() {
  const refs = api('repos/' + repository + '/git/matching-refs/tags/' + tag);
  return refs.find(ref => ref.ref === 'refs/tags/' + tag)?.object;
}

function verifyStablePointers() {
  for (const [repo, expectedId, expectedTag] of [
    [repository, 428417992, 'v0.0.13'], [sourceRepository, 453073409, 'v0.0.14'],
  ]) {
    const latest = api('repos/' + repo + '/releases/latest');
    assert.equal(latest.id, expectedId, 'Latest release changed in ' + repo);
    assert.equal(latest.tag_name, expectedTag);
  }
}

function verifyRelease(release, isDraft) {
  assert.equal(release.draft, isDraft);
  assert.equal(release.prerelease, true);
  assert.equal(release.tag_name, tag);
  assert.equal(release.id, draftId);
  assert.equal(release.target_commitish, producerSha);
  const releaseSlug = isDraft ? draftSlug : tag;
  assert.equal(release.html_url, 'https://github.com/' + repository + '/releases/tag/' + releaseSlug);
  assert.equal(release.body.trimEnd(), read(notesName).toString().trimEnd());
  const seen = new Set();
  for (const asset of release.assets) {
    assert(!seen.has(asset.name), 'Duplicate asset: ' + asset.name);
    assert(hashes.has(asset.name), 'Unexpected asset: ' + asset.name);
    assert.equal(asset.state, 'uploaded');
    assert.equal(asset.digest, 'sha256:' + hashes.get(asset.name), 'Different staged bytes: ' + asset.name);
    assert.equal(asset.size, read(asset.name).length);
    assert.equal(asset.browser_download_url, 'https://github.com/' + repository + '/releases/download/' + releaseSlug + '/' + asset.name);
    seen.add(asset.name);
  }
  return seen;
}

verifyStablePointers();
let release = betaRelease();
assert.equal(release?.id, draftId, 'The approved beta draft does not exist.');
const tagObject = {
  type: 'commit', sha: producerSha,
  url: 'https://api.github.com/repos/' + repository + '/git/commits/' + producerSha,
};
const preexistingTag = betaTag();
if (preexistingTag) assert.deepEqual(preexistingTag, tagObject);
assert.equal(verifyRelease(release, release.draft).size, names.length);

const releaseEndpoint = 'repos/' + repository + '/releases/' + draftId;
if (release.draft) {
  verifyStablePointers();
  gh(['api', '--method', 'PATCH', releaseEndpoint, '-F', 'draft=false', '-F', 'prerelease=true', '-f', 'make_latest=false']);
}
release = api(releaseEndpoint);
assert.equal(verifyRelease(release, false).size, names.length);
assert.deepEqual(betaTag(), tagObject);
verifyStablePointers();

mkdirSync(downloadsDirectory);
gh(['release', 'download', tag, '--repo', repository, '--pattern', '*', '--dir', downloadsDirectory]);
assert.deepEqual(readdirSync(downloadsDirectory).sort(), names);
for (const name of names) {
  assert.equal(hash(name, downloadsDirectory), hashes.get(name), 'Public download differs: ' + name);
}
console.log('Verified ' + names.length + ' public asset downloads and both stable release pointers.');
console.log(release.html_url);
