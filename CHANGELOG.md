# Changelog

## Unreleased

### Added

- Added a local Web UI with task, queue, schedule, log, file, and artifact views.
- Added `drift web` options for LAN access and read-only mode.
- Added Web task management actions for enqueue, cancel, stop, resume, rerun, abandon, remove, and history cleanup.
- Added Task Create Assistant in the Web UI with draft directories, assistant rounds, manual editing, and file upload support.
- Added the built-in `general` task type as the default creation type.

### Changed

- Changed non-running task removal rules so any task except `running` can be deleted directly.
- Changed content-generating tasks to default toward file artifacts: creation assistants now describe file output by default, and runners now expect the final content to be written to files and listed in `artifactRefs` unless the task explicitly says otherwise.
- Changed Web task details to organize content into clearer sections with run history, tail-style log viewing, and task file browsing.

### Notes

- Web creation currently covers **Task** creation only. `Schedule Create Assistant` remains a follow-up phase.
- `drift web` remains a local control surface; it does not replace `drift start` for orchestrator / scheduler execution.
