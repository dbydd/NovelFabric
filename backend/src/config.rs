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
const LLM_ROLES_CONFIG_FILE: &str = "roles.json";
const DEFAULT_ROLE_ID: &str = "default";
const DEFAULT_LLM_MODEL: &str = "gpt-4o-mini";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmEndpointConfig {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub api_style: LlmApiStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmRoleConfig {
    pub role_id: String,
    pub model: String,
    pub api_style: Option<LlmApiStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct LlmRolesConfig {
    pub roles: Vec<LlmRoleConfig>,
}

#[derive(Debug, Clone, Deserialize)]
struct LegacyLlmSettings {
    provider: String,
    base_url: String,
    api_key: String,
    model: Option<String>,
    api_style: LlmApiStyle,
}

#[derive(Debug, Clone)]
pub struct LlmConfigService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum LlmSettingsError {
    #[error("invalid llm setting: {0}")]
    Invalid(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl LlmConfigService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn load_endpoint(&self) -> Result<Option<LlmEndpointConfig>, LlmSettingsError> {
        let path = llm_endpoint_path();
        if !self.storage.exists(&path).await? {
            return Ok(None);
        }
        let text = self.storage.read_text(&path).await?;
        let legacy =
            serde_json::from_str::<LegacyLlmSettings>(&text).map_err(StorageError::Json)?;
        let endpoint = LlmEndpointConfig {
            provider: legacy.provider,
            base_url: legacy.base_url,
            api_key: legacy.api_key,
            api_style: legacy.api_style,
        };
        validate_llm_endpoint(&endpoint)?;
        Ok(Some(endpoint))
    }

    pub async fn save_endpoint(
        &self,
        endpoint: LlmEndpointConfig,
    ) -> Result<LlmEndpointConfig, LlmSettingsError> {
        validate_llm_endpoint(&endpoint)?;
        self.storage
            .write_json(&llm_endpoint_path(), &endpoint)
            .await?;
        Ok(endpoint)
    }

    pub async fn load_roles(&self) -> Result<LlmRolesConfig, LlmSettingsError> {
        let path = llm_roles_path();
        if !self.storage.exists(&path).await? {
            return Ok(LlmRolesConfig::default());
        }
        let text = self.storage.read_text(&path).await?;
        let roles = serde_json::from_str::<LlmRolesConfig>(&text).map_err(StorageError::Json)?;
        for role in &roles.roles {
            validate_llm_role(role)?;
        }
        Ok(roles)
    }

    pub async fn load_role(
        &self,
        role_id: &str,
    ) -> Result<Option<LlmRoleConfig>, LlmSettingsError> {
        let role_id = normalize_role_id(role_id)?;
        if let Some(role) = self
            .load_roles()
            .await?
            .roles
            .into_iter()
            .find(|role| role.role_id == role_id)
        {
            return Ok(Some(role));
        }
        if role_id == DEFAULT_ROLE_ID {
            return Ok(Some(self.default_role_from_legacy().await?));
        }
        Ok(None)
    }

    pub async fn save_role(
        &self,
        role_id: &str,
        mut config: LlmRoleConfig,
    ) -> Result<LlmRoleConfig, LlmSettingsError> {
        config.role_id = normalize_role_id(role_id)?;
        validate_llm_role(&config)?;

        let mut roles = self.load_roles().await?;
        roles.roles.retain(|role| role.role_id != config.role_id);
        roles.roles.push(config.clone());
        roles
            .roles
            .sort_by(|left, right| left.role_id.cmp(&right.role_id));
        self.storage.write_json(&llm_roles_path(), &roles).await?;
        Ok(config)
    }

    pub async fn delete_role(&self, role_id: &str) -> Result<(), LlmSettingsError> {
        let role_id = normalize_role_id(role_id)?;
        let mut roles = self.load_roles().await?;
        roles.roles.retain(|role| role.role_id != role_id);
        self.storage.write_json(&llm_roles_path(), &roles).await?;
        Ok(())
    }

    pub async fn load_resolved(
        &self,
        role_id: &str,
    ) -> Result<Option<crate::llm::LlmConfig>, LlmSettingsError> {
        let Some(endpoint) = self.load_endpoint().await? else {
            return Ok(None);
        };
        let role = match self.load_role(role_id).await? {
            Some(role) => role,
            None => self
                .load_role(DEFAULT_ROLE_ID)
                .await?
                .unwrap_or_else(default_llm_role),
        };
        Ok(Some(crate::llm::LlmConfig {
            base_url: endpoint.base_url,
            api_key: endpoint.api_key,
            model: role.model,
            api_style: role.api_style.unwrap_or(endpoint.api_style),
        }))
    }

    async fn default_role_from_legacy(&self) -> Result<LlmRoleConfig, LlmSettingsError> {
        let path = llm_endpoint_path();
        if self.storage.exists(&path).await? {
            let text = self.storage.read_text(&path).await?;
            let legacy =
                serde_json::from_str::<LegacyLlmSettings>(&text).map_err(StorageError::Json)?;
            if let Some(model) = legacy.model.filter(|model| !model.trim().is_empty()) {
                return Ok(LlmRoleConfig {
                    role_id: DEFAULT_ROLE_ID.to_string(),
                    model,
                    api_style: None,
                });
            }
        }
        Ok(default_llm_role())
    }
}

fn default_llm_role() -> LlmRoleConfig {
    LlmRoleConfig {
        role_id: DEFAULT_ROLE_ID.to_string(),
        model: DEFAULT_LLM_MODEL.to_string(),
        api_style: None,
    }
}

fn validate_llm_endpoint(endpoint: &LlmEndpointConfig) -> Result<(), LlmSettingsError> {
    for (name, value) in [
        ("provider", endpoint.provider.as_str()),
        ("base_url", endpoint.base_url.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(LlmSettingsError::Invalid(name.to_string()));
        }
    }
    if !(endpoint.base_url.starts_with("http://") || endpoint.base_url.starts_with("https://")) {
        return Err(LlmSettingsError::Invalid("base_url".to_string()));
    }
    Ok(())
}

fn validate_llm_role(role: &LlmRoleConfig) -> Result<(), LlmSettingsError> {
    normalize_role_id(&role.role_id)?;
    if role.model.trim().is_empty() {
        return Err(LlmSettingsError::Invalid("model".to_string()));
    }
    Ok(())
}

fn normalize_role_id(role_id: &str) -> Result<String, LlmSettingsError> {
    let role_id = role_id.trim();
    if role_id.is_empty() {
        return Err(LlmSettingsError::Invalid("role_id".to_string()));
    }
    Ok(role_id.to_string())
}

fn llm_endpoint_path() -> PathBuf {
    Path::new(CONFIG_DIR).join(LLM_CONFIG_FILE)
}

fn llm_roles_path() -> PathBuf {
    Path::new(CONFIG_DIR).join(LLM_ROLES_CONFIG_FILE)
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
    async fn persists_frontend_llm_config_to_local_config_files() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = crate::storage::Storage::new(temp.path().to_path_buf());
        let service = crate::config::LlmConfigService::new(std::sync::Arc::new(storage));
        let endpoint = crate::config::LlmEndpointConfig {
            provider: "axonhub".to_string(),
            base_url: "http://localhost:3000/v1".to_string(),
            api_key: "test-key".to_string(),
            api_style: crate::llm::LlmApiStyle::OpenAiChatCompletions,
        };
        let role = crate::config::LlmRoleConfig {
            role_id: "default".to_string(),
            model: "generic-writer".to_string(),
            api_style: None,
        };

        service
            .save_endpoint(endpoint.clone())
            .await
            .expect("endpoint save should succeed");
        service
            .save_role("default", role.clone())
            .await
            .expect("role save should succeed");
        let loaded_endpoint = service
            .load_endpoint()
            .await
            .expect("endpoint load should succeed")
            .expect("endpoint should exist");
        let loaded_role = service
            .load_role("default")
            .await
            .expect("role load should succeed")
            .expect("role should exist");
        let resolved = service
            .load_resolved("import")
            .await
            .expect("resolved load should succeed")
            .expect("resolved config should exist");

        assert_eq!(loaded_endpoint, endpoint);
        assert_eq!(loaded_role, role);
        assert_eq!(resolved.model, "generic-writer");
        assert!(temp.path().join("config/llm.json").exists());
        assert!(temp.path().join("config/roles.json").exists());
    }

    #[tokio::test]
    async fn loads_legacy_llm_settings_model_as_default_role() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = crate::storage::Storage::new(temp.path().to_path_buf());
        let service = crate::config::LlmConfigService::new(std::sync::Arc::new(storage));
        tokio::fs::create_dir_all(temp.path().join("config"))
            .await
            .expect("config dir should write");
        tokio::fs::write(
            temp.path().join("config/llm.json"),
            r#"{
  "provider": "axonhub",
  "base_url": "http://localhost:3000/v1",
  "api_key": "test-key",
  "model": "legacy-writer",
  "api_style": "OpenAiChatCompletions"
}"#,
        )
        .await
        .expect("legacy settings should write");

        let endpoint = service
            .load_endpoint()
            .await
            .expect("endpoint load should succeed")
            .expect("endpoint should exist");
        let role = service
            .load_role("default")
            .await
            .expect("role load should succeed")
            .expect("role should exist");

        assert_eq!(endpoint.provider, "axonhub");
        assert_eq!(role.model, "legacy-writer");
    }
}
