#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::{imageops::FilterType, GenericImageView, ImageBuffer};
use mosaic_gui::{load_library, tiles_avg_rgb, Tile};
use serde::{Deserialize, Serialize};
use std::{cmp::min, sync::Arc};
use tauri::State;
use tokio::sync::RwLock;

#[derive(Clone, PartialEq, Debug)]
struct CacheKey {
    tile_directory: String,
    asset_size: u32,
}

#[derive(Default)]
struct AppState {
    tiles: Arc<RwLock<Arc<Vec<Tile>>>>,
    cache_params: Arc<RwLock<Option<CacheKey>>>,
}

#[derive(Serialize, Deserialize)]
struct MosaicParams {
    target_image_path: String,
    tile_directory: String,
    tile_size: u32,
    asset_size: u32,
    penalty_factor: f64,
    sigma_divisor: f64,
}

#[tauri::command]
async fn generate_mosaic(params: MosaicParams, state: State<'_, AppState>) -> Result<String, String> {
    let cache_key = CacheKey {
        tile_directory: params.tile_directory.clone(),
        asset_size: params.asset_size,
    };

    // Check if cache is valid
    let needs_reload = {
        let cached = state.cache_params.read().await;
        match cached.as_ref() {
            None => true,
            Some(key) => key != &cache_key,
        }
    };

    let tiles = if needs_reload {
        println!("Loading tiles: {} @ {}px", cache_key.tile_directory, cache_key.asset_size);

        let new_tiles = tokio::task::spawn_blocking({
            let dir = cache_key.tile_directory.clone();
            let size = cache_key.asset_size;
            move || Arc::new(load_library(&dir, size))
        })
        .await
        .map_err(|e| format!("Failed to load tiles: {}", e))?;

        if new_tiles.is_empty() {
            return Err("No valid tile images found in directory".to_string());
        }

        *state.tiles.write().await = new_tiles.clone();
        *state.cache_params.write().await = Some(cache_key);
        new_tiles
    } else {
        println!("Using cached tiles");
        state.tiles.read().await.clone()
    };

    // Run heavy computation in blocking task
    let output_path = tokio::task::spawn_blocking(move || {
        let target = image::open(&params.target_image_path)
            .map_err(|e| format!("Failed to open target image: {}", e))?
            .to_rgba8();

        let (target_w, target_h) = target.dimensions();
        let mut canvas = ImageBuffer::new(target_w, target_h);
        let mut usage_counts = vec![0usize; tiles.len()];

        for y in (0..target_h).step_by(params.tile_size as usize) {
            for x in (0..target_w).step_by(params.tile_size as usize) {
                let width = min(params.tile_size, target_w - x);
                let height = min(params.tile_size, target_h - y);

                let region = target.view(x, y, width, height).to_image();
                let target_color = tiles_avg_rgb(&region, params.sigma_divisor);

                let mut min_dist = f64::MAX;
                let mut best_idx = 0;

                for (i, tile) in tiles.iter().enumerate() {
                    let r_diff = (tile.color[0] - target_color[0]).abs();
                    let g_diff = (tile.color[1] - target_color[1]).abs();
                    let b_diff = (tile.color[2] - target_color[2]).abs();

                    let color_dist = (r_diff * r_diff) + (g_diff * g_diff) + (b_diff * b_diff);
                    let penalty = usage_counts[i] as f64 * params.penalty_factor;
                    let total_dist = color_dist + penalty;

                    if total_dist < min_dist {
                        min_dist = total_dist;
                        best_idx = i;
                    }
                }

                usage_counts[best_idx] += 1;

                let final_tile = tiles[best_idx]
                    .image
                    .resize_exact(width, height, FilterType::Nearest);

                image::imageops::overlay(&mut canvas, &final_tile, x as i64, y as i64);
            }
        }

        let output_path = std::env::temp_dir().join("mosaic_output.png");
        canvas
            .save(&output_path)
            .map_err(|e| format!("Failed to save mosaic: {}", e))?;

        Ok::<_, String>(output_path)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    Ok(output_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![generate_mosaic])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
