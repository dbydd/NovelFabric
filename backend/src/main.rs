#![forbid(unsafe_code)]

use std::{net::SocketAddr, path::PathBuf};

use clap::Parser;
use novelfabric_backend::{ApplicationConfig, config::ConfigOverrides, run};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{EnvFilter, fmt};

#[derive(Debug, Parser)]
#[command(name = "novelfabric-backend")]
#[command(about = "NovelFabric Rust backend server")]
struct Cli {
    /// Bind address for the HTTP API, for example 127.0.0.1:50000.
    #[arg(long, env = "NOVELFABRIC_BACKEND_BIND_ADDRESS")]
    bind_address: Option<SocketAddr>,

    /// Data directory for text-first project storage.
    #[arg(long, env = "NOVELFABRIC_DATA_DIR")]
    data_dir: Option<PathBuf>,

    /// Config file path. Defaults to the platform config directory, e.g. ~/.config/novelfabric/config.toml on Linux.
    #[arg(long)]
    config: Option<PathBuf>,

    /// Write a default config file to --config or the platform default path and exit.
    #[arg(long)]
    write_default_config: bool,

    /// Print the resolved config as TOML and exit.
    #[arg(long)]
    print_config: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing();

    let cli = Cli::parse();
    let config_path = cli
        .config
        .clone()
        .unwrap_or_else(ApplicationConfig::default_config_path);
    if cli.write_default_config {
        ApplicationConfig::write_default_config(&config_path).await?;
        println!("wrote config to {}", config_path.display());
        return Ok(());
    }

    let config = ApplicationConfig::from_sources(ConfigOverrides {
        config_path: Some(config_path.clone()),
        bind_address: cli.bind_address,
        data_dir: cli.data_dir,
    })
    .await?;

    if cli.print_config {
        println!("{}", toml::to_string_pretty(&config)?);
        return Ok(());
    }

    let listener = TcpListener::bind(config.server.bind_address).await?;
    let local_addr = listener.local_addr()?;

    info!(address = %local_addr, config = %config_path.display(), "backend listener bound");

    run(listener, config).await?;
    Ok(())
}

fn init_tracing() {
    use std::io::IsTerminal as _;

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info"));

    fmt()
        .with_env_filter(env_filter)
        .with_target(false)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_line_number(true)
        .with_file(true)
        .with_ansi(std::io::stdout().is_terminal())
        .init();
}
