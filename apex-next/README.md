# APEX RUSH NEXT — Setup & User Manual

A 3D arcade street, off-road, and highway racing game with drift-charged NOS and online multiplayer for up to **8 players**.

---

## 1. Before You Start

Make sure you have:
- **Node.js (LTS)** installed (this includes `npm`): [https://nodejs.org](https://nodejs.org)
- **Google Chrome** (recommended browser for WebGL graphics and multiplayer)
- **An active internet connection** on each PC if you want to play **Online Multiplayer** (solo races work offline once running).

> **Note for sharing `apex-next` as a `.zip`:**  
> Exclude `node_modules` before zipping so the archive stays small and works across Mac, Windows, and Linux.

---

## 2. How to Run the Game (Step-by-Step)

### Step 1 — Unzip the folder
- Extract `apex-next.zip` anywhere easy to find (for example on your `Desktop` or `Downloads`).
- Make sure you open the folder that directly contains `package.json` (if your archive tool created a nested folder like `apex-next/apex-next`, use the inner `apex-next` folder).

### Step 2 — Open Terminal / Console
- **macOS:** Press `Cmd + Space`, type **Terminal**, and press `Enter`.
- **Windows:** Press the **Windows** key, type **Command Prompt** (or **PowerShell**), and press `Enter`.

### Step 3 — Set the console path to the `apex-next` folder
Type `cd ` (with a trailing space), then navigate to your extracted `apex-next` folder:

- **macOS example:**
  ```bash
  cd ~/Desktop/apex-next
  ```
  *(Easy trick on Mac/Windows: type `cd `, drag-and-drop the `apex-next` folder straight into the console window, and press `Enter`.)*

- **Windows example:**
  ```bat
  cd %USERPROFILE%\Desktop\apex-next
  ```

You can verify you are in the right folder by checking that `package.json` is there:
- Mac/Linux: `ls`
- Windows: `dir`

### Step 4 — Install packages (first time only)
Run:
```bash
npm install
```
Wait for installation to finish cleanly. *(You only need to do this once per PC.)*

### Step 5 — Start the game
Run:
```bash
npm run dev
```
The console will print a local web address like:
```text
  ➜  Local:   http://localhost:5173/
```
Keep this console window open while playing.

### Step 6 — Open in Chrome
1. Open **Google Chrome**.
2. Click the address bar, type or paste **`http://localhost:5173/`** (or the exact `Local:` URL shown in your console), and press `Enter`.

*(To stop the server later, go back to the console window and press `Ctrl + C`.)*

---

## 3. Playing Without Node.js (Single-File Alternative)

If a friend doesn't want to install Node.js, you can build or send the standalone single-file bundle:
1. Run `npm run build` inside `apex-next` to update `dist/index.html`.
2. Send just the single **`dist/index.html`** file to friends — they can open it directly in Chrome (or serve `dist/` with Python `python3 -m http.server 8000` -> `http://localhost:8000/`).
3. Players running `npm run dev` and players opening `dist/index.html` can join the **same** online rooms.

---

## 4. How to Play Online Multiplayer (Same Wi-Fi or Separate Hotspots)

Online multiplayer supports up to **8 human players** (`HOST ONLINE` / `JOIN`) even when every player is on a **different network or personal mobile hotspot**.

### Before hosting or joining (Every Player)
1. Enter your **DRIVER NAME**.
2. Pick your vehicle (**SELECT CAR**), **PAINT**, and **UNDERGLOW**.  
   *(Choose your car and colors before entering the lobby.)*

### Host (1 Person)
1. Pick your starting **TRACK** (and **LAPS** for circuit tracks).
2. Click **`HOST ONLINE`**.
3. The **`ONLINE RACE LOBBY`** will appear with a 5-character **`ROOM CODE`** (for example `XGGX3`).
4. Send that 5-character code to your friends.
5. While waiting, the host can still change **TRACK** and set **`AI TRAFFIC BOTS`** (`None`, `3`, or `5`).

> **Tip:** Give hosting (`HOST ONLINE`) to the player with the fastest, most stable internet/hotspot connection, since the host runs the room and AI traffic bots.

### Friends (Up to 7 Joiners)
1. On the main garage menu, type the 5-character code into the **`CODE`** input box.
2. Click **`JOIN`** (or press `Enter`).
3. Wait in **`ONLINE RACE LOBBY`** until everyone appears.

### Starting & Racing Again
- When all friends are in the lobby, the host clicks **`START RACE`** to launch everyone onto the grid together.
- After finishing a race, the host sees **`BACK TO LOBBY`** on the results screen so you can pick a new track and race again using the same room.

---

## 5. Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Gas / Accelerate | `W` or `↑` | `RT` |
| Brake / Reverse | `S` or `↓` (when stopped) | `LT` |
| Steer | `A` / `D` or `←` / `→` | Left Stick |
| Drift *(Charges NOS)* | `SPACE` or `↓` at speed | `A` / `X` |
| NOS Boost | `SHIFT` | `B` / `Y` / `RB` |
| Camera View | `C` | — |
| Reset to Track | `R` | — |
| Mute Audio | `M` | — |
| Pause Menu | `P` or `Esc` | — |

Open **`⚙ SETTINGS`** on the garage screen or top-right HUD button during a race to adjust **Graphics Quality** (`Medium`, `High (Bloom)`, `Ultra (MSAA + Bloom)`) and **Master Volume**.

---

## 6. Available Cars & Tracks

### Vehicles (8)
- **Nissan GT-R R34 V-Spec** — `AWD · 2.6L RB26DETT Twin-Turbo`
- **Toyota Supra MK4** — `RWD · 3.0L 2JZ-GTE Twin-Turbo`
- **Dodge Charger Hellcat** — `RWD · 6.2L Supercharged HEMI V8`
- **Lamborghini Huracán EVO** — `AWD · 5.2L Naturally Aspirated V10`
- **Nissan 370Z NISMO** — `RWD · 3.7L VQ37VHR V6`
- **Tesla Cybertruck Cyberbeast** — `AWD · Tri-Motor 845 HP Electric`
- **Mercedes-AMG G 63** — `4x4 · 4.0L Biturbo V8`
- **Classic Porsche 911 Turbo** — `RWD · Tuned Twin-Turbo Flat-6`

### Tracks (6)
- **Neon Tokyo** — Night wet-asphalt city drift circuit
- **Sunset Canyon** — High-speed golden hour canyon circuit
- **Alpine Touge** — Mountain hairpins & elevation switchbacks
- **Harbor Bay GP** — Coastal marina & suspension bridge GP circuit
- **Dune River Run** — Off-road desert sand, mud & river crossings (`OFFROAD · 4x4`)
- **Katunayake E03** — One-way point-to-point expressway sprint (`Peliyagoda → BIA`, 1 lap)

---

## 7. Troubleshooting

- **`npm: command not found`:** Install Node.js from [https://nodejs.org](https://nodejs.org), close and reopen your Terminal/Command Prompt, then run `npm install` again.
- **`Missing script: "dev"` or `package.json` not found:** Your console path isn't inside the inner `apex-next` folder that holds `package.json`. Run `cd path/to/apex-next` again.
- **Joining a room hangs on a personal hotspot or office Wi-Fi:** Some mobile carriers block direct peer-to-peer WebRTC. The game automatically falls back to WebSocket relays after a few seconds (`Direct connection unavailable — connecting via relay…`). To force relay mode immediately, open **`http://localhost:5173/#relay`** in Chrome and refresh before clicking `HOST ONLINE` or `JOIN`.
- **Sharing over the same Wi-Fi from one PC:** If you don't want everyone running `npm`, one person can run:
  ```bash
  npx vite preview --host --port 4173
  ```
  after `npm run build`, and everyone on the same Wi-Fi opens `http://<host-pc-ip>:4173/`.

