export function displayName(person:{name:string},mode:'local'|'cloud'):string {
 return mode==='local'?({'Owner demonstration':'本地用户1','Member one demonstration':'本地用户2','Member two demonstration':'本地用户3'} as Record<string,string>)[person.name]??person.name:person.name;
}
export function personLabel(person:{name:string;role?:string},mode:'local'|'cloud') {
 return displayName(person,mode);
}
export function avatarCrop(width:number,height:number) {
 if(width<=0||height<=0||width*height>40000000)throw Error('图片尺寸过大或无法读取。');
 const size=Math.min(width,height);return {x:(width-size)/2,y:(height-size)/2,size};
}
export class AvatarGeneration {
 private generation=0;
 begin(profile:string,session:number){return {generation:++this.generation,profile,session};}
 current(token:{generation:number;profile:string;session:number},profile:string,session:number){return token.generation===this.generation&&token.profile===profile&&token.session===session;}
 cancel(){this.generation++;}
}
export async function prepareAvatar(file:File):Promise<string> {
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('请选择 8MB 以内的 PNG、JPEG 或 WebP 图片。');
 const bitmap=await createImageBitmap(file);
 try {
  const {x,y,size}=avatarCrop(bitmap.width,bitmap.height),canvas=document.createElement('canvas');canvas.width=canvas.height=192;
  const context=canvas.getContext('2d');if(!context)throw Error('无法处理图片。');
  context.drawImage(bitmap,x,y,size,size,0,0,192,192);
  let data=canvas.toDataURL('image/png');
  if(data.length>180000){canvas.width=canvas.height=128;context.drawImage(bitmap,x,y,size,size,0,0,128,128);data=canvas.toDataURL('image/png');}
  if(data.length>180000)throw Error('头像处理后仍过大，请选择更简单的图片。');return data;
 }finally{bitmap.close();}
}
