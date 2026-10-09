export type AttachmentKind='image'|'video'|'demo'|'repository'|'demo_link';
export type AttachmentTarget={entity_type:'project'|'idea'|'experiment';entity_id:string};
export interface Attachment extends AttachmentTarget {id:string;kind:AttachmentKind;name:string;caption:string;mime_type:string;byte_size:number;sha256:string|null;url:string|null;uploader_id:string;created_at:string;target_revision:number}
export function fileKind(name:string):'image'|'video'|'demo' {
 const ext=name.split('.').pop()?.toLowerCase();
 if(['png','jpg','jpeg','webp'].includes(ext??''))return 'image';
 if(['mp4','webm'].includes(ext??''))return 'video';
 if(['html','htm'].includes(ext??''))return 'demo';
 throw new Error('支持 PNG、JPEG、WebP、MP4、WebM 和自包含 HTML。');
}
export function checkFile(name:string,size:number){const kind=fileKind(name),max={image:10,video:50,demo:5}[kind]*1024*1024;if(!Number.isSafeInteger(size)||size<=0||size>max)throw new Error(`文件为空或超过限制：${{image:'图片 10 MB',video:'视频 50 MB',demo:'网页演示 5 MB'}[kind]}。`);return kind;}
export const demoSandbox='allow-scripts';
