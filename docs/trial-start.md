# Run the functional trial

The current build is ready for the manual trial. Karl stopped the review/polish
cycle on 10 November 2026. Review 37 was interrupted without a replacement;
its unfinished evidence is preserved. Independent 9.5 sign-off is not claimed
and is not a prerequisite for this trial.

Use the project and actual plans you want to test. No reinstall or rebuild is
needed on this PC. Replace the example project path below:

```sh
cd /home/user/.t3/projects/pymtheg
TRIAL_PROJECT="/absolute/path/to/your/trial-project"
./pymtheg init "$TRIAL_PROJECT" --import-docs
./pymtheg studio "$TRIAL_PROJECT"
```

Open the printed session URL in Firefox. Keep that terminal running; Ctrl+C
stops Studio. Initialization preserves existing project configuration and
designs. `--import-docs` retains supported existing design documents in planning
history. It does not turn prose into a verified model.

1. Open **Architecture** and confirm your real plans are present. Use **Import
   documents** for plans outside the normal documentation folders, or **Add
   planning record** for the requirement you want to exercise.
2. Use **Connect agent** to obtain the MCP configuration for this project. The
   server command is `/home/user/.t3/projects/pymtheg/pymtheg mcp
   /absolute/path/to/your/trial-project`. Verification and simulation use the
   built-in engines; nothing else needs configuring.
3. Give the agent one real planned workflow. Ask it to model that workflow in
   `.pym`, link it to the requirement, check it, replay any returned
   counterexample and propose the minimum correction. Save only changes you
   explicitly accept. Review incomplete results as incomplete.
4. Close and reopen Studio to confirm the saved plan, model and links persist.
   If implementation review is part of your trial, capture only the relevant
   TypeScript/JavaScript files in **Plan & code graphs**, link a declaration,
   then make one known code change and refresh the observation.

Record failures that stop the workflow, lose work, crash, or give an incorrect
result, together with the input and expected/actual behavior. Cosmetic changes
and feature ideas are backlog items. No new audit, polish or feature work starts
automatically after this handoff.

Host prerequisite check: `./pymtheg doctor` reports Node 24 or newer, the built-in
verifier and simulator, storage, the Go, Rust and TypeScript code graph and the
built Studio. (Earlier trials
also used Java, TLC and Quint; R1-A removed them.) Candidate 37 and previous test
evidence remain available under `evidence/`.
