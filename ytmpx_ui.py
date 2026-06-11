import os
import sys
import ctypes
import json
import tkinter as tk
import subprocess
import pystray
import threading
from PIL import Image

# [1] MANTRA ANTI-BULU TKINTER
try:
    myappid = 'migign.ytmpx.discord.ultimate'
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
except Exception:
    pass

CONFIG_FILE = "ytmpx_config.json"

def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# --- CUSTOM UI WIDGET: TOGGLE SWITCH ---
class ToggleSwitch(tk.Canvas):
    def __init__(self, parent, initial_state=False, command=None, *args, **kwargs):
        super().__init__(parent, width=40, height=20, highlightthickness=0, *args, **kwargs)
        self.state = initial_state
        self.command = command
        self.bind("<Button-1>", self.on_click)
        self.draw()

    def draw(self):
        self.delete("all")
        # Warna Hijau ala Discord kalau ON, Abu-abu kalau OFF
        color = "#43b581" if self.state else "#72767d"
        x = 20 if self.state else 0
        
        # Gambar bentuk pil
        self.create_oval(0, 0, 20, 20, fill=color, outline="")
        self.create_oval(20, 0, 40, 20, fill=color, outline="")
        self.create_rectangle(10, 0, 30, 20, fill=color, outline="")
        
        # Gambar lingkaran putih (thumb)
        self.create_oval(x+2, 2, x+18, 18, fill="#ffffff", outline="")

    def on_click(self, event):
        self.state = not self.state
        self.draw()
        if self.command:
            self.command(self.state)

class YTMPXController:
    def __init__(self, root):
        self.root = root
        self.root.title("YTMPX Discord")
        self.root.geometry("320x280")
        self.root.resizable(False, False)

        icon_path = resource_path("icon.ico")
        if os.path.exists(icon_path):
            self.root.iconbitmap(default=icon_path)

        self.is_running = False

        # --- SISTEM MEMORI ---
        self.config = {
            "dark_mode": True, 
            "minimize_on_close": True,
            "start_minimized": False,
            "activity_type": "listening"
        }
        self.load_config()

        # --- HEADER UI ---
        self.label = tk.Label(root, text="Discord YTMPX", font=("Helvetica", 14, "bold"))
        self.label.pack(pady=(15, 5))

        self.status_label = tk.Label(root, text="🔴 Status: MATI", font=("Helvetica", 10))
        self.status_label.pack(pady=(0, 10))

        self.toggle_btn = tk.Button(root, text="▶ Mulai YTMPX", font=("Helvetica", 10), width=15, command=self.toggle_node)
        self.toggle_btn.pack(pady=(0, 15))

        # --- SETTINGS FRAME (Grid Layout) ---
        self.settings_frame = tk.Frame(root)
        self.settings_frame.pack(fill="both", padx=30, pady=5)
        self.settings_frame.columnconfigure(0, weight=1)

        self.lbl_dark = tk.Label(self.settings_frame, text="Dark Mode", font=("Helvetica", 9))
        self.lbl_dark.grid(row=0, column=0, sticky="w", pady=5)
        self.sw_dark = ToggleSwitch(self.settings_frame, initial_state=self.config["dark_mode"], command=lambda s: self.save_setting("dark_mode", s))
        self.sw_dark.grid(row=0, column=1, sticky="e")

        self.lbl_close = tk.Label(self.settings_frame, text="Minimize saat di-Close (X)", font=("Helvetica", 9))
        self.lbl_close.grid(row=1, column=0, sticky="w", pady=5)
        self.sw_close = ToggleSwitch(self.settings_frame, initial_state=self.config["minimize_on_close"], command=lambda s: self.save_setting("minimize_on_close", s))
        self.sw_close.grid(row=1, column=1, sticky="e")

        self.lbl_start = tk.Label(self.settings_frame, text="Auto Minimize saat Dibuka", font=("Helvetica", 9))
        self.lbl_start.grid(row=2, column=0, sticky="w", pady=5)
        self.sw_start = ToggleSwitch(self.settings_frame, initial_state=self.config["start_minimized"], command=lambda s: self.save_setting("start_minimized", s))
        self.sw_start.grid(row=2, column=1, sticky="e")

        self.lbl_activity = tk.Label(self.settings_frame, text="Mode Playing (bukan Listening)", font=("Helvetica", 9))
        self.lbl_activity.grid(row=3, column=0, sticky="w", pady=5)
        self.sw_activity = ToggleSwitch(self.settings_frame, initial_state=self.config["activity_type"] == "playing", command=lambda s: self.save_setting("activity_type", "playing" if s else "listening"))
        self.sw_activity.grid(row=3, column=1, sticky="e")

        # Eksekusi tema & mesin node
        self.apply_theme()
        self.toggle_node()

    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    saved = json.load(f)
                    self.config.update(saved)
            except Exception:
                pass

    def save_setting(self, key, state):
        self.config[key] = state
        with open(CONFIG_FILE, "w") as f:
            json.dump(self.config, f)
        
        if key == "dark_mode":
            self.apply_theme()

    def apply_theme(self):
        if self.config["dark_mode"]:
            bg_col, fg_col = "#2b2d31", "#ffffff"
            btn_bg, btn_fg = "#404249", "#ffffff"
            status_on, status_off = "#2ecc71", "#ff4757"
        else:
            bg_col, fg_col = "#f0f0f0", "#000000"
            btn_bg, btn_fg = "#e0e0e0", "#000000"
            status_on, status_off = "green", "red"

        self.root.config(bg=bg_col)
        self.settings_frame.config(bg=bg_col)
        self.label.config(bg=bg_col, fg=fg_col)
        self.toggle_btn.config(bg=btn_bg, fg=btn_fg, activebackground=btn_bg, activeforeground=btn_fg)
        
        for lbl in (self.lbl_dark, self.lbl_close, self.lbl_start, self.lbl_activity):
            lbl.config(bg=bg_col, fg=fg_col)
        
        for sw in (self.sw_dark, self.sw_close, self.sw_start, self.sw_activity):
            sw.config(bg=bg_col)

        self.status_label.config(bg=bg_col, fg=status_on if self.is_running else status_off)

    def toggle_node(self):
        HIDE_WINDOW = 0x08000000 
        if not self.is_running:
            # FIX SERVER HANG: Ganti PIPE jadi DEVNULL biar nggak macet log-nya!
            base = os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__))
            server_path = os.path.join(base, "packages", "server", "bin", "index.mjs")
            subprocess.Popen(
                f"node \"{server_path}\"", shell=True, creationflags=HIDE_WINDOW,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            self.is_running = True
            self.status_label.config(text="🟢 Status: NYALA")
        else:
            self.kill_node()
            self.is_running = False
            self.status_label.config(text="🔴 Status: MATI")
            
        self.apply_theme()
        self.toggle_btn.config(text="⏹ Matikan YTMPX" if self.is_running else "▶ Mulai YTMPX")

    def kill_node(self):
        HIDE_WINDOW = 0x08000000
        subprocess.run(
            "taskkill /F /IM node.exe /T", shell=True, creationflags=HIDE_WINDOW,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

# --- FUNGSI SYSTEM TRAY ---
def create_tray_icon():
    icon_path = resource_path("icon.ico")
    if os.path.exists(icon_path):
        return Image.open(icon_path)
    return Image.new('RGB', (64, 64), color=(88, 101, 242))

def hide_to_tray():
    root.withdraw() 
    menu = pystray.Menu(
        pystray.MenuItem('Buka Aplikasi', show_from_tray),
        pystray.MenuItem('Keluar Total', quit_app)
    )
    global tray_icon
    tray_icon = pystray.Icon("YTMPX", create_tray_icon(), "YTMPX Discord", menu)
    threading.Thread(target=tray_icon.run, daemon=True).start()

def show_from_tray(icon, item):
    icon.stop()
    root.after(0, root.deiconify)

def quit_app(icon, item=None):
    if 'tray_icon' in globals() and icon:
        icon.stop()
    app.kill_node()
    root.after(0, root.destroy)

def on_window_close():
    if app.config["minimize_on_close"]:
        hide_to_tray()
    else:
        quit_app(None)

if __name__ == "__main__":
    # --- FITUR ANTI-DOUBLE OPEN (MUTEX) SILENT ---
    mutex_name = "YTMPX_Discord_App_Lock"
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
    if ctypes.windll.kernel32.GetLastError() == 183: # ERROR_ALREADY_EXISTS
        sys.exit(0) # Kalau udah jalan, keluar diam-diam tanpa bacot!
    # ---------------------------------------------

    root = tk.Tk()
    app = YTMPXController(root)
    
    root.protocol("WM_DELETE_WINDOW", on_window_close)
    
    # CEK SETTINGAN AUTO MINIMIZE SAAT START
    if app.config["start_minimized"]:
        hide_to_tray() 
    
    root.mainloop()