# File Router

A local Node.js app that reads structured text-file headers, previews metadata-based organization, and schedules archive moves.

## Run

Install Node.js 18 or newer, then open a terminal in this folder:

```powershell
npm start
```

Open http://127.0.0.1:4173. To run the routing tests, use `npm test`.

The default input is `file_router/input`. The app writes organized files to `file_router/organized` and archives due files under `file_router/archive`. Folder paths, naming patterns, and the default archive date are configurable in the UI.

## Workflow

1. Scan the input folder and review metadata and destination previews.
2. Set one default archive date or enter a different date per file.
3. Select files and apply. Files with invalid metadata, missing dates, or existing destinations are not moved.
4. Leave the server running for scheduled archive checks. Due files are checked at startup and once per minute.

Routes use only the first metadata header fields: `Document-ID`, `Project`, `Type`, `Date`, `Status`, and `Title`. Filename and folder templates accept these fields plus `{year}`, `{month}`, and `{day}`. App settings and the move manifest are stored in the ignored-at-runtime `.file-router-data` folder.