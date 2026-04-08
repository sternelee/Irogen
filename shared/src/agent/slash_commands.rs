//! 内置斜杠命令处理器
//!
//! 此模块将 ClawdPilot 内置命令转换为 ACP prompt，
//! 通过 Claude Code 的能力来实现这些功能。

use std::path::Path;

use crate::message_protocol::BuiltinCommand;

/// 内置命令处理结果
#[derive(Debug, Clone)]
pub struct BuiltinCommandResult {
    /// 转换后的 prompt 文本
    pub prompt: String,
    /// 可选的系统提示（用于改变 agent 行为）
    pub system_prompt: Option<String>,
    /// 是否需要特殊处理（如等待用户确认）
    pub requires_confirmation: bool,
}

/// 将内置命令转换为 ACP prompt
pub fn process_builtin_command(cmd: &BuiltinCommand, working_dir: &Path) -> BuiltinCommandResult {
    match cmd {
        BuiltinCommand::Init { description } => {
            let prompt = format!(
                r#"请帮我初始化这个项目。

{}

请：
1. 分析项目结构和现有文件
2. 识别技术栈和依赖
3. 创建详细的开发计划和架构建议
4. 如果有配置文件，检查是否需要更新"#,
                description
                    .as_ref()
                    .map(|d| format!("项目描述：{}\n", d))
                    .unwrap_or_default()
            );
            BuiltinCommandResult {
                prompt,
                system_prompt: Some(
                    "你是一个项目初始化专家，擅长分析代码库并提供结构化的开发建议。"
                        .to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Review { target } => {
            let prompt = if let Some(t) = target {
                format!(
                    r#"请对以下目标进行代码审查：{}

请检查：
1. 代码质量和可读性
2. 潜在的性能问题
3. 安全漏洞
4. 是否符合最佳实践
5. 是否有改进建议

请提供具体的改进建议和代码示例。"#,
                    t
                )
            } else {
                r#"请审查当前工作目录中的所有更改（包括未提交的修改）。

请检查：
1. 代码质量和可读性
2. 潜在的性能问题
3. 安全漏洞
4. 是否符合最佳实践
5. 是否有改进建议

请提供具体的改进建议和代码示例。"#
                    .to_string()
            };
            BuiltinCommandResult {
                prompt,
                system_prompt: Some(
                    "你是一个严格的代码审查专家，善于发现潜在问题并提供建设性反馈。"
                        .to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Commit { message } => {
            if let Some(msg) = message {
                BuiltinCommandResult {
                    prompt: format!(
                        r#"请执行以下 git 操作：
1. 运行 `git status` 查看当前更改
2. 运行 `git add -A` 暂存所有更改
3. 运行 `git commit -m "{}"` 提交更改

完成后请告诉我提交结果。"#,
                        msg
                    ),
                    system_prompt: Some("你是一个 git 操作助手。".to_string()),
                    requires_confirmation: true,
                }
            } else {
                BuiltinCommandResult {
                    prompt: r#"请帮我生成提交信息并创建 commit。

步骤：
1. 运行 `git status` 和 `git diff --staged`（或 `git diff`）查看更改
2. 根据更改内容生成符合 Conventional Commits 规范的提交信息
3. 执行 `git add -A` 和 `git commit` 完成提交

提交信息格式：<type>(<scope>): <description>
type 可以是：feat, fix, docs, style, refactor, test, chore

请先生成提交信息让我确认，然后再执行提交。"#
                        .to_string(),
                    system_prompt: Some(
                        "你是一个 git 专家，擅长生成规范的提交信息。".to_string(),
                    ),
                    requires_confirmation: true,
                }
            }
        }

        BuiltinCommand::Loop { task, iterations } => {
            let iter_desc = iterations
                .map(|i| format!("最多 {} 次迭代", i))
                .unwrap_or_else(|| "直到任务完成".to_string());

            BuiltinCommandResult {
                prompt: format!(
                    r#"请循环执行以下任务（{}）：

任务：{}

要求：
1. 每次迭代后总结进展
2. 检查是否已完成目标
3. 如果未完成，继续下一次迭代
4. 完成后报告总迭代次数和最终结果"#,
                    iter_desc, task
                ),
                system_prompt: Some(
                    "你是一个专注的执行助手，善于迭代完成任务并持续跟进。".to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::AddDir { path } => {
            BuiltinCommandResult {
                prompt: format!(
                    r#"请阅读目录 {} 中的所有相关文件，并将其内容纳入我们的对话上下文中。

请：
1. 列出目录结构
2. 阅读关键文件（代码、配置、文档）
3. 总结这个目录的主要功能和用途
4. 在后续回答中参考这些文件内容"#,
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
                        r#"请执行以下 git 分支操作：
1. 运行 `git status` 检查当前状态
2. 如果工作区干净，运行 `git checkout -b {}` 创建并切换到新分支
3. 如果工作区有更改，先提交或暂存，然后创建分支
4. 完成后告诉我当前所在分支"#,
                        branch_name
                    ),
                    system_prompt: Some("你是一个 git 分支管理助手。".to_string()),
                    requires_confirmation: true,
                }
            } else {
                BuiltinCommandResult {
                    prompt: r#"请帮我查看分支情况：
1. 运行 `git branch -a` 列出所有分支
2. 运行 `git status` 查看当前状态
3. 告诉我建议的操作（创建新分支、切换分支或保持当前分支）"#
                        .to_string(),
                    system_prompt: None,
                    requires_confirmation: false,
                }
            }
        }

        BuiltinCommand::Btw { message } => {
            BuiltinCommandResult {
                prompt: format!(
                    r#"顺便记录以下想法/上下文，请在后续回答中考虑：

💭 {}

这可能会影响我们当前的讨论，请适当调整后续建议。"#,
                    message
                ),
                system_prompt: None,
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Clear => BuiltinCommandResult {
            // Note: ACP does not support true context clearing
            // This just sends a hint to start a new topic
            prompt: r#"让我们开始一个新的话题。请忽略之前的对话上下文，专注于接下来的讨论。

（提示：如需真正清空上下文，请创建新会话）"#             .to_string(),
            system_prompt: None,
            requires_confirmation: false,
        },

        BuiltinCommand::Compact => {
            BuiltinCommandResult {
                prompt: r#"请总结我们目前的对话内容，压缩成一个简洁的摘要：

要求：
1. 总结主要讨论点和决策
2. 列出待办事项和下一步行动
3. 保留关键代码片段和配置
4. 丢弃冗余的中间思考过程

这样我们可以用更清晰的上下文继续。"#.to_string(),
                system_prompt: None,
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Plan { description } => {
            BuiltinCommandResult {
                prompt: format!(
                    r#"请为以下任务创建一个结构化的执行计划：

任务：{}

请提供：
1. 目标澄清和理解
2. 分步骤的详细计划（包含每个步骤的预计时间和依赖）
3. 潜在风险和缓解措施
4. 成功标准
5. 使用 todo 格式输出可勾选的任务列表

格式示例：
- [ ] 步骤1：描述"#,
                    description
                ),
                system_prompt: Some(
                    "你是一个项目规划专家，善于创建结构化的执行计划。".to_string(),
                ),
                requires_confirmation: false,
            }
        }

        BuiltinCommand::Rename { new_name } => {
            // Note: This only sends a hint to the agent
            // Actual session rename should be handled by UI layer
            BuiltinCommandResult {
                prompt: format!(
                    r#"此会话已被重命名为："{}"

请在后续回答中适当引用此名称。"#,
                    new_name
                ),
                system_prompt: None,
                requires_confirmation: false,
            }
        }

        // 其他命令不通过此处理器处理
        _ => BuiltinCommandResult {
            prompt: String::new(),
            system_prompt: None,
            requires_confirmation: false,
        },
    }
}

/// 解析斜杠命令字符串为 BuiltinCommand
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
            // 解析格式: /loop [n] <task>
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
