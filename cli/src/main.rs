mod cli;
mod host;
mod p2p;
mod shell;
mod shell_manager;
mod string_compressor;
mod terminal;
mod terminal_config;

use anyhow::Result;
use clap::Parser;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

use cli::{Cli, CliApp};

#[tokio::main]
async fn main() -> Result<()> {
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

    CliApp::print_banner();

    let cli = Cli::parse();
    let relay = cli.relay.clone();
    let mut app = CliApp::new(relay).await?;

    app.run(cli).await?;

    Ok(())
}
