import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveGenerateUiFlags, transitionGenerateState } from './generate-state.mjs';

test('start event blocks when request already in flight', () => {
    const current = { inFlight: true, hasPreview: true };
    const next = transitionGenerateState(current, 'start');
    assert.deepEqual(next, current);
});

test('error event keeps existing preview visible', () => {
    const current = { inFlight: true, hasPreview: true };
    const next = transitionGenerateState(current, 'error');
    const flags = deriveGenerateUiFlags(next, true);

    assert.equal(next.inFlight, false);
    assert.equal(next.hasPreview, true);
    assert.equal(flags.showPreview, true);
    assert.equal(flags.showPlaceholder, false);
});

test('loading with no preview still shows placeholder', () => {
    const current = { inFlight: false, hasPreview: false };
    const next = transitionGenerateState(current, 'start');
    const flags = deriveGenerateUiFlags(next, true);

    assert.equal(flags.showLoading, true);
    assert.equal(flags.showPreview, false);
    assert.equal(flags.showPlaceholder, true);
    assert.equal(flags.disableGenerate, true);
});
