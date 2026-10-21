//! Carga y guarda `profiles.json`.

use crate::app_paths::AppPaths;
use crate::files::file_guard::{read_or_null, write_atomic};
use crate::models::AppState;
use crate::Result;

pub struct ProfileStore<'a> {
    pub paths: &'a AppPaths,
}

impl<'a> ProfileStore<'a> {
    pub fn new(paths: &'a AppPaths) -> Self {
        ProfileStore { paths }
    }

    pub fn load(&self) -> Result<AppState> {
        let Some(json) = read_or_null(&self.paths.profiles_json()) else { return Ok(AppState::default()) };
        Ok(serde_json::from_str(&json)?)
    }

    pub fn save(&self, state: &AppState) -> Result<()> {
        write_atomic(&self.paths.profiles_json(), &serde_json::to_string_pretty(state)?)
    }
}
