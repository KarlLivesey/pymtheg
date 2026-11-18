// SPDX-License-Identifier: MIT
import { join } from "node:path";

export async function goMapKeyReader(createTagsParser, root) {
  let keys;
  const parser = await createTagsParser({
    wasmPath: join(root, "grammars", "go", "tree-sitter-go.wasm"),
    query: "(composite_literal type: (map_type) body: (literal_value (keyed_element key: (_) @key)))",
    secondPass({ matches }) {
      keys = matches.flatMap((match) => match.captures.flatMap(({ node }) => {
        const key = node.type === "literal_element" ? node.firstNamedChild : node;
        return key?.type === "identifier" ? [{ name: key.text, start: key.startIndex }] : [];
      }));
    },
  });
  return (text) => {
    keys = [];
    parser.parse(text);
    return keys;
  };
}

export function typescriptShapes(ts, source, names) {
  const nested = new Set();
  const functions = new Map();
  const aliases = new Map();
  const variables = new Map();
  const shorthand = [];
  const members = [];
  const withinFunction = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent)) return true;
    return false;
  };
  const scopeOf = (node) => {
    let scope = node.parent;
    while (scope && !ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isModuleBlock(scope)) scope = scope.parent;
    return scope;
  };
  const typeMembers = (node) => new Set(node.members.flatMap((member) =>
    member.name && ts.isIdentifier(member.name) ? [member.name.text] : []));
  const visit = (node) => {
    const name = node.name;
    if (name && ts.isIdentifier(name) && names.get(name.text) === 1) {
      if (ts.isFunctionDeclaration(node) && node.body ||
          ts.isVariableDeclaration(node) && node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        functions.set(name.text, scopeOf(node));
        if (withinFunction(node)) nested.add(name.text);
      }
      if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) aliases.set(name.text, typeMembers(node.type));
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.type) variables.set(name.text, node.type);
    }
    if (ts.isShorthandPropertyAssignment(node)) shorthand.push(node);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) members.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const omittedCandidates = [];
  const objectMembers = new Set();
  for (const site of shorthand) {
    const scope = functions.get(site.name.text);
    if (scope && scope.pos <= site.pos && site.end <= scope.end) {
      omittedCandidates.push({ family: "ts-shorthand-function", name: site.name.text, start: site.name.getStart(source) });
    }
  }
  for (const site of members) {
    const type = variables.get(site.expression.text);
    const properties = type && (ts.isTypeLiteralNode(type) ? typeMembers(type) :
      ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) ? aliases.get(type.typeName.text) : null);
    if (properties?.has(site.name.text)) {
      const start = site.name.getStart(source);
      objectMembers.add(start);
      omittedCandidates.push({ family: "ts-object-member", name: site.name.text, start });
    }
  }
  return { nested, omittedCandidates, objectMembers };
}
