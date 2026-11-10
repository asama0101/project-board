// 使い方: node tools/validate.js <data.json>   結果を JSON で出力し、errors があれば exit 1
import { readFileSync } from "node:fs";
import { validate } from "../src/core/schema.js";

const path = process.argv[2];
if (!path) { console.error("使い方: node tools/validate.js <data.json>"); process.exit(2); }
let data;
try { data = JSON.parse(readFileSync(path, "utf8")); }
catch (e) { console.log(JSON.stringify({ errors: [`読み込めません: ${e.message}`], warnings: [] }, null, 2)); process.exit(1); }
const r = validate(data);
console.log(JSON.stringify(r, null, 2));
process.exit(r.errors.length ? 1 : 0);
