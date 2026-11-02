"""Cửa sổ tiến trình khi chuyển thành PDF từ menu chuột phải mà không mở app.

Word, Edge không báo tiến độ ra ngoài, nên % của file đang chuyển là ước lượng theo thời gian: tăng dần, dừng trước 100%,
chỉ khi file thật sự xong mới lên 100%. Các file chuyển lần lượt. Hết giờ thì chuyen_pdf báo lỗi, nên cửa sổ luôn đi đến nút OK.
"""
import ctypes
import math
import queue
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import font, ttk

import chuyen_pdf

TIEU_DE = "Sửa TeX - Chuyển thành PDF"
MAU_LOI = "#b3261e"
SO_DONG_HIEN = 7  # nhiều file hơn thì cuộn
CAO_DONG = 58


def giay_uoc_tinh(p: Path) -> float:
    d = p.suffix.lower()
    return 8 if d in chuyen_pdf.OFFICE else 1 if d in chuyen_pdf.ANH else 3


def lam_viec(ds: list, tin: queue.Queue) -> None:
    for i, p in enumerate(ds):
        tin.put(("bat", i, None))
        try:
            tin.put(("xong", i, chuyen_pdf.chuyen(p).name))
        except Exception as e:
            tin.put(("loi", i, str(e)))


def chay(ds: list) -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # để chữ không bị mờ
    except OSError:
        pass
    cs = tk.Tk()
    cs.title(TIEU_DE)
    cs.resizable(False, False)
    try:
        import sys
        cs.iconbitmap(sys.executable)
    except tk.TclError:
        pass
    font.nametofont("TkDefaultFont").configure(family="Segoe UI", size=10)
    khung = ttk.Frame(cs, padding=14)
    khung.pack(fill="both", expand=True)
    dau = ttk.Label(khung, text=f"Đang chuyển 0/{len(ds)} file")
    dau.pack(anchor="w", pady=(0, 8))

    rong = cs.winfo_fpixels("1i") / 96
    nen = ttk.Style().lookup("TFrame", "background")
    vung = tk.Canvas(khung, width=int(500 * rong), height=int(min(len(ds), SO_DONG_HIEN) * CAO_DONG * rong), highlightthickness=0, background=nen)
    vung.pack(side="left", fill="both", expand=True)
    if len(ds) > SO_DONG_HIEN:
        cuon = ttk.Scrollbar(khung, orient="vertical", command=vung.yview)
        cuon.pack(side="left", fill="y")
        vung.configure(yscrollcommand=cuon.set)
        cs.bind("<MouseWheel>", lambda e: vung.yview_scroll(-1 if e.delta > 0 else 1, "units"))
    bang = ttk.Frame(vung)
    vung.create_window(0, 0, anchor="nw", window=bang)
    bang.bind("<Configure>", lambda e: vung.configure(scrollregion=vung.bbox("all")))

    dong = []
    for i, p in enumerate(ds):
        o = ttk.Frame(bang)
        o.pack(fill="x", pady=(0, 8))
        tren = ttk.Frame(o)
        tren.pack(fill="x")
        ten = ttk.Label(tren, text=f"{p.stem}.pdf", width=52)
        ten.pack(side="left")
        so = ttk.Label(tren, text="Chờ", width=6, anchor="e")
        so.pack(side="right")
        thanh = ttk.Progressbar(o, maximum=100, length=int(500 * rong))
        thanh.pack(fill="x", pady=(2, 0))
        dong.append({"p": p, "ten": ten, "so": so, "thanh": thanh, "o": o, "luc": None, "xong": False})

    day = ttk.Frame(cs, padding=(14, 0, 14, 14))
    nut = ttk.Button(day, text="OK", command=cs.destroy)
    tin = queue.Queue()
    so_loi = [0]

    def ket_thuc():
        loi = so_loi[0]
        dau.configure(text=f"Đã chuyển xong {len(ds)} file" if not loi else f"Xong {len(ds) - loi} file, lỗi {loi} file", foreground=MAU_LOI if loi else "")
        day.pack(fill="x")
        nut.pack(side="right")
        nut.focus_set()
        cs.bind("<Return>", lambda e: cs.destroy())
        cs.protocol("WM_DELETE_WINDOW", cs.destroy)

    def cap_nhat():
        while True:
            try:
                viec, i, gt = tin.get_nowait()
            except queue.Empty:
                break
            d = dong[i]
            if viec == "bat":
                d["luc"] = time.monotonic()
            else:
                d["xong"] = True
            if viec == "xong":
                d["ten"].configure(text=gt)
                d["thanh"].configure(value=100)
                d["so"].configure(text="100%")
            elif viec == "loi":
                so_loi[0] += 1
                d["so"].configure(text="Lỗi", foreground=MAU_LOI)
                ttk.Label(d["o"], text=gt, foreground=MAU_LOI, wraplength=int(500 * rong)).pack(anchor="w", pady=(2, 0))
            if viec != "bat":
                dau.configure(text=f"Đang chuyển {sum(x['xong'] for x in dong)}/{len(ds)} file")
                vung.update_idletasks()
                vung.configure(height=min(bang.winfo_reqheight(), int(SO_DONG_HIEN * CAO_DONG * rong)))
        for d in dong:
            if d["luc"] is not None and not d["xong"]:
                pt = int(95 * (1 - math.exp(-(time.monotonic() - d["luc"]) / giay_uoc_tinh(d["p"]))))
                d["thanh"].configure(value=pt)
                d["so"].configure(text=f"{pt}%")
        if all(d["xong"] for d in dong):
            ket_thuc()
        else:
            cs.after(100, cap_nhat)

    vung.update_idletasks()
    vung.configure(width=bang.winfo_reqwidth(), height=min(bang.winfo_reqheight(), int(SO_DONG_HIEN * CAO_DONG * rong)))
    cs.protocol("WM_DELETE_WINDOW", lambda: None)  # chưa xong thì chưa đóng; file nào quá giờ cũng tự dừng
    cs.update_idletasks()
    cs.geometry(f"+{(cs.winfo_screenwidth() - cs.winfo_reqwidth()) // 2}+{(cs.winfo_screenheight() - cs.winfo_reqheight()) // 3}")
    cs.lift()
    cs.attributes("-topmost", True)
    cs.after(300, lambda: cs.attributes("-topmost", False))
    threading.Thread(target=lam_viec, args=(ds, tin), daemon=True).start()
    cs.after(100, cap_nhat)
    cs.mainloop()
