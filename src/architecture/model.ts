import { errorMessage } from "../shared/error-message.js";
import { documentSetHash } from "./manifest.js";
import { sourceCatalogueSchema } from "../shared/source-contracts.js";
import { architectureMarkdown, relationshipText } from "./headings.js";
import { identifiedHeadings } from "./heading-identities.js";
import {
  architectureLimits,
  maxStoredDocuments,
  documentCountsWithinLimits,
} from "./limits.js";
import { parseArchitectureJson } from "./json.js";
import { z } from "zod";
import { hash } from "../shared/identity.js";
import {
  architectureIndexVersion,
  documentSchema,
  planSchema,
  type ArchitectureDocument,
  type ArchitectureEntity,
  type ArchitectureEdge,
  type ArchitectureIndex,
} from "./schema.js";
/** Plan fields that record reviews or baselines, not what the record says. */
const reviewBookkeeping = new Set([
  "linkReviewRevision",
  "linkBaselines",
  "sourceRoots",
  "sourceExpectations",
  "sourceHashes",
  "sourceReviewSnapshot",
  "sourceSelectionSnapshot",
  "sourceSelections",
  "sourceReviewSelection",
]);
export * from "./schema.js";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const catalogueSchema = z
  .object({
    functions: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            owner: z.string(),
            symbol: z.string().optional(),
            status: z.string().optional(),
            description: z.string().optional(),
            args: z.record(z.string(), z.unknown()).optional(),
            returns: z.unknown().optional(),
            edges: z.array(z.unknown()).optional(),
            calls: z.array(z.string()).optional(),
          })
          .passthrough(),
      )
      .max(100000),
    types: z.record(z.string(), z.unknown()),
  })
  .passthrough();
/** Search decoded values; schema/field names are not authored content. */
function recordText(value: unknown, visit: () => void): string {
  const stack: unknown[] = [value],
    text: string[] = [];
  while (stack.length) {
    visit();
    const next = stack.pop();
    if (
      typeof next === "string" ||
      typeof next === "number" ||
      typeof next === "boolean"
    )
      text.push(String(next));
    else if (next && typeof next === "object") {
      const values = Array.isArray(next) ? next : Object.values(next);
      for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
    }
  }
  return text.join("\n").toLowerCase();
}
/** Preserves every original document. The index is navigation, not semantic verification. */
export function indexArchitecture(
  input: ArchitectureDocument[],
  limits: { maxVisits?: number } = {},
): ArchitectureIndex {
  const docs = z
      .array(documentSchema)
      .min(1)
      .max(maxStoredDocuments)
      .refine(
        documentCountsWithinLimits,
        "A snapshot supports 4,096 architecture documents and 10,000 observed-code parts.",
      )
      .parse(input),
    paths = new Set<string>(),
    entities: ArchitectureEntity[] = [],
    edges: ArchitectureEdge[] = [],
    warnings: string[] = [];
  let indexVisits = 0;
  const maxVisits = limits.maxVisits ?? architectureLimits.indexVisits;
  if (
    !Number.isSafeInteger(maxVisits) ||
    maxVisits < 1 ||
    maxVisits > 10_000_000
  )
    throw Error("Architecture visit budget must be 1..10000000");
  const visit = () => {
    if (++indexVisits > maxVisits)
      throw Error(
        `Architecture indexing exceeded its ${maxVisits} visit budget; no complete index is claimed.`,
      );
  };
  const documents = docs.map((d) => {
    if (paths.has(d.path)) throw Error("Duplicate document path " + d.path);
    paths.add(d.path);
    if (Buffer.byteLength(d.text) > architectureLimits.documentBytes)
      throw Error(d.path + " exceeds the 16 MiB document limit");
    return {
      path: d.path,
      hash: hash(d.text),
      bytes: Buffer.byteLength(d.text),
    };
  });
  const total = documents.reduce((n, d) => n + d.bytes, 0);
  if (total > architectureLimits.snapshotBytes)
    throw Error("Architecture import exceeds 64 MiB");
  const headingIndex = identifiedHeadings(docs);
  warnings.push(...headingIndex.warnings);
  const buckets = new Map<string, ArchitectureEntity[]>(),
    functions = new Map<string, ArchitectureEntity[]>(),
    parameters = new Map<ArchitectureEntity, string[] | null>(),
    functionSources = new Map<string, ArchitectureEntity>(),
    typeSources = new Map<string, ArchitectureEntity>(),
    typeNames = new Map<string, ArchitectureEntity[]>(),
    owners = new Set<string>(),
    catalogues: { path: string; value: z.infer<typeof catalogueSchema> }[] = [];
  const pendingEdges: {
    owner: ArchitectureEntity;
    edge: Omit<ArchitectureEdge, "from">;
  }[] = [];
  function add(entity: ArchitectureEntity) {
    entities.push(entity);
    const bucket = buckets.get(entity.id) ?? [];
    bucket.push(entity);
    buckets.set(entity.id, bucket);
    return entity;
  }
  for (const d of docs) {
    if (!d.path.startsWith(".pymtheg")) {
      visit();
      add({
        id: "document:" + d.path,
        key: d.path,
        name: d.path,
        kind: "document",
        owner: "documents",
        status: "retained-unverified",
        summary: "Complete retained document",
        contentHash: hash(d.text),
        document: d.path,
        pointer: [],
        identity: "name-derived",
      });
      if (/\.(md|rst)$/i.test(d.path)) {
        const headings = headingIndex.headings.get(d.path) ?? [];
        headings.forEach((heading, i) => {
          visit();
          const end = heading.end,
            text = heading.text,
            id = heading.id;
          add({
            id,
            key: heading.key,
            name: heading.title,
            kind: "heading",
            owner: "documents",
            status: "retained-unverified",
            summary: text.slice(0, 1000),
            searchText: text.toLowerCase(),
            contentHash: hash(text),
            relationshipHash: hash(relationshipText(text)),
            document: d.path,
            pointer: ["lines", heading.line, end],
            identity: "name-derived",
          });
          edges.push({
            from: id,
            to: "document:" + d.path,
            targetName: d.path,
            kind: "section-of",
            order: i + 1,
            document: d.path,
            pointer: ["lines", heading.line, end],
            binding: "not-applicable",
            unresolved: false,
          });
        });
        for (const generic of architectureMarkdown(d.text).generics) {
          visit();
          const entity = add({
            id: "type:generic:" + d.path + "#" + generic.name,
            key: generic.name,
            name: generic.name + "<" + generic.parameters.join(", ") + ">",
            kind: "type",
            owner: "documents",
            status: "declared-unverified",
            summary: generic.text,
            contentHash: hash(generic.text),
            document: d.path,
            pointer: ["lines", generic.line, generic.line + 1],
            identity: "declared",
          });
          const group = typeNames.get(generic.name) ?? [];
          group.push(entity);
          typeNames.set(generic.name, group);
          edges.push({
            from: entity.id,
            to: "document:" + d.path,
            targetName: d.path,
            kind: "declared-in",
            order: 0,
            document: d.path,
            pointer: entity.pointer,
            binding: "not-applicable",
            unresolved: false,
          });
        }
      }
    }
    if (!d.path.toLowerCase().endsWith(".json")) continue;
    let raw: unknown;
    try {
      const parsedJson = parseArchitectureJson(d.text);
      raw = parsedJson.value;
      if (parsedJson.exactNumbers)
        warnings.push(
          `${d.path}: ${parsedJson.exactNumbers} numeric literals are shown as $exactNumber records to preserve their exact values. Original text is retained.`,
        );
    } catch {
      warnings.push(
        `${d.path}: retained as text; invalid JSON cannot be indexed.`,
      );
      continue;
    }
    if (record(raw) && raw.schema === "pymtheg.source-contracts/v1") {
      const checked = sourceCatalogueSchema.safeParse(raw);
      if (!checked.success) {
        warnings.push(
          `${d.path}: retained source catalogue has an unsupported schema.`,
        );
        continue;
      }
      checked.data.entries.forEach((entry, i) => {
        visit();
        owners.add("project source");
        add({
          id: entry.id,
          key: entry.signature,
          name: entry.name,
          kind:
            entry.kind === "type" || entry.kind === "resource"
              ? "type"
              : entry.kind === "machine"
                ? "component"
                : "function",
          owner: "project source",
          status: "source-snapshot-" + entry.modelStatus,
          summary: entry.signature,
          contentHash: entry.declarationHash,
          searchText: recordText({ ...entry, declaration: undefined }, visit),
          document: d.path,
          pointer: ["entries", i],
          identity: "declared",
        });
      });
      checked.data.dependencies.forEach((edge, i) =>
        edges.push({
          from: edge.from,
          to: edge.to,
          targetName: edge.to,
          kind: edge.kind,
          order: i,
          document: d.path,
          pointer: ["dependencies", i],
          binding: "not-applicable",
          unresolved: false,
        }),
      );
      continue;
    }
    if (record(raw) && raw.schema === "pymtheg.plan/v1") {
      const plan = planSchema.safeParse(raw);
      if (!plan.success) {
        warnings.push(
          `${d.path}: planning records are retained but have an unsupported schema. ${errorMessage(plan.error)}`,
        );
        continue;
      }
      plan.data.items.forEach((item, i) => {
        visit();
        owners.add(item.owner);
        const entity = add({
          id: "plan:" + item.id,
          key: item.title,
          name: item.title,
          kind: item.kind,
          owner: item.owner,
          status: item.status,
          summary: item.detail,
          planning: {
            hasAcceptance: !!item.acceptance.trim(),
            hasEvidence: !!item.evidence.trim(),
            evidenceRevision: item.evidenceRevision,
            ...(item.originRevision
              ? { originRevision: item.originRevision }
              : {}),
            ...(item.linkReviewRevision
              ? { linkReviewRevision: item.linkReviewRevision }
              : {}),
            ...(item.linkBaselines && Object.keys(item.linkBaselines).length
              ? { linkBaselines: { ...item.linkBaselines } }
              : {}),
          },
          contentHash: hash(JSON.stringify(item)),
          // Link change detection ignores review and baseline bookkeeping.
          relationshipHash: hash(
            JSON.stringify(
              Object.fromEntries(
                Object.entries(item).filter(
                  ([key]) => !reviewBookkeeping.has(key),
                ),
              ),
            ),
          ),
          searchText: recordText(item, visit),
          document: d.path,
          pointer: ["items", i],
          identity: "declared",
        });
        item.links.forEach((link, j) => {
          visit();
          pendingEdges.push({
            owner: entity,
            edge: {
              to: link.target,
              targetName: link.target,
              kind: link.kind,
              order: j + 1,
              document: d.path,
              pointer: ["items", i, "links", j],
              binding: "not-applicable",
              unresolved: false,
            },
          });
        });
      });
      continue;
    }
    if (!record(raw) || !Array.isArray(raw.functions) || !record(raw.types))
      continue;
    const parsed = catalogueSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(
        `${d.path}: retained completely; unsupported catalogue schema was not indexed.`,
      );
      continue;
    }
    catalogues.push({ path: d.path, value: parsed.data });
    parsed.data.functions.forEach((f, i) => {
      visit();
      const id = f.symbol ? "function:" + f.symbol : "function:" + f.id;
      owners.add(f.owner);
      const entity = add({
        id,
        key: f.id,
        name: f.name,
        kind: "function",
        owner: f.owner,
        status: f.status ?? "unspecified",
        summary: f.description ?? "",
        contentHash: hash(JSON.stringify(f)),
        searchText: recordText([f, Object.keys(f.args ?? {})], visit),
        document: d.path,
        pointer: ["functions", i],
        identity: f.symbol ? "declared" : "name-derived",
      });
      functionSources.set(JSON.stringify([d.path, i]), entity);
      parameters.set(entity, f.args ? Object.keys(f.args) : null);
      const named = functions.get(f.id) ?? [];
      named.push(entity);
      functions.set(f.id, named);
    });
    for (const [name, t] of Object.entries(parsed.data.types)) {
      visit();
      const number =
        record(t) && Number.isSafeInteger(t.number) ? Number(t.number) : null;
      const owner =
        record(t) && typeof t.owner === "string" ? t.owner : "unassigned";
      owners.add(owner);
      const entity = add({
        id: number === null ? "type:" + name : "type:" + number,
        key: name,
        name,
        kind: "type",
        owner,
        status: "imported-contract",
        summary: record(t) && typeof t.rule === "string" ? t.rule : "",
        contentHash: hash(JSON.stringify(t)),
        searchText: recordText(t, visit),
        document: d.path,
        pointer: ["types", name],
        identity: number === null ? "name-derived" : "declared",
      });
      typeSources.set(JSON.stringify([d.path, name]), entity);
      for (const key of [
        name,
        ...(record(t) && typeof t.rustPath === "string" ? [t.rustPath] : []),
      ]) {
        const group = typeNames.get(key) ?? [];
        group.push(entity);
        typeNames.set(key, group);
      }
    }
  }
  const foreignLinks: {
    owner: ArchitectureEntity;
    target: string;
    kind: string;
  }[] = [];
  for (const catalogue of catalogues) {
    const addForeign = (
      kind: "route" | "command" | "review" | "profile" | "release",
      key: string,
      value: unknown,
      pointer: (string | number)[],
    ) => {
      visit();
      const text = JSON.stringify(value),
        entity = add({
          id: kind + ":" + key,
          key,
          name: key,
          kind,
          owner: "architecture",
          status:
            record(value) && typeof value.status === "string"
              ? value.status
              : "imported-unverified",
          summary:
            record(value) && typeof value.authority === "string"
              ? value.authority
              : typeof value === "string"
                ? value
                : "Imported " + kind,
          contentHash: hash(text),
          document: catalogue.path,
          pointer,
          identity: "declared",
          searchText: text.toLowerCase(),
        });
      if (record(value)) {
        for (const [field, relation] of [
          ["callees", "calls"],
          ["targets", "concerns"],
        ] as const)
          if (Array.isArray(value[field]))
            for (const target of value[field])
              if (typeof target === "string")
                foreignLinks.push({ owner: entity, target, kind: relation });
        if (typeof value.evaluator === "string")
          foreignLinks.push({
            owner: entity,
            target: value.evaluator,
            kind: "evaluated-by",
          });
      }
      if (kind === "command")
        foreignLinks.push({ owner: entity, target: key, kind: "invokes" });
    };
    for (const field of [
      "publicRoutes",
      "adminRoutes",
      "replicatedCommands",
      "profiles",
    ]) {
      const values = catalogue.value[field];
      if (record(values))
        for (const [key, value] of Object.entries(values))
          addForeign(
            field === "profiles"
              ? "profile"
              : field === "replicatedCommands"
                ? "command"
                : "route",
            field.endsWith("Routes") ? field + ":" + key : key,
            value,
            [field, key],
          );
    }
    const reviews = catalogue.value.reviewFindings;
    if (Array.isArray(reviews))
      reviews.forEach((value, i) =>
        addForeign(
          "review",
          record(value) && typeof value.id === "string"
            ? value.id
            : String(i + 1),
          value,
          ["reviewFindings", i],
        ),
      );
    if (catalogue.value.releaseState !== undefined)
      addForeign("release", "release-state", catalogue.value.releaseState, [
        "releaseState",
      ]);
  }
  for (const owner of [...owners].sort())
    add({
      id: "owner:" + owner,
      key: owner,
      name: owner,
      kind: "owner",
      owner,
      status: "structural-group",
      summary: "Functions and types owned by " + owner,
      contentHash: hash(owner),
      document: catalogues[0]?.path ?? docs[0]!.path,
      pointer: [],
      identity: "name-derived",
    });
  for (const [id, bucket] of buckets) {
    if (bucket.length < 2) continue;
    for (const entity of bucket) {
      entity.conflictOf = id;
      entity.id =
        id + "@" + hash(JSON.stringify([entity.document, entity.pointer]));
    }
    warnings.push(
      `Conflicting identity ${id}: all ${bucket.length} definitions remain visible. References to this identity are unresolved until the conflict is resolved.`,
    );
  }
  const ids = new Set(entities.map((e) => e.id));
  const namedEntities = new Map<string, ArchitectureEntity[]>();
  for (const entity of entities) {
    const group = namedEntities.get(entity.key) ?? [];
    group.push(entity);
    namedEntities.set(entity.key, group);
  }
  for (const link of foreignLinks) {
    const candidates =
        functions.get(link.target) ?? namedEntities.get(link.target),
      target =
        candidates?.length === 1 && !candidates[0]!.conflictOf
          ? candidates[0]
          : undefined;
    edges.push({
      from: link.owner.id,
      to: target?.id ?? "unresolved:" + link.target,
      targetName: link.target,
      kind: link.kind,
      order: 0,
      document: link.owner.document,
      pointer: link.owner.pointer,
      binding: "not-applicable",
      unresolved: !target,
    });
  }

  for (const { owner, edge } of pendingEdges)
    edges.push({ ...edge, from: owner.id });
  for (const [name, named] of functions)
    if (named.length > 1)
      warnings.push(
        `Ambiguous function name ${name}; its definitions remain visible and calls using that name are unresolved.`,
      );
  for (const catalogue of catalogues)
    catalogue.value.functions.forEach((f, i) => {
      const listed =
        f.edges ?? f.calls?.map((callee) => ({ callee, kind: "call" })) ?? [];
      listed.forEach((raw, j) => {
        visit();
        if (!record(raw) || typeof raw.callee !== "string") {
          warnings.push(
            `${f.id}: unrecognised edge retained in the original document.`,
          );
          return;
        }
        const named = functions.get(raw.callee),
          target =
            named?.length === 1 && !named[0]!.conflictOf
              ? named[0]!
              : undefined;
        const bindings = record(raw.bindings) ? raw.bindings : null;
        const required = target ? parameters.get(target) : null;
        const binding: ArchitectureEdge["binding"] =
          !target || !required
            ? "unknown"
            : required.length === 0
              ? "not-applicable"
              : !bindings
                ? "missing"
                : required.every((name) => Object.hasOwn(bindings, name))
                  ? "recorded"
                  : "partial";
        edges.push({
          from: functionSources.get(JSON.stringify([catalogue.path, i]))!.id,
          to: target?.id ?? "unresolved:" + raw.callee,
          targetName: raw.callee,
          kind: typeof raw.kind === "string" ? raw.kind : "call",
          order:
            typeof raw.order === "number" && Number.isFinite(raw.order)
              ? raw.order
              : j + 1,
          document: catalogue.path,
          pointer: f.edges
            ? ["functions", i, "edges", j]
            : ["functions", i, "calls", j],
          binding,
          unresolved: !target,
        });
      });
    });
  // Foreign type syntax is indexed conservatively, not interpreted as Pymtheg types.
  const primitiveNames = new Set([
    "Bool",
    "Int",
    "Nat",
    "Unit",
    "bool",
    "boolean",
    "string",
    "str",
    "String",
    "number",
    "int",
    "void",
    "unit",
    "usize",
    "isize",
    "u8",
    "u16",
    "u32",
    "u64",
    "u128",
    "i8",
    "i16",
    "i32",
    "i64",
    "i128",
    "f32",
    "f64",
    "Option",
    "Result",
    "Vec",
    "List",
    "Map",
    "Set",
    "HashMap",
    "BTreeMap",
    "HashSet",
    "Box",
    "Arc",
    "Rc",
    "Self",
    "None",
    "Some",
    "Ok",
    "Err",
  ]);
  for (const catalogue of catalogues) {
    const unknown = new Set<string>();
    const references = (
      owner: ArchitectureEntity,
      value: unknown,
      pointer: (string | number)[],
    ) => {
      const targets = new Map<
        string,
        { entity: ArchitectureEntity | undefined; name: string }
      >();
      const scan = (v: unknown) => {
        visit();
        if (typeof v === "string")
          for (const token of v.match(
            /[A-Za-z_][A-Za-z_0-9]*(?:::[A-Za-z_][A-Za-z_0-9]*)*/g,
          ) ?? []) {
            const names = typeNames.get(token),
              target =
                names?.length === 1 && !names[0]!.conflictOf
                  ? names[0]
                  : undefined;
            if (target) targets.set(target.id, { entity: target, name: token });
            else if (
              names ||
              (!primitiveNames.has(token) && /^[A-Z]/.test(token))
            ) {
              unknown.add(token);
              targets.set("unresolved:type:" + token, {
                entity: undefined,
                name: token,
              });
            }
          }
        else if (Array.isArray(v)) v.forEach(scan);
        else if (record(v)) Object.values(v).forEach(scan);
        else if (v !== undefined && v !== null)
          unknown.add("<non-text type shape>");
      };
      scan(value);
      for (const [id, target] of targets)
        edges.push({
          from: owner.id,
          to: id,
          targetName: target.name,
          kind: "uses-type",
          order: 0,
          document: catalogue.path,
          pointer,
          binding: "not-applicable",
          unresolved: !target.entity,
        });
    };
    catalogue.value.functions.forEach((f, i) => {
      const owner = functionSources.get(JSON.stringify([catalogue.path, i]))!;
      for (const field of ["args", "returns"])
        if (f[field] !== undefined)
          references(owner, f[field], ["functions", i, field]);
    });
    for (const [name, t] of Object.entries(catalogue.value.types)) {
      const owner = typeSources.get(JSON.stringify([catalogue.path, name]))!;
      if (typeof t === "string") references(owner, t, ["types", name]);
      else if (record(t))
        for (const field of [
          "fields",
          "variants",
          "type",
          "items",
          "element",
          "key",
          "value",
          "target",
        ])
          if (t[field] !== undefined) {
            if (
              t.kind === "enum" &&
              (field === "fields" || field === "variants")
            ) {
              // In declared enum syntax the outer names are cases, not types.
              // Retain only explicitly parenthesized payload references.
              const values = Array.isArray(t[field]) ? t[field] : [t[field]];
              for (const value of values) {
                if (typeof value !== "string") {
                  unknown.add("<unsupported enum shape>");
                  continue;
                }
                if (!value.trim()) continue;
                for (const alternative of value.split("|")) {
                  const variant =
                    /^\s*[A-Za-z_][A-Za-z_0-9]*(?:\(([^()]*)\))?\s*$/.exec(
                      alternative,
                    );
                  if (!variant)
                    unknown.add("<unsupported enum payload syntax>");
                  else if (variant[1]?.trim()) {
                    if (/^[A-Za-z_0-9\s:<>,\[\]&?*]+$/.test(variant[1]))
                      references(owner, variant[1], ["types", name, field]);
                    else unknown.add("<unsupported enum payload syntax>");
                  }
                }
              }
            } else references(owner, t[field], ["types", name, field]);
          }
    }
    if (unknown.size)
      warnings.push(
        `${catalogue.path}: type-reference coverage is incomplete: ${unknown.size} unresolved names or unsupported shapes (examples: ${[...unknown].slice(0, 10).join(", ")}). Impact is a conservative navigation aid, not complete type analysis.`,
      );
  }
  if (!catalogues.length && !entities.length)
    warnings.push(
      "Documents retained; no supported catalogue or structured planning records were found.",
    );
  for (const edge of edges) edge.unresolved = !ids.has(edge.to);
  warnings.push(
    "Retained architecture records are claims; importing them does not prove the claims or that code implements them.",
  );
  const id = documentSetHash(documents);
  return {
    schema: "pymtheg.architecture/v1",
    indexVersion: architectureIndexVersion,
    id,
    entities,
    edges,
    documents,
    warnings,
    measurements: {
      documents: docs.length,
      bytes: total,
      entities: entities.length,
      edges: edges.length,
      indexVisits,
    },
  };
}
export function architectureDetail(
  doc: ArchitectureDocument,
  pointer: (string | number)[],
): unknown {
  if (!doc.path.toLowerCase().endsWith(".json")) {
    if (pointer.length === 0) return doc.text;
    if (
      pointer[0] === "lines" &&
      typeof pointer[1] === "number" &&
      typeof pointer[2] === "number"
    )
      return doc.text.split("\n").slice(pointer[1], pointer[2]).join("\n");
    throw Error("Invalid document section pointer");
  }
  let value: unknown = parseArchitectureJson(doc.text).value;
  for (const part of pointer) {
    if (Array.isArray(value) && typeof part === "number") value = value[part];
    else if (record(value) && Object.hasOwn(value, part)) value = value[part];
    else throw Error("Architecture source pointer is invalid");
  }
  return value;
}
export function affectedEntities(
  index: ArchitectureIndex,
  id: string,
): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of index.edges) {
    const list = incoming.get(e.to) ?? [];
    list.push(e.from);
    incoming.set(e.to, list);
  }
  const seen = new Set<string>([id]),
    queue = [id];
  for (let i = 0; i < queue.length; i++)
    for (const from of incoming.get(queue[i]!) ?? [])
      if (!seen.has(from)) {
        seen.add(from);
        queue.push(from);
      }
  return queue.slice(1);
}
export function compareArchitecture(
  current: ArchitectureIndex,
  previous: ArchitectureIndex,
) {
  const old = new Map(previous.entities.map((e) => [e.id, e])),
    now = new Map(current.entities.map((e) => [e.id, e])),
    oldDocuments = new Map(previous.documents.map((d) => [d.path, d.hash])),
    currentDocuments = new Set(current.documents.map((d) => d.path));
  return {
    changed: current.entities
      .filter((e) => e.kind !== "document")
      .filter(
        (e) => old.has(e.id) && old.get(e.id)!.contentHash !== e.contentHash,
      )
      .map((e) => e.id),
    added: current.entities
      .filter((e) => e.kind !== "document" && !old.has(e.id))
      .map((e) => e.id),
    removed: previous.entities
      .filter((e) => e.kind !== "document" && !now.has(e.id))
      .map((e) => e.id),
    renamed: current.entities
      .filter((e) => old.has(e.id) && old.get(e.id)!.key !== e.key)
      .map((e) => ({ id: e.id, before: old.get(e.id)!.key, after: e.key })),
    removedDocuments: previous.documents
      .filter((d) => !currentDocuments.has(d.path))
      .map((d) => d.path),
    changedDocuments: current.documents
      .filter((d) => oldDocuments.get(d.path) !== d.hash)
      .map((d) => d.path),
  };
}

export function architectureImpact(index: ArchitectureIndex, id: string) {
  const affected = affectedEntities(index, id),
    byId = new Map(index.entities.map((e) => [e.id, e]));
  const direct = new Set(
    index.edges.filter((e) => e.to === id && e.from !== id).map((e) => e.from),
  );
  const planning = affected.filter((key) =>
    byId.get(key)?.id.startsWith("plan:"),
  );
  const planningSet = new Set(planning);
  return {
    direct: affected.filter((key) => direct.has(key) && !planningSet.has(key)),
    transitive: affected.filter(
      (key) => !direct.has(key) && !planningSet.has(key),
    ),
    planning,
  };
}
