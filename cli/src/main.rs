mod cli;
mod host;
mod p2p;
mod session_encrypt;
mod shared_terminal;
mod shell;
mod shell_manager;
mod string_compressor;
mod terminal;
mod terminal_config;

// 新的 sshx 风格模块
mod controller;
mod runner;
mod sshx_main;
mod terminal_impl;

use anyhow::Result;
use clap::Parser;
use std::process::ExitCode;
use tracing::error;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

use cli::{Cli, CliApp};

#[tokio::main]
async fn main() -> ExitCode {
    // Create a file appender for logging
    std::fs::create_dir_all("logs").ok(); // Create logs directory if it doesn't exist
    let file_appender =
        RollingFileAppender::new(Rotation::DAILY, "logs", "iroh-code-remote-cli.log");

    // Create a fmt layer for file logging
    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(file_appender)
        .with_ansi(false) // Disable ANSI colors for file output
        .with_filter(EnvFilter::new("debug")); // Log everything to file

    // Create console layer with filtering - only show info and above by default
    let console_layer = tracing_subscriber::fmt::layer().with_filter(
        EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info,netwatch::netmon::bsd=error".into()),
    );

    tracing_subscriber::registry()
        .with(file_layer)
        .with(console_layer)
        .init();

    // 检查是否应该使用新的 sshx 风格
    let args: Vec<String> = std::env::args().collect();

    // 如果没有子命令或者使用了简单参数，使用 sshx 风格
    let use_sshx_mode = args.len() == 1
        || args.iter().any(|arg| {
            arg == "--shell" || arg == "--quiet" || arg == "--name" || arg == "--enable-readers"
        });

    if use_sshx_mode {
        // 使用新的 sshx 风格主函数
        match sshx_main::run_sshx().await {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                error!("{err:?}");
                ExitCode::FAILURE
            }
        }
    } else {
        // 使用旧的 CLI 风格
        CliApp::print_banner();

        let result: Result<()> = async {
            let cli = Cli::parse();
            let relay = cli.relay.clone();
            let mut app = CliApp::new(relay).await?;
            app.run(cli).await?;
            Ok(())
        }
        .await;

        match result {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                error!("Command failed: {err:?}");
                ExitCode::FAILURE
            }
        }
    }
}
