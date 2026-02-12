#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

use mosaic_gui::errors::AppError;
use mosaic_gui::{load_image_with_orientation, MosaicConfig, TileLibrary};

/// Application state managed by Tauri.
#[derive(Default)]
struct AppState {
    library: Arc<RwLock<Option<TileLibrary>>>,
}

/// Parameters for mosaic generation from the frontend.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct MosaicParams {
    target_image_path: String,
    tile_directory: String,
    tile_size: u32,
    penalty_factor: f64,
    sigma_divisor: f64,
}

/// Calculates adaptive settings based on inputs.
#[tauri::command]
async fn get_adaptive_settings(
    target_image_path: String,
    tile_directory: String,
) -> Result<serde_json::Value, AppError> {
    let target_img = load_image_with_orientation(&target_image_path)?;

    let (width, height) = target_img.dimensions();
    let min_dimension = width.min(height);
    
    // Calculate adaptive tile size based on image dimensions
    // Target: ~50-200 tiles per dimension for good detail
    let adaptive_tile_size = {
        let tiles_per_dim = 100.0; // Target tiles per dimension
        let suggested = (min_dimension as f64 / tiles_per_dim).round() as u32;
        // Clamp to reasonable range
        suggested.max(8).min(128)
    };
    
    // Count tiles in directory
    use walkdir::WalkDir;
    let tile_count = WalkDir::new(&tile_directory)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let ext = e.path().extension()?.to_string_lossy().to_lowercase();
            if ["jpg", "jpeg", "png"].contains(&ext.as_str()) {
                Some(())
            } else {
                None
            }
        })
        .count();
    
    // Calculate adaptive penalty factor based on tile count
    // Fewer tiles = lower penalty (need to reuse), more tiles = higher penalty (can diversify)
    let adaptive_penalty = if tile_count == 0 {
        50.0 // Default if can't count
    } else if tile_count < 50 {
        // Very few tiles: low penalty (10-30)
        10.0 + (tile_count as f64 / 50.0) * 20.0
    } else if tile_count < 200 {
        // Moderate tiles: medium penalty (30-70)
        30.0 + ((tile_count - 50) as f64 / 150.0) * 40.0
    } else {
        // Many tiles: high penalty (70-100)
        70.0 + ((tile_count.min(1000) - 200) as f64 / 800.0) * 30.0
    };
    
    Ok(serde_json::json!({
        "tile_size": adaptive_tile_size,
        "penalty_factor": adaptive_penalty.round(),
        "tile_count": tile_count,
        "image_width": width,
        "image_height": height
    }))
}

/// Generates a mosaic image from the provided parameters.
#[tauri::command]
async fn generate_mosaic(
    params: MosaicParams,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let mut library_guard = state.library.write().await;

    let needs_reload = match *library_guard {
        Some(ref lib) => !lib.matches_config(
            Path::new(&params.tile_directory),
            params.tile_size,
            params.sigma_divisor,
        ),
        None => true,
    };

    if needs_reload {
        let new_lib = TileLibrary::new(
            PathBuf::from(&params.tile_directory),
            params.tile_size,
            params.sigma_divisor,
        )?;
        *library_guard = Some(new_lib);
    }

    let lib = library_guard
        .as_mut()
        .ok_or_else(|| AppError::Config("Library failed to initialize".into()))?;

    let config = MosaicConfig {
        tile_size: params.tile_size,
        penalty_factor: params.penalty_factor,
        sigma_divisor: params.sigma_divisor,
    };

    lib.generate_mosaic(&params.target_image_path, &config)
}

/// Initializes and runs the Tauri application.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![generate_mosaic, get_adaptive_settings])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
