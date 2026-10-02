import postgres from "npm:postgres@3.4.9";
import c1 from "./chunk1.ts";
import c2 from "./chunk2.ts";
import c3 from "./chunk3.ts";
import c4 from "./chunk4.ts";
import c5 from "./chunk5.ts";
import c6 from "./chunk6.ts";
import c7 from "./chunk7.ts";
import c8 from "./chunk8.ts";
globalThis.__whatsapp_postgres = postgres;
const EXPECTED_SHA256="66644918ffb25bb7118fa25106bcaa499c536c6e6c6716533dd7c29cf9b52960";
const payload=[c1,c2,c3,c4,c5,c6,c7,c8].join("");
function decodeBase64(v){const s=atob(v),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;}
function bytesToHex(a){return Array.from(a,b=>b.toString(16).padStart(2,"0")).join("");}
const sourceBytes=decodeBase64(payload);
const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",sourceBytes));
if(bytesToHex(digest)!==EXPECTED_SHA256) throw new Error("WHATSAPP_RUNTIME_BUNDLE_INTEGRITY_FAILURE");
await import(`data:text/javascript;base64,${payload}`);
