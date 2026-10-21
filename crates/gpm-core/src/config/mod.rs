pub mod generator;
pub mod gitconfig_doc;

pub use generator::{ConfigGenerator, GeneratedFile, GeneratedFileKind, SshClientInfo};
pub use gitconfig_doc::GitConfigDocument;
