export class UIManager {
    constructor() {
        this.els = {
            statusContainer: document.getElementById('status-container'),
            generateBtn: document.getElementById('generate-btn'),
            placeholder: document.getElementById('placeholder'),
            loading: document.getElementById('loading'),
            sliders: {
                tileSize: document.getElementById('tile-size'),
                penalty: document.getElementById('penalty-factor'),
                sigma: document.getElementById('sigma-divisor'),
                opacity: document.getElementById('opacity-slider')
            },
            values: {
                tileSize: document.getElementById('tile-size-value'),
                penalty: document.getElementById('penalty-factor-value'),
                sigma: document.getElementById('sigma-divisor-value'),
                opacity: document.getElementById('opacity-value')
            }
        };
        this.initListeners();
    }

    initListeners() {
        Object.keys(this.els.sliders).forEach(key => {
            this.els.sliders[key]?.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                const display = key === 'sigma' ? val.toFixed(1) : Math.round(val);
                if (this.els.values[key]) {
                    this.els.values[key].textContent = display;
                }
            });
        });
    }

    getSettings() {
        return {
            tile_size: parseInt(this.els.sliders.tileSize?.value || 32),
            penalty_factor: parseFloat(this.els.sliders.penalty?.value || 50),
            sigma_divisor: parseFloat(this.els.sliders.sigma?.value || 4)
        };
    }

    setGenerateEnabled(isEnabled) {
        if (this.els.generateBtn) {
            this.els.generateBtn.disabled = !isEnabled;
        }
    }

    setLoading(isLoading) {
        if (isLoading) {
            this.els.loading?.classList.remove('hidden');
        } else {
            this.els.loading?.classList.add('hidden');
        }
    }

    applyGenerateUiFlags(flags) {
        this.setLoading(flags.showLoading);

        const container = document.getElementById('mosaic-container');
        if (container) {
            container.classList.toggle('hidden', !flags.showPreview);
        }

        if (this.els.placeholder) {
            this.els.placeholder.classList.toggle('hidden', !flags.showPlaceholder);
        }

        this.setGenerateEnabled(!flags.disableGenerate);
    }

    updatePreview(mosaicUrl, targetUrl, overlayEnabled) {
        const mosaicImg = document.getElementById('mosaic-overlay');
        const targetImg = document.getElementById('target-overlay');

        if (!mosaicImg || !targetImg) return;

        // Set mosaic image
        const cleanUrl = mosaicUrl.includes('data:') ? mosaicUrl.split('?')[0] : mosaicUrl;
        mosaicImg.src = cleanUrl;

        // Set target image if overlay mode is enabled
        if (overlayEnabled && targetUrl) {
            targetImg.src = targetUrl;
            targetImg.style.display = 'block';
        } else {
            targetImg.style.display = 'none';
        }

        // Show container
        const container = document.getElementById('mosaic-container');
        if (container) {
            container.classList.remove('hidden');
        }
        this.els.placeholder?.classList.add('hidden');
    }

    setStatus(msg, type = 'info') {
        if (!this.els.statusContainer) return;
        const el = document.createElement('div');
        el.className = `status-msg ${type}`;
        el.textContent = msg;
        this.els.statusContainer.appendChild(el);
        setTimeout(() => el.remove(), 5000);
    }
    
    clearStatus() {
        if (this.els.statusContainer) {
            this.els.statusContainer.innerHTML = '';
        }
    }

    setOpacity(value) {
        const mosaicImg = document.getElementById('mosaic-overlay');
        if (mosaicImg) {
            mosaicImg.style.opacity = value / 100;
        }
    }

    showAdaptiveSettings(adaptive) {
        // Show adaptive suggestions
        const adaptiveInfo = document.getElementById('adaptive-info');
        if (!adaptiveInfo) return;
        
        const tileCount = adaptive.tile_count || 0;
        const suggestedTileSize = adaptive.tile_size || 32;
        const suggestedPenalty = adaptive.penalty_factor || 50;
        
        adaptiveInfo.innerHTML = `
            <div class="adaptive-suggestion">
                <strong>Adaptive Suggestions:</strong><br>
                <span class="adaptive-hint">Found ${tileCount} tiles</span><br>
                <span class="adaptive-hint">Suggested tile size: ${suggestedTileSize}px</span><br>
                <span class="adaptive-hint">Suggested penalty: ${Math.round(suggestedPenalty)}</span>
                <button id="apply-adaptive-btn" class="apply-adaptive-btn">Apply Suggestions</button>
            </div>
        `;
        
        // Bind apply button
        const applyBtn = document.getElementById('apply-adaptive-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                // Update sliders
                if (this.els.sliders.tileSize) {
                    this.els.sliders.tileSize.value = suggestedTileSize;
                    this.els.values.tileSize.textContent = suggestedTileSize;
                }
                if (this.els.sliders.penalty) {
                    this.els.sliders.penalty.value = suggestedPenalty;
                    this.els.values.penalty.textContent = Math.round(suggestedPenalty);
                }
                adaptiveInfo.innerHTML = '<span class="adaptive-hint">Settings applied!</span>';
                setTimeout(() => {
                    if (adaptiveInfo) adaptiveInfo.innerHTML = '';
                }, 2000);
            });
        }
    }
}
