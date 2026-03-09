//! OpenSSH config 导入能力。
use std::fs;
use std::path::{Path, PathBuf};

use engine::{AuthType, EngineError, HostProfile};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::commands::profile::{validate_and_dedupe_groups, validate_profile_name};
use crate::profile_store::{ProfileStore, read_profiles, write_profiles};
use crate::telemetry::{TelemetryLevel, log_telemetry};

const IMPORT_GROUP_NAME: &str = "OpenSSH";
/// 导入会话名称沿用前端 ProfileModal 的 14 字符显示约束，避免导入结果与手工编辑规则不一致。
const IMPORT_PROFILE_NAME_MAX_CHARS: usize = 14;

/// OpenSSH config 中可映射为会话的 Host 块。
#[derive(Debug, Clone, PartialEq, Eq)]
struct OpensshHostBlock {
    host_pattern: String,
    hostname: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_file: Option<String>,
    identities_only: Option<bool>,
}

/// OpenSSH config 文本的解析结果。
/// `unsupported_count` 记录未进入导入映射阶段的块数量。
#[derive(Debug, Default)]
struct ParsedOpensshConfig {
    blocks: Vec<OpensshHostBlock>,
    unsupported_count: usize,
}

/// 当前生效的默认导入字段，仅由 `Host *` 提供。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct OpensshDefaults {
    hostname: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_file: Option<String>,
    identities_only: Option<bool>,
}

/// 前端用于展示的导入摘要。
/// 各字段直接对应导入流程中的结果分类，不包含逐项明细。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpensshImportSummary {
    pub added_count: usize,
    pub skipped_count: usize,
    pub conflict_count: usize,
    pub unsupported_count: usize,
    pub error_count: usize,
}

/// 读取默认 OpenSSH config 并导入为 FluxTerm 会话。
/// 导入只处理固定路径 `<home>/.ssh/config`，成功后直接写回现有 ProfileStore。
pub fn import_openssh_config(app: &AppHandle) -> Result<OpensshImportSummary, EngineError> {
    let home = app.path().home_dir().map_err(|err| {
        EngineError::with_detail("local_home_failed", "无法获取本机家目录", err.to_string())
    })?;
    let path = home.join(".ssh").join("config");
    if !path.exists() {
        return Err(EngineError::new(
            "ssh_config_not_found",
            "未找到 SSH config 文件",
        ));
    }
    let content = fs::read_to_string(&path).map_err(|err| {
        EngineError::with_detail(
            "ssh_config_unreadable",
            "无法读取 SSH config 文件",
            err.to_string(),
        )
    })?;
    let parsed = parse_openssh_config(&content)?;
    let mut store = read_profiles(app)?;
    let summary = apply_import(&mut store, &home, parsed)?;
    if summary.added_count == 0
        && summary.skipped_count == 0
        && summary.conflict_count == 0
        && summary.error_count == 0
    {
        return Err(EngineError::new(
            "ssh_config_import_empty",
            "未发现可导入的 SSH 主机配置",
        ));
    }
    write_profiles(app, &store)?;
    Ok(summary)
}

/// 将文本解析为可导入的 Host 块列表。
/// 当前只把 `Host *` 识别为默认值块；其他含通配符或多 pattern 的块记为 unsupported。
fn parse_openssh_config(content: &str) -> Result<ParsedOpensshConfig, EngineError> {
    let mut parsed = ParsedOpensshConfig::default();
    let mut current: Option<OpensshHostBlock> = None;
    let mut defaults = OpensshDefaults::default();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = split_config_line(line) else {
            return Err(EngineError::new(
                "ssh_config_parse_failed",
                "SSH config 解析失败",
            ));
        };
        let key_lower = key.to_ascii_lowercase();
        if key_lower == "host" {
            if let Some(block) = current.take() {
                if is_default_host_pattern(&block.host_pattern) {
                    defaults = merge_defaults(&defaults, &block);
                } else if is_supported_host_pattern(&block.host_pattern) {
                    parsed.blocks.push(block);
                } else {
                    parsed.unsupported_count += 1;
                }
            }
            if value.is_empty() {
                parsed.unsupported_count += 1;
                current = None;
                continue;
            }
            current = Some(apply_defaults_to_block(
                &OpensshHostBlock {
                    host_pattern: value.to_string(),
                    hostname: None,
                    port: None,
                    user: None,
                    identity_file: None,
                    identities_only: None,
                },
                &defaults,
            ));
            continue;
        }

        let Some(block) = current.as_mut() else {
            continue;
        };
        match key_lower.as_str() {
            "hostname" => block.hostname = Some(value.to_string()),
            "port" => {
                if let Ok(port) = value.parse::<u16>() {
                    block.port = Some(port);
                }
            }
            "user" => block.user = Some(value.to_string()),
            "identityfile" => {
                if block.identity_file.is_none() {
                    block.identity_file = Some(value.to_string());
                }
            }
            "identitiesonly" => block.identities_only = parse_ssh_bool(value),
            _ => {}
        }
    }

    if let Some(block) = current {
        if is_default_host_pattern(&block.host_pattern) {
            let _ = merge_defaults(&defaults, &block);
        } else if is_supported_host_pattern(&block.host_pattern) {
            parsed.blocks.push(block);
        } else {
            parsed.unsupported_count += 1;
        }
    }

    Ok(parsed)
}

/// 将解析后的 Host 块写入现有 ProfileStore。
/// 判重使用 `name + host + port + username`，同名但目标不同记为冲突而不是覆盖。
fn apply_import(
    store: &mut ProfileStore,
    home: &Path,
    parsed: ParsedOpensshConfig,
) -> Result<OpensshImportSummary, EngineError> {
    ensure_import_group(store)?;
    let mut summary = OpensshImportSummary {
        added_count: 0,
        skipped_count: 0,
        conflict_count: 0,
        unsupported_count: parsed.unsupported_count,
        error_count: 0,
    };

    for block in parsed.blocks {
        let mapped = match map_host_block_to_profile(&block, home) {
            Ok(profile) => profile,
            Err(_) => {
                summary.error_count += 1;
                continue;
            }
        };
        let duplicate = store.profiles.iter().any(|item| {
            item.name == mapped.name
                && item.host == mapped.host
                && item.port == mapped.port
                && item.username == mapped.username
        });
        if duplicate {
            summary.skipped_count += 1;
            continue;
        }
        let conflict = store.profiles.iter().any(|item| item.name == mapped.name);
        if conflict {
            summary.conflict_count += 1;
            continue;
        }
        store.profiles.push(mapped);
        summary.added_count += 1;
    }

    store.updated_at = now_epoch();
    Ok(summary)
}

/// 将单个 OpenSSH Host 块映射为 FluxTerm 会话。
/// 映射阶段只生成当前模型能表达的字段，不扩展新的 profile 存储结构。
fn map_host_block_to_profile(
    block: &OpensshHostBlock,
    home: &Path,
) -> Result<HostProfile, EngineError> {
    let name = validate_profile_name(truncate_profile_name(&block.host_pattern))?;
    let host = block
        .hostname
        .clone()
        .unwrap_or_else(|| block.host_pattern.clone());
    let private_key_path = block
        .identity_file
        .as_ref()
        .map(|value| expand_identity_file(value, home));
    Ok(HostProfile {
        id: Uuid::new_v4().to_string(),
        name,
        host,
        port: block.port.unwrap_or(22),
        username: block.user.clone().unwrap_or_default(),
        auth_type: if private_key_path.is_some() {
            AuthType::PrivateKey
        } else {
            AuthType::Password
        },
        private_key_path,
        private_key_passphrase_ref: None,
        password_ref: None,
        known_host: None,
        tags: Some(vec![IMPORT_GROUP_NAME.to_string()]),
        terminal_type: None,
        target_system: None,
        charset: None,
        word_separators: None,
        description: None,
    })
}

/// 确保固定导入分组存在于现有 SSH 分组集合中。
/// 这里复用现有分组约束和排序逻辑，避免导入链路生成特殊分组格式。
fn ensure_import_group(store: &mut ProfileStore) -> Result<(), EngineError> {
    let next = validate_and_dedupe_groups(
        store
            .ssh_groups
            .iter()
            .cloned()
            .chain(std::iter::once(IMPORT_GROUP_NAME.to_string()))
            .collect(),
    )?;
    store.ssh_groups = next;
    Ok(())
}

/// 判断 Host pattern 是否在当前支持范围内。
/// 当前只接受单个具体目标，不接受通配符、否定模式或多 pattern。
fn is_supported_host_pattern(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "*" {
        return false;
    }
    if trimmed.contains(char::is_whitespace) {
        return false;
    }
    !trimmed.contains('*') && !trimmed.contains('?') && !trimmed.contains('!')
}

/// 判断是否为当前支持的默认值块。
fn is_default_host_pattern(value: &str) -> bool {
    value.trim() == "*"
}

/// 将当前默认值合并到新的 `Host *` 块中，后出现的字段覆盖前值。
fn merge_defaults(current: &OpensshDefaults, block: &OpensshHostBlock) -> OpensshDefaults {
    OpensshDefaults {
        hostname: block.hostname.clone().or_else(|| current.hostname.clone()),
        port: block.port.or(current.port),
        user: block.user.clone().or_else(|| current.user.clone()),
        identity_file: block
            .identity_file
            .clone()
            .or_else(|| current.identity_file.clone()),
        identities_only: block.identities_only.or(current.identities_only),
    }
}

/// 将 `Host *` 提供的默认字段应用到新块中，块内显式字段后续仍可覆盖。
/// 默认值块自身不会进入导入结果，只影响其后的具体 Host 块。
fn apply_defaults_to_block(
    block: &OpensshHostBlock,
    defaults: &OpensshDefaults,
) -> OpensshHostBlock {
    if is_default_host_pattern(&block.host_pattern) {
        return block.clone();
    }
    OpensshHostBlock {
        host_pattern: block.host_pattern.clone(),
        hostname: defaults.hostname.clone(),
        port: defaults.port,
        user: defaults.user.clone(),
        identity_file: defaults.identity_file.clone(),
        identities_only: defaults.identities_only,
    }
}

/// 解析 OpenSSH 布尔值。
fn parse_ssh_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "yes" | "true" | "on" => Some(true),
        "no" | "false" | "off" => Some(false),
        _ => None,
    }
}

/// 解析 `key value` 形式的配置行。
fn split_config_line(line: &str) -> Option<(&str, &str)> {
    let mut parts = line.splitn(2, char::is_whitespace);
    let key = parts.next()?.trim();
    let value = parts.next()?.trim();
    if key.is_empty() || value.is_empty() {
        return None;
    }
    Some((key, value))
}

/// 将 IdentityFile 展开为当前平台可直接使用的路径。
fn expand_identity_file(value: &str, home: &Path) -> String {
    let trimmed = value.trim();
    if trimmed == "~" {
        return home.to_string_lossy().to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix("~/") {
        return home.join(stripped).to_string_lossy().to_string();
    }
    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        return candidate.to_string_lossy().to_string();
    }
    home.join(".ssh")
        .join(candidate)
        .to_string_lossy()
        .to_string()
}

/// 将导入来源的 Host 名裁剪到当前会话名称上限。
/// 裁剪仅发生在导入路径中，手工编辑会话仍由前后端共同执行长度校验。
fn truncate_profile_name(value: &str) -> String {
    let truncated: String = value.chars().take(IMPORT_PROFILE_NAME_MAX_CHARS).collect();
    if truncated != value {
        log_telemetry(
            TelemetryLevel::Warn,
            "ssh.config.import.truncate.success",
            None,
            json!({
                "original": value,
                "truncated": truncated,
                "maxChars": IMPORT_PROFILE_NAME_MAX_CHARS,
            }),
        );
    }
    truncated
}

fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_home() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\tester")
        } else {
            PathBuf::from("/home/tester")
        }
    }

    fn profile_store_with_profiles(profiles: Vec<HostProfile>) -> ProfileStore {
        ProfileStore {
            version: 1,
            updated_at: 0,
            ssh_groups: Vec::new(),
            secret: None,
            profiles,
        }
    }

    fn sample_profile(name: &str, host: &str, port: u16, username: &str) -> HostProfile {
        HostProfile {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            host: host.to_string(),
            port,
            username: username.to_string(),
            auth_type: AuthType::Password,
            private_key_path: None,
            private_key_passphrase_ref: None,
            password_ref: None,
            known_host: None,
            tags: None,
            terminal_type: None,
            target_system: None,
            charset: None,
            word_separators: None,
            description: None,
        }
    }

    #[test]
    fn parse_openssh_config_reads_basic_host_block() {
        let parsed = parse_openssh_config(
            r#"
Host prod
  HostName 10.0.0.10
  User root
  Port 2222
"#,
        )
        .unwrap();

        assert_eq!(parsed.unsupported_count, 0);
        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(parsed.blocks[0].host_pattern, "prod");
        assert_eq!(parsed.blocks[0].hostname.as_deref(), Some("10.0.0.10"));
        assert_eq!(parsed.blocks[0].user.as_deref(), Some("root"));
        assert_eq!(parsed.blocks[0].port, Some(2222));
    }

    #[test]
    fn parse_openssh_config_is_case_insensitive_and_last_value_wins() {
        let parsed = parse_openssh_config(
            r#"
HOST Prod
  User deploy
  user root
  HostName 10.0.0.1
  HOSTNAME 10.0.0.2
"#,
        )
        .unwrap();

        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(parsed.blocks[0].user.as_deref(), Some("root"));
        assert_eq!(parsed.blocks[0].hostname.as_deref(), Some("10.0.0.2"));
    }

    #[test]
    fn parse_openssh_config_marks_wildcards_and_multi_pattern_as_unsupported() {
        let parsed = parse_openssh_config(
            r#"
Host *
  User root
Host web-*
  HostName 10.0.0.3
Host prod staging
  HostName 10.0.0.4
"#,
        )
        .unwrap();

        assert_eq!(parsed.blocks.len(), 0);
        assert_eq!(parsed.unsupported_count, 2);
    }

    #[test]
    fn map_host_block_to_profile_uses_defaults_and_expands_identity_file() {
        let profile = map_host_block_to_profile(
            &OpensshHostBlock {
                host_pattern: "prod".to_string(),
                hostname: None,
                port: None,
                user: None,
                identity_file: Some("~/.ssh/id_ed25519".to_string()),
                identities_only: Some(true),
            },
            &fake_home(),
        )
        .unwrap();

        assert_eq!(profile.name, "prod");
        assert_eq!(profile.host, "prod");
        assert_eq!(profile.port, 22);
        assert_eq!(profile.username, "");
        assert!(matches!(profile.auth_type, AuthType::PrivateKey));
        assert!(profile.private_key_path.unwrap().contains("id_ed25519"));
        assert_eq!(profile.tags, Some(vec![IMPORT_GROUP_NAME.to_string()]));
    }

    #[test]
    fn expand_identity_file_uses_ssh_dir_for_relative_paths() {
        let home = fake_home();
        let path = expand_identity_file("keys/id_rsa", &home);

        assert!(path.contains(".ssh"));
        assert!(path.contains("keys"));
        assert!(path.contains("id_rsa"));
    }

    #[test]
    fn apply_import_counts_added_skipped_and_conflicts() {
        let mut store = profile_store_with_profiles(vec![
            sample_profile("prod", "10.0.0.1", 22, "root"),
            sample_profile("staging", "10.0.0.2", 22, "root"),
        ]);
        let summary = apply_import(
            &mut store,
            &fake_home(),
            ParsedOpensshConfig {
                unsupported_count: 1,
                blocks: vec![
                    OpensshHostBlock {
                        host_pattern: "prod".to_string(),
                        hostname: Some("10.0.0.1".to_string()),
                        port: Some(22),
                        user: Some("root".to_string()),
                        identity_file: None,
                        identities_only: None,
                    },
                    OpensshHostBlock {
                        host_pattern: "staging".to_string(),
                        hostname: Some("10.0.0.20".to_string()),
                        port: Some(22),
                        user: Some("root".to_string()),
                        identity_file: None,
                        identities_only: None,
                    },
                    OpensshHostBlock {
                        host_pattern: "qa".to_string(),
                        hostname: Some("10.0.0.3".to_string()),
                        port: Some(2200),
                        user: Some("deploy".to_string()),
                        identity_file: None,
                        identities_only: None,
                    },
                ],
            },
        )
        .unwrap();

        assert_eq!(
            summary,
            OpensshImportSummary {
                added_count: 1,
                skipped_count: 1,
                conflict_count: 1,
                unsupported_count: 1,
                error_count: 0,
            }
        );
        assert!(
            store
                .ssh_groups
                .iter()
                .any(|item| item == IMPORT_GROUP_NAME)
        );
        assert_eq!(store.profiles.len(), 3);
    }

    #[test]
    fn parse_openssh_config_applies_host_star_defaults_to_following_blocks() {
        let parsed = parse_openssh_config(
            r#"
Host *
  User demo
  Port 2200

Host alpha
  HostName 10.0.0.33

Host beta
  HostName example.com
  Port 58022
"#,
        )
        .unwrap();

        assert_eq!(parsed.unsupported_count, 0);
        assert_eq!(parsed.blocks.len(), 2);
        assert_eq!(parsed.blocks[0].user.as_deref(), Some("demo"));
        assert_eq!(parsed.blocks[0].port, Some(2200));
        assert_eq!(parsed.blocks[1].user.as_deref(), Some("demo"));
        assert_eq!(parsed.blocks[1].port, Some(58022));
    }

    #[test]
    fn map_host_block_to_profile_truncates_long_host_name() {
        let profile = map_host_block_to_profile(
            &OpensshHostBlock {
                host_pattern: "0123456789abcde".to_string(),
                hostname: Some("10.0.0.9".to_string()),
                port: Some(22),
                user: Some("root".to_string()),
                identity_file: None,
                identities_only: None,
            },
            &fake_home(),
        )
        .unwrap();

        assert_eq!(profile.name, "0123456789abcd");
    }

    #[test]
    fn apply_import_adds_truncated_long_host_name() {
        let mut store = profile_store_with_profiles(Vec::new());
        let summary = apply_import(
            &mut store,
            &fake_home(),
            ParsedOpensshConfig {
                unsupported_count: 0,
                blocks: vec![OpensshHostBlock {
                    host_pattern: "0123456789abcde".to_string(),
                    hostname: Some("10.0.0.9".to_string()),
                    port: Some(22),
                    user: Some("root".to_string()),
                    identity_file: None,
                    identities_only: None,
                }],
            },
        )
        .unwrap();

        assert_eq!(summary.added_count, 1);
        assert_eq!(summary.error_count, 0);
        assert_eq!(store.profiles.len(), 1);
        assert_eq!(store.profiles[0].name, "0123456789abcd");
    }
}
