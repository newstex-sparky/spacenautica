import { runProbe } from './__probe';
const c = document.createElement('canvas');
document.body.appendChild(c);
try { runProbe(c); } catch (e) { (window as unknown as {__PROBE__?:string}).__PROBE__ = JSON.stringify({ fatal: String(e) }); }
