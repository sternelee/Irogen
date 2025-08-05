mod cli;
mod p2p;
mod shell;
mod terminal;

use anyhow::Result;
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use cli::{Cli, CliApp};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,netwatch::netmon::bsd=error".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    CliApp::print_banner();

    let cli = Cli::parse();
    let mut app = CliApp::new().await?;

    app.run(cli).await?;

    Ok(())
}
