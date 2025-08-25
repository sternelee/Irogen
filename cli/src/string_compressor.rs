use anyhow::Result;
use base64::prelude::*;
use brotli::{CompressorReader, Decompressor};
use std::io::Read;
use tracing::debug;

/// String compression utility for shortening tickets and other data
pub struct StringCompressor;

impl StringCompressor {
    /// Compress a string using Brotli compression + Base64 URL-safe encoding
    /// This is optimized for mobile QR code compatibility
    pub fn compress(input: &str) -> Result<String> {
        let input_bytes = input.as_bytes();

        // Use more aggressive Brotli compression with maximum settings
        // Quality level 11 (maximum) provides best compression ratio
        // Window size 24 (maximum) for better compression
        let mut compressor = CompressorReader::new(input_bytes, 8192, 11, 24);
        let mut compressed_data = Vec::new();
        compressor.read_to_end(&mut compressed_data)?;

        // Use Base64 URL-safe encoding without padding (shorter)
        let encoded = BASE64_URL_SAFE_NO_PAD.encode(&compressed_data);

        debug!(
            "Compressed string from {} bytes to {} bytes (compression ratio: {:.2}%)",
            input.len(),
            encoded.len(),
            (encoded.len() as f64 / input.len() as f64) * 100.0
        );

        Ok(encoded)
    }

    /// Decompress a string that was compressed with compress()
    pub fn decompress(compressed: &str) -> Result<String> {
        // Check for different compression prefixes
        if compressed.starts_with("HEX_") {
            // Hex encoded for very short strings
            let hex_part = &compressed[4..];
            let bytes = hex::decode(hex_part)
                .map_err(|e| anyhow::anyhow!("Failed to decode hex: {}", e))?;
            return Ok(String::from_utf8(bytes)?);
        }

        // Standard Brotli + Base64 decompression
        // Decode Base64 URL-safe without padding
        let compressed_data = BASE64_URL_SAFE_NO_PAD
            .decode(compressed)
            .map_err(|e| anyhow::anyhow!("Failed to decode Base64: {}", e))?;

        // Use Brotli decompression with larger buffer
        let mut decompressor = Decompressor::new(&compressed_data[..], 8192);
        let mut decompressed = String::new();
        decompressor
            .read_to_string(&mut decompressed)
            .map_err(|e| anyhow::anyhow!("Failed to decompress: {}", e))?;

        Ok(decompressed)
    }

    /// Hybrid compression that tries multiple approaches and picks the best one
    pub fn compress_hybrid(input: &str) -> Result<String> {
        let input_len = input.len();

        // For very short strings, try hex encoding (might be shorter than base64 overhead)
        if input_len < 50 {
            let hex_encoded = format!("HEX_{}", hex::encode(input.as_bytes()));
            if hex_encoded.len() < input_len {
                debug!(
                    "Using hex encoding for short string: {} → {} bytes",
                    input_len,
                    hex_encoded.len()
                );
                return Ok(hex_encoded);
            }
        }

        // Try multiple Brotli compression settings and pick the best
        let mut best_result = input.to_string(); // Fallback to original
        let mut best_size = input_len;

        // Setting 1: Maximum compression (quality 11, window 24)
        if let Ok(result1) = Self::try_brotli_compress(input, 11, 24) {
            if result1.len() < best_size {
                best_result = result1.clone();
                best_size = result1.len();
            }
        }

        // Setting 2: Alternative high compression (quality 10, window 22)
        if let Ok(result2) = Self::try_brotli_compress(input, 10, 22) {
            if result2.len() < best_size {
                best_result = result2.clone();
                best_size = result2.len();
            }
        }

        // Setting 3: Balanced compression (quality 9, window 20)
        if let Ok(result3) = Self::try_brotli_compress(input, 9, 20) {
            if result3.len() < best_size {
                best_size = result3.len();
                best_result = result3;
            }
        }

        debug!(
            "Hybrid compression: {} → {} bytes ({:.1}% reduction)",
            input_len,
            best_size,
            (1.0 - (best_size as f64 / input_len as f64)) * 100.0
        );

        Ok(best_result)
    }

    /// Helper method to try Brotli compression with specific settings
    fn try_brotli_compress(input: &str, quality: u32, window: u32) -> Result<String> {
        let input_bytes = input.as_bytes();
        let mut compressor = CompressorReader::new(input_bytes, 8192, quality, window);
        let mut compressed_data = Vec::new();
        compressor.read_to_end(&mut compressed_data)?;

        // Use Base64 URL-safe encoding without padding
        let encoded = BASE64_URL_SAFE_NO_PAD.encode(&compressed_data);
        Ok(encoded)
    }

    /// Calculate compression ratio (useful for monitoring)
    pub fn compression_ratio(input: &str) -> Result<f64> {
        let compressed = Self::compress(input)?;
        let original_len = input.len();
        let compressed_len = compressed.len();

        Ok(compressed_len as f64 / original_len as f64)
    }

    /// Validate that a string can be decompressed (for testing)
    pub fn validate_compressed(compressed: &str) -> bool {
        Self::decompress(compressed).is_ok()
    }

    /// Get compression statistics for monitoring
    pub fn get_compression_stats(input: &str) -> Result<CompressionStats> {
        let compressed = Self::compress(input)?;
        let original_size = input.len();
        let compressed_size = compressed.len();
        let ratio = compressed_size as f64 / original_size as f64;
        let savings = original_size.saturating_sub(compressed_size);

        Ok(CompressionStats {
            original_size,
            compressed_size,
            compression_ratio: ratio,
            bytes_saved: savings,
            compression_percentage: (1.0 - ratio) * 100.0,
        })
    }
}

/// Statistics about compression performance
#[derive(Debug, Clone)]
pub struct CompressionStats {
    pub original_size: usize,
    pub compressed_size: usize,
    pub compression_ratio: f64,
    pub bytes_saved: usize,
    pub compression_percentage: f64,
}

impl std::fmt::Display for CompressionStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Compression: {} → {} bytes ({:.1}% reduction, ratio: {:.3})",
            self.original_size,
            self.compressed_size,
            self.compression_percentage,
            self.compression_ratio
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compression_roundtrip() {
        let original = "This is a test string that should compress well due to repetitive content. This is a test string that should compress well due to repetitive content.";

        let compressed = StringCompressor::compress(original).unwrap();
        let decompressed = StringCompressor::decompress(&compressed).unwrap();

        assert_eq!(original, decompressed);
        assert!(
            compressed.len() < original.len(),
            "Compression should reduce size"
        );
    }

    #[test]
    fn test_compression_stats() {
        let original = "Hello, World! ".repeat(20);
        let stats = StringCompressor::get_compression_stats(&original).unwrap();

        println!("{}", stats);
        assert!(stats.compression_ratio < 1.0, "Should achieve compression");
        assert!(stats.bytes_saved > 0, "Should save bytes");
    }

    #[test]
    fn test_validation() {
        let original = "Test string for validation";
        let compressed = StringCompressor::compress(original).unwrap();

        assert!(StringCompressor::validate_compressed(&compressed));
        assert!(!StringCompressor::validate_compressed("invalid_data"));
    }

    #[test]
    fn test_empty_string() {
        let original = "";
        let compressed = StringCompressor::compress(original).unwrap();
        let decompressed = StringCompressor::decompress(&compressed).unwrap();

        assert_eq!(original, decompressed);
    }

    #[test]
    fn test_short_string() {
        let original = "Hi";
        let compressed = StringCompressor::compress(original).unwrap();
        let decompressed = StringCompressor::decompress(&compressed).unwrap();

        assert_eq!(original, decompressed);
        // Note: short strings might not compress well due to overhead
    }
}
