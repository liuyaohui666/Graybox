# Silent desktop launch — 2026-10-08

Follow-up: at the user's request, the local delivery folder and its desktop shortcut were moved to the Recycle Bin, and only the owned local API and isolated PostgreSQL cluster were stopped. Local database files and source remain for recovery/development. The installer now defaults to cloud only; local launcher creation requires explicit `-IncludeLocal` and an existing local delivery folder.

The delivered shortcuts targeted batch files, and the native debug binary used the console subsystem. Both could display a command window.

The application now uses the Windows GUI subsystem for non-test builds, including the current debug delivery. `scripts/install-desktop-launchers.ps1` validates that PE subsystem, stages a separately named executable without replacing the user's running old process, and creates Windows Script Host entrypoints and desktop shortcuts.

- Desktop **Graybox**: cloud client with the configured HTTPS server; removes inherited local credential/environment selection. Starts only the GUI executable, without local database or API startup.
- Desktop **Graybox 本地版**: existing local development mode, starts its PowerShell bootstrap hidden and then the GUI. Failed bootstrap shows a normal error dialog pointing to the diagnostic command file.
- `Start-Graybox.cmd` remains an explicitly chosen diagnostic entrypoint with a visible console.

Validation: native build passed; installer PowerShell parsed successfully; both staged binaries have PE subsystem 2 and matching SHA-256 `6260EC1D0E6E767E2F4DCA86299395935645383E5CF684D96E4E3AA73CFEEA50`. Shortcut readback points to `wscript.exe` and the corresponding VBS. Cloud launch created a responding Graybox window and its WebView2 child, without a shell child. Native screenshots are unavailable to the current tools; no claim of visual acceptance or successful cloud login is made. The old local window and its draft were left open. Server code and data are unchanged by this delivery.
