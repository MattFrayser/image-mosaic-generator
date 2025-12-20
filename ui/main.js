import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

// Helper to avoid double conversion
function toAssetUrl(path) {
    // Check if already converted
    if (path.startsWith('http://asset.localhost/') ||
        path.startsWith('https://asset.localhost/') ||
        path.startsWith('asset://')) {
        return path;
    }
    return convertFileSrc(path);
}

let targetImagePath = '';
let tileDirectoryPath = '';
let debounceTimer = null;

const elements = {
    tileSizeSlider: document.getElementById('tile-size'),
    tileSizeValue: document.getElementById('tile-size-value'),
    assetSizeSlider: document.getElementById('asset-size'),
    assetSizeValue: document.getElementById('asset-size-value'),
    penaltyFactorSlider: document.getElementById('penalty-factor'),
    penaltyFactorValue: document.getElementById('penalty-factor-value'),
    sigmaDivisorSlider: document.getElementById('sigma-divisor'),
    sigmaDivisorValue: document.getElementById('sigma-divisor-value'),
    selectTargetBtn: document.getElementById('select-target-btn'),
    selectTilesBtn: document.getElementById('select-tiles-btn'),
    targetPath: document.getElementById('target-path'),
    tilesPath: document.getElementById('tiles-path'),
    generateBtn: document.getElementById('generate-btn'),
    status: document.getElementById('status'),
    mosaicPreview: document.getElementById('mosaic-preview'),
    loading: document.getElementById('loading'),
    placeholder: document.getElementById('placeholder'),
    mosaicInfo: document.getElementById('mosaic-info')
};

function updateSliderValue(slider, valueDisplay, decimals = 0) {
    const value = parseFloat(slider.value);
    valueDisplay.textContent = decimals > 0 ? value.toFixed(1) : value;
    checkCanGenerate();
}

elements.tileSizeSlider.addEventListener('input', (e) => {
    updateSliderValue(e.target, elements.tileSizeValue);
});

elements.assetSizeSlider.addEventListener('input', (e) => {
    updateSliderValue(e.target, elements.assetSizeValue);
});

elements.penaltyFactorSlider.addEventListener('input', (e) => {
    updateSliderValue(e.target, elements.penaltyFactorValue, 0);
});

elements.sigmaDivisorSlider.addEventListener('input', (e) => {
    updateSliderValue(e.target, elements.sigmaDivisorValue, 1);
});

elements.selectTargetBtn.addEventListener('click', async () => {
    try {
        const selected = await open({
            multiple: false,
            filters: [{
                name: 'Image',
                extensions: ['png', 'jpg', 'jpeg']
            }]
        });

        if (selected) {
            targetImagePath = selected;
            elements.targetPath.textContent = selected.split('/').pop();

            // Show original image preview
            const targetPreview = document.getElementById('target-preview');
            targetPreview.src = toAssetUrl(selected);
            targetPreview.classList.remove('hidden');

            checkCanGenerate();
        }
    } catch (error) {
        showStatus('Error selecting file: ' + error, 'error');
    }
});

elements.selectTilesBtn.addEventListener('click', async () => {
    try {
        const selected = await open({
            directory: true,
            multiple: false
        });

        if (selected) {
            tileDirectoryPath = selected;
            elements.tilesPath.textContent = selected.split('/').pop();
            checkCanGenerate();
        }
    } catch (error) {
        showStatus('Error selecting folder: ' + error, 'error');
    }
});

elements.generateBtn.addEventListener('click', () => {
    generateMosaic();
});

function checkCanGenerate() {
    const canGenerate = targetImagePath && tileDirectoryPath;
    elements.generateBtn.disabled = !canGenerate;
}


async function generateMosaic() {
    if (!targetImagePath || !tileDirectoryPath) {
        showStatus('Please select both target image and tile directory', 'error');
        return;
    }

    elements.loading.classList.remove('hidden');
    elements.mosaicPreview.classList.add('hidden');
    elements.placeholder.classList.add('hidden');
    elements.status.textContent = '';
    elements.status.className = 'status';

    const params = {
        target_image_path: targetImagePath,
        tile_directory: tileDirectoryPath,
        tile_size: parseInt(elements.tileSizeSlider.value),
        asset_size: parseInt(elements.assetSizeSlider.value),
        penalty_factor: parseFloat(elements.penaltyFactorSlider.value),
        sigma_divisor: parseFloat(elements.sigmaDivisorSlider.value)
    };

    try {
        console.log('Generating mosaic with params:', params);
        const filePath = await invoke('generate_mosaic', { params });
        console.log('Mosaic generated at:', filePath);

        const assetUrl = toAssetUrl(filePath);
        console.log('Asset URL:', assetUrl);

        // Force image reload
        elements.mosaicPreview.src = '';
        elements.mosaicPreview.src = assetUrl;

        elements.mosaicPreview.classList.remove('hidden');
        elements.placeholder.classList.add('hidden');

        // Calculate and display mosaic info
        const img = new Image();
        img.onload = () => {
            const tilesWide = Math.ceil(img.width / parseInt(elements.tileSizeSlider.value));
            const tilesHigh = Math.ceil(img.height / parseInt(elements.tileSizeSlider.value));
            const totalTiles = tilesWide * tilesHigh;

            elements.mosaicInfo.textContent = `Mosaic: ${img.width}×${img.height}px | ${tilesWide}×${tilesHigh} tiles (${totalTiles} total)`;
            elements.mosaicInfo.classList.remove('hidden');
        };
        img.src = assetUrl;

        showStatus('Mosaic generated successfully!', 'success');
    } catch (error) {
        elements.placeholder.classList.remove('hidden');
        showStatus('Error: ' + error, 'error');
        console.error('Generation error:', error);
    } finally {
        elements.loading.classList.add('hidden');
    }
}

function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `status ${type}`;
}

checkCanGenerate();
