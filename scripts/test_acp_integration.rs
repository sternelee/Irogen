#!/usr/bin/env rust-script
//!
//! ACP Integration Test Runner
//!
//! This script runs comprehensive integration tests for the ACP Client/Host implementation.
//! It tests both compilation and provides command templates for manual testing with actual
//! AI agents.
//!
//! Usage:
//!   cargo run --example test_acp_integration
//!   # or
//!   rust-script scripts/test_acp_integration.rs

use std::process::{Command, exit};
use std::io::{self, Write};
use colored::*;

struct TestResult {
    name: String,
    status: TestStatus,
    details: Option<String>,
}

enum TestStatus {
    Pass,
    Fail,
    Warn,
}

impl TestStatus {
    fn to_string(&self) -> String {
        match self {
            TestStatus::Pass => "PASS".green().bold().to_string(),
            TestStatus::Fail => "FAIL".red().bold().to_string(),
            TestStatus::Warn => "WARN".yellow().bold().to_string(),
        }
    }
}

fn run_test<F>(name: &str, test_fn: F) -> TestResult
where
    F: FnOnce() -> (bool, Option<String>),
{
    print!("Testing {}... ", name);
    io::stdout().flush().unwrap();

    let (passed, details) = test_fn();
    let status = if passed {
        TestStatus::Pass
    } else {
        TestStatus::Fail
    };

    println!("{}", status.to_string());

    if let Some(ref d) = details {
        println!("  {}", d);
    }

    TestResult {
        name: name.to_string(),
        status,
        details,
    }
}

fn check_compilation() -> (bool, Option<String>) {
    let result = Command::new("cargo")
        .args(["check", "--workspace"])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                (true, Some("All workspace crates compile successfully".to_string()))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                (false, Some(format!("Compilation errors:\n{}", stderr)))
            }
        }
        Err(e) => (false, Some(format!("Failed to run cargo check: {}", e))),
    }
}

fn run_lib_tests() -> (bool, Option<String>) {
    let result = Command::new("cargo")
        .args(["test", "--workspace", "--lib"])
        .output();

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            if output.status.success() {
                // Parse test results
                let total_tests = stdout.lines()
                    .filter(|l| l.contains("test result:"))
                    .count();

                if total_tests > 0 {
                    (true, Some(format!("Library tests passed ({} test runs found)", total_tests)))
                } else {
                    (true, Some("No library tests found".to_string()))
                }
            } else {
                (false, Some(format!("Test failures:\n{}\n{}", stdout, stderr)))
            }
        }
        Err(e) => (false, Some(format!("Failed to run tests: {}", e))),
    }
}

fn check_cli_build() -> (bool, Option<String>) {
    let result = Command::new("cargo")
        .args(["build", "-p", "cli"])
        .output();

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            if output.status.success() {
                (true, Some("CLI builds successfully".to_string()))
            } else {
                (false, Some(format!("Build failed:\n{}\n{}", stdout, stderr)))
            }
        }
        Err(e) => (false, Some(format!("Failed to build CLI: {}", e))),
    }
}

fn check_local_client_module() -> (bool, Option<String>) {
    let result = Command::new("cargo")
        .args(["check", "-p", "cli", "--lib"])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                (true, Some("local_client module compiles".to_string()))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                (false, Some(format!("Module check failed:\n{}", stderr)))
            }
        }
        Err(e) => (false, Some(format!("Failed to check module: {}", e))),
    }
}

fn check_acp_module() -> (bool, Option<String>) {
    let result = Command::new("cargo")
        .args(["check", "-p", "lib", "--lib"])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                (true, Some("ACP module compiles".to_string()))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                (false, Some(format!("ACP module check failed:\n{}", stderr)))
            }
        }
        Err(e) => (false, Some(format!("Failed to check ACP module: {}", e))),
    }
}

fn print_test_header(header: &str) {
    println!();
    println!("{}", header.bold().cyan());
    println!("{}", "=".repeat(header.len()).cyan());
    println!();
}

fn print_command_template(cmd: &str, description: &str, expected: &str) {
    println!("{}\n", cmd.magenta());
    println!("  Description: {}", description);
    println!("  Expected:    {}", expected.green());
    println!();
}

fn main() {
    let mut results = Vec::new();

    println!("{}", "ACP Integration Test Suite".bold().cyan());
    println!("{}", "=".repeat(50).cyan());
    println!();

    // Phase 1: Compilation Tests
    print_test_header("Phase 1: Compilation Tests");

    results.push(run_test("Workspace Compilation", check_compilation));
    results.push(run_test("Library Tests", run_lib_tests));
    results.push(run_test("CLI Build", check_cli_build));
    results.push(run_test("Local Client Module", check_local_client_module));
    results.push(run_test("ACP Module", check_acp_module));

    // Phase 2: Command Templates for Manual Testing
    print_test_header("Phase 2: Manual Testing Commands");

    println!("For manual testing with actual ACP agents, use these commands:\n");

    print_command_template(
        "cargo build --release -p cli",
        "Build the CLI in release mode",
        "CLI binary at cli/target/release/cli"
    );

    print_command_template(
        "./target/release/cli run --agent claude --project /path/to/project",
        "Start a local ACP session with Claude Code",
        "Interactive session with Claude Code agent"
    );

    print_command_template(
        "./target/release/cli run --agent opencode --project /path/to/project",
        "Start a local ACP session with OpenCode",
        "Interactive session with OpenCode agent"
    );

    print_command_template(
        "./target/release/cli run --agent gemini --project /path/to/project",
        "Start a local ACP session with Gemini CLI",
        "Interactive session with Gemini CLI agent"
    );

    print_command_template(
        "./target/release/cli run --agent claude --project /path/to/project --args \"--verbose\"",
        "Start a local ACP session with extra arguments",
        "Interactive session with additional agent arguments"
    );

    // Phase 3: Permission Flow Test Scenarios
    print_test_header("Phase 3: Permission Flow Test Scenarios");

    println!("When running an ACP agent, test these permission scenarios:\n");

    println!("Scenario 1: Permission Request");
    println!("  1. Ask agent to run a command or access a file");
    println!("  2. Agent will request permission via ACP");
    println!("  3. Type: /listperms");
    println!("  4. Expected: List of pending permission requests");
    println!();

    println!("Scenario 2: Approve Permission");
    println!("  1. With pending permissions, note request_id");
    println!("  2. Type: /approve <request_id>");
    println!("  3. Expected: Permission approved, agent continues");
    println!();

    println!("Scenario 3: Deny Permission");
    println!("  1. With pending permissions, note request_id");
    println!("  2. Type: /deny <request_id>");
    println!("  3. Expected: Permission denied, agent stops or tries alternative");
    println!();

    println!("Scenario 4: Interrupt Operation");
    println!("  1. Agent is processing a request");
    println!("  2. Type: /interrupt");
    println!("  3. Expected: Current operation is interrupted");
    println!();

    println!("Scenario 5: Help Command");
    println!("  1. Type: /help");
    println!("  2. Expected: Display all available slash commands");
    println!();

    println!("Scenario 6: Quit Session");
    println!("  1. Type: /quit or /exit");
    println!("  2. Expected: Session gracefully shuts down");
    println!();

    // Phase 4: Expected Behavior Matrix
    print_test_header("Phase 4: Expected Behavior Matrix");

    println!("Test Case                    | Expected Behavior");
    println!("-" .repeat(75));
    println!("启动 claude agent           | Session starts, ACP connection established");
    println!("发送消息                    | Message forwarded to agent, response streamed back");
    println!("agent 请求权限              | /listperms shows pending request");
    println!("执行 /approve <id>          | Permission granted, agent executes task");
    println!("执行 /deny <id>             | Permission denied, agent stops task");
    println!("执行 /interrupt             | Current operation cancelled");
    println!("执行 /listperms (empty)     | Shows 'No pending permission requests'");
    println!("执行 /quit                  | Session ends cleanly");
    println!("Ctrl+C                      | Session ends with cleanup");
    println!();

    // Phase 5: Troubleshooting Guide
    print_test_header("Phase 5: Troubleshooting Guide");

    println!("Problem: CLI won't start");
    println!("  Solution: Ensure agent (Claude Code, OpenCode, etc.) is installed and in PATH");
    println!();

    println!("Problem: Permission requests not showing");
    println!("  Solution: Check agent logs, verify ACP protocol support");
    println!();

    println!("Problem: Session interruption not working");
    println!("  Solution: Interruption only works when an operation is active");
    println!();

    println!("Problem: Connection errors");
    println!("  Solution: Check working directory permissions and network connectivity");
    println!();

    // Summary
    print_test_header("Test Summary");

    let pass_count = results.iter().filter(|r| matches!(r.status, TestStatus::Pass)).count();
    let fail_count = results.iter().filter(|r| matches!(r.status, TestStatus::Fail)).count();
    let warn_count = results.iter().filter(|r| matches!(r.status, TestStatus::Warn)).count();

    println!("Tests Passed:  {}", pass_count.to_string().green().bold());
    println!("Tests Failed:  {}", fail_count.to_string().red().bold());
    println!("Tests Warning: {}", warn_count.to_string().yellow().bold());
    println!("Total Tests:   {}", results.len());
    println!();

    if fail_count > 0 {
        println!("Failed Tests:");
        for result in &results {
            if matches!(result.status, TestStatus::Fail) {
                println!("  ✗ {}", result.name);
            }
        }
        println!();
        exit(1);
    } else {
        println!("{} All basic tests passed!", "✓".green().bold());
        println!();
        println!("Next steps:");
        println!("  1. Build the CLI: cargo build --release -p cli");
        println!("  2. Install an ACP-compatible agent (Claude Code, OpenCode, Gemini CLI, etc.)");
        println!("  3. Run manual tests using the commands above");
        println!("  4. Test permission flow scenarios");
        println!();
        exit(0);
    }
}
