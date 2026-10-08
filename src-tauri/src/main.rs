// Evita la ventana de consola adicional en Windows en builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    audioextract_lib::run()
}
