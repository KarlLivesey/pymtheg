import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { z } from "zod";
const checkSchema = z.object({
  source: z.string(),
  extension: z.string(),
  instructions: z.string(),
  snapshotId: z.string(),
  guarantee: z.literal("compiler-input-only"),
});
export function ImplementationCheck({
  runId,
  target,
}: {
  runId: string;
  target: "typescript" | "rust" | "go";
}) {
  const [contracts, setContracts] = useState(
    target === "rust" ? "crate::contracts" : "./contracts",
  );
  const [implementationModule, setImplementationModule] =
    useState("./implementation");
  const [implementationType, setImplementationType] = useState("");
  const [result, setResult] = useState<z.infer<typeof checkSchema> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const previousRun = useRef(runId);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const changed = previousRun.current !== runId;
    previousRun.current = runId;
    request.current?.abort();
    request.current = null;
    setResult(null);
    setError(
      changed && (busy || result)
        ? "The checked design changed. Your settings are kept; preview the implementation check again."
        : "",
    );
    setBusy(false);
  }, [runId]);
  const invalidate = () => {
    request.current?.abort();
    request.current = null;
    setResult(null);
    setBusy(false);
  };
  return (
    <section aria-label="Check a handwritten implementation">
      <h4>Connect your implementation to these contracts</h4>
      <p>
        Generate a separate file for your normal build to check. This checks
        signatures, including added inputs; it does not check business
        behaviour.
      </p>
      {target !== "go" && (
        <label>
          Generated contracts module
          <input
            className="text-input"
            value={contracts}
            onChange={(e) => {
              invalidate();
              setContracts(e.target.value);
            }}
          />
        </label>
      )}
      {target === "typescript" && (
        <label>
          Implementation module
          <input
            className="text-input"
            value={implementationModule}
            onChange={(e) => {
              invalidate();
              setImplementationModule(e.target.value);
            }}
          />
        </label>
      )}
      {target === "go" && (
        <p>
          Keep the check file in the same package as your contracts and
          implementation.
        </p>
      )}
      <label>
        Implementation type
        <input
          className="text-input"
          value={implementationType}
          placeholder={
            target === "rust"
              ? "crate::PaymentService"
              : target === "go"
                ? "*PaymentService"
                : "PaymentService"
          }
          onChange={(e) => {
            invalidate();
            setImplementationType(e.target.value);
          }}
        />
      </label>
      <button
        type="button"
        className="button secondary"
        disabled={busy || !implementationType.trim()}
        onClick={() => {
          request.current?.abort();
          const controller = new AbortController();
          request.current = controller;
          setBusy(true);
          setError("");
          setResult(null);
          void api(
            "implementation-check",
            {
              id: runId,
              options: {
                target,
                ...(target !== "go" ? { contractsModule: contracts } : {}),
                ...(target === "typescript" ? { implementationModule } : {}),
                implementationType: implementationType.trim(),
              },
            },
            controller.signal,
          )
            .then((value) => {
              if (!controller.signal.aborted)
                setResult(checkSchema.parse(value));
            })
            .catch((e) => {
              if (!controller.signal.aborted) setError(String(e));
            })
            .finally(() => {
              if (request.current === controller) request.current = null;
              if (!controller.signal.aborted) setBusy(false);
            });
        }}
      >
        {busy ? "Preparing check…" : "Preview implementation check"}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <p>{result.instructions}</p>
          <pre>{result.source}</pre>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([result.source], { type: "text/plain" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "implementation" + result.extension;
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download implementation check
          </button>
          <p>
            No compiler has been run by this preview. Run your build after
            adding the file.
          </p>
        </div>
      )}
    </section>
  );
}
