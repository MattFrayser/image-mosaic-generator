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

function clearStatus() {
    const existingStatus = document.getElementById('status');
    if (existingStatus) {
        existingStatus.remove();
    }
}

function showStatus(message, type) {
    // Only create status for errors
    if (type !== 'error') return;

    clearStatus();

    const statusEl = document.createElement('div');
    statusEl.id = 'status';
    statusEl.className = 'status error';
    statusEl.textContent = message;

    // Insert after mosaic-info
    const mosaicInfo = document.getElementById('mosaic-info');
    mosaicInfo.parentElement.appendChild(statusEl);
}

let targetImagePath = '';
let tileDirectoryPath = '';

const elements = {
    tileSizeSlider: document.getElementById('tile-size'),
    tileSizeValue: document.getElementById('tile-size-value'),
    penaltyFactorSlider: document.getElementById('penalty-factor'),
    penaltyFactorValue: document.getElementById('penalty-factor-value'),
    sigmaDivisorSlider: document.getElementById('sigma-divisor'),
    sigmaDivisorValue: document.getElementById('sigma-divisor-value'),
    selectTargetBtn: document.getElementById('select-target-btn'),
    selectTilesBtn: document.getElementById('select-tiles-btn'),
    targetContainer: document.getElementById('target-image-container'),
    targetPreview: document.getElementById('target-preview'),
    tilesPath: document.getElementById('tiles-path'),
    generateBtn: document.getElementById('generate-btn'),
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

elements.penaltyFactorSlider.addEventListener('input', (e) => {
    updateSliderValue(e.target, elements.penaltyFactorValue, 0);
});

elements.sigmaDivisorSlider.addEventListener('input', (e) => {
    updateSliderValue(e.target, elements.sigmaDivisorValue, 1);
});

async function selectTargetImage() {
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
            elements.targetPreview.src = toAssetUrl(selected);
            elements.targetContainer.classList.add('has-image');
            checkCanGenerate();
            clearStatus();
        }
    } catch (error) {
        showStatus('Error selecting file: ' + error, 'error');
    }
}

// Attach to button click
elements.selectTargetBtn.addEventListener('click', selectTargetImage);

// Attach to preview click (for changing image)
elements.targetPreview.addEventListener('click', selectTargetImage);

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
            clearStatus();
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
    clearStatus();

    const params = {
        target_image_path: targetImagePath,
        tile_directory: tileDirectoryPath,
        tile_size: parseInt(elements.tileSizeSlider.value),
        penalty_factor: parseFloat(elements.penaltyFactorSlider.value),
        sigma_divisor: parseFloat(elements.sigmaDivisorSlider.value)
    };

    try {
        console.log('Generating mosaic with params:', params);
        const filePath = await invoke('generate_mosaic', { params });
        console.log('Mosaic generated at:', filePath);

        const assetUrl = toAssetUrl(filePath);
        console.log('Asset URL:', assetUrl);

        // Force image reload with cache busting
        const cacheBustedUrl = `${assetUrl}?t=${Date.now()}`;
        elements.mosaicPreview.src = cacheBustedUrl;

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
        img.src = cacheBustedUrl;

        clearStatus();
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
