//! 公共安全模块入口。
//!
//! 本模块负责统一封装本地敏感数据的加解密能力，避免业务代码直接依赖具体算法。
//! 当前默认采用弱保护模式；用户显式设置安全密码后，再切换到强保护模式。
//! 外部业务只通过统一入口读取和写入敏感字段。

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
