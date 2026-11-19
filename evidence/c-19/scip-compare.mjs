// SPDX-License-Identifier: MIT
// C-19: compare SCIP indexes by payload, leaving out the index metadata
// (field 1: tool info and the absolute project root, which differs between
// copies). Each document (field 2: relative path, occurrences, symbols) is
// hashed from its raw protobuf bytes and compared by relative path; external
// symbols (field 3) are hashed as a set.
// Usage: node scip-compare.mjs BASE.scip OTHER.scip [OTHER.scip ...]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function varint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
  }
}
function summarise(file) {
  const buf = readFileSync(file);
  const docs = new Map();
  const external = [];
  let root = "";
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = varint(buf, pos);
    const field = key >>> 3;
    const wire = key & 7;
    if (wire !== 2) throw Error(`unexpected wire type ${wire} at top level`);
    let len;
    [len, pos] = varint(buf, pos);
    const body = buf.subarray(pos, pos + len);
    pos += len;
    if (field === 1) {
      // metadata: project_root is field 3 (string)
      let p = 0;
      while (p < body.length) {
        let k;
        [k, p] = varint(body, p);
        const w = k & 7;
        if (w === 0) [, p] = varint(body, p);
        else if (w === 2) {
          let l;
          [l, p] = varint(body, p);
          if (k >>> 3 === 3) root = body.subarray(p, p + l).toString("utf8");
          p += l;
        } else throw Error("metadata wire type");
      }
    } else if (field === 2) {
      // relative_path is field 1 of the document
      let p = 0;
      let path = "";
      while (p < body.length) {
        let k;
        [k, p] = varint(body, p);
        const w = k & 7;
        if (w === 0) [, p] = varint(body, p);
        else if (w === 2) {
          let l;
          [l, p] = varint(body, p);
          if (k >>> 3 === 1) path = body.subarray(p, p + l).toString("utf8");
          p += l;
        } else if (w === 1) p += 8;
        else if (w === 5) p += 4;
      }
      docs.set(path, createHash("sha256").update(body).digest("hex"));
    } else if (field === 3) external.push(createHash("sha256").update(body).digest("hex"));
  }
  return { file, bytes: buf.length, root, docs, external: createHash("sha256").update(external.sort().join("")).digest("hex") };
}

const [base, ...others] = process.argv.slice(2).map(summarise);
const report = { base: { file: base.file.split("/").pop(), bytes: base.bytes, documents: base.docs.size }, comparisons: [] };
for (const o of others) {
  let same = 0;
  const differ = [];
  const onlyBase = [];
  const onlyOther = [];
  for (const [p, h] of base.docs) {
    if (!o.docs.has(p)) onlyBase.push(p);
    else if (o.docs.get(p) === h) same++;
    else differ.push(p);
  }
  for (const p of o.docs.keys()) if (!base.docs.has(p)) onlyOther.push(p);
  report.comparisons.push({
    file: o.file.split("/").pop(),
    bytes: o.bytes,
    rawBytesEqual: o.bytes === base.bytes && readFileSync(o.file).equals(readFileSync(base.file)),
    projectRootDiffers: o.root !== base.root,
    documents: o.docs.size,
    documentsIdentical: same,
    documentsDiffering: differ.length,
    onlyInBase: onlyBase.length,
    onlyInOther: onlyOther.length,
    externalSymbolsEqual: o.external === base.external,
    payloadIdentical: differ.length === 0 && onlyBase.length === 0 && onlyOther.length === 0 && o.external === base.external,
    differingSample: [...differ, ...onlyBase.map((p) => "-" + p), ...onlyOther.map((p) => "+" + p)].slice(0, 8),
  });
}
console.log(JSON.stringify(report, null, 1));
