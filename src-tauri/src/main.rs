// Sin consola adicional en Windows en las compilaciones de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    git_profile_manager_lib::run();
}
