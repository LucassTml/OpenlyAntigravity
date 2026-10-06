# Antigravity (agy) Plugin for OpenCode

Use **Antigravity CLI (`agy`)** models (Gemini, Claude, GPT-OSS) directly in **OpenCode**'s model selector, using the login you already have in `agy`. **No API key is required.**

> Tested with **OpenCode 2.0.19** and **agy 1.2.13** on Windows 11.

## What's in this folder

| File | What it is for |
|---|---|
| `agy/` | The plugin itself (5 files). This is the folder that goes into OpenCode's configuration. |
| `install.ps1` | Installer for **Windows** |
| `install.sh` | Installer for **macOS / Linux** |
| `enable-image-permissions.ps1` | Optional (Windows): lets agy generate images, download web images and move files — see [Images](#images-generate-download-and-organize-windows) |
| `opencode.example.json` | Example of the configuration used by the plugin |
| `README.md` | This tutorial |

---

## 1. Prerequisites

1. **OpenCode 2.x** installed. Check in the terminal:
   ```
   opencode --version
   ```
   It must output `v2.something`. If it outputs `1.x`, update it with `opencode upgrade`.

2. **Antigravity CLI (`agy`)** installed **and logged in**. Run `agy` once in the terminal and sign in when asked. Then check:
   ```
   agy models
   ```
   If a list of models appears (`gemini-3.1-pro-high`, `claude-sonnet-4-6`, etc.), you are good to go.

## 2. Installation

### Windows (automatic, recommended)

1. Extract the zip file anywhere.
2. Open the extracted folder, right-click on an empty space, and choose **"Open in Terminal"**.
3. Paste and run:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
4. **Close and reopen OpenCode.** If you already had a previous version of this plugin, also run `opencode service restart` once.
5. *(Optional)* To let agy generate images, find images on the web and move files, also run:
   ```
   powershell -ExecutionPolicy Bypass -File .\enable-image-permissions.ps1
   ```
   See [Images](#images-generate-download-and-organize-windows) for what it allows.

The installer checks the prerequisites, copies the plugin, and adds the configuration to your `opencode.json`. If `opencode.json` already existed, it creates a backup first (`opencode.json.bak-agy`).

### macOS / Linux

```
sh install.sh
```

Then close and reopen OpenCode.

### Manual (any OS)

1. Copy the **`agy`** folder into the `plugins` folder inside OpenCode's configuration:
   - Windows: `%USERPROFILE%\.config\opencode\plugins\`
   - macOS / Linux: `~/.config/opencode/plugins/`

   The result must be `...\.config\opencode\plugins\agy\server.js` (and not `plugins\agy\agy\server.js`).
2. In the `.config\opencode` folder, open `opencode.json` and add the `"agy"` block inside `"providers"`, just like in `opencode.example.json`. If `opencode.json` doesn't exist, copy `opencode.example.json` there and rename it to `opencode.json`.

> OpenCode 2 automatically loads any folder placed in `plugins/`. You do not need to register the plugin anywhere else.

## 3. How to use

- **In OpenCode:** type `/models`, look for the **Antigravity (agy)** group, and choose a model.
- **Via command line:**
  ```
  opencode run -m agy/gemini-3.1-pro-high "your question here"
  ```
- **Set as default model:** add this line at the beginning of `opencode.json`:
  ```json
  "model": "agy/gemini-3.1-pro-high",
  ```
- **Obsidian:** Obsidian extensions that use OpenCode work the same way. The vault folder is the session folder, so agy can read and edit notes in the vault.

The model list comes from `agy` itself and updates automatically when OpenCode opens. If agy gets a new model, it will appear here.

> ⏱️ Each response takes about 5 to 10 seconds to start, because `agy` is launched for every message. Claude models via agy may take up to 30 seconds.

## 4. Permissions (what agy can do on your PC)

`agy` is an agent: it uses its own tools to read files, edit files, and run commands. Inside OpenCode it runs in the background, so **it cannot ask you for authorization**. Anything that is not explicitly allowed is **automatically denied**, and the plugin shows what was blocked and how to allow it in the response.

This is controlled by the `"permissions"` option in `opencode.json`:

| `"permissions"` | Read and write files **in the open folder** | Other folders | Terminal commands |
|---|---|---|---|
| `"edit"` **(default)** | ✅ | ❌ (only those in `addDirs`) | ❌ |
| `"read-only"` | read only | ❌ | ❌ |
| `"skip"` | ✅ | ✅ | ✅ **everything, without asking** |

"Open folder" is the folder where you opened OpenCode (or the vault, in Obsidian). agy only acts when you ask for something; the permission simply defines how far it can go.

### Allowing other folders (two ways, choose one)

**a) Via the plugin**, in `opencode.json` (applies only inside OpenCode):

```json
"addDirs": ["C:/Users/YourName/Documents/Notes"]
```

**b) Via agy itself**, in its `settings.json`, following the [official permissions documentation](https://antigravity.google/docs/permissions). This applies to OpenCode and also when you use `agy` in the terminal. The file is located at:

- Windows: `%USERPROFILE%\.gemini\antigravity-cli\settings.json`
- macOS / Linux: `~/.gemini/antigravity-cli/settings.json`

Complete and **valid** example for Windows. Replace `YourName` with your user folder name and keep any other keys that already exist in the file, such as `"model"`:

```json
{
  "model": "Gemini 3.1 Pro (High)",
  "permissions": {
    "allow": [
      "write_file(C:/Users/YourName/Documents)",
      "write_file(C:/Users/YourName/OneDrive/Documents)",
      "command(git status)"
    ],
    "deny": [
      "command(rm -rf)"
    ],
    "ask": []
  }
}
```

Rules that work:
- `write_file(folder)` allows writing **and** reading everything inside the folder, including subfolders.
- `read_file(folder)` allows read-only access.
- `command(command)` allows **only that exact command**, with no arguments (e.g., `command(git status)`). To accept arguments, use a regex (see the Images section below).
- `mcp(server/tool)` and `read_url(domain)` are also accepted.

On Windows, write paths using `/` (e.g., `C:/Users/...`). This format has been tested. Names like `"ReadFile"` or `"WriteToFile"` **do not work**.

> ⚠️ **The example on the Google page is just for illustration.** Rules like `read_file(/var/log/app)`, `write_file(src/)`, and `mcp(linter/*)` have nothing to do with your files. Do not copy the entire example: write rules with **your** folders.

> ⚠️ **Be careful with JSON.** A missing or extra comma (for example `],` right before a `}`) makes agy **ignore the entire file silently**, including your default model and all permissions. After editing, check it with a validator (e.g., jsonlint.com) or look for the word `malformed` in the `cli.log` file, located in the same folder.

> ⚠️ **`"skip"`** lets agy run **any** command on your PC without asking, including deleting files. Use only if you know what you are doing.

### Images: generate, download and organize (Windows)

To let agy **generate images**, **find and download images from the web** and **copy, move or rename files** (for example, to put images into a `.md` note), it needs extra rules in **agy's own** `settings.json`. That file belongs to each computer, so installing the plugin is not enough: run this once on every PC, in the repository folder:

```
powershell -ExecutionPolicy Bypass -File .\enable-image-permissions.ps1
```

The script backs up the file first, uses your own user folders, and does not duplicate rules if you run it again. If you prefer to do it by hand, add these rules to the `"allow"` list in agy's `settings.json`, replacing `YourName`:

```json
"write_file(C:/Users/YourName/Documents)",
"read_file(C:/Users/YourName/.gemini/antigravity-cli/brain)",
"read_url(*)",
"command(regex:^Copy-Item( [^;|&`$(){}<>]*)?$)",
"command(regex:^Move-Item( [^;|&`$(){}<>]*)?$)",
"command(regex:^Rename-Item( [^;|&`$(){}<>]*)?$)",
"command(regex:^New-Item -ItemType Directory( [^;|&`$(){}<>]*)?$)",
"command(regex:^Get-ChildItem( [^;|&`$(){}<>]*)?$)",
"command(regex:^Invoke-WebRequest( [^;|&`$(){}<>]*)?$)"
```

What each rule allows:
- The `brain` folder is where agy stores images it generates, before copying them to your folder.
- `read_url(*)` lets it read web pages.
- The `command(regex:...)` rules allow **only** copying, moving, renaming, creating folders, listing and downloading files. The `[^;|&...]` part blocks chaining other commands (e.g. `Copy-Item a b; Remove-Item ...` is denied). **Deleting files and any other command stay blocked.**

The plugin already tells agy to use exactly these simple commands. Then just ask, for example: *"generate an image of a circuit and add it to this note"* or *"find an image of a transistor online, download it into an images folder and add it to the .md"*.

> Note: `Invoke-WebRequest` downloads files from the internet, and `read_url(*)` lets agy read any website. Web pages can contain malicious instructions aimed at AIs, so review what it did when you ask for things from the web.

## 5. All options

Everything goes under `providers.agy.settings` in `opencode.json`. OpenCode automatically reloads when you save the file; if it doesn't, restart it.

| Option | Values | What it does |
|---|---|---|
| `permissions` | `"edit"` (default), `"read-only"`, `"skip"` | See section 4 |
| `addDirs` | list of folders | Extra folders where agy can read and write |
| `effort` | `"low"`, `"medium"`, `"high"`, `"max"` | How much the model "thinks" (when the model supports it) |
| `mode` | `"plan"` | Uses agy's planning mode instead of editing mode |
| `agyPath` | executable path | Use if `agy` is not found automatically |
| `printTimeout` | e.g.: `"15m"` | Maximum time per response |
| `toolActivity` | `"reasoning"` (default), `"off"` | Shows (or hides) the tools agy used, like "Thinking" |
| `system` | `"wrap"` (default), `"omit"` | Sends (or omits) OpenCode and your AGENTS.md instructions to agy |
| `resume` | `true` (default), `false` | Continues the agy conversation between messages instead of resending the whole history |
| `titles` | `"agy"` | Generates session titles using agy (by default titles are generated locally, saving quota) |
| `debug` | `true` | Logs complete prompts to the log file |

You can also adjust a specific model, for example its context size:

```json
"providers": {
  "agy": {
    "settings": { "permissions": "edit" },
    "models": {
      "gemini-3.1-pro-high": { "limit": { "context": 500000 } }
    }
  }
}
```

## 6. Checking if it worked

```
opencode plugin list
```
It should show a line `agy   local   ...\plugins\agy\server.js`.

```
opencode models
```
It should list `agy/gemini-...`, `agy/claude-...`, etc.

```
opencode run -m agy/gemini-3.8-flash-low "Answer only: ok"
```
It should answer `ok`.

## 7. Common problems

| Symptom | Cause and solution |
|---|---|
| The `agy/...` models don't appear | Check if `opencode --version` is 2.x, if the file is at `.config\opencode\plugins\agy\server.js`, and if `agy models` works in the terminal. Then restart OpenCode. |
| "agy is not signed in" | Run `agy` in the terminal and sign in again. |
| "Could not start agy" | agy is not in the PATH. Put `"agyPath": "C:/path/to/agy.exe"` in the settings. On Windows it's usually at `%LOCALAPPDATA%\agy\bin\agy.exe`. |
| "…not allowed to use: WriteToFile" | agy tried to write outside the open folder, or is in `read-only` mode. Open OpenCode in the right folder, allow the folder (section 4), or switch to `"edit"`. |
| It keeps denying even after installing or updating the plugin | The OpenCode service is still running an old version. Run `opencode service restart` once. Closing the app is not enough because the service keeps running in the background. |
| In an old session, agy doesn't even try to write | It "remembers" it was denied before. Ask again ("try again now") or open a new session. |
| "…not allowed to use: RunCommand" | Commands are blocked by default. See section 4. |
| agy ignores its settings | agy's `settings.json` has a syntax error. Search for `malformed` in `%USERPROFILE%\.gemini\antigravity-cli\cli.log` and fix the JSON (it's almost always a comma). |
| "agy does not offer this model any more" | The model was removed from agy. Restart OpenCode to update the list. |
| Quota or rate limit error | It's your Antigravity account limit. Wait a bit or switch models. |
| Slow response | It's normal: agy is launched for every message and sends about 12k tokens of its own instructions. Flash models are the fastest. |

**Plugin log** (every message and error):
- Windows: `%USERPROFILE%\.local\share\opencode\log\agy-provider.log`
- macOS / Linux: `~/.local/share/opencode/log/agy-provider.log`

With `"debug": true`, the log also keeps the full prompts.

## 8. How it works

1. **`server.js`** is the OpenCode plugin. It runs `agy models`, registers each model as `agy/<id>`, and reports the folder for each session.
2. **`provider.js`** is the entry point OpenCode loads for the provider. It is minimal and reloads `model.js` and `agy.js` whenever these files change, so plugin updates take effect on the next message without restarting.
3. **`model.js`** is the "model" itself. For every message, it launches `agy` in the session's folder, sends the prompt via stdin, and streams the response back in real time.
4. **`agy.js`** handles the `agy` process: finds the executable, applies permissions, reads output, translates errors into clear messages, and writes the log.

Authentication is always your `agy`'s: the plugin never reads or stores keys or passwords.

## 9. Limitations

- OpenCode's own tools are not used: agy uses its own, which appear as "Thinking" in the response.
- Images and attachments are not sent to agy, only text.
- Every message includes about 12k tokens of agy's own instructions, which count against your quota.

## 10. Uninstalling

1. Delete the `.config\opencode\plugins\agy` folder.
2. Remove the `"agy"` block from `"providers"` in `opencode.json`.
3. (Optional) Delete `agy-models.json` and `agy-conversations.json` in `%USERPROFILE%\.cache\opencode\` (on macOS/Linux, `~/.cache/opencode/`).
