# Mosaic Generator GUI

A sleek desktop application for creating photographic mosaics using Tauri v2.

## Prerequisites

Before running the application, install the required system dependencies:

### Linux (Arch-based)
```bash
sudo pacman -S webkit2gtk-4.1
```

### Linux (Debian/Ubuntu)
```bash
sudo apt install libwebkit2gtk-4.1-dev
```

See the [Tauri Prerequisites Guide](https://v2.tauri.app/start/prerequisites/) for other platforms.

## Features

- **Modern GUI**: Midnight black theme with gradient accents
- **Real-time Controls**: Interactive sliders for all mosaic parameters
- **Debounced Updates**: Efficient mosaic generation with 800ms debouncing
- **File Selection**: Easy file picker for target images and tile directories
- **Live Preview**: See your mosaic instantly in the app

## Settings

- **Tile Size** (8-128px): Controls the granularity of the mosaic
- **Asset Size** (32-256px): Size to resize source tile images
- **Penalty Factor** (0-500): Controls how much to penalize tile reuse
- **Sigma Divisor** (0-10): Gaussian weighting (0=uniform, higher=stronger center focus)

## Running the Application

### Development Mode
```bash
cd /home/matt/Projects/mosaic-gui
npm run dev
```

### Build for Production
```bash
npm run build
```

## How to Use

1. Click "Select Image" to choose your target image (PNG/JPG)
2. Click "Select Folder" to choose a directory containing tile images
3. Adjust the sliders to customize your mosaic
4. Click "Generate Mosaic" or wait for auto-generation (debounced)
5. View your mosaic in the preview panel

## Technology Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Backend**: Rust with Tauri v2
- **Image Processing**: Rust `image` crate with parallel processing via `rayon`
- **Plugins**: tauri-plugin-fs, tauri-plugin-dialog

## Architecture

- `/ui/` - Frontend files (HTML, CSS, JS)
- `/src-tauri/` - Rust backend
  - `src/main.rs` - Tauri commands and app logic
  - `src/lib.rs` - Mosaic generation algorithm
  - `tauri.conf.json` - Tauri configuration
