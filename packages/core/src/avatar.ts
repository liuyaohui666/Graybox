import {inflateSync} from 'node:zlib';
// Small bounded raster parser. PNG CRCs/chunks and inflated rows are checked;
// JPEG dimensions come from its frame, never caller metadata.
export function validAvatar(value:string):boolean {
 if(value.length>180000)return false;
 const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!match)return false;
 const b=Buffer.from(match[2]!,'base64');if(b.toString('base64')!==match[2])return false;
 const dimensions=(w:number,h:number)=>w>=128&&w<=256&&h>=128&&h<=256;
 try {
  if(match[1]==='png') {
   if(!b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return false;
   let offset=8,width=0,height=0,channels=0,ended=false;const data:Buffer[]=[];
   while(offset+12<=b.length) {
    const length=b.readUInt32BE(offset),end=offset+length+12;if(end>b.length)return false;
    const type=b.toString('ascii',offset+4,offset+8),bytes=b.subarray(offset+8,end-4);
    let crc=0xffffffff;for(const v of b.subarray(offset+4,end-4)){crc^=v;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==b.readUInt32BE(end-4))return false;
    if(offset===8&&type!=='IHDR')return false;
    if(type==='IHDR'){if(offset!==8||length!==13)return false;width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);channels=({0:1,2:3,4:2,6:4} as Record<number,number>)[bytes[9]!]??0;if(!dimensions(width,height)||bytes[8]!==8||!channels||bytes[10]!==0||bytes[11]!==0||bytes[12]!==0)return false;}
    else if(type==='IDAT')data.push(bytes);
    else if(type==='IEND'){if(length!==0||end!==b.length)return false;ended=true;break;}
    else if(!/^[a-z]/.test(type))return false; // only known critical chunks
    offset=end;
   }
   if(!ended||!data.length)return false;
   const stride=width*channels+1,raw=inflateSync(Buffer.concat(data),{maxOutputLength:height*stride});
   if(raw.length!==height*stride)return false;for(let i=0;i<raw.length;i+=stride)if(raw[i]!>4)return false;
   return true;
  }
  if(b.length<4||b[0]!==0xff||b[1]!==0xd8||b[b.length-2]!==0xff||b[b.length-1]!==0xd9)return false;
  let offset=2,frame=false;
  while(offset+4<=b.length) {
   if(b[offset++]!==0xff)return false;while(b[offset]===0xff)offset++;
   const marker=b[offset++]!;
   if(marker===0xd9||marker===0x00)return false;
   const length=b.readUInt16BE(offset);if(length<2||offset+length>b.length)return false;
   if(marker===0xda){const components=b[offset+2]!;return frame&&components>=1&&components<=4&&length===6+2*components&&offset+length<b.length-2;}
   if([0xc0,0xc1,0xc2].includes(marker)){if(length<8||b[offset+2]!==8||!dimensions(b.readUInt16BE(offset+5),b.readUInt16BE(offset+3)))return false;frame=true;}
   offset+=length;
  }
 } catch {return false;}
 return false;
}
