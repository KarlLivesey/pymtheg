// SPDX-License-Identifier: MIT
// C-43 design B's oracle: a seeded generator of small crates built from the
// selection shapes every review round found. Each ingredient selects between
// two always-compiled items with the `fast` feature (on by default) and has
// one call site that reaches the selection; a control ingredient has none.
// Each ingredient states what its sites resolve to with `fast` on and off.
// A test runs the route under both settings and checks every decided answer
// against that setting (answers are definite per configuration, D17).

/** A small seeded generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n) };
}

const FAST = '#[cfg(feature = "fast")]';
const SLOW = '#[cfg(not(feature = "fast"))]';
/** Two always-compiled types with the same methods. */
const pair = (f, s, i) =>
  [f, s]
    .map(
      (t, v) =>
        `pub struct ${t};\nimpl ${t} {\n    pub fn mk${i}() -> Self {\n        ${t}\n    }\n    pub fn go${i}(&self) -> u32 {\n        ${v + 1}\n    }\n}\n`,
    )
    .join("");

export const INGREDIENTS = {
  control: (i) => ({
    expect: [[`crate::p${i}_free`, `src/lib.rs#p${i}_free`, `src/lib.rs#p${i}_free`]],
    lib: `pub struct P${i};\nimpl P${i} {\n    pub fn go${i}(&self) -> u32 {\n        0\n    }\n}\npub fn p${i}_free() -> u32 {\n    0\n}\npub fn site${i}() -> u32 {\n    P${i}.go${i}() + crate::p${i}_free()\n}\n`,
  }),
  "use-twin": (i) => ({
    expect: [[`T${i}::mk${i}`, `src/m${i}a.rs#`, `src/m${i}b.rs#`], [`T${i}::mk${i}().go${i}`, `src/m${i}a.rs#`, `src/m${i}b.rs#`]],
    lib: `mod m${i}a;\nmod m${i}b;\n${FAST}\nuse m${i}a::T${i};\n${SLOW}\nuse m${i}b::T${i};\npub fn site${i}() -> u32 {\n    T${i}::mk${i}().go${i}()\n}\n`,
    files: {
      [`src/m${i}a.rs`]: pair(`T${i}`, `Unused${i}a`, i),
      [`src/m${i}b.rs`]: pair(`T${i}`, `Unused${i}b`, i),
    },
  }),
  "alias-twin": (i) => ({
    expect: [[`A${i}::mk${i}`, `#impl F${i}::mk${i}`, `#impl S${i}::mk${i}`], [`A${i}::mk${i}().go${i}`, `#impl F${i}::go${i}`, `#impl S${i}::go${i}`]],
    lib: `${pair(`F${i}`, `S${i}`, i)}${FAST}\npub type A${i} = F${i};\n${SLOW}\npub type A${i} = S${i};\npub fn site${i}() -> u32 {\n    A${i}::mk${i}().go${i}()\n}\n`,
  }),
  "fn-twin": (i) => ({
    expect: [[`make${i}().go${i}`, `#impl F${i}::go${i}`, `#impl S${i}::go${i}`]],
    lib: `${pair(`F${i}`, `S${i}`, i)}${FAST}\nfn make${i}() -> F${i} {\n    F${i}\n}\n${SLOW}\nfn make${i}() -> S${i} {\n    S${i}\n}\npub fn site${i}() -> u32 {\n    make${i}().go${i}()\n}\n`,
  }),
  "impl-member-twin": (i) => ({
    expect: [[`H${i}.b${i}().go${i}`, `#impl F${i}::go${i}`, `#impl S${i}::go${i}`]],
    lib: `${pair(`F${i}`, `S${i}`, i)}pub struct H${i};\nimpl H${i} {\n    ${FAST}\n    pub fn b${i}(&self) -> F${i} {\n        F${i}\n    }\n    ${SLOW}\n    pub fn b${i}(&self) -> S${i} {\n        S${i}\n    }\n}\npub fn site${i}() -> u32 {\n    H${i}.b${i}().go${i}()\n}\n`,
  }),
  "static-twin": (i) => ({
    expect: [[`D${i}.go${i}`, `#impl F${i}::go${i}`, `#impl S${i}::go${i}`]],
    lib: `${pair(`F${i}`, `S${i}`, i)}${FAST}\nstatic D${i}: F${i} = F${i};\n${SLOW}\nstatic D${i}: S${i} = S${i};\npub fn site${i}() -> u32 {\n    D${i}.go${i}()\n}\n`,
  }),
  "cfg-if": (i) => ({
    expect: [[`C${i}::mk${i}`, `src/c${i}a.rs#`, `src/c${i}b.rs#`], [`C${i}::mk${i}().go${i}`, `src/c${i}a.rs#`, `src/c${i}b.rs#`]],
    cfgIf: true,
    lib: `mod c${i}a;\nmod c${i}b;\ncfg_if! {\n    if #[cfg(feature = "fast")] {\n        use c${i}a::C${i};\n    } else {\n        use c${i}b::C${i};\n    }\n}\npub fn site${i}() -> u32 {\n    C${i}::mk${i}().go${i}()\n}\n`,
    files: {
      [`src/c${i}a.rs`]: pair(`C${i}`, `Unused${i}a`, i),
      [`src/c${i}b.rs`]: pair(`C${i}`, `Unused${i}b`, i),
    },
  }),
  "gated-let": (i) => ({
    expect: [[`b.go${i}`, `#impl F${i}::go${i}`, `#impl S${i}::go${i}`]],
    lib: `${pair(`F${i}`, `S${i}`, i)}pub fn site${i}() -> u32 {\n    ${FAST}\n    let b = F${i};\n    ${SLOW}\n    let b = S${i};\n    b.go${i}()\n}\n`,
  }),
  "paired-globs": (i) => ({
    expect: [[`gf${i}`, `src/g${i}a.rs#`, `src/g${i}b.rs#`]],
    lib: `mod g${i}a;\nmod g${i}b;\n${FAST}\nuse g${i}a::*;\n${SLOW}\nuse g${i}b::*;\npub fn site${i}() -> u32 {\n    gf${i}()\n}\n`,
    files: {
      [`src/g${i}a.rs`]: `pub fn gf${i}() -> u32 {\n    1\n}\n`,
      [`src/g${i}b.rs`]: `pub fn gf${i}() -> u32 {\n    2\n}\n`,
    },
  }),
  "alias-other-file": (i) => ({
    expect: [[`OA${i}::mk${i}`, `#impl OF${i}::mk${i}`, `#impl OS${i}::mk${i}`], [`OA${i}::mk${i}().go${i}`, `#impl OF${i}::go${i}`, `#impl OS${i}::go${i}`]],
    lib: `mod o${i};\n${FAST}\ntype OA${i} = o${i}::OF${i};\n${SLOW}\ntype OA${i} = o${i}::OS${i};\npub fn site${i}() -> u32 {\n    OA${i}::mk${i}().go${i}()\n}\n`,
    files: { [`src/o${i}.rs`]: pair(`OF${i}`, `OS${i}`, i) },
  }),
  "sys-mod": (i) => ({
    expect: [[`sys${i}::sf${i}`, `src/sa${i}.rs#`, `src/sb${i}.rs#`]],
    lib: `${FAST}\nmod sa${i};\n${SLOW}\nmod sb${i};\n${FAST}\nuse sa${i} as sys${i};\n${SLOW}\nuse sb${i} as sys${i};\npub fn site${i}() -> u32 {\n    sys${i}::sf${i}()\n}\n`,
    files: {
      [`src/sa${i}.rs`]: `pub fn sf${i}() -> u32 {\n    1\n}\n`,
      [`src/sb${i}.rs`]: `pub fn sf${i}() -> u32 {\n    2\n}\n`,
    },
  }),
  "cfg-attr-path": (i) => ({
    expect: [[`ca${i}::cf${i}`, `src/ca${i}_fast.rs#`, `src/ca${i}.rs#`]],
    lib: `#[cfg_attr(feature = "fast", path = "ca${i}_fast.rs")]\nmod ca${i};\npub fn site${i}() -> u32 {\n    ca${i}::cf${i}()\n}\n`,
    files: {
      [`src/ca${i}.rs`]: `pub fn cf${i}() -> u32 {\n    1\n}\n`,
      [`src/ca${i}_fast.rs`]: `pub fn cf${i}() -> u32 {\n    2\n}\n`,
    },
  }),
};

const CFG_IF = [
  "macro_rules! cfg_if {",
  "    (if #[cfg($m:meta)] { $($i:item)* } else { $($e:item)* }) => {",
  "        $(#[cfg($m)] $i)*",
  "        $(#[cfg(not($m))] $e)*",
  "    };",
  "}",
  "",
].join("\n");

/** One crate from a seed: the control and `count` other ingredients. */
export function generate(seed, count = 4) {
  const r = rng(seed);
  const names = Object.keys(INGREDIENTS).filter((n) => n !== "control");
  const chosen = ["control"];
  for (let k = 0; k < count; k++) chosen.push(names[r.int(names.length)]);
  let lib = "#![allow(dead_code, unused_imports)]\n";
  const files = {
    "Cargo.toml":
      '[package]\nname = "oracle"\nversion = "0.1.0"\nedition = "2021"\n\n[features]\ndefault = ["fast"]\nfast = []\n',
  };
  const parts = chosen.map((name, i) => ({ name, ...INGREDIENTS[name](i) }));
  const expectations = parts.flatMap((p) => p.expect ?? []);
  if (parts.some((p) => p.cfgIf)) lib += CFG_IF;
  for (const p of parts) {
    lib += `\n// ${p.name}\n${p.lib}`;
    Object.assign(files, p.files ?? {});
  }
  files["src/lib.rs"] = lib;
  return { files, ingredients: chosen, expectations };
}
