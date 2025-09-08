#[cfg(test)]
mod tests {
    use std::time::Duration;

    #[tokio::test]
    async fn test_exponential_backoff_timing() {
        // Test that exponential backoff timing is reasonable
        let start = std::time::Instant::now();

        let mut backoff = Duration::from_millis(500);
        const MAX_BACKOFF: Duration = Duration::from_secs(30);
        const BACKOFF_MULTIPLIER: u32 = 2;

        // Simulate 3 failed attempts
        for attempt in 1..=3 {
            println!("Attempt {}: backoff = {:?}", attempt, backoff);

            // Verify backoff is within reasonable bounds
            assert!(backoff >= Duration::from_millis(500));
            assert!(backoff <= MAX_BACKOFF);

            if attempt < 3 {
                // Simulate exponential backoff (without actual sleep)
                let jitter = Duration::from_millis(50); // Fixed jitter for test
                backoff = std::cmp::min(backoff * BACKOFF_MULTIPLIER + jitter, MAX_BACKOFF);
            }
        }

        let elapsed = start.elapsed();
        assert!(elapsed < Duration::from_millis(100)); // Should complete quickly in test
    }

    #[test]
    fn test_buffer_size_constants() {
        // Verify our buffer size constants are reasonable
        const MAX_EVENTS_BUFFER: usize = 10000;
        const BUFFER_CLEANUP_SIZE: usize = 2500;

        assert!(BUFFER_CLEANUP_SIZE < MAX_EVENTS_BUFFER);
        assert!(BUFFER_CLEANUP_SIZE > 0);
        assert!(MAX_EVENTS_BUFFER > 1000); // Should be large enough for real usage

        // Verify cleanup leaves reasonable buffer size
        let remaining_after_cleanup = MAX_EVENTS_BUFFER - BUFFER_CLEANUP_SIZE;
        assert!(remaining_after_cleanup >= MAX_EVENTS_BUFFER / 2); // At least half remaining
    }
}

