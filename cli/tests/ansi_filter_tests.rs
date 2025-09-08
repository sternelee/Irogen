#[cfg(test)]
mod ansi_filter_tests {
    use regex::Regex;

    /// Filter out problematic ANSI escape sequences from terminal output
    fn filter_ansi_sequences(input: &str) -> String {
        // Quick check for escape sequences
        if !input.contains('\x1B') {
            return input.to_string();
        }
        
        let ansi_regex = Regex::new(r"(?x)
            \x1B\[                    # Start with ESC[
            (?:
                [0-9]*;[0-9]*c        | # Device Status Report response (e.g., 1;2c from vim)
                [0-9]*;[0-9]*R        | # Cursor Position Report response
                \?[0-9]+[hl]          | # Private mode set/reset
                [0-9]*;?[0-9]*;?[0-9]*[ABCDEFGHJKSTfmsu] | # Other CSI sequences
                [0-9]*[ABCDEFGHJKST]    # Simple cursor movement, etc.
            )
            |
            \x1B\]0;[^\x07\x1B]*[\x07\x1B\\] | # Window title sequences
            \x1B[()>][0-9AB]          | # Character set selection
            \x1B[?0-9]*[hl]           | # Mode queries and responses
            \x1B>[0-9]*c              | # Secondary Device Attribute responses
            \x1B\[>[0-9;]*c            # Primary Device Attribute responses
        ").expect("Invalid regex pattern");
        
        let mut filtered = ansi_regex.replace_all(input, "").to_string();
        
        // Additional cleanup for vim-specific sequences
        let vim_sequences = &[
            "\x1B[?1000h", "\x1B[?1000l", // Mouse tracking
            "\x1B[?1002h", "\x1B[?1002l", // Cell motion mouse tracking
            "\x1B[?1006h", "\x1B[?1006l", // SGR mouse mode
            "\x1B[?2004h", "\x1B[?2004l", // Bracketed paste mode
            "\x1B[?25h", "\x1B[?25l",     // Show/hide cursor
            "\x1B[?1049h", "\x1B[?1049l", // Alternative buffer
            "\x1B[?47h", "\x1B[?47l",     // Alternative buffer (legacy)
            "\x1B[c", "\x1B[>c", "\x1B[6n", // Device queries
        ];
        
        for seq in vim_sequences {
            filtered = filtered.replace(seq, "");
        }
        
        filtered
    }

    /// Check if a string contains only ANSI escape sequences (no visible content)
    fn is_only_ansi_sequences(input: &str) -> bool {
        let filtered = filter_ansi_sequences(input);
        filtered.trim().is_empty()
    }

    #[test]
    fn test_vim_escape_sequence_filtering() {
        // Test the specific vim sequence that causes "1;2c" output
        let vim_sequence = "\x1B[1;2c";
        assert!(is_only_ansi_sequences(vim_sequence));
        
        let filtered = filter_ansi_sequences(vim_sequence);
        assert_eq!(filtered, "");
        
        // Test other vim sequences
        let test_cases = vec![
            ("\x1B[?1000h", ""), // Mouse tracking enable
            ("\x1B[?1000l", ""), // Mouse tracking disable
            ("\x1B[?2004h", ""), // Bracketed paste mode enable
            ("\x1B[?2004l", ""), // Bracketed paste mode disable
            ("\x1B[6n", ""),     // Cursor position query
            ("\x1B[c", ""),      // Device attribute query
            ("\x1B[>c", ""),     // Secondary device attribute query
        ];
        
        for (input, expected) in test_cases {
            let result = filter_ansi_sequences(input);
            assert_eq!(result, expected, "Failed to filter: {:?}", input);
        }
    }
    
    #[test]
    fn test_mixed_content_filtering() {
        // Test content mixed with ANSI sequences
        let mixed = "Hello\x1B[1;2cWorld\x1B[?2004h!";
        let filtered = filter_ansi_sequences(mixed);
        assert_eq!(filtered, "HelloWorld!");
        
        // Should not be considered only ANSI since it has visible content
        assert!(!is_only_ansi_sequences(mixed));
    }
    
    #[test]
    fn test_preserve_useful_ansi() {
        // Test that we preserve useful ANSI sequences like colors
        let colored_text = "\x1B[31mRed Text\x1B[0m";
        let filtered = filter_ansi_sequences(colored_text);
        // Colors should be preserved (not in our filter list)
        assert!(filtered.contains("31m"));
        assert!(filtered.contains("Red Text"));
    }
    
    #[test]
    fn test_no_escape_sequences() {
        // Test plain text without escape sequences
        let plain_text = "This is plain text";
        let filtered = filter_ansi_sequences(plain_text);
        assert_eq!(filtered, plain_text);
        assert!(!is_only_ansi_sequences(plain_text));
    }
}