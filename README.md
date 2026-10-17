# CtrlEm Image Queue

Run with Node.js 18 or newer:

```bash
npm start
```

Then open <http://localhost:3000>.

## Portable Windows app

Build the single-file Windows executable that opens its own window:

```powershell
npm install
npm run package:window
```

The output is in `dist\CtrlEmImageQueue.exe`. Share that one file; recipients do not need Node.js or a browser installed. Running it opens a native app window directly.

The app uses the documented CtrlEm API:

- A direct 5-character control code is used for the target, so the app does not depend on the users-list endpoint.
- `POST /api/v1/command` with `popupImage`, `changeWallpaper`, or `videoOverlay`.
- Images, GIFs, and videos are sent as public media URLs, so they must be reachable by the target device.
- Queue items are sent sequentially with a three-second delay to respect CtrlEm's per-user cooldown.
- Images, GIFs, and videos can be uploaded directly to ImageChest as unlisted, hidden NSFW-marked posts; the resulting CDN URLs are added to the queue. Choose batch mode for up to 20 files in one post, or individual mode for no batch limit.

The API keys and ImageChest token are kept in the browser and proxied only through the local server; they are not stored on disk.

## ImageChest setup

Create a personal access token from your ImageChest profile's security tab. Select **Batch** to upload up to 20 images in one post, or **Individual** to upload any number one at a time. Both use `privacy=hidden` and `nsfw=true`; individual titles use `{filename}+#1`, `{filename}+#2`, and so on. ImageChest calls `hidden` the unlisted option.
