//! Built-in slash command processor
//!
//! This module converts Irogen built-in commands to ACP prompts,
//! leveraging Claude Code's capabilities to implement these features.

use std::path::Path;

use crate::message_protocol::BuiltinCommand;

/// Built-in command processing result
#[derive(Debug, Clone)]
pub struct BuiltinCommandResult {
    /// Converted prompt text
    pub prompt: String,
    /// Optional system prompt (for changing agent behavior)
    pub system_prompt: Option<String>,
    /// Whether special handling is required (e.g., waiting for user confirmation)
    pub requires_confirmation: bool,
}

/// Convert built-in commands to ACP prompts
pub fn process_builtin_command(cmd: &BuiltinCommand, _working_dir: &Path) -> BuiltinCommandResult {
    match cmd {
        BuiltinCommand::Init { description } => {
            let prompt = format!(
                r#"Please analyze this codebase and create a CLAUDE.md file, which will be given to future instances of Claude Code to operate in this repository.

What to add:
1. Commands that will be commonly used, such as how to build, lint, and run tests. Include the necessary commands to develop in this codebase, such as how to run a single test.
2. High-level code architecture and structure so that future instances can be productive more quickly. Focus on the "big picture" architecture that requires reading multiple files to understand.

Usage notes:
- If there's already a CLAUDE.md, suggest improvements to it.
- When you make the initial CLAUDE.md, do not repeat yourself and do not include obvious instructions like "Provide helpful error messages to users", "Write unit tests for all new utilities", "Never include sensitive information (API keys, tokens) in code or commits".
- Avoid listing every component or file structure that can be easily discovered.
- Don't include generic development practices.
- If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include the important parts.
- If there is a README.md, make sure to include the important parts.
- Do not make up information such as "Common Development Tasks", "Tips for Development", "Support and Documentation" unless this is expressly included in other files that you read.
- Be sure to prefix the file with the following text:

```
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
```

{}

Please explore the codebase thoroughly to understand:
- Build, test, and lint commands
- Languages, frameworks, and package manager
- Project structure
- Code style rules
- Non-obvious gotchas or workflow quirks"#,
                description.as_ref().map(|d| format!("Additional context: {}\n", d)).unwrap_or_default()
            );
            BuiltinCommandResult {
                prompt,
                system_prompt: Some(
                    "You are a project initialization expert, skilled at analyzing codebases and providing structured development advice."
                        .to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Review { target } => {
            let prompt = if let Some(t) = target {
                format!(
                    r#"Please conduct a code review for the following target: {}

Please check:
1. Code quality and readability
2. Potential performance issues
3. Security vulnerabilities
4. Compliance with best practices
5. Improvement suggestions

Please provide specific improvement suggestions and code examples."#,
                    t
                )
            } else {
                r#"You are an expert code reviewer. Follow these steps:

1. Run `git status` and `git diff HEAD` to view all changes (staged and unstaged)
2. Analyze the changes and provide a thorough code review that includes:
   - Overview of what the changes do
   - Analysis of code quality and style
   - Specific suggestions for improvements
   - Any potential issues or risks

Keep your review concise but thorough. Focus on:
- Code correctness
- Following project conventions
- Performance implications
- Test coverage
- Security considerations

Format your review with clear sections and bullet points."#
                    .to_string()
            };
            BuiltinCommandResult {
                prompt,
                system_prompt: Some(
                    "You are a strict code review expert, adept at identifying potential issues and providing constructive feedback."
                        .to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Commit { message } => {
            if let Some(msg) = message {
                BuiltinCommandResult {
                    prompt: format!(
                        r#"Please execute the following git operations:
1. Run `git status` to view current changes
2. Run `git add -A` to stage all changes
3. Run `git commit -m "{}"` to commit changes

Please tell me the commit result when done."#,
                        msg
                    ),
                    system_prompt: Some("You are a git operations assistant.".to_string()),
                    requires_confirmation: true,
                }
            } else {
                BuiltinCommandResult {
                    prompt: r#"## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Git Safety Protocol

- NEVER update the git config
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- CRITICAL: ALWAYS create NEW commits. NEVER use git commit --amend, unless the user explicitly requests it
- Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported

## Your task

Based on the above changes, create a single git commit:

1. Analyze all staged changes and draft a commit message:
   - Look at the recent commits above to follow this repository's commit message style
   - Summarize the nature of the changes (new feature, enhancement, bug fix, refactoring, test, docs, etc.)
   - Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.)
   - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"

2. Stage relevant files and create the commit using HEREDOC syntax:
```
git commit -m "$(cat <<'EOF'
Commit message here.
EOF
)"
```

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls."#
                        .to_string(),
                    system_prompt: Some(
                        "You are a git expert, adept at generating standardized commit messages.".to_string(),
                    ),
                    requires_confirmation: true,
                }
            }
        }

        BuiltinCommand::Loop { task, iterations } => {
            let iter_desc = iterations
                .map(|i| format!("up to {} iterations", i))
                .unwrap_or_else(|| "until task completion".to_string());

            BuiltinCommandResult {
                prompt: format!(
                    r#"Please execute the following task in a loop ({}):

Task: {}

Requirements:
1. Summarize progress after each iteration
2. Check if the goal has been achieved
3. If not completed, continue to the next iteration
4. Report total iteration count and final result when done"#,
                    iter_desc, task
                ),
                system_prompt: Some(
                    "You are a focused execution assistant, skilled at iteratively completing tasks and continuously following up.".to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::AddDir { path } => {
            BuiltinCommandResult {
                prompt: format!(
                    r#"Please read all relevant files in directory {} and include their content in our conversation context.

Please:
1. List the directory structure
2. Read key files (code, config, documentation)
3. Summarize the main functionality and purpose of this directory
4. Reference these file contents in subsequent responses"#,
                    path
                ),
                system_prompt: None,
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Branch { name } => {
            if let Some(branch_name) = name {
                BuiltinCommandResult {
                    prompt: format!(
                        r#"Please execute the following git branch operations:
1. Run `git status` to check current status
2. If working directory is clean, run `git checkout -b {}` to create and switch to new branch
3. If working directory has changes, stash or commit first, then create branch
4. Tell me the current branch when done"#,
                        branch_name
                    ),
                    system_prompt: Some("You are a git branch management assistant.".to_string()),
                    requires_confirmation: true,
                }
            } else {
                BuiltinCommandResult {
                    prompt: r#"Please help me check the branch situation:
1. Run `git status` to view current status
2. Run `git branch -a` to list all branches
3. Run `git branch --show-current` to see current branch
4. Tell me recommended actions (create new branch, switch branch, or stay on current branch)"#
                        .to_string(),
                    system_prompt: None,
                    requires_confirmation: false,
                }
            }
        }

        BuiltinCommand::Btw { message } => {
            BuiltinCommandResult {
                prompt: format!(
                    r#"By the way, record the following thought/context, please consider it in subsequent responses:

💭 {}

This may affect our current discussion, please adjust subsequent recommendations accordingly."#,
                    message
                ),
                system_prompt: None,
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Clear => BuiltinCommandResult {
            // Note: ACP does not support true context clearing
            // This just sends a hint to start a new topic
            prompt: r#"Let's start a new topic. Please ignore previous conversation context and focus on the upcoming discussion.

(Hint: To truly clear context, please create a new session)"#             .to_string(),
            system_prompt: None,
            requires_confirmation: false,
        },

        BuiltinCommand::Compact => {
            BuiltinCommandResult {
                prompt: r#"Please summarize our current conversation content into a concise summary:

Requirements:
1. Summarize main discussion points and decisions
2. List to-do items and next actions
3. Keep key code snippets and configurations
4. Discard redundant intermediate thinking processes

So we can continue with a clearer context."#.to_string(),
                system_prompt: None,
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Plan { description } => {
            BuiltinCommandResult {
                prompt: format!(
                    r#"Please create a structured execution plan for the following task:

Task: {}

Please provide:
1. Goal clarification and understanding
2. Step-by-step detailed plan (including estimated time and dependencies for each step)
3. Potential risks and mitigation measures
4. Success criteria
5. Output as a todo-style checkable task list

Format example:
- [ ] Step 1: Description"#,
                    description
                ),
                system_prompt: Some(
                    "You are a project planning expert, skilled at creating structured execution plans.".to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Rename { new_name } => {
            // Note: This only sends a hint to the agent
            // Actual session rename should be handled by UI layer
            BuiltinCommandResult {
                prompt: format!(
                    r#"This session has been renamed to: "{}"

Please appropriately reference this name in subsequent responses."#,
                    new_name
                ),
                system_prompt: None,
                requires_confirmation: false,
            }
        }

        // Other commands are not processed through this handler
        _ => BuiltinCommandResult {
            prompt: String::new(),
            system_prompt: None,
            requires_confirmation: false,
        },
    }
}

/// Parse slash command string into BuiltinCommand
pub fn parse_slash_command(input: &str) -> Option<BuiltinCommand> {
    let input = input.trim();
    if !input.starts_with('/') {
        return None;
    }

    let parts: Vec<&str> = input[1..].split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }

    let cmd = parts[0].to_lowercase();
    let args = &parts[1..];

    match cmd.as_str() {
        "init" => Some(BuiltinCommand::Init {
            description: args.join(" ").trim().to_string().into(),
        }),
        "review" => Some(BuiltinCommand::Review {
            target: args.join(" ").trim().to_string().into(),
        }),
        "commit" => Some(BuiltinCommand::Commit {
            message: args.join(" ").trim().to_string().into(),
        }),
        "loop" => {
            // Parse format: /loop [n] <task>
            if args.is_empty() {
                return None;
            }
            let (iterations, task) = if let Ok(n) = args[0].parse::<u32>() {
                (Some(n), args[1..].join(" "))
            } else {
                (None, args.join(" "))
            };
            if task.trim().is_empty() {
                None
            } else {
                Some(BuiltinCommand::Loop { task, iterations })
            }
        }
        "add-dir" => {
            let path = args.join(" ");
            if path.is_empty() {
                None
            } else {
                Some(BuiltinCommand::AddDir { path })
            }
        }
        "branch" => Some(BuiltinCommand::Branch {
            name: args.join(" ").trim().to_string().into(),
        }),
        "btw" => {
            let message = args.join(" ");
            if message.is_empty() {
                None
            } else {
                Some(BuiltinCommand::Btw { message })
            }
        }
        "clear" => Some(BuiltinCommand::Clear),
        "compact" => Some(BuiltinCommand::Compact),
        "plan" => {
            let description = args.join(" ");
            if description.is_empty() {
                None
            } else {
                Some(BuiltinCommand::Plan { description })
            }
        }
        "rename" => {
            let new_name = args.join(" ");
            if new_name.is_empty() {
                None
            } else {
                Some(BuiltinCommand::Rename { new_name })
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_init() {
        let cmd = parse_slash_command("/init a new rust project");
        assert!(matches!(cmd, Some(BuiltinCommand::Init { .. })));
    }

    #[test]
    fn test_parse_review() {
        let cmd = parse_slash_command("/review src/main.rs");
        assert!(matches!(cmd, Some(BuiltinCommand::Review { .. })));
    }

    #[test]
    fn test_parse_commit() {
        let cmd = parse_slash_command("/commit fix: bug in parser");
        assert!(matches!(cmd, Some(BuiltinCommand::Commit { .. })));
    }

    #[test]
    fn test_parse_clear() {
        let cmd = parse_slash_command("/clear");
        assert!(matches!(cmd, Some(BuiltinCommand::Clear)));
    }
}
