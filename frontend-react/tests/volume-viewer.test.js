import test from 'node:test';
import assert from 'node:assert/strict';
import { NIFTI2, readHeader } from 'nifti-reader-js';
import { syntheticNifti } from './e2e/nifti-fixture.js';
import { inspectVolume, sameAffine, validatePair, volumeBudget } from '../src/lib/volume-geometry.js';
import { createSegmentationApi } from '../src/api/segmentation-contract.js';
import { gzipSync } from 'fflate';
import { MAX_TRANSFER_BYTES } from '../src/lib/volume-geometry.js';
import { decode } from '../src/workers/volume.worker.js';
import { loadViewerPair } from '../src/lib/volume-loader.js';
import { releaseViewer } from '../src/lib/niivue-adapter.js';

const id = '12345678-1234-4567-890a-123456789abc';
const array = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const ct = () => array(syntheticNifti());
const mask = () => array(syntheticNifti({ mask: true }));
const metadata = geometry => ({ shape: geometry.shape, affine: geometry.affine, xyzt_units: 2 });

test('raw decoding enforces the expected output limit and accepts its boundary', () => {
  const input = new ArrayBuffer(32);
  assert.equal(decode(input, 32), input);
  assert.throws(() => decode(input, 31), /expected output limit/);
});

test('raw and gzip inputs over MAX_TRANSFER_BYTES are rejected before decoding', () => {
  // One zero-initialized buffer tests both paths without populating a large payload.
  const input = new ArrayBuffer(MAX_TRANSFER_BYTES + 1);
  assert.throws(() => decode(input, input.byteLength), /input exceeds.*transfer limit/);
  new Uint8Array(input, 0, 2).set([31, 139]);
  // Invalid gzip would produce a decompression error if the input guard were bypassed.
  assert.throws(() => decode(input, input.byteLength), /input exceeds.*transfer limit/);
});

test('bounded gzip decoding rejects output exceeding the expected uncompressed limit', () => {
  const input = array(gzipSync(new Uint8Array(128 * 1024)));
  assert.throws(() => decode(input, 1024), /Decompressed volume exceeds/);
});

test('gzip input overhead does not count against the uncompressed output limit', () => {
  const original = new Uint8Array([1, 2, 3, 4]);
  const input = array(gzipSync(original));
  assert.ok(input.byteLength > original.byteLength);
  assert.deepEqual(new Uint8Array(decode(input, original.byteLength)), original);
});

test('bounded gzip decoding preserves output across multiple input chunks', () => {
  const original = new Uint8Array(160 * 1024);
  let state = 42;
  for (let index = 0; index < original.length; index++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    original[index] = state & 255;
  }
  const input = array(gzipSync(original));
  assert.ok(input.byteLength > 2 * 64 * 1024);
  assert.deepEqual(new Uint8Array(decode(input, original.byteLength)), original);
});

test('loadViewerPair explicitly requires an AbortSignal before doing any work', async () => {
  await assert.rejects(loadViewerPair(null, 1, null), {
    name: 'TypeError', message: 'loadViewerPair requires an AbortSignal.',
  });
});

test('loadViewerPair rejects an already aborted signal before doing any work', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadViewerPair(null, 1, null, { signal: controller.signal }), { name: 'AbortError' });
});

for (const throws of [false, true]) test(`viewer release is idempotent when library cleanup ${throws ? 'throws' : 'succeeds'}`, () => {
  const calls = [];
  const viewer = {
    volumes: [{}], back: {}, overlays: [{}],
    onLocationChange: () => { throw new Error('Released callback should be detached.'); },
    onAzimuthElevationChange: () => { throw new Error('Released camera callback should be detached.'); },
    onZoom3DChange: () => { throw new Error('Released zoom callback should be detached.'); },
    cleanup: () => { calls.push('cleanup'); if (throws) throw new Error('Library cleanup failed.'); },
    gl: { getExtension: name => {
      assert.equal(name, 'WEBGL_lose_context');
      calls.push('extension');
      return { loseContext: () => { calls.push('release'); } };
    } },
  };
  assert.doesNotThrow(() => releaseViewer(viewer));
  assert.deepEqual(viewer.volumes, []);
  assert.equal(viewer.back, null);
  assert.deepEqual(viewer.overlays, []);
  assert.doesNotThrow(() => viewer.onLocationChange());
  assert.doesNotThrow(() => viewer.onAzimuthElevationChange());
  assert.doesNotThrow(() => viewer.onZoom3DChange());
  assert.doesNotThrow(() => releaseViewer(viewer));
  assert.deepEqual(calls, ['cleanup', 'extension', 'release']);
});

test('geometry preserves signed affine, spacing and provenance alignment', () => {
  const source = inspectVolume(ct());
  const labels = inspectVolume(mask(), { mask: true });
  assert.equal(source.affine[0][0] < 0, true);
  assert.equal(source.shape.join(), '12,10,8');
  assert.equal(source.units, 'mm');
  assert.equal(validatePair(source, labels, metadata(source)), source);
  assert.throws(() => validatePair(source, { ...labels, shape: [11,10,8] }, metadata(source)), /do not match/);
  const moved = labels.affine.map(row => [...row]); moved[0][3] += 1;
  assert.throws(() => validatePair(source, { ...labels, affine: moved }, metadata(source)), /do not match/);
  assert.throws(() => validatePair(source, labels, { ...metadata(source), shape: [12,10,7] }), /provenance/);
});

test('sform wins over a higher qform code, matching the backend', () => {
  const source = inspectVolume(array(syntheticNifti({ qformCode: 4 })));
  assert.ok(Math.abs(source.affine[0][0] + .7) < .00001);
  assert.equal(source.affine[0][3], 24);
});

test('coded qform-only volumes and NIfTI-2 headers are supported', () => {
  const original = syntheticNifti({ qformCode: 1 }); original.writeInt16LE(0, 254);
  assert.equal(inspectVolume(array(original)).sformCode, 0);
  const one = readHeader(ct());
  const two = Object.assign(new NIFTI2(), one, { magic: 'n+2\0\r\n\x1a\n', vox_offset: 544 });
  const header = new Uint8Array(two.toArrayBuffer());
  const converted = new Uint8Array(header.length + 12*10*8*2);
  converted.set(header); converted.set(new Uint8Array(ct(),352),544);
  assert.equal(inspectVolume(converted.buffer).shape.join(), '12,10,8');
});

for (const [name, change, expected] of [
  ['unknown units', b => { b[123] = 0; }, /unknown/],
  ['metre units', b => { b[123] = 1; }, /not millimetres/],
  ['uncoded orientation', b => { b.writeInt16LE(0,252); b.writeInt16LE(0,254); }, /coded spatial/],
  ['four dimensions', b => b.writeInt16LE(4,40), /three-dimensional/],
  ['shear', b => b.writeFloatLE(.2,284), /Oblique or sheared/],
  ['non-finite affine', b => b.writeFloatLE(NaN,280), /Invalid spatial/],
]) test(`geometry refuses ${name}`, () => {
  const input = syntheticNifti(); change(input);
  assert.throws(() => inspectVolume(array(input)), expected);
});

test('invalid binary payloads, truncation, size and provenance are rejected', () => {
  const labels = syntheticNifti({ mask:true }); labels[352] = 2;
  assert.throws(() => inspectVolume(array(labels), { mask:true }), /binary 0 and 1/);
  assert.throws(() => inspectVolume(ct().slice(0,400)), /incomplete/);
  assert.throws(() => volumeBudget([512,512,512]), /memory budget/);
  assert.throws(() => volumeBudget([512,512,217], 4), /memory budget/);
  assert.equal(volumeBudget([512,512,217], 8).voxels, 56_885_248);
  assert.equal(sameAffine([[1]], [[1]]), false);
});

test('viewer binary requests construct protected routes and propagate progress/cancellation', async () => {
  const controller = new AbortController();
  let config;
  const api = createSegmentationApi({ get: async (url, options) => {
    assert.equal(url, `/cases/1/segmentations/${id}/source`);
    config = options;
    assert.equal(config.responseType, 'arraybuffer');
    options.onDownloadProgress({ loaded: 42 });
    controller.abort();
    assert.equal(config.signal.aborted, true);
    return { status: 200, headers:{'content-type':'application/octet-stream'}, data: ct() };
  } });
  let progress;
  await assert.rejects(api.loadVolume(1, id, 'source', { signal:controller.signal, onProgress:v => { progress = v; } }), { name:'AbortError' });
  assert.deepEqual(progress, {loaded:42,total:null});
  await assert.rejects(api.loadVolume(1,id,'probabilities'), /Invalid viewer/);
});

test('viewer download decodes protected error bodies and refuses HTML or empty data', async () => {
  for (const data of [new ArrayBuffer(0), ct()]) {
    const api = createSegmentationApi({ get:async () => ({status:200,headers:{'content-type':'text/html'},data}) });
    await assert.rejects(api.loadVolume(1,id,'source'), /supported medical volume/);
  }
  const api = createSegmentationApi({get:async () => { throw { response:{ status:409, data:new TextEncoder().encode('{"detail":"Input changed"}').buffer } }; }});
  await assert.rejects(api.loadVolume(1,id,'mask'), error => error.message === 'Input changed');
});
