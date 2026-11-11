// Frozen pre-W2-I reference, compiled from 397c5e7. Test-only.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { compare, contentHash, validateResult } from "../../../../dist/graph/identity.js";
import { resolutionFacts } from "./analysis.mjs";
import { matchesPattern } from "../../../../dist/graph/registry.js";
const message = (error) => error instanceof Error ? error.message : String(error);
const failure = (detail) => ({
    status: "failed",
    diagnostics: [{ message: detail }],
    symbols: [],
    links: [],
});
const needsContext = (module, path) => module.contextFiles?.some((pattern) => matchesPattern(path, pattern)) ??
    false;
export async function indexProject(root, registry, store, options = {}) {
    const report = {
        discovered: 0,
        claimed: 0,
        indexed: 0,
        unchanged: 0,
        removed: 0,
        analyzed: 0,
        symbols: 0,
        links: 0,
        unresolved: 0,
        ambiguous: 0,
        contextFiles: 0,
        unclaimedCount: 0,
        failedCount: 0,
        partialCount: 0,
        unclaimed: [],
        failed: [],
        partial: [],
        ignoredSymlinks: [],
        errors: [],
        analysisErrors: [],
        resolutionErrors: [],
    };
    const paths = [];
    const excluded = new Set([
        ".git",
        "node_modules",
        ".codegraph",
        ...(options.excludeDirectories ?? []),
    ]);
    async function walk(directory) {
        const entries = await readdir(join(root, directory), {
            withFileTypes: true,
        });
        for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
            const path = directory ? `${directory}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink())
                report.ignoredSymlinks.push(path);
            else if (entry.isDirectory()) {
                if (!excluded.has(entry.name))
                    await walk(path);
            }
            else if (entry.isFile() && !options.excludeFiles?.includes(path))
                paths.push(path);
        }
    }
    await walk("");
    paths.sort(compare);
    // Storage reads are deliberately outside all source/module error catches, before any writes.
    const oldFiles = await store.files();
    const oldContexts = await store.contexts();
    const claims = new Map();
    const previous = new Map();
    for (const path of paths) {
        report.discovered++;
        let module;
        try {
            module = registry.claim(path);
        }
        catch (error) {
            report.failed.push(path);
            report.errors.push({ path, message: message(error) });
            continue;
        }
        if (module) {
            claims.set(path, module);
            previous.set(path, await store.getFile(path));
            report.claimed++;
        }
        else if (!registry.modules.some((module) => needsContext(module, path)))
            report.unclaimed.push(path);
    }
    const captures = new Map();
    for (const path of paths)
        if (claims.has(path) ||
            registry.modules.some((module) => needsContext(module, path))) {
            let hash = "";
            let text = "";
            let diagnostic;
            try {
                const bytes = await readFile(join(root, path));
                hash = contentHash(bytes);
                try {
                    text = new TextDecoder("utf-8", {
                        fatal: true,
                        ignoreBOM: true,
                    }).decode(bytes);
                }
                catch {
                    throw Error("Unsupported source encoding: expected valid UTF-8");
                }
            }
            catch (error) {
                diagnostic = message(error);
                report.errors.push({ path, message: diagnostic });
            }
            captures.set(path, {
                path,
                text,
                hash,
                status: diagnostic ? "failed" : "clean",
                diagnostics: diagnostic ? [{ message: diagnostic }] : [],
            });
        }
    const contexts = [...captures.values()].filter((file) => registry.modules.some((module) => needsContext(module, file.path)));
    const changedContexts = [
        ...new Set([
            ...oldContexts.map((file) => file.path),
            ...contexts.map((file) => file.path),
        ]),
    ]
        .filter((path) => JSON.stringify(oldContexts.find((file) => file.path === path)) !==
        JSON.stringify(contexts.find((file) => file.path === path)))
        .sort(compare);
    const updates = [];
    const changed = new Set();
    for (const [path, module] of claims) {
        const source = captures.get(path);
        const old = previous.get(path);
        if (source.status === "clean" &&
            old?.hash === source.hash &&
            old.module === module.id &&
            old.version === module.version &&
            old.result.status !== "failed") {
            report.unchanged++;
            continue;
        }
        let result;
        if (source.status === "failed")
            result = failure(source.diagnostics[0].message);
        else if (!module.parse)
            result = failure("Awaiting project analysis");
        else {
            try {
                result = await module.parse({ path, text: source.text });
                validateResult(source.text, result);
            }
            catch (error) {
                const detail = message(error);
                report.errors.push({ path, message: detail });
                result = failure(detail);
            }
        }
        updates.push({
            path,
            text: source.text,
            hash: source.hash,
            module: module.id,
            version: module.version,
            result,
        });
        changed.add(path);
    }
    await store.replaceContexts(contexts);
    for (const file of updates) {
        await store.replaceFile(file);
        report.indexed++;
    }
    for (const file of oldFiles)
        if (!claims.has(file.path)) {
            await store.removeFile(file.path);
            changed.add(file.path);
            report.removed++;
        }
    for (const module of registry.modules)
        if (module.analyze) {
            const files = (await store.files()).filter((file) => file.module === module.id);
            const ownContexts = contexts.filter((file) => needsContext(module, file.path));
            let results;
            try {
                if (ownContexts.some((file) => file.status === "failed"))
                    throw Error("Project context could not be captured");
                results = await module.analyze({
                    projectId: store.projectId,
                    files,
                    contextFiles: ownContexts,
                    changedFiles: [...changed]
                        .filter((path) => files.some((file) => file.path === path) ||
                        oldFiles.some((file) => file.path === path && file.module === module.id))
                        .sort(compare),
                    changedContextFiles: changedContexts.filter((path) => needsContext(module, path)),
                });
                const seen = new Set();
                for (const item of results) {
                    const file = files.find((file) => file.path === item.path);
                    if (!file || seen.has(item.path))
                        throw Error("Project analysis returned a duplicate or foreign file");
                    if (captures.get(item.path)?.status === "failed")
                        throw Error("Project analysis cannot clean an unreadable source");
                    validateResult(file.text, item.result);
                    seen.add(item.path);
                }
                if (!module.parse &&
                    files.some((file) => captures.get(file.path)?.status !== "failed" &&
                        !seen.has(file.path)))
                    throw Error("Analyze-only modules must return every readable captured file");
            }
            catch (error) {
                const detail = message(error);
                report.analysisErrors.push({ module: module.id, message: detail });
                results = files.map((file) => ({
                    path: file.path,
                    result: failure(detail),
                }));
            }
            for (const item of results) {
                const file = files.find((file) => file.path === item.path);
                if (JSON.stringify(file.result) !== JSON.stringify(item.result))
                    await store.replaceFile({ ...file, result: item.result });
                report.analyzed++;
            }
        }
    const files = await store.files();
    const symbols = await store.findSymbols();
    const links = await store.links();
    for (const module of registry.modules) {
        const ownContexts = contexts.filter((file) => needsContext(module, file.path));
        const own = links
            .filter((link) => link.module === module.id && link.origin === "parse")
            .map((link) => ({
            ...link,
            targetId: null,
            targetStatus: null,
            candidates: [],
            resolution: "unresolved",
        }));
        let result = { resolutions: [], links: [] };
        try {
            if (ownContexts.some((file) => file.status === "failed") ||
                report.analysisErrors.some((error) => error.module === module.id))
                throw Error("Project analysis/context is incomplete");
            const output = (await module.resolve?.({
                projectId: store.projectId,
                files,
                contextFiles: ownContexts,
                symbols,
                links: own,
            })) ?? [];
            result = Array.isArray(output)
                ? { resolutions: output, links: [] }
                : output;
            resolutionFacts(store.projectId, module.id, result, files, symbols, links);
        }
        catch (error) {
            report.resolutionErrors.push({
                module: module.id,
                message: message(error),
            });
            result = { resolutions: [], links: [] };
        }
        // Storage errors propagate; they are not mislabeled as module failures.
        await store.replaceAnalysis(module.id, result);
    }
    for (const file of files)
        if (file.result.status !== "clean")
            report[file.result.status].push(file.path);
    for (const file of contexts)
        if (file.status === "failed")
            report.failed.push(file.path);
    report.failed = [...new Set(report.failed)].sort(compare);
    report.partial.sort(compare);
    report.unclaimed.sort(compare);
    report.contextFiles = contexts.length;
    report.unclaimedCount = report.unclaimed.length;
    report.failedCount = report.failed.length;
    report.partialCount = report.partial.length;
    report.symbols = (await store.findSymbols()).length;
    report.links = (await store.links()).length;
    report.unresolved = (await store.unresolved()).length;
    report.ambiguous = (await store.ambiguous()).length;
    return report;
}
//# sourceMappingURL=indexer.js.map