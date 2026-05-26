use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs;

use crate::{
    ApplicationConfig, ServerConfig,
    llm::LlmApiStyle,
    storage::{Storage, StorageError},
};

const CONFIG_FILE_NAME: &str = "config.toml";

const CONFIG_DIR: &str = "config";
const LLM_CONFIG_FILE: &str = "llm.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmSettings {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub api_style: LlmApiStyle,
}

#[derive(Debug, Clone)]
pub struct LlmSettingsService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum LlmSettingsError {
    #[error("invalid llm setting: {0}")]
    Invalid(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl LlmSettingsService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn load(&self) -> Result<Option<LlmSettings>, LlmSettingsError> {
        let path = llm_settings_path();
        if !self.storage.exists(&path).await? {
            return Ok(None);
        }
        let text = self.storage.read_text(&path).await?;
        Ok(Some(
            serde_json::from_str(&text).map_err(StorageError::Json)?,
        ))
    }

    pub async fn save(&self, settings: LlmSettings) -> Result<LlmSettings, LlmSettingsError> {
        validate_llm_settings(&settings)?;
        self.storage
            .write_json(&llm_settings_path(), &settings)
            .await?;
        Ok(settings)
    }
}

fn validate_llm_settings(settings: &LlmSettings) -> Result<(), LlmSettingsError> {
    for (name, value) in [
        ("provider", settings.provider.as_str()),
        ("base_url", settings.base_url.as_str()),
        ("model", settings.model.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(LlmSettingsError::Invalid(name.to_string()));
        }
    }
    if !(settings.base_url.starts_with("http://") || settings.base_url.starts_with("https://")) {
        return Err(LlmSettingsError::Invalid("base_url".to_string()));
    }
    Ok(())
}

fn llm_settings_path() -> PathBuf {
    Path::new(CONFIG_DIR).join(LLM_CONFIG_FILE)
}

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

    #[tokio::test]
    async fn persists_frontend_llm_config_to_local_config_file() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = crate::storage::Storage::new(temp.path().to_path_buf());
        let service = crate::config::LlmSettingsService::new(std::sync::Arc::new(storage));
        let settings = crate::config::LlmSettings {
            provider: "axonhub".to_string(),
            base_url: "http://localhost:3000/v1".to_string(),
            api_key: "test-key".to_string(),
            model: "generic-writer".to_string(),
            api_style: crate::llm::LlmApiStyle::OpenAiChatCompletions,
        };

        service
            .save(settings.clone())
            .await
            .expect("settings save should succeed");
        let loaded = service
            .load()
            .await
            .expect("settings load should succeed")
            .expect("settings should exist");

        assert_eq!(loaded, settings);
        assert!(temp.path().join("config/llm.json").exists());
    }
}
