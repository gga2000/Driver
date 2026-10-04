# Run Driver on your Mac (one-time setup, ~15 minutes)

You'll install four things once, then every day it's: open Claude Code in the Driver folder → say
"run the studio" → open http://localhost:4000.

## 1. Node.js 22
Go to https://nodejs.org/en/download, pick **v22 (LTS)** in the version menu, choose **macOS
Installer (.pkg)**, download and double-click it. Click through the installer.

Check it: open **Terminal** (⌘ Space → type "Terminal" → Enter) and paste:
```sh
node --version
```
It should print `v22.something`.

## 2. pnpm (the package tool this project uses)
In Terminal:
```sh
sudo corepack enable
```
It asks for your Mac password (typing shows nothing — that's normal). Then `pnpm --version` should
print a number.

## 3. The code
Easiest: install **GitHub Desktop** (https://desktop.github.com), sign in as `gga2000`, then
**File → Clone Repository → gga2000/Driver**. It goes to `Documents/GitHub/Driver`.

(Or in Terminal: `git clone https://github.com/gga2000/Driver.git ~/Documents/GitHub/Driver` — the
first time, macOS offers to install "Command Line Tools"; accept and run the command again.)

Tip: the repository is currently **public**. To make it private: github.com/gga2000/Driver →
Settings → bottom of the page → Change visibility → Private. GitHub Desktop keeps working.

## 4. Claude Code
Either:
- **Claude desktop app** → the **Code** tab → choose the `Documents/GitHub/Driver` folder, or
- **Terminal**:
  ```sh
  curl -fsSL https://claude.ai/install.sh | bash
  ```
  then open a **new** Terminal window and run:
  ```sh
  cd ~/Documents/GitHub/Driver
  claude
  ```
  Sign in with your Claude account when the browser opens.

## 5. First run
Say to Claude Code:

> Install everything and run the studio.

It runs `pnpm install` (a few minutes the first time) and `pnpm studio`. Then open
**http://localhost:4000** in your browser: the customer app, the driver app, the restaurant tablet
and the Console side by side, each on demo data. Sign-in numbers are under each app (the code fills
itself in demo mode). Use the size slider at the top; "افتحه بصفحة لحاله" opens one app full size.

The first start takes 1–2 minutes per app (it prepares each one once); after that, changes appear in
the browser within a second or two.

## Every day
1. Open Claude Code in the Driver folder.
2. "Pull the latest changes and run the studio."
3. Describe what you want to change, e.g. *"On the customer home screen, make the restaurant cards
   bigger and show the delivery time more clearly"* — Claude edits, the browser updates, you look
   and say what's next. Screenshots help: drag one into Claude Code to point at what to change.
4. When you like it: "Commit and push" (the checks run first).

## If something goes wrong
- **"Port … is already in use"**: an old studio is still running. Close the Terminal window that runs
  it (or restart the Mac) and start again.
- **Mac feels slow** (8 GB Macs): run fewer apps at once — tell Claude Code "run the studio for the
  customer app only" (`pnpm studio customer`).
- **An app frame shows an error**: tell Claude Code "the merchant app shows an error in the studio,
  check .studio/logs and fix it".
