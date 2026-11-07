# Chemical Modelling documentation

[Project overview](../README.md)

| Task | Guide |
| --- | --- |
| Install and start the workstation | [Getting started](GETTING_STARTED.md) |
| Build or run the desktop app | [Desktop app](DESKTOP.md) |
| Understand the backend, frontend and API | [Architecture](ARCHITECTURE.md) |
| Interpret orbitals, methods and units | [Methodology](METHODOLOGY.md) |
| Understand approximations and unavailable features | [Limitations](LIMITATIONS.md) |
| Review recorded scientific checks | [Validation](VALIDATION.md) |
| See what is implemented or planned | [Roadmap](ROADMAP.md) |
| Continue implementation work | [Handoff](HANDOFF.md) |

The implemented workspaces are the Atomic Explorer and Molecular Builder.
Crystals, alloys, compound discovery and molecular dynamics remain planned.
The installed backend exposes its generated API reference at
http://127.0.0.1:8000/docs.

Hydrogen-like analytic orbitals, HF/DFT electronic structure, force-field
geometries and optional xTB calculations have different assumptions. Read the
methodology and limitations before comparing their outputs. Existing validation
reports describe prior runs rather than a new scientific calculation in this
documentation review.
