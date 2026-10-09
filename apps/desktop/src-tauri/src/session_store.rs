use std::{fs,path::PathBuf};
use serde::{Serialize,Deserialize};
use serde_json::Value;
#[derive(Serialize,Deserialize)]
pub struct SavedSession {pub endpoint:String,pub token:String,pub profile:Value}
fn path()->Result<PathBuf,String>{Ok(PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("无法定位 Windows 用户数据目录。")?).join("dev.graybox.desktop").join("session.dpapi"))}
#[cfg(windows)]
fn protect(input:&[u8],decrypt:bool)->Result<Vec<u8>,String>{
 use windows_sys::Win32::{Security::Cryptography::{CRYPT_INTEGER_BLOB,CryptProtectData,CryptUnprotectData,CRYPTPROTECT_UI_FORBIDDEN},Foundation::LocalFree};
 let source=CRYPT_INTEGER_BLOB{cbData:input.len().try_into().map_err(|_|"登录状态过大。")?,pbData:input.as_ptr() as *mut u8};
 let mut result=CRYPT_INTEGER_BLOB{cbData:0,pbData:std::ptr::null_mut()};
 let ok=unsafe{if decrypt{CryptUnprotectData(&source,std::ptr::null_mut(),std::ptr::null(),std::ptr::null(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut result)}else{CryptProtectData(&source,std::ptr::null(),std::ptr::null(),std::ptr::null(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut result)}};
 if ok==0{return Err("Windows 无法加密或恢复登录状态，请重新登录。".into());}
 let value=unsafe{std::slice::from_raw_parts(result.pbData,result.cbData as usize).to_vec()};
 unsafe{LocalFree(result.pbData.cast());} Ok(value)
}
#[cfg(not(windows))]
fn protect(_: &[u8],_:bool)->Result<Vec<u8>,String>{Err("此登录存储仅支持 Windows。".into())}
pub fn save(saved:&SavedSession)->Result<(),String>{let target=path()?;fs::create_dir_all(target.parent().unwrap()).map_err(|_|"无法创建登录状态目录。")?;let raw=serde_json::to_vec(saved).map_err(|_|"登录状态格式错误。")?;let encrypted=protect(&raw,false)?;fs::write(&target,encrypted).map_err(|_|"无法保存登录状态。".to_string())}
pub fn load()->Option<SavedSession>{let target=path().ok()?;let raw=fs::read(target).ok()?;if raw.len()>65536{return None;}serde_json::from_slice(&protect(&raw,true).ok()?).ok()}
pub fn clear()->Result<(),String>{match fs::remove_file(path()?){Ok(())=>Ok(()),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),Err(_)=>Err("无法清除已保存登录状态。".into())}}
#[cfg(test)]mod tests{use super::*;#[test]fn encrypted_roundtrip_and_corruption(){let plain=b"fixture-token-not-a-real-credential";let cipher=protect(plain,false).unwrap();assert!(!cipher.windows(plain.len()).any(|w|w==plain));assert_eq!(protect(&cipher,true).unwrap(),plain);assert!(protect(b"corrupt",true).is_err());}}
