//! 公共安全模块入口。
//!
//! 本模块负责统一封装本地敏感数据的加解密能力，避免业务代码直接依赖具体算法。
//! Alpha 阶段默认启用硬编码密钥 Provider，但外部调用接口保持稳定，后续可替换为
//! 系统安全存储、用户主密码或远端密钥 Provider。

pub mod crypto;
pub mod provider;
pub mod providers;
pub mod secret_store;
pub mod types;

pub use crypto::CryptoService;
pub use secret_store::SecretStore;
pub use types::{
    EncryptedPayload, EncryptionAlgorithm, EncryptionProviderKind, ProviderCiphertext,
    SecurityStatus,
};
