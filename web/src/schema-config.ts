// SPDX-License-Identifier: MIT
import { z } from "zod";

// Studio's CSP disallows eval. Use the interpreter before any schema parsing.
z.config({ jitless: true });
