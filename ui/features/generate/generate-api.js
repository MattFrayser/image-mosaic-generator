import { invokeCommand } from '../../shared/api/tauri-client.js';

export function createGenerateApi(client = { invokeCommand }) {
    return {
        async getAdaptiveSettings({ targetPath, tileDir }) {
            return client.invokeCommand('get_adaptive_settings', {
                target_image_path: targetPath,
                tile_directory: tileDir
            });
        },

        async generateMosaic(params) {
            return client.invokeCommand('generate_mosaic', { params });
        }
    };
}

export const generateApi = createGenerateApi();
