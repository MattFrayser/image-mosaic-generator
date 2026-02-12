import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { UIManager } from './ui.js';
import { deriveGenerateUiFlags, transitionGenerateState } from './generate-state.mjs';
import { generateApi } from './features/generate/generate-api.js';

function init() {
    const ui = new UIManager();
    const state = {
        targetPath: null,
        tileDir: null,
        lastMosaicUrl: null,
        targetImageSrc: null,
        overlayEnabled: false,
        generateState: {
            inFlight: false,
            hasPreview: false
        }
    };

    function canGenerate() {
        return Boolean(state.targetPath && state.tileDir);
    }

    function applyGenerateUiState() {
        const flags = deriveGenerateUiFlags(state.generateState, canGenerate());
        ui.applyGenerateUiFlags(flags);
    }

    function transitionAndApply(event) {
        const next = transitionGenerateState(state.generateState, event);
        const changed = next !== state.generateState;
        state.generateState = next;
        applyGenerateUiState();
        return changed;
    }

    async function selectTarget() {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }]
            });

            if (selected) {
                state.targetPath = selected;
                const preview = document.getElementById('target-preview');
                const container = document.getElementById('target-image-container');
                if (preview) {
                    const targetSrc = convertFileSrc(selected);
                    preview.src = targetSrc;
                    preview.classList.remove('hidden');
                    state.targetImageSrc = targetSrc;
                }
                if (container) container.classList.add('has-image');
                validateState();
            }
        } catch (err) {
            console.error('Select target error:', err);
            ui.setStatus(`Selection failed: ${err}`, 'error');
        }
    }

    async function selectTileFolder() {
        try {
            const selected = await open({ directory: true });
            if (selected) {
                state.tileDir = selected;
                const pathEl = document.getElementById('tiles-path');
                const btn = document.getElementById('select-tiles-btn');
                const container = document.getElementById('tile-directory-container');
                if (pathEl) {
                    pathEl.textContent = selected.split(/[/\\]/).pop();
                    pathEl.classList.add('selected');
                }
                if (btn) {
                    btn.textContent = 'Change Folder';
                }
                if (container) {
                    container.classList.add('has-selection');
                }
                validateState();
            }
        } catch (err) {
            console.error('Select folder error:', err);
            ui.setStatus(`Folder failed: ${err}`, 'error');
        }
    }

    async function calculateAdaptiveSettings() {
        if (!state.targetPath || !state.tileDir) return;
        
        try {
            const adaptive = await generateApi.getAdaptiveSettings({
                targetPath: state.targetPath,
                tileDir: state.tileDir
            });
            
            // Update UI with adaptive suggestions
            ui.showAdaptiveSettings(adaptive);
        } catch (err) {
            console.error('Failed to calculate adaptive settings:', err);
        }
    }

    function validateState() {
        const hasBoth = canGenerate();
        applyGenerateUiState();
        
        // Calculate adaptive settings when both are selected
        if (hasBoth) {
            calculateAdaptiveSettings();
        }
    }

    async function generate() {
        if (!canGenerate()) return;
        const started = transitionAndApply('start');
        if (!started) {
            ui.setStatus('Generation already in progress', 'info');
            return;
        }

        ui.clearStatus();

        const settings = ui.getSettings();
        const params = {
            target_image_path: state.targetPath,
            tile_directory: state.tileDir,
            tile_size: settings.tile_size,
            penalty_factor: settings.penalty_factor,
            sigma_divisor: settings.sigma_divisor
        };

        try {
            const output = await generateApi.generateMosaic(params);
            // output is already a base64 data URL from backend
            ui.updatePreview(output, state.targetImageSrc, state.overlayEnabled);
            state.lastMosaicUrl = output; // Store for download
            transitionAndApply('success');
            ui.setStatus('Mosaic generated!', 'success');
        } catch (err) {
            console.error('Generate error:', err);
            transitionAndApply('error');
            ui.setStatus(typeof err === 'string' ? err : 'Generation failed', 'error');
        }
    }

    // Bind events
    document.getElementById('select-target-btn')?.addEventListener('click', selectTarget);
    document.getElementById('select-tiles-btn')?.addEventListener('click', selectTileFolder);
    document.getElementById('generate-btn')?.addEventListener('click', generate);

    // Make target preview clickable to change image
    const targetPreview = document.getElementById('target-preview');
    if (targetPreview) {
        targetPreview.addEventListener('click', selectTarget);
        targetPreview.style.cursor = 'pointer';
    }

    // Overlay toggle handler
    const overlayToggle = document.getElementById('overlay-toggle');
    const opacityControl = document.getElementById('opacity-control');
    if (overlayToggle) {
        overlayToggle.addEventListener('change', (e) => {
            state.overlayEnabled = e.target.checked;

            // Show/hide opacity slider
            if (opacityControl) {
                opacityControl.style.display = state.overlayEnabled ? 'block' : 'none';
            }

            // Update preview if mosaic exists
            if (state.lastMosaicUrl) {
                ui.updatePreview(state.lastMosaicUrl, state.targetImageSrc, state.overlayEnabled);
            }
        });
    }

    // Opacity slider handler
    const opacitySlider = document.getElementById('opacity-slider');
    if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            ui.setOpacity(value);
            const valueDisplay = document.getElementById('opacity-value');
            if (valueDisplay) {
                valueDisplay.textContent = Math.round(value);
            }
        });
    }

    // Download button handler
    function downloadMosaic() {
        if (!state.lastMosaicUrl) return;
        
        // Convert base64 data URL to blob
        const base64Data = state.lastMosaicUrl.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mosaic.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        ui.setStatus('Mosaic downloaded!', 'success');
    }

    document.getElementById('download-btn')?.addEventListener('click', downloadMosaic);

    validateState();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
