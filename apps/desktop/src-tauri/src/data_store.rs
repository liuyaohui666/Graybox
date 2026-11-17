use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

#[derive(Serialize, Deserialize)]
struct Manifest {
    format_version: u8,
    created_at: String,
    files: Vec<String>,
}

fn root() -> PathBuf {
    PathBuf::from(std::env::var_os("GRAYBOX_DATA_ROOT").unwrap_or_else(|| "D:\\Graybox".into()))
}

fn hash(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "无法读取迁移文件。".to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let size = file.read(&mut buffer).map_err(|_| "无法读取迁移文件。".to_string())?;
        if size == 0 { break; }
        digest.update(&buffer[..size]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn add_dir(
    archive: &mut ZipWriter<File>,
    base: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|_| "无法读取数据目录。".to_string())? {
        let entry = entry.map_err(|_| "无法读取数据目录。".to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default();
            if name == "backups" || name.starts_with(".import-") { continue; }
            add_dir(archive, base, &path, files)?;
            continue;
        }
        let relative = path.strip_prefix(base)
            .map_err(|_| "迁移路径错误。")?
            .to_string_lossy()
            .replace('\\', "/");
        if relative == "README.txt" { continue; }
        archive.start_file(&relative, SimpleFileOptions::default()).map_err(|_| "无法写入迁移包。".to_string())?;
        archive.write_all(&fs::read(&path).map_err(|_| "无法读取迁移文件。".to_string())?)
            .map_err(|_| "无法写入迁移包。".to_string())?;
        files.push(relative);
    }
    Ok(())
}

fn read_manifest(archive: &mut ZipArchive<File>) -> Result<Manifest, String> {
    let mut content = String::new();
    archive.by_name("manifest.json")
        .map_err(|_| "迁移包缺少清单。")?
        .read_to_string(&mut content)
        .map_err(|_| "迁移清单读取失败。")?;
    let manifest: Manifest = serde_json::from_str(&content).map_err(|_| "迁移清单格式错误。")?;
    if manifest.format_version != 1 { return Err("迁移包版本不受支持。".into()); }
    for name in &manifest.files {
        if !safe_entry(name) { return Err("迁移包包含非法路径。".into()); }
    }
    for index in 0..archive.len() {
        let name = archive.by_index(index).map_err(|_| "迁移包读取失败。")?.name().to_string();
        if name != "manifest.json" && !safe_entry(&name) { return Err("迁移包包含非法路径。".into()); }
    }
    Ok(manifest)
}

fn safe_entry(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('/') && !name.contains("..") && !name.contains('\\')
}

fn timestamp() -> String {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
}

#[tauri::command]
pub fn data_export(target: String) -> Result<serde_json::Value, String> {
    let base = root();
    fs::create_dir_all(&base).map_err(|_| "无法创建数据目录。")?;
    let target_path = PathBuf::from(&target);
    if let Some(parent) = target_path.parent() { fs::create_dir_all(parent).map_err(|_| "无法创建迁移包目录。")?; }
    let file = File::create(&target_path).map_err(|_| "无法创建迁移包。")?;
    let mut archive = ZipWriter::new(file);
    let mut files = Vec::new();
    add_dir(&mut archive, &base, &base, &mut files)?;
    let manifest = serde_json::to_vec(&Manifest { format_version: 1, created_at: timestamp(), files })
        .map_err(|_| "迁移清单生成失败。")?;
    archive.start_file("manifest.json", SimpleFileOptions::default()).map_err(|_| "无法写入迁移清单。")?;
    archive.write_all(&manifest).map_err(|_| "无法写入迁移包。")?;
    archive.finish().map_err(|_| "迁移包写入失败。")?;
    Ok(serde_json::json!({"path": target, "sha256": hash(&target_path)?}))
}

#[tauri::command]
pub fn data_validate(path: String) -> Result<serde_json::Value, String> {
    let file = File::open(&path).map_err(|_| "找不到迁移包。")?;
    let mut archive = ZipArchive::new(file).map_err(|_| "迁移包格式错误。")?;
    let manifest = read_manifest(&mut archive)?;
    Ok(serde_json::json!({"valid": true, "files": manifest.files.len(), "sha256": hash(Path::new(&path))?}))
}

#[tauri::command]
pub fn data_import(path: String) -> Result<serde_json::Value, String> {
    let source = PathBuf::from(&path);
    let file = File::open(&source).map_err(|_| "找不到迁移包。")?;
    let mut archive = ZipArchive::new(file).map_err(|_| "迁移包格式错误。")?;
    let manifest = read_manifest(&mut archive)?;
    let base = root();
    fs::create_dir_all(&base).map_err(|_| "无法创建数据目录。")?;
    let staging = base.join(format!(".import-{}", timestamp()));
    fs::create_dir_all(&staging).map_err(|_| "无法创建导入临时目录。")?;
    for name in &manifest.files {
        let mut entry = archive.by_name(name).map_err(|_| "迁移包缺少文件。")?;
        let destination = staging.join(name);
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|_| "无法创建导入目录。")?; }
        let mut output = File::create(&destination).map_err(|_| "无法写入导入文件。")?;
        std::io::copy(&mut entry, &mut output).map_err(|_| "无法写入导入文件。")?;
    }
    let pending = base.join(".pending-import");
    if pending.exists() { fs::remove_dir_all(&pending).map_err(|_| "已有导入任务，请重启 Graybox 后再试。")?; }
    fs::rename(&staging, &pending).map_err(|_| "无法准备导入数据。")?;
    Ok(serde_json::json!({"imported": true, "requires_restart": true, "files": manifest.files.len()}))
}

