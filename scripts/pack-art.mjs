import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Crop generated sprites on their documented cell boundaries. No artwork is
// synthesized here: transparent source pixels, shading and silhouettes survive.
const themeNames=['studio','grove','tide','ink','orbit','timber','zenith'];
const names=['target','short-0','short-1','short-2','long-0','long-1','long-2','board','primary','secondary','round','panel','tab-on','tab-off','tile','chest'];
const manifest={version:2,themes:{},icons:{}};
async function spriteRegions(source,columns,rows){
 const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const {width:w,height:h}=info,n=w*h,seen=new Uint8Array(n),queue=new Int32Array(n),groups=Array.from({length:columns*rows},()=>[]);
 for(let start=0;start<n;start++){
  if(seen[start]||data[start*4+3]<48)continue;
  let head=0,tail=1,minX=start%w,maxX=minX,minY=Math.floor(start/w),maxY=minY;queue[0]=start;seen[start]=1;
  while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(const q of [x>0?p-1:-1,x<w-1?p+1:-1,y>0?p-w:-1,y<h-1?p+w:-1])if(q>=0&&!seen[q]&&data[q*4+3]>=48){seen[q]=1;queue[tail++]=q;}}
  if(tail<90)continue;
  const col=Math.min(columns-1,Math.floor((minX+maxX)/2/w*columns)),row=Math.min(rows-1,Math.floor((minY+maxY)/2/h*rows));groups[row*columns+col].push({minX,maxX,minY,maxY,area:tail});
 }
 return groups.map((items,i)=>{
  if(!items.length)throw Error(`No sprite in cell ${i} of ${source}`);
  const largest=Math.max(...items.map(a=>a.area));items=items.filter(a=>a.area>=Math.max(90,largest*.025));
  const pad=3,left=Math.max(0,Math.min(...items.map(a=>a.minX))-pad),top=Math.max(0,Math.min(...items.map(a=>a.minY))-pad),right=Math.min(w,Math.max(...items.map(a=>a.maxX))+pad+1),bottom=Math.min(h,Math.max(...items.map(a=>a.maxY))+pad+1);
  return {left,top,width:right-left,height:bottom-top};
 });
}
for(const id of themeNames){
 const source=path.join('art/source',`${id}.png`);
 try{await fs.access(source);}catch{continue;}
 const metadata=await sharp(source).metadata(),cw=Math.floor(metadata.width/4),ch=Math.floor(metadata.height/4);
 const regions=await spriteRegions(source,4,4);
 const out=path.join('public/art',id);await fs.mkdir(out,{recursive:true});
 const entries={};
 for(let i=0;i<names.length;i++){
  const name=names[i],tile=await sharp(source).extract(regions[i]).png().toBuffer();
  // Preserve all non-transparent authored edge pixels and a narrow safe margin.
  const trimmed=tile;
  await fs.writeFile(path.join(out,`${name}.webp`),await sharp(trimmed).webp({quality:94,alphaQuality:100,effort:4}).toBuffer());
  const m=await sharp(trimmed).metadata();entries[name]={column:i%4,row:Math.floor(i/4),...regions[i]};
 }
 await fs.writeFile(path.join(out,'atlas.webp'),await sharp(source).webp({quality:94,alphaQuality:100,effort:4}).toBuffer());
 manifest.themes[id]={width:metadata.width,height:metadata.height,columns:4,rows:4,entries};
}
const icons=['coin','star','trophy','settings','hint','undo','restart','arrow','back','chevron','play','pause','grid','sun','infinity','shop','leaf','bolt','close','check','lock','clock','sound','mute','download','upload','help','flame','gift','spark','palette','snow','heart','logo','toggle-on','toggle-off'];
try{
 const source='art/source/icons.png';const m=await sharp(source).metadata();const cw=Math.floor(m.width/6),ch=Math.floor(m.height/6);await fs.mkdir('public/art/icons',{recursive:true});
 const regions=await spriteRegions(source,6,6);
 for(let i=0;i<icons.length;i++){
  const tile=await sharp(source).extract(regions[i]).png().toBuffer();
  await fs.writeFile(`public/art/icons/${icons[i]}.webp`,await sharp(tile).webp({quality:95,alphaQuality:100,effort:4}).toBuffer());
  manifest.icons[icons[i]]={column:i%6,row:Math.floor(i/6)};
 }
 await fs.writeFile('public/art/icons/atlas.webp',await sharp(source).webp({quality:95,alphaQuality:100,effort:4}).toBuffer());
}catch(error){if(error.code!=='ENOENT'&&!String(error).includes('Input file is missing'))throw error;}
for(const id of themeNames){
 const source='art/source/'+id+'-background.png';
 await fs.writeFile('public/art/'+id+'/background.webp',await sharp(source).resize({width:1080,withoutEnlargement:true}).webp({quality:88,effort:6}).toBuffer());
}
await fs.writeFile('public/art/manifest.json',JSON.stringify(manifest,null,2));
console.log('Packed raster themes:',Object.keys(manifest.themes).join(', '),'icons:',Object.keys(manifest.icons).length);
