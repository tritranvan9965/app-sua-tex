"""Ngân hàng câu hỏi: đọc các file .tex trong một thư mục, nhận diện từng câu và gom theo cây tri thức hoặc theo nguồn (file, thư mục).

Chạy độc lập với phần còn lại của app: app.py chỉ nhập module này trong try/except, lỗi ở đây không làm sập app.

Nhận diện câu: môi trường \\begin{bt}...\\end{bt} (và ex, cau, tn, ds, tln...) ở đầu dòng. Dòng ghi chú ngay phía trên có dạng
    %@ id=OLD.C6B1.001 | trang=2 | so=1 | vitri=C6.1.1 | muc=7 | tt=0 | thieu=loigiai
thì được kèm theo câu (dòng đó là một phần của câu khi chèn đi nơi khác).
Mã id: id=... trong dòng %@, hoặc %[mã] sau \\begin{...} cùng dòng. Câu không có id thì so khớp bằng băm nội dung.
Cây tri thức đọc từ vitri=C<chương>.<bài>.<dạng>; tên chương, bài, dạng lấy từ file dang-*.md trong thư mục ngân hàng nếu có.
"""
import hashlib
import json
import os
import re
import threading
from pathlib import Path

import duong_app

TEP_CAI_DAT = duong_app.DU_LIEU / "ngan-hang.json"  # tách khỏi cai-dat.json vì file đó do trang ghi đè cả tệp
MOI_TRUONG_CAU = {"bt", "bai", "baitap", "ex", "cau", "cauhoi", "tn", "ds", "tln", "vd", "vidu"}
BEGIN = re.compile(r"^\s*\\begin\{(\w+)\}")
GHI_CHU = re.compile(r"^\s*%@")
ID_CUNG_DONG = re.compile(r"^\s*\\begin\{\w+\}(?:\[[^\]\n]*\])?\s*%\s*\[([^\]\n]+)\]")
MA_DANG = re.compile(r"^([A-Za-z]*)(\d+)(?:\.(\d+))?(?:\.(\d+))?$")
SO_LA_MA = {"I": 1, "V": 5, "X": 10, "L": 50}
TOI_DA_DS = 200

_khoa = threading.RLock()
_bo_nho = {}   # đường dẫn file -> (mtime_ns, size, ds câu)
_chi_muc = {"dau": None, "thu_muc": None, "ds": [], "ten": {}}


class LoiNganHang(Exception):
    pass


def doc_cai_dat() -> dict:
    try:
        return json.loads(TEP_CAI_DAT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def thu_muc_hien() -> Path | None:
    t = doc_cai_dat().get("thu_muc")
    p = Path(t) if t else None
    return p if p and p.is_dir() else None


def la_ma(chu: str) -> int:
    n = 0
    for i, c in enumerate(chu):
        v = SO_LA_MA.get(c, 0)
        n += -v if i + 1 < len(chu) and SO_LA_MA.get(chu[i + 1], 0) > v else v
    return n


def bam_noi_dung(dong: list[str]) -> str:
    return hashlib.sha1(re.sub(r"\s+", "", "".join(dong)).encode("utf-8")).hexdigest()[:12]


def doc_ghi_chu(dong: str) -> dict:
    kq = {}
    for p in dong.strip()[2:].split("|"):
        if "=" in p:
            k, v = p.split("=", 1)
            kq[k.strip()] = v.strip()
    return kq


def tach_cau(chu: str) -> list[dict]:
    """Trả các câu trong một file theo thứ tự: dong_dau/dong_cuoi (số dòng, tính cả dòng %@), id, ghi chú, nội dung."""
    dong = chu.split("\n")
    kq, i = [], 0
    while i < len(dong):
        m = BEGIN.match(dong[i])
        if not m or m.group(1) not in MOI_TRUONG_CAU:
            i += 1
            continue
        ten = m.group(1)
        mo, j = 0, i
        while j < len(dong):
            mo += len(re.findall(r"\\begin\{%s\}" % ten, dong[j])) - len(re.findall(r"\\end\{%s\}" % ten, dong[j]))
            if mo <= 0:
                break
            j += 1
        if j >= len(dong):  # câu không đóng, bỏ qua phần còn lại để không nuốt cả file
            break
        a = i
        k = i - 1
        while k >= 0 and not dong[k].strip():
            k -= 1
        meta = doc_ghi_chu(dong[k]) if k >= 0 and GHI_CHU.match(dong[k]) else {}
        if k >= 0 and GHI_CHU.match(dong[k]):
            a = k
        than = dong[i:j + 1]
        cung = ID_CUNG_DONG.match(dong[i])
        ma = meta.get("id") or (cung.group(1).strip() if cung else "")
        kq.append({"a": a, "b": j, "id": ma, "meta": meta, "bam": bam_noi_dung(than), "dong": dong[a:j + 1]})
        i = j + 1
    return kq


def doc_file(p: Path) -> list[dict]:
    st = p.stat()
    with _khoa:
        c = _bo_nho.get(str(p))
        if c and c[0] == st.st_mtime_ns and c[1] == st.st_size:
            return c[2]
    ds = tach_cau(p.read_text(encoding="utf-8", errors="replace"))
    with _khoa:
        _bo_nho[str(p)] = (st.st_mtime_ns, st.st_size, ds)
    return ds


def liet_ke_tex(goc: Path) -> list[Path]:
    kq = []
    for thu_muc, ds_con, ds_tep in os.walk(goc):
        ds_con[:] = sorted(d for d in ds_con if not d.startswith("."))
        kq += [Path(thu_muc) / t for t in sorted(ds_tep) if t.lower().endswith(".tex")]
    return kq


def doc_ten_nhom(goc: Path) -> dict:
    """Tên chương, bài, dạng từ các file dang-*.md: '## Chương I. ...', '**Bài 1. ...**', '| C1.1.1 | tên | ... |'."""
    ten = {}
    for md in sorted(goc.glob("*.md")):
        tien = (re.match(r"dang-([A-Za-z]+)", md.stem) or [None, ""])[1]
        chuong = bai = 0
        try:
            dong = md.read_text(encoding="utf-8").split("\n")
        except OSError:
            continue
        for d in dong:
            m = re.match(r"^#+\s*Chương\s+([IVXL]+|\d+)\.?\s*(.*)$", d)
            if m:
                chuong = int(m.group(1)) if m.group(1).isdigit() else la_ma(m.group(1))
                ten[f"{tien}{chuong}"] = m.group(2).strip()
                continue
            m = re.match(r"^\**\s*Bài\s+(\d+)\.?\s*(.*?)\**\s*$", d)
            if m and chuong:
                bai = int(m.group(1))
                ten[f"{tien}{chuong}.{bai}"] = m.group(2).strip()
                continue
            m = re.match(r"^\|\s*([A-Za-z]*\d+\.\d+\.\d+)\s*\|\s*(.*?)\s*\|", d)
            if m:
                ten[m.group(1)] = m.group(2)
    return ten


def chi_muc() -> dict:
    """Đọc cả thư mục (có nhớ theo thời gian sửa từng file). Trả {'ds': [câu], 'ten': {...}, 'thu_muc': Path}."""
    goc = thu_muc_hien()
    if not goc:
        raise LoiNganHang("Chưa chọn thư mục ngân hàng.")
    teps = liet_ke_tex(goc)
    dau = (str(goc), tuple((str(t), t.stat().st_mtime_ns, t.stat().st_size) for t in teps))
    with _khoa:
        if _chi_muc["dau"] == dau:
            return _chi_muc
        ds = []
        for p in teps:
            rel = p.relative_to(goc).as_posix()
            for n, c in enumerate(doc_file(p)):
                v = c["meta"].get("vitri", "")
                ds.append({"tep": rel, "so_tt": n + 1, "id": c["id"], "meta": c["meta"], "bam": c["bam"], "vitri": [x for x in (y.strip() for y in v.split(",")) if MA_DANG.match(x)]})
        _chi_muc.update(dau=dau, thu_muc=goc, ds=ds, ten=doc_ten_nhom(goc))
        return _chi_muc


def nhan_cau(c: dict) -> str:
    return c["id"] or f"{Path(c['tep']).stem}#{c['so_tt']}"


# ---------- Cây ----------

def cay_tri_thuc(cm: dict) -> dict:
    nut = {}

    def lay(ma, ten, cha):
        n = nut.get(ma)
        if not n:
            n = nut[ma] = {"id": f"tt:{ma}", "ten": ten, "ma": ma, "dem": 0, "con": []}
            cha["con"].append(n)
        return n

    goc = {"con": []}
    tien_to = {MA_DANG.match(m).group(1) for c in cm["ds"] for m in c["vitri"]}
    for c in cm["ds"]:
        if not c["vitri"]:
            lay("?", "Chưa phân dạng", goc)["dem"] += 1
            continue
        da_dem = set()  # một câu có nhiều mã (vitri=C6.20.5,CD2.5) thì tính vào từng nhánh, nhưng mỗi nút chỉ đếm một lần
        for vt in c["vitri"]:
            m = MA_DANG.match(vt)
            tien, so = m.group(1), [x for x in m.groups()[1:] if x]
            cha = lay(f"@{tien}", f"Phần {tien}", goc) if len(tien_to) > 1 else goc
            ds_nut = [cha] if cha is not goc else []
            for cap in range(len(so)):
                ma = f"{tien}{'.'.join(so[:cap + 1])}"
                ten = cm["ten"].get(ma) or f"{('Chương', 'Bài', 'Dạng')[cap]} {so[cap]}"
                cha = lay(ma, ten, cha)
                ds_nut.append(cha)
            for n in ds_nut:
                if n["id"] not in da_dem:
                    da_dem.add(n["id"])
                    n["dem"] += 1

    def khoa_xep(x):
        return ([int(t) for t in re.findall(r"\d+", x["ma"])] or [10**9], x["ma"])

    def xep(n):
        n["con"].sort(key=khoa_xep)
        for x in n["con"]:
            xep(x)
    xep(goc)
    goc["con"].sort(key=lambda x: (x["ma"] == "?", x["ma"].lstrip("@"), khoa_xep(x)))  # "Chưa phân dạng" cuối cùng
    return goc


def cay_nguon(cm: dict) -> dict:
    goc = {"con": []}
    nut = {"": goc}
    for c in cm["ds"]:
        phan = c["tep"].split("/")
        cha = goc
        for i, ten in enumerate(phan):
            duong = "/".join(phan[:i + 1])
            n = nut.get(duong)
            if not n:
                n = nut[duong] = {"id": f"ng:{duong}", "ten": ten[:-4] if i == len(phan) - 1 else ten, "ma": duong, "dem": 0, "con": []}
                cha["con"].append(n)
            n["dem"] += 1
            cha = n
    return goc


def viec_cay(d: dict) -> dict:
    cm = chi_muc()
    goc = cay_nguon(cm) if d.get("kieu") == "nguon" else cay_tri_thuc(cm)
    return {"thu_muc": str(cm["thu_muc"]), "tong": len(cm["ds"]), "cay": goc["con"]}


# ---------- Danh sách câu của một nút ----------

def thuoc_nut(c: dict, nut: str) -> bool:
    loai, _, ma = nut.partition(":")
    if loai == "tt":
        if ma == "?":
            return not c["vitri"]
        if ma.startswith("@"):
            return any(MA_DANG.match(v).group(1) == ma[1:] for v in c["vitri"])
        return any(v == ma or v.startswith(ma + ".") for v in c["vitri"])
    if loai == "ng":
        return c["tep"] == ma or c["tep"].startswith(ma + "/")
    return False


def xem_truoc(dong: list[str], toi_da: int = 110) -> str:
    t = " ".join(d.strip() for d in dong if not GHI_CHU.match(d) and not BEGIN.match(d))
    t = re.sub(r"\\(begin|end)\{[^}]*\}|\\item|\\loigiai\{", " ", t)
    return re.sub(r"\s+", " ", t).strip()[:toi_da]


def viec_ds(d: dict) -> dict:
    cm = chi_muc()
    nut, tu = d.get("nut", ""), int(d.get("tu", 0))
    ds = [c for c in cm["ds"] if thuoc_nut(c, nut)]
    kq = []
    for c in ds[tu:tu + TOI_DA_DS]:
        m = c["meta"]
        kq.append({"nhan": nhan_cau(c), "tep": c["tep"], "so_tt": c["so_tt"], "khoa": [x for x in (c["id"], c["bam"]) if x],
                   "muc": m.get("muc", ""), "thieu": m.get("thieu", ""), "tt": m.get("tt") == "1", "vitri": ", ".join(c["vitri"])})
    # xem trước cần đọc nội dung nên chỉ làm cho trang đang trả về
    goc = cm["thu_muc"]
    for x in kq:
        cau = doc_file(goc / x["tep"])[x["so_tt"] - 1]
        x["xem"] = xem_truoc(cau["dong"])
    return {"tong": len(ds), "tu": tu, "ds": kq}


def duong_trong_goc(tep: str) -> Path:
    goc = thu_muc_hien()
    if not goc:
        raise LoiNganHang("Chưa chọn thư mục ngân hàng.")
    p = (goc / tep).resolve()
    if not p.is_relative_to(goc.resolve()) or p.suffix.lower() != ".tex" or not p.is_file():
        raise LoiNganHang("Không tìm thấy file câu hỏi này trong ngân hàng.")
    return p


def viec_noi_dung(d: dict) -> dict:
    p = duong_trong_goc(d.get("tep", ""))
    ds = doc_file(p)
    n = int(d.get("so_tt", 0)) - 1
    if not 0 <= n < len(ds):
        raise LoiNganHang("File đã thay đổi, câu này không còn ở vị trí cũ. Bấm làm mới danh sách.")
    return {"chu": "\n".join(ds[n]["dong"])}


def viec_trong_file(d: dict) -> dict:
    """Các khoá (id và băm nội dung) của những câu đang có trong văn bản của file đang mở."""
    khoa = set()
    for c in tach_cau(d.get("chu", "")):
        khoa.add(c["bam"])
        if c["id"]:
            khoa.add(c["id"])
    return {"khoa": sorted(khoa)}


def viec_dat_thu_muc(d: dict) -> dict:
    p = Path(d.get("duong", ""))
    if not p.is_dir():
        raise LoiNganHang("Không tìm thấy thư mục này.")
    TEP_CAI_DAT.write_text(json.dumps({**doc_cai_dat(), "thu_muc": str(p)}, ensure_ascii=False, indent=1), encoding="utf-8")
    with _khoa:
        _chi_muc["dau"] = None
    return viec_cay({})


def viec_thong_tin(_) -> dict:
    p = thu_muc_hien()
    return {"thu_muc": str(p) if p else ""}


def boc(f):
    """Lỗi của ngân hàng trả về dạng {'loi': ...} với mã 200 để giao diện chỉ báo trong khung ngân hàng."""
    def chay(d):
        try:
            return f(d)
        except LoiNganHang as e:
            return {"loi": str(e)}
        except (OSError, ValueError, KeyError, IndexError) as e:
            return {"loi": f"Ngân hàng không đọc được: {e}"}
    return chay


VIEC = {f"/api/ngan-hang/{ten}": boc(f) for ten, f in {
    "thong-tin": viec_thong_tin, "dat-thu-muc": viec_dat_thu_muc, "cay": viec_cay, "ds": viec_ds,
    "noi-dung": viec_noi_dung, "trong-file": viec_trong_file}.items()}
