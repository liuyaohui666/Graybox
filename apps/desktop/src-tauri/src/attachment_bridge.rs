use base64::{Engine as _,engine::general_purpose::{STANDARD,URL_SAFE_NO_PAD}};
use serde_json::{Value,json};
use std::time::Duration;
use super::{session_snapshot,session,credentials};
const MAX:usize=50*1024*1024;
fn allowed(path:&str,upload:bool)->bool {
 if upload{return path=="/v1/attachments/upload";}
 path.strip_prefix("/v1/attachments/").and_then(|v|v.strip_suffix("/content")).is_some_and(|id|id.len()==36&&id.chars().all(|c|c.is_ascii_hexdigit()||c=='-'))
}
#[tauri::command]
pub async fn attachment_transfer(profile_id:String,path:String,metadata:Option<Value>,data_base64:Option<String>)->Result<Value,String>{
 let upload=data_base64.is_some();if !allowed(&path,upload){return Err("附件请求不被允许。".into());}
 let snapshot=session_snapshot()?;
 if snapshot.endpoint.is_some()&&snapshot.profile.as_ref().and_then(|p|p["id"].as_str())!=Some(profile_id.as_str()){return Err("附件身份与当前会话不匹配。".into());}
 let (endpoint,token)=if let Some(endpoint)=snapshot.endpoint.clone(){(endpoint,snapshot.token.clone().ok_or("请先登录。")?)}else{("http://127.0.0.1:4318".into(),credentials()?.humans.into_iter().find(|h|h.id==profile_id).ok_or("本地身份不存在。")?.token)};
 let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(90)).build().map_err(|_|"无法创建连接。")?;
 let mut request=if upload{client.post(format!("{}{}",endpoint,path))}else{client.get(format!("{}{}",endpoint,path))};
 if let Some(encoded)=data_base64{
  if encoded.len()>(MAX+2)/3*4{return Err("附件超过 50 MB。".into());}
  let bytes=STANDARD.decode(encoded).map_err(|_|"附件数据格式错误。")?;if bytes.is_empty()||bytes.len()>MAX{return Err("附件为空或超限。".into());}
  let meta=serde_json::to_vec(&metadata.ok_or("缺少附件信息。")?).map_err(|_|"附件信息错误。")?;if meta.len()>8192{return Err("附件信息过长。".into());}
  request=request.header("content-type","application/octet-stream").header("x-graybox-metadata",URL_SAFE_NO_PAD.encode(meta)).body(bytes);
 }
 if session().lock().unwrap().generation!=snapshot.generation{return Err("会话已变更。".into());}
 let mut response=request.bearer_auth(token.clone()).send().await.map_err(|_|"附件传输未确认，请使用原操作重试。")?;
 if response.status().is_redirection(){return Err("附件服务重定向被拒绝。".into());}
 if upload||!response.status().is_success(){let result=response.json::<Value>().await.map_err(|_|"附件服务返回格式错误。")?;let mut state=session().lock().unwrap();if state.generation!=snapshot.generation{return Err("会话已变更，请重新读取。".into());}if result["error"]["code"]=="UNAUTHORIZED"&&state.token.as_deref()==Some(token.as_str()){super::session_store::clear()?;state.token=None;state.token_origin=None;state.profile=None;state.generation+=1;}return Ok(result);}
 let mime=response.headers().get("content-type").and_then(|v|v.to_str().ok()).unwrap_or("application/octet-stream").to_owned();
 let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|"附件读取失败，请重试。")?{if bytes.len()+chunk.len()>MAX{return Err("附件响应超过限制。".into());}bytes.extend_from_slice(&chunk);}
 if session().lock().unwrap().generation!=snapshot.generation{return Err("会话已变更，请重新读取。".into());}
 Ok(json!({"data":{"base64":STANDARD.encode(bytes),"mime_type":mime}}))
}
#[cfg(test)]mod tests{use super::*;#[test]fn transfer_routes_are_narrow(){assert!(allowed("/v1/attachments/upload",true));assert!(!allowed("/v1/commands",true));assert!(allowed("/v1/attachments/11111111-1111-4111-8111-111111111111/content",false));assert!(!allowed("/v1/attachments/../../auth/content",false));assert!(!allowed("https://other.invalid/v1/attachments/upload",true));}}
