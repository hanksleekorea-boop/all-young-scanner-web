import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css'};
const server=createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file;
    if(path==='/')file='index.html';
    else if(/^\/(?:guides\/(?:[a-z0-9-]+\/)?|en\/)$/.test(path))file=`${path.slice(1)}index.html`;
    else if(/^\/(?:[a-zA-Z0-9_-]+\.(?:html|json|js|svg|png|webmanifest|txt|xml)|en\/[a-zA-Z0-9_-]+\.html|(?:assets|content)\/[a-zA-Z0-9_.-]+)$/.test(path))file=path.slice(1);
    else {res.writeHead(404);res.end();return;}
    const body=await readFile(resolve(root,file));
    res.writeHead(200,{'Content-Type':types[extname(file)]||'text/plain','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
server.listen(4179,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4179/'));
