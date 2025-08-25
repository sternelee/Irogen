use anyhow::Result;
use base64::prelude::*;
use brotli::{CompressorReader, Decompressor};
use std::io::Read;

/// String compression utility for shortening tickets and other data
/// This is a simplified version for the app that focuses on decompression
pub struct StringCompressor;

impl StringCompressor {
    /// Compress a string using Brotli compression + Base64 URL-safe encoding
    /// This is optimized for mobile QR code compatibility
    pub fn compress(input: &str) -> Result<String> {
        let input_bytes = input.as_bytes();
        
        // Use Brotli compression with maximum settings for best compression
        let mut compressor = CompressorReader::new(input_bytes, 8192, 11, 24);
        let mut compressed_data = Vec::new();
        compressor.read_to_end(&mut compressed_data)?;
        
        // Use Base64 URL-safe encoding without padding (shorter)
        let encoded = BASE64_URL_SAFE_NO_PAD.encode(&compressed_data);
        
        Ok(encoded)
    }
    
    /// Decompress a string that was compressed with compress() or compress_hybrid()
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
        let compressed_data = BASE64_URL_SAFE_NO_PAD.decode(compressed)
            .map_err(|e| anyhow::anyhow!("Failed to decode Base64: {}", e))?;
        
        // Use Brotli decompression
        let mut decompressor = Decompressor::new(&compressed_data[..], 8192);
        let mut decompressed = String::new();
        decompressor.read_to_string(&mut decompressed)
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
    
    /// Validate that a string can be decompressed (for testing)
    pub fn validate_compressed(compressed: &str) -> bool {
        Self::decompress(compressed).is_ok()
    }
}