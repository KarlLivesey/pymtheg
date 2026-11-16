// SPDX-License-Identifier: MIT
import { z } from "zod";

const name = z.string().max(120);
const expression = z.string().max(1000);
export const machineDefinitionSchema = z
  .object({
    kind: z.literal("machine"),
    name,
    states: z
      .array(
        z
          .object({
            name,
            type: z.enum(["Bool", "Nat", "Int"]),
            min: z.string().max(30),
            max: z.string().max(30),
            initial: expression,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    events: z
      .array(
        z
          .object({
            name,
            guard: expression,
            updates: z
              .array(z.object({ state: name, value: expression }).strict())
              .max(20),
          })
          .strict(),
      )
      .max(20),
    invariants: z.array(z.object({ name, expression }).strict()).max(20),
  })
  .strict();
export type MachineDefinition = z.infer<typeof machineDefinitionSchema>;
