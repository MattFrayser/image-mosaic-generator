pub mod errors;

use crate::errors::{AppError, AppResult};
use base64::{engine::general_purpose, Engine as _};
use image::{
    codecs::png::PngEncoder, imageops::FilterType, metadata::Orientation, DynamicImage,
    GenericImageView, ImageBuffer, ImageDecoder, ImageEncoder, ImageReader,
};
use kiddo::{ImmutableKdTree, SquaredEuclidean};
use rayon::prelude::*;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use walkdir::WalkDir;

/// Loads an image and applies EXIF orientation if present.
pub fn load_image_with_orientation(path: impl AsRef<Path>) -> AppResult<DynamicImage> {
    let reader = ImageReader::open(path.as_ref())
        .map_err(|e| AppError::Image(format!("Failed to open image: {}", e)))?;

    let mut decoder = reader
        .into_decoder()
        .map_err(|e| AppError::Image(format!("Failed to decode image: {}", e)))?;

    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);

    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|e| AppError::Image(format!("Failed to load image: {}", e)))?;

    img.apply_orientation(orientation);

    Ok(img)
}

fn load_resized_image_with_orientation(
    path: impl AsRef<Path>,
    size: u32,
) -> AppResult<DynamicImage> {
    let img = load_image_with_orientation(path)?;
    Ok(img.resize_to_fill(size, size, FilterType::Lanczos3))
}

// Constants for performance tuning
const PENALTY_MULTIPLIER: f64 = 50.0;
const KD_TREE_K_MIN: usize = 10;
const KD_TREE_K_MAX: usize = 100;
const KD_TREE_K_DIVISOR: usize = 10;
const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png"];

/// Pre-calculated Gaussian weights for O(1) weight lookups during color averaging.
#[derive(Clone)]
pub struct GaussianMask {
    weights: Vec<f64>,
    total_weight: f64,
}

impl GaussianMask {
    /// Creates a new Gaussian mask with the specified size and sigma divisor.
    #[must_use]
    pub fn new(size: u32, sigma_divisor: f64) -> Self {
        let capacity = (size * size) as usize;
        let mut weights = Vec::with_capacity(capacity);
        let mut total_weight = 0.0;
        let center = size as f64 / 2.0;

        let use_gaussian = sigma_divisor > 0.0;
        let sigma = if use_gaussian {
            size as f64 / sigma_divisor
        } else {
            1.0
        };

        for y in 0..size {
            for x in 0..size {
                let weight = if use_gaussian {
                    let dx = x as f64 - center;
                    let dy = y as f64 - center;
                    let dist_sq = dx * dx + dy * dy;
                    (-dist_sq / (2.0 * sigma * sigma)).exp()
                } else {
                    1.0
                };
                weights.push(weight);
                total_weight += weight;
            }
        }
        Self {
            weights,
            total_weight,
        }
    }

    #[inline]
    pub fn total_weight(&self) -> f64 {
        self.total_weight
    }

    #[inline]
    pub fn weights(&self) -> &[f64] {
        &self.weights
    }
}

/// Configuration for mosaic generation.
#[derive(Debug, Clone, Copy)]
pub struct MosaicConfig {
    pub penalty_factor: f64,
}

/// Represents a single tile with its metadata.
/// Images are loaded lazily to save memory.
#[derive(Debug, Clone)]
pub struct Tile {
    pub path: PathBuf,
    pub color: [f64; 3],
    /// Cached resized image. None if not yet loaded.
    image_cache: Option<Arc<DynamicImage>>,
    tile_size: u32,
}

impl Tile {
    /// Creates a new tile with color information.
    /// The image will be loaded lazily when needed.
    #[must_use]
    pub fn new(path: PathBuf, color: [f64; 3], tile_size: u32) -> Self {
        Self {
            path,
            color,
            image_cache: None,
            tile_size,
        }
    }

    /// Gets the cached image or loads it if needed.
    pub fn get_image(&mut self) -> AppResult<Arc<DynamicImage>> {
        if let Some(ref cached) = self.image_cache {
            return Ok(Arc::clone(cached));
        }

        let resized =
            load_resized_image_with_orientation(&self.path, self.tile_size).map_err(|e| {
                AppError::Image(format!(
                    "Failed to load tile {}: {}",
                    self.path.display(),
                    e
                ))
            })?;
        let cached = Arc::new(resized);
        self.image_cache = Some(Arc::clone(&cached));
        Ok(cached)
    }
}

/// Calculates average RGB color using a Gaussian mask.
/// Uses pre-calculated weights for O(1) weight lookups.
#[inline]
#[must_use]
fn avg_rgb_with_mask(img: &DynamicImage, mask: &GaussianMask) -> [f64; 3] {
    let mut r = 0.0;
    let mut g = 0.0;
    let mut b = 0.0;

    let weights = mask.weights();
    for (i, (_, _, pixel)) in img.pixels().enumerate() {
        // Safe access because padding guarantees image size == mask size
        let weight = weights[i];
        r += pixel.0[0] as f64 * weight;
        g += pixel.0[1] as f64 * weight;
        b += pixel.0[2] as f64 * weight;
    }

    let total = mask.total_weight();
    [r / total, g / total, b / total]
}

/// Tile library with KD-tree acceleration for fast color matching.
pub struct TileLibrary {
    tiles: Vec<Tile>,
    color_index: ImmutableKdTree<f64, 3>,
    src_dir: PathBuf,
    tile_size: u32,
    sigma_divisor: f64,
    mask: GaussianMask,
}

impl TileLibrary {
    /// Creates a new tile library from a directory.
    pub fn new(dir: PathBuf, size: u32, sigma_divisor: f64) -> AppResult<Self> {
        let mask = GaussianMask::new(size, sigma_divisor);
        let tiles = Self::load_library(&dir, size, &mask)?;

        if tiles.is_empty() {
            return Err(AppError::Config(
                "No valid images found in directory".into(),
            ));
        }

        // Build KD-tree for fast color matching
        let color_points: Vec<[f64; 3]> = tiles.iter().map(|t| t.color).collect();
        let color_index = ImmutableKdTree::new_from_slice(&color_points);

        Ok(Self {
            tiles,
            color_index,
            src_dir: dir,
            tile_size: size,
            sigma_divisor,
            mask,
        })
    }

    /// Loads tiles from a directory in parallel.
    fn load_library(src: &Path, size: u32, mask: &GaussianMask) -> AppResult<Vec<Tile>> {
        // Collect entries first to avoid holding WalkDir in the parallel bridge
        let entries: Vec<PathBuf> = WalkDir::new(src)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .collect();

        let tiles: Vec<Tile> = entries
            .into_par_iter()
            .filter_map(|path| {
                let ext = path.extension()?.to_string_lossy().to_lowercase();
                if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                    return None;
                }

                let tile_img = load_resized_image_with_orientation(&path, size).ok()?;
                // Calculate color from resized image
                let color = avg_rgb_with_mask(&tile_img, mask);

                Some(Tile::new(path, color, size))
            })
            .collect();

        Ok(tiles)
    }

    /// Checks if the library matches the given configuration.
    #[inline]
    #[must_use]
    pub fn matches_config(&self, dir: &Path, size: u32, sigma_divisor: f64) -> bool {
        self.src_dir == dir && self.tile_size == size && self.sigma_divisor == sigma_divisor
    }

    /// Generates a mosaic from a target image.
    pub fn generate_mosaic(
        &mut self,
        target_path: &str,
        config: &MosaicConfig,
    ) -> AppResult<String> {
        let target_img = load_image_with_orientation(target_path)?;
        let (orig_w, orig_h) = target_img.dimensions();

        // Pad image to be a perfect multiple of tile_size
        let pad_w = ((orig_w + self.tile_size - 1) / self.tile_size) * self.tile_size;
        let pad_h = ((orig_h + self.tile_size - 1) / self.tile_size) * self.tile_size;

        // Only resize if dimensions actually changed to preserve quality
        let target = if pad_w == orig_w && pad_h == orig_h {
            // No padding needed, use original image
            target_img.to_rgba8()
        } else {
            // Resize only when necessary, using high-quality filter
            target_img
                .resize_exact(pad_w, pad_h, FilterType::Lanczos3)
                .to_rgba8()
        };

        // Calculate tile coordinates
        let coords: Vec<(u32, u32)> = (0..pad_h)
            .step_by(self.tile_size as usize)
            .flat_map(|y| {
                (0..pad_w)
                    .step_by(self.tile_size as usize)
                    .map(move |x| (x, y))
            })
            .collect();

        // Process tiles sequentially with usage tracking
        // Penalty must be applied sequentially to maintain deterministic results
        let mut usage_counts = vec![0usize; self.tiles.len()];
        let matches: Vec<usize> = coords
            .iter()
            .map(|&(x, y)| {
                let region = target.view(x, y, self.tile_size, self.tile_size).to_image();
                let target_color = avg_rgb_with_mask(&DynamicImage::ImageRgba8(region), &self.mask);
                let best_idx =
                    self.find_best_tile(target_color, &usage_counts, config.penalty_factor);
                usage_counts[best_idx] += 1;
                best_idx
            })
            .collect();

        // Build canvas sequentially (required for image operations)
        // Use RgbaImage for better quality preservation
        let mut canvas = ImageBuffer::<image::Rgba<u8>, Vec<u8>>::new(pad_w, pad_h);
        for ((x, y), &best_idx) in coords.iter().zip(matches.iter()) {
            // Load image if not cached
            let tile_img = self.tiles[best_idx].get_image()?;
            // Convert to RgbaImage for overlay to ensure proper format
            let tile_rgba = tile_img.to_rgba8();
            image::imageops::overlay(&mut canvas, &tile_rgba, *x as i64, *y as i64);
        }

        // Crop back to original user dimensions
        let final_canvas = image::imageops::crop_imm(&canvas, 0, 0, orig_w, orig_h).to_image();

        // Encode as base64 PNG
        let mut buffer = Vec::new();
        let (width, height) = final_canvas.dimensions();
        let encoder = PngEncoder::new(&mut buffer);
        encoder
            .write_image(
                final_canvas.as_raw(),
                width,
                height,
                image::ColorType::Rgba8.into(),
            )
            .map_err(|e| AppError::Image(format!("Failed to encode image: {}", e)))?;

        Ok(format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(buffer)
        ))
    }

    /// Finds the best tile match considering both color and usage penalty.
    /// Uses KD-tree acceleration for O(log n) lookup.
    #[inline]
    fn find_best_tile(
        &self,
        target_color: [f64; 3],
        usage_counts: &[usize],
        penalty: f64,
    ) -> usize {
        // Adaptive k: query 10-100 nearest neighbors
        let k = (self.tiles.len() / KD_TREE_K_DIVISOR)
            .max(KD_TREE_K_MIN)
            .min(KD_TREE_K_MAX)
            .min(self.tiles.len())
            .max(1);

        // k is guaranteed to be >= 1, so unwrap is safe
        let k_nonzero = NonZeroUsize::new(k).unwrap();
        let nearest = self
            .color_index
            .nearest_n::<SquaredEuclidean>(&target_color, k_nonzero);

        // Find best among candidates considering penalty
        let mut best_idx = 0;
        let mut min_score = f64::MAX;

        for neighbor in nearest {
            let idx = neighbor.item as usize;
            let color_dist = neighbor.distance;
            let penalty_score = usage_counts[idx] as f64 * penalty * PENALTY_MULTIPLIER;
            let total_score = color_dist + penalty_score;

            if total_score < min_score {
                min_score = total_score;
                best_idx = idx;
            }
        }

        best_idx
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn build_test_library() -> TileLibrary {
        let points = [[0.0, 0.0, 0.0]];
        TileLibrary {
            tiles: vec![Tile::new(
                PathBuf::from("/tmp/tile.png"),
                [0.0, 0.0, 0.0],
                32,
            )],
            color_index: ImmutableKdTree::new_from_slice(&points),
            src_dir: PathBuf::from("/tmp/tiles"),
            tile_size: 32,
            sigma_divisor: 4.0,
            mask: GaussianMask::new(32, 4.0),
        }
    }

    #[test]
    fn matches_config_includes_sigma_divisor() {
        let lib = build_test_library();

        assert!(lib.matches_config(Path::new("/tmp/tiles"), 32, 4.0));
        assert!(!lib.matches_config(Path::new("/tmp/tiles"), 32, 8.0));
    }

    #[test]
    fn load_resized_image_with_orientation_resizes_to_tile_size() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let test_path = std::env::temp_dir().join(format!("mosaic-test-{}.png", timestamp));

        let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_fn(20, 10, |_x, _y| Rgba([255, 0, 0, 255]));
        img.save(&test_path).unwrap();

        let resized = load_resized_image_with_orientation(&test_path, 8).unwrap();

        assert_eq!(resized.dimensions(), (8, 8));

        std::fs::remove_file(test_path).unwrap();
    }
}
