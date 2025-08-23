#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::state::AppState;

    #[test]
    fn test_app_error_serialization() {
        let error = AppError::NetworkNotInitialized;
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(serialized.contains("Network not initialized"));
    }

    #[test]
    fn test_app_state_creation() {
        let state = AppState::new();
        // State should be created successfully
        assert!(true); // Placeholder assertion
    }

    #[tokio::test]
    async fn test_app_state_cleanup() {
        let state = AppState::new();
        state.cleanup().await;
        // Should complete without panic
        assert!(true);
    }

    #[test]
    fn test_error_conversion() {
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "File not found");
        let app_error: AppError = io_error.into();

        match app_error {
            AppError::IoError(msg) => assert!(msg.contains("File not found")),
            _ => panic!("Expected IoError"),
        }
    }

    #[test]
    fn test_json_error_conversion() {
        let json_str = "invalid json";
        let json_error = serde_json::from_str::<serde_json::Value>(json_str).unwrap_err();
        let app_error: AppError = json_error.into();

        match app_error {
            AppError::ParseError(_) => assert!(true),
            _ => panic!("Expected ParseError"),
        }
    }
}

// Integration tests for commands
#[cfg(test)]
mod command_tests {
    use super::*;
    use crate::commands::*;
    use crate::state::AppState;
    use tauri::State;

    // Mock state for testing
    fn create_test_state() -> AppState {
        AppState::new()
    }

    #[tokio::test]
    async fn test_parse_session_ticket_invalid() {
        let result = parse_session_ticket("invalid_ticket".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_active_sessions_empty() {
        let state = create_test_state();
        let state_wrapper = State::from(&state);

        let result = get_active_sessions(state_wrapper).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Vec::<String>::new());
    }

    #[tokio::test]
    async fn test_get_node_info_no_network() {
        let state = create_test_state();
        let state_wrapper = State::from(&state);

        let result = get_node_info(state_wrapper).await;
        assert!(result.is_err());

        match result.unwrap_err() {
            crate::error::AppError::NetworkNotInitialized => assert!(true),
            _ => panic!("Expected NetworkNotInitialized error"),
        }
    }
}

