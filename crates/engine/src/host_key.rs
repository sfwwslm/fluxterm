//! SSH Host Key 预检能力。

use std::sync::{Arc, Mutex};

use russh::client;
use russh::keys::{self, HashAlg, PublicKeyBase64};

use crate::error::EngineError;
use crate::types::HostProfile;

/// Host Key 预检结果。
#[derive(Debug, Clone)]
pub struct HostKeyProbe {
    pub key_algorithm: String,
    pub public_key_base64: String,
    pub fingerprint_sha256: String,
}

#[derive(Clone)]
struct ProbeHandler {
    key: Arc<Mutex<Option<keys::PublicKey>>>,
}

impl client::Handler for ProbeHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let mut guard = self
            .key
            .lock()
            .map_err(|_| anyhow::anyhow!("host key probe lock poisoned"))?;
        *guard = Some(server_public_key.clone());
        Ok(false)
    }
}

/// 预检目标主机的 Host Key。
pub async fn probe_host_key(profile: &HostProfile) -> Result<HostKeyProbe, EngineError> {
    let addr = format!("{}:{}", profile.host, profile.port);
    let config = Arc::new(client::Config::default());
    let key = Arc::new(Mutex::new(None));

    let connect_result = client::connect(
        config,
        addr,
        ProbeHandler {
            key: Arc::clone(&key),
        },
    )
    .await;

    let captured = key
        .lock()
        .map_err(|_| EngineError::new("ssh_host_key_probe_failed", "Host Key 预检失败"))?
        .clone();

    if let Some(public_key) = captured {
        return Ok(HostKeyProbe {
            key_algorithm: public_key.algorithm().to_string(),
            public_key_base64: public_key.public_key_base64(),
            fingerprint_sha256: public_key.fingerprint(HashAlg::Sha256).to_string(),
        });
    }

    connect_result.map_err(|err| {
        EngineError::with_detail(
            "ssh_host_key_probe_failed",
            "无法获取目标主机的 Host Key",
            err.to_string(),
        )
    })?;

    Err(EngineError::new(
        "ssh_host_key_probe_failed",
        "无法获取目标主机的 Host Key",
    ))
}
