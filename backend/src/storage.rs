use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use thiserror::Error;
use tokio::fs;

#[cfg(test)]
use tempfile as _;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("invalid path segment: {0}")]
    InvalidPathSegment(String),
    #[error("path escapes storage root")]
    PathEscapesRoot,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct Storage {
    root: PathBuf,
}

impl Storage {
    #[must_use]
    pub const fn new(root: PathBuf) -> Self {
        Self { root }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub async fn ensure_dir(&self, relative: &Path) -> Result<PathBuf, StorageError> {
        let resolved = self.resolve(relative)?;
        fs::create_dir_all(&resolved).await?;
        Ok(resolved)
    }

    pub async fn write_text(
        &self,
        relative: &Path,
        content: &str,
    ) -> Result<PathBuf, StorageError> {
        let resolved = self.resolve(relative)?;
        self.write_text_to_resolved(&resolved, content).await?;
        Ok(resolved)
    }

    pub async fn write_json<T: Serialize>(
        &self,
        relative: &Path,
        value: &T,
    ) -> Result<PathBuf, StorageError> {
        let resolved = self.resolve(relative)?;
        let serialized = serde_json::to_string_pretty(value)?;
        self.write_text_to_resolved(&resolved, &serialized).await?;
        Ok(resolved)
    }

    pub async fn read_text(&self, relative: &Path) -> Result<String, StorageError> {
        let resolved = self.resolve(relative)?;
        Ok(fs::read_to_string(resolved).await?)
    }

    pub async fn exists(&self, relative: &Path) -> Result<bool, StorageError> {
        let resolved = self.resolve(relative)?;
        Ok(fs::try_exists(resolved).await?)
    }

    pub async fn remove_file(&self, relative: &Path) -> Result<(), StorageError> {
        let resolved = self.resolve(relative)?;
        match fs::remove_file(resolved).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(StorageError::Io(error)),
        }
    }

    pub async fn remove_dir_all(&self, relative: &Path) -> Result<(), StorageError> {
        let resolved = self.resolve(relative)?;
        match fs::remove_dir_all(resolved).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(StorageError::Io(error)),
        }
    }

    pub async fn list_dirs(&self, relative: &Path) -> Result<Vec<PathBuf>, StorageError> {
        let resolved = self.resolve(relative)?;
        let mut reader = match fs::read_dir(resolved).await {
            Ok(reader) => reader,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(StorageError::Io(error)),
        };

        let mut directories = Vec::new();
        while let Some(entry) = reader.next_entry().await? {
            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                directories.push(entry.path());
            }
        }
        directories.sort();
        Ok(directories)
    }

    pub async fn list_files(&self, relative: &Path) -> Result<Vec<PathBuf>, StorageError> {
        let resolved = self.resolve(relative)?;
        let mut reader = match fs::read_dir(resolved).await {
            Ok(reader) => reader,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(StorageError::Io(error)),
        };

        let mut files = Vec::new();
        while let Some(entry) = reader.next_entry().await? {
            let file_type = entry.file_type().await?;
            if file_type.is_file() {
                files.push(entry.path());
            }
        }
        files.sort();
        Ok(files)
    }

    pub async fn list_recursive_files(
        &self,
        relative: &Path,
    ) -> Result<Vec<PathBuf>, StorageError> {
        let root = self.resolve(relative)?;
        if !fs::try_exists(&root).await? {
            return Ok(Vec::new());
        }

        let mut pending = vec![root];
        let mut files = Vec::new();
        while let Some(directory) = pending.pop() {
            let mut reader = fs::read_dir(directory).await?;
            while let Some(entry) = reader.next_entry().await? {
                let file_type = entry.file_type().await?;
                if file_type.is_dir() {
                    pending.push(entry.path());
                } else if file_type.is_file() {
                    files.push(entry.path());
                }
            }
        }
        files.sort();
        Ok(files)
    }

    pub fn resolve(&self, relative: &Path) -> Result<PathBuf, StorageError> {
        let mut resolved = self.root.clone();
        for component in relative.components() {
            match component {
                Component::Normal(segment) => {
                    let value = segment.to_string_lossy();
                    validate_segment(&value)?;
                    resolved.push(segment);
                }
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(StorageError::PathEscapesRoot);
                }
            }
        }
        Ok(resolved)
    }

    async fn write_text_to_resolved(
        &self,
        resolved: &Path,
        content: &str,
    ) -> Result<(), StorageError> {
        if let Some(parent) = resolved.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(resolved, content).await?;
        Ok(())
    }
}

pub fn validate_segment(segment: &str) -> Result<(), StorageError> {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.contains('/')
        || segment.contains('\\')
    {
        return Err(StorageError::InvalidPathSegment(segment.to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use tempfile::tempdir;

    use super::{Storage, StorageError, validate_segment};

    #[test]
    fn validate_segment_rejects_invalid_values() {
        assert!(matches!(
            validate_segment(""),
            Err(StorageError::InvalidPathSegment(_))
        ));
        assert!(matches!(
            validate_segment(".."),
            Err(StorageError::InvalidPathSegment(_))
        ));
        assert!(matches!(
            validate_segment("bad/name"),
            Err(StorageError::InvalidPathSegment(_))
        ));
        assert!(matches!(
            validate_segment("bad\\name"),
            Err(StorageError::InvalidPathSegment(_))
        ));
    }

    #[tokio::test]
    async fn storage_writes_and_reads_text_within_root() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Storage::new(temp.path().to_path_buf());

        storage
            .write_text(Path::new("projects/alpha/project.md"), "hello")
            .await
            .expect("write should succeed");

        let content = storage
            .read_text(Path::new("projects/alpha/project.md"))
            .await
            .expect("read should succeed");

        assert_eq!(content, "hello");
    }

    #[tokio::test]
    async fn storage_blocks_parent_dir_escape() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Storage::new(temp.path().to_path_buf());

        let result = storage.write_text(Path::new("../escape.txt"), "nope").await;
        assert!(matches!(result, Err(StorageError::PathEscapesRoot)));
    }
}
