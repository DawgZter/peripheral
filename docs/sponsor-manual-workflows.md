# Sponsor Manual Workflows

`.github/workflows/sponsor-manual-tools.yml` is a review-gated entrypoint for sponsor run jobs, separate from push and pull-request automation.

The workflow exposes three target choices:

- `tx-extract`
- `ports`
- `run-waveform`

Each run must pass the confirmation string `SPONSOR-RUN`. The job also uses the `sponsor-review` environment so the repository can add environment reviewers or secrets without changing this file.

## Make Interface

The selected target is called through `make` with the workflow inputs passed as variables:

```sh
make tx-extract \
  SPONSOR_PROFILE=review \
  SPONSOR_INPUT_PATH=fixtures/input \
  SPONSOR_OUTPUT_DIR=out/sponsor \
  SPONSOR_ARGS="key=value"

make ports \
  SPONSOR_PROFILE=review \
  SPONSOR_INPUT_PATH=fixtures/input \
  SPONSOR_OUTPUT_DIR=out/sponsor \
  SPONSOR_ARGS="key=value"

make run-waveform \
  SPONSOR_PROFILE=review \
  SPONSOR_INPUT_PATH=fixtures/input \
  SPONSOR_OUTPUT_DIR=out/sponsor \
  SPONSOR_ARGS="key=value"
```

The public repository ships these stable make targets as sponsor-run interfaces. Each target writes a structured artifact and accepts the profile, input path, output directory, and extra arguments from the workflow.

## Public Boundary

- The workflow checks out repository contents and calls the selected make target.
- It runs only through `workflow_dispatch` with the confirmation string.
- Credential values, local environment files, and display commands stay under the selected operator flow.
- Artifacts are limited to the selected output directory and can be disabled per run.
