use std::{net::SocketAddr, path::PathBuf};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs;

use crate::{ApplicationConfig, ServerConfig};

const CONFIG_FILE_NAME: &str = "config.toml";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigOverrides {
    pub config_path: Option<PathBuf>,
    pub bind_address: Option<SocketAddr>,
    pub data_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct PartialApplicationConfig {
    pub server: Option<PartialServerConfig>,
    pub data_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct PartialServerConfig {
    pub bind_address: Option<SocketAddr>,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("config parse error: {0}")]
    TomlDeserialize(#[from] toml::de::Error),
    #[error("config serialize error: {0}")]
    TomlSerialize(#[from] toml::ser::Error),
}

impl ApplicationConfig {
    #[must_use]
    pub fn default_config_dir() -> PathBuf {
        ProjectDirs::from("", "", "novelfabric").map_or_else(
            || PathBuf::from(".novelfabric"),
            |dirs| dirs.config_dir().to_path_buf(),
        )
    }

    #[must_use]
    pub fn default_config_path() -> PathBuf {
        Self::default_config_dir().join(CONFIG_FILE_NAME)
    }

    pub async fn from_sources(overrides: ConfigOverrides) -> Result<Self, ConfigError> {
        let config_path = overrides
            .config_path
            .clone()
            .unwrap_or_else(Self::default_config_path);
        let mut config = Self::default();

        if fs::try_exists(&config_path).await? {
            let file_config = fs::read_to_string(&config_path).await?;
            apply_partial_config(&mut config, toml::from_str(&file_config)?);
        }

        apply_env(&mut config);
        if let Some(bind_address) = overrides.bind_address {
            config.server.bind_address = bind_address;
        }
        if let Some(data_dir) = overrides.data_dir {
            config.data_dir = data_dir;
        }
        Ok(config)
    }

    pub async fn write_default_config(path: &std::path::Path) -> Result<(), ConfigError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        let config = Self::default();
        let serialized = toml::to_string_pretty(&config)?;
        fs::write(path, serialized).await?;
        Ok(())
    }
}

impl Default for ApplicationConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            data_dir: PathBuf::from("data"),
        }
    }
}

fn apply_partial_config(config: &mut ApplicationConfig, partial: PartialApplicationConfig) {
    if let Some(server) = partial.server {
        if let Some(bind_address) = server.bind_address {
            config.server.bind_address = bind_address;
        }
    }
    if let Some(data_dir) = partial.data_dir {
        config.data_dir = data_dir;
    }
}

fn apply_env(config: &mut ApplicationConfig) {
    if let Ok(value) = std::env::var("NOVELFABRIC_BACKEND_BIND_ADDRESS") {
        if let Ok(bind_address) = value.parse() {
            config.server.bind_address = bind_address;
        }
    }
    if let Ok(value) = std::env::var("NOVELFABRIC_DATA_DIR") {
        config.data_dir = PathBuf::from(value);
    }
}

#[cfg(test)]
mod tests {
    use std::{net::SocketAddr, path::PathBuf};

    use tempfile::tempdir;

    use super::ConfigOverrides;
    use crate::ApplicationConfig;

    #[tokio::test]
    async fn loads_config_file_then_applies_cli_overrides() {
        let temp = tempdir().expect("tempdir should exist");
        let config_path = temp.path().join("config.toml");
        tokio::fs::write(
            &config_path,
            r#"
data_dir = "from-file"

[server]
bind_address = "127.0.0.1:50041"
"#,
        )
        .await
        .expect("config should write");

        let config = ApplicationConfig::from_sources(ConfigOverrides {
            config_path: Some(config_path),
            bind_address: Some("127.0.0.1:50042".parse::<SocketAddr>().expect("addr")),
            data_dir: Some(PathBuf::from("from-cli")),
        })
        .await
        .expect("config should load");

        assert_eq!(config.server.bind_address.to_string(), "127.0.0.1:50042");
        assert_eq!(config.data_dir, PathBuf::from("from-cli"));
    }

    #[tokio::test]
    async fn writes_default_config_file() {
        let temp = tempdir().expect("tempdir should exist");
        let config_path = temp.path().join("nested/config.toml");
        ApplicationConfig::write_default_config(&config_path)
            .await
            .expect("default config should write");
        let written = tokio::fs::read_to_string(config_path)
            .await
            .expect("config should read");
        assert!(written.contains("bind_address"));
        assert!(written.contains("data_dir"));
    }
}
