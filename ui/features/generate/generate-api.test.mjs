import assert from 'node:assert/strict';
import test from 'node:test';
import { createGenerateApi } from './generate-api.js';

test('getAdaptiveSettings maps camelCase inputs to command payload', async () => {
    const calls = [];
    const api = createGenerateApi({
        async invokeCommand(command, payload) {
            calls.push({ command, payload });
            return { ok: true };
        }
    });

    await api.getAdaptiveSettings({
        targetPath: '/tmp/target.png',
        tileDir: '/tmp/tiles'
    });

    assert.deepEqual(calls, [
        {
            command: 'get_adaptive_settings',
            payload: {
                target_image_path: '/tmp/target.png',
                tile_directory: '/tmp/tiles'
            }
        }
    ]);
});

test('generateMosaic wraps params under params key', async () => {
    const calls = [];
    const api = createGenerateApi({
        async invokeCommand(command, payload) {
            calls.push({ command, payload });
            return { ok: true };
        }
    });

    const params = {
        target_image_path: '/tmp/target.png',
        tile_directory: '/tmp/tiles',
        tile_size: 32,
        penalty_factor: 50,
        sigma_divisor: 4
    };
    await api.generateMosaic(params);

    assert.deepEqual(calls, [
        {
            command: 'generate_mosaic',
            payload: { params }
        }
    ]);
});

test('generate API propagates transport errors', async () => {
    const api = createGenerateApi({
        async invokeCommand() {
            throw new Error('boom');
        }
    });

    await assert.rejects(
        () => api.generateMosaic({ target_image_path: '/tmp/target.png' }),
        /boom/
    );
});
