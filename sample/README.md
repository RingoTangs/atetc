# Production PAK fixtures

This directory contains real production AskTao PAK samples used for
compatibility regression testing and PAK format research.

The current samples come from AAA, CCS, CSA, DBA, and GS. They verify parsing,
validation, payload reading, unpacking, reference-preserving rebuilds, and
format analysis against production archives.

Ordinary unit tests generate synthetic fixtures dynamically with `buildPak()`.
No additional synthetic fixture files are stored in this directory.
