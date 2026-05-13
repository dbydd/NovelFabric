#![forbid(unsafe_code)]

use tracing_subscriber as _;

use novelfabric_backend::{ApplicationConfig, run};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    init_tracing();

    let config = ApplicationConfig::from_env();
    let listener = TcpListener::bind(config.server.bind_address).await?;
    let local_addr = listener.local_addr()?;

    info!(address = %local_addr, "backend listener bound");

    run(listener, config).await
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
