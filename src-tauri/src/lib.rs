use image::{imageops::FilterType, DynamicImage, GenericImageView, Rgba};
use rayon::iter::{ParallelBridge, ParallelIterator};
use std::path::PathBuf;
use walkdir::WalkDir;

#[derive(Debug, Clone)]
pub struct Tile {
    pub path: PathBuf,
    pub color: [f64; 3],
    pub image: DynamicImage,
}

pub fn load_library(src: &str, size: u32) -> Vec<Tile> {
    WalkDir::new(src)
        .into_iter()
        .filter_map(|e| e.ok())
        .par_bridge()
        .filter_map(|entry| {
            let path = entry.path();

            let is_img = path.extension().is_some_and(|ext| {
                let s = ext.to_string_lossy().to_lowercase();
                s == "jpg" || s == "jpeg" || s == "png"
            });

            if !is_img {
                return None;
            }

            let img = image::open(path).ok()?;
            let tile = img.resize_to_fill(size, size, FilterType::Lanczos3);
            let rgb_avg = tiles_avg_rgb(&tile, 0.0);

            Some(Tile {
                path: path.to_path_buf(),
                color: rgb_avg,
                image: tile,
            })
        })
        .collect()
}

pub fn tiles_avg_rgb(img: &impl GenericImageView<Pixel = Rgba<u8>>, sigma_divisor: f64) -> [f64; 3] {
    let mut r = 0.0;
    let mut g = 0.0;
    let mut b = 0.0;
    let mut total_weight = 0.0;

    let (w, h) = img.dimensions();
    let center_x = w as f64 / 2.0;
    let center_y = h as f64 / 2.0;

    let use_gaussian = sigma_divisor > 0.0;
    let sigma = if use_gaussian { w.max(h) as f64 / sigma_divisor } else { 1.0 };

    for (x, y, pixel) in img.pixels() {
        let weight = if use_gaussian {
            let dx = x as f64 - center_x;
            let dy = y as f64 - center_y;
            let dist_sq = dx * dx + dy * dy;
            (-dist_sq / (2.0 * sigma * sigma)).exp()
        } else {
            1.0
        };

        r += pixel.0[0] as f64 * weight;
        g += pixel.0[1] as f64 * weight;
        b += pixel.0[2] as f64 * weight;
        total_weight += weight;
    }

    [r / total_weight, g / total_weight, b / total_weight]
}
