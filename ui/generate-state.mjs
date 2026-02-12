export function transitionGenerateState(current, event) {
    if (event === 'start') {
        if (current.inFlight) return current;
        return { ...current, inFlight: true };
    }

    if (event === 'success') {
        return { inFlight: false, hasPreview: true };
    }

    if (event === 'error') {
        return { inFlight: false, hasPreview: current.hasPreview };
    }

    return current;
}

export function deriveGenerateUiFlags(state, canGenerate) {
    return {
        showLoading: state.inFlight,
        showPreview: state.hasPreview,
        showPlaceholder: !state.hasPreview,
        disableGenerate: state.inFlight || !canGenerate
    };
}
