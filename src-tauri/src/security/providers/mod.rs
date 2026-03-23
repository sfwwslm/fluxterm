//! 内置 Provider 集合。

pub mod embedded;
pub mod user_password;

pub use embedded::EmbeddedProvider;
pub use user_password::UserPasswordProvider;
