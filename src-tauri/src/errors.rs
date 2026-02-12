use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Application error types with context.
#[derive(Error, Debug, Serialize, Deserialize)]
#[non_exhaustive]
pub enum AppError {
    #[error("IO Error: {0}")]
    Io(String),
    #[error("Image Processing Error: {0}")]
    Image(String),
    #[error("Configuration Error: {0}")]
    Config(String),
}

// Convert internal errors into serializable AppErrors with context
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(format!("{}: {}", err.kind(), err))
    }
}

impl From<image::ImageError> for AppError {
    fn from(err: image::ImageError) -> Self {
        AppError::Image(err.to_string())
    }
}

/// Result type alias for application operations.
pub type AppResult<T> = Result<T, AppError>;
