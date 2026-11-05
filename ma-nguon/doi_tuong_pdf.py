"""Sửa đối tượng trong PDF như "Edit Object" của Foxit: liệt kê ảnh và hình vẽ không phải chữ, rồi dời, co giãn hoặc xóa.

Tọa độ giao diện: pt, gốc ở góc trên-trái trang ĐANG NHÌN THẤY (đã tính /Rotate), y xuống. Giống chu_pdf.

Cách làm: đọc content stream của trang bằng pikepdf, dò từng lệnh vẽ để biết đối tượng nào nằm ở khoảng lệnh nào (id = "trang:a-b", a và b là
chỉ số lệnh đầu và cuối). Dời/co: bọc khoảng lệnh đó trong `q <ma trận> cm ... Q`; xóa: bỏ khoảng lệnh đó. Không viết lại cả trang, phần
còn lại giữ nguyên từng byte. Chữ sửa cùng lúc (ap_sua) tính trên cùng bản phân tích rồi ghi một lần nên chỉ số không bị lệch.
Mọi lần ghi đều dựng ảnh trang trước/sau để so: ngoài vùng sửa (vùng cũ và vùng mới) phải giống nhau, nếu không thì hủy, không ghi file.

Đối tượng:
- anh: ảnh (image XObject hoặc ảnh inline). Nếu ảnh nằm trong khối q...Q có cắt xén thì cả khối là đối tượng, để dời cả khung cắt.
- hinh: một nét vẽ (đường, hình chữ nhật, khung...). Nét rất nhỏ (gạch phân số, dấu căn, chấm) bị bỏ qua khi liệt kê, trừ khi xin chi tiết.
- nhom: nhiều đối tượng trong cùng một khối q...Q (ví dụ một hình TikZ), hoặc một Form XObject. Khối có chữ lẫn bên trong vẫn là nhóm nếu chữ
  ít (tối đa 40 lệnh chữ) và khối không chiếm quá 60% trang; chữ trong nhóm dời/co/xóa theo nhóm.
Ảnh do app vẽ tay thêm vào (tài nguyên SuaTex...) và chữ do app thêm không được liệt kê."""
import re

import pikepdf
from pikepdf import Array

import chu_pdf
from chu_pdf import LoiChu, _ban_do, _diem, _hop, _luu_an_toan, _mo_pdf, _mo_ra_an_toan, _nhan, _so, _so_anh

GIOI_HAN_CHU_TRONG_NHOM = 40
TI_LE_TRANG_TOI_DA_NHOM_CO_CHU = 0.6
PHEP_TO = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*"}
PHEP_NET = {"S", "s", "B", "B*", "b", "b*"}
PHEP_CHU = {"Tj", "TJ", "'", '"'}
_I = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


# ---------- Ma trận ----------

def _nghich(m):
    det = m[0] * m[3] - m[1] * m[2]
    if abs(det) < 1e-12:
        return None
    a, b, c, d = m[3] / det, -m[1] / det, -m[2] / det, m[0] / det
    return (a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d))


def _bao(diem) -> tuple:
    xs, ys = [p[0] for p in diem], [p[1] for p in diem]
    return (min(xs), min(ys), max(xs), max(ys))


def _giao(a, b):
    """Giao hai hộp (x0,y0,x1,y1); b = None nghĩa là không giới hạn. Trả None nếu rỗng."""
    if b is None:
        return a
    g = (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))
    return g if g[2] > g[0] - 1e-6 and g[3] > g[1] - 1e-6 else None


def _hop_ma_tran(hop, m) -> tuple:
    x0, y0, x1, y1 = hop
    return _bao([_diem(m, x, y) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))])


def _ma_tran_nhin(hop, r) -> tuple:
    """Ma trận P: tọa độ trang gốc -> tọa độ nhìn thấy (x, y xuống), cùng công thức với chu_pdf._ban_do."""
    _, nguoc = chu_pdf._ban_do(hop, r)
    o = nguoc(0, 0)
    ex, ey = nguoc(1, 0), nguoc(0, 1)
    return (ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1])


# ---------- Dò content stream ----------

def _nut_moi(a, cha):
    return {"a": a, "b": None, "cha": cha, "la": [], "con": [], "tat_ca": [], "n_chu": 0}


def _quet_do_hoa(lenh, tai_nguyen, hop_trang) -> dict:
    """Duyệt các lệnh, ghi lại từng 'lá' (ảnh, ảnh inline, Form XObject, một nét vẽ) và cây khối q...Q.
    Trả {nut, la, ctm_tai}: nut[0] là gốc; mỗi lá có kind, a, b (chỉ số lệnh), bbox (tọa độ trang gốc), cha (chỉ số nút)."""
    xo = tai_nguyen.get("/XObject") if tai_nguyen is not None else None
    ctm, lw, cat = _I, 1.0, None
    ngan_xep = []
    nut = [_nut_moi(-1, None)]
    cur = 0
    la, ctm_tai = [], []
    diem, bat_dau, co_cat = [], None, False
    cache_xo = {}

    def them_la(kind, a, b, hop, **them):
        hop = _giao(hop, cat)
        if hop is None:
            return
        la.append({"kind": kind, "a": a, "b": b, "bbox": hop, "cha": cur, **them})
        nut[cur]["la"].append(len(la) - 1)
        nut[cur]["tat_ca"].append(len(la) - 1)

    for i, l in enumerate(lenh):
        ctm_tai.append(ctm)
        o = str(getattr(l, "operator", ""))
        a = getattr(l, "operands", [])
        try:
            if o == "q":
                ngan_xep.append((ctm, lw, cat, cur))
                nut.append(_nut_moi(i, cur))
                nut[cur]["con"].append(len(nut) - 1)
                cur = len(nut) - 1
            elif o == "Q":
                if ngan_xep:
                    nut[cur]["b"] = i
                    con = nut[cur]
                    ctm, lw, cat, cha = ngan_xep.pop()
                    nut[cha]["tat_ca"].extend(con["tat_ca"])
                    nut[cha]["n_chu"] += con["n_chu"]
                    cur = cha
            elif o == "cm":
                ctm = _nhan(tuple(float(v) for v in a), ctm)
            elif o == "w":
                lw = float(a[0])
            elif o in ("m", "l"):
                if bat_dau is None:
                    bat_dau = i
                diem.append(_diem(ctm, float(a[0]), float(a[1])))
            elif o == "c":
                if bat_dau is None:
                    bat_dau = i
                diem += [_diem(ctm, float(a[k]), float(a[k + 1])) for k in (0, 2, 4)]
            elif o in ("v", "y"):
                if bat_dau is None:
                    bat_dau = i
                diem += [_diem(ctm, float(a[k]), float(a[k + 1])) for k in (0, 2)]
            elif o == "h":
                if bat_dau is None:
                    bat_dau = i
            elif o == "re":
                if bat_dau is None:
                    bat_dau = i
                x, y, w, h = (float(v) for v in a)
                diem += [_diem(ctm, px, py) for px, py in ((x, y), (x + w, y), (x, y + h), (x + w, y + h))]
            elif o in ("W", "W*"):
                co_cat = True
            elif o in PHEP_TO or o == "n":
                if bat_dau is not None and diem:
                    hop = _bao(diem)
                    if co_cat:
                        cat = _giao(hop, cat) if _giao(hop, cat) is not None else (0.0, 0.0, 0.0, 0.0)
                    elif o != "n":
                        if o in PHEP_NET:
                            ti = abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) ** 0.5
                            n = lw * ti / 2
                            hop = (hop[0] - n, hop[1] - n, hop[2] + n, hop[3] + n)
                        them_la("duong", bat_dau, i, hop)
                diem, bat_dau, co_cat = [], None, False
            elif o == "Do" and xo is not None:
                ten = str(a[0])
                if ten.startswith("/SuaTex"):
                    continue
                if ten not in cache_xo:
                    x = xo.get(ten)
                    cache_xo[ten] = x if x is not None and str(x.get("/Subtype")) in ("/Image", "/Form") else None
                x = cache_xo[ten]
                if x is None:
                    continue
                if str(x.get("/Subtype")) == "/Image":
                    them_la("anh", i, i, _hop_ma_tran((0, 0, 1, 1), ctm), ten=ten, rong_px=int(x.get("/Width", 0)), cao_px=int(x.get("/Height", 0)))
                else:
                    bb = [float(v) for v in x.get("/BBox", [0, 0, 1, 1])]
                    mt = tuple(float(v) for v in x.get("/Matrix", _I))
                    them_la("khoi", i, i, _hop_ma_tran(_hop_ma_tran((min(bb[0], bb[2]), min(bb[1], bb[3]), max(bb[0], bb[2]), max(bb[1], bb[3])), mt), ctm), ten=ten)
            elif o == "INLINE IMAGE":
                them_la("anh-inline", i, i, _hop_ma_tran((0, 0, 1, 1), ctm))
            elif o in PHEP_CHU:
                nut[cur]["n_chu"] += 1
        except (ValueError, TypeError, IndexError, AttributeError):
            raise LoiChu("Nội dung trang có lệnh vẽ lạ, app chưa sửa được đối tượng trên trang này.")
    while ngan_xep:  # khối q chưa đóng: gộp lên cha để đếm đủ, nhưng không dùng làm nhóm (b = None)
        con = nut[cur]
        _, _, _, cha = ngan_xep.pop()
        nut[cha]["tat_ca"].extend(con["tat_ca"])
        nut[cha]["n_chu"] += con["n_chu"]
        cur = cha
    return {"nut": nut, "la": la, "ctm_tai": ctm_tai, "lenh": lenh, "hop": hop_trang}


# ---------- Dựng danh sách đối tượng ----------

def _loai_la(la) -> str:
    return {"anh": "anh", "anh-inline": "anh", "duong": "hinh", "khoi": "nhom"}[la["kind"]]


def _doi_tuong_tu_la(q, i) -> dict:
    la = q["la"][i]
    return {"a": la["a"], "b": la["b"], "loai": _loai_la(la), "nguon": la["kind"], "bbox": la["bbox"], "la": [i], "n_chu": 0, "chi_duong": la["kind"] == "duong",
            **{k: la[k] for k in ("ten", "rong_px", "cao_px") if k in la}}


def _doi_tuong_tu_nut(q, n) -> dict:
    nut = q["nut"][n]
    ls = nut["tat_ca"]
    if len(ls) == 1:
        o = _doi_tuong_tu_la(q, ls[0])
        o.update(a=nut["a"], b=nut["b"], n_chu=nut["n_chu"])
        return o
    return {"a": nut["a"], "b": nut["b"], "loai": "nhom", "nguon": "nhom", "bbox": _bao([p for i in ls for p in
            ((q["la"][i]["bbox"][0], q["la"][i]["bbox"][1]), (q["la"][i]["bbox"][2], q["la"][i]["bbox"][3]))]), "la": list(ls), "n_chu": nut["n_chu"],
            "chi_duong": all(q["la"][i]["kind"] == "duong" for i in ls)}


def _la_dieu_kien_nhom(q, n, dien_tich_trang: float) -> bool:
    nut = q["nut"][n]
    if nut["b"] is None or not nut["tat_ca"]:
        return False
    if nut["a"] == 0 and nut["b"] == len(q["lenh"]) - 1:  # khối bọc cả trang (như khối bảo vệ app thêm khi sửa) không phải một đối tượng
        return False
    if nut["n_chu"] == 0:
        return True
    if len(nut["tat_ca"]) < 2 or nut["n_chu"] > GIOI_HAN_CHU_TRONG_NHOM:
        return False
    x0, y0, x1, y1 = _bao([p for i in nut["tat_ca"] for p in ((q["la"][i]["bbox"][0], q["la"][i]["bbox"][1]), (q["la"][i]["bbox"][2], q["la"][i]["bbox"][3]))])
    return (x1 - x0) * (y1 - y0) <= TI_LE_TRANG_TOI_DA_NHOM_CO_CHU * dien_tich_trang


PHEP_TRANG_THAI = {"cm", "w", "J", "j", "M", "d", "ri", "i", "gs", "g", "G", "rg", "RG", "k", "K", "cs", "CS", "sc", "scn", "SC", "SCN"}


def _hop_doi_tuong(ds) -> tuple:
    return _bao([p for o in ds for p in ((o["bbox"][0], o["bbox"][1]), (o["bbox"][2], o["bbox"][3]))])


def _noi_duoc(day, o, lenh, dien_tich) -> bool:
    """Mục o có nối tiếp được vào dãy `day` không: sát nhau (chỉ có lệnh đổi trạng thái ở giữa), chồng hoặc chạm hộp, dãy không quá lớn."""
    if o["n_chu"] or day[-1]["n_chu"] or not o["chi_duong"] or not day[-1]["chi_duong"]:  # chỉ gom các nét vẽ; ảnh và khối luôn đứng riêng
        return False
    if any(str(getattr(lenh[i], "operator", "")) not in PHEP_TRANG_THAI for i in range(day[-1]["b"] + 1, o["a"])):
        return False
    h = _hop_doi_tuong(day)
    x0, y0, x1, y1 = o["bbox"]
    if x0 > h[2] + 1.0 or x1 < h[0] - 1.0 or y0 > h[3] + 1.0 or y1 < h[1] - 1.0:
        return False
    u = _hop_doi_tuong(day + [o])
    return (u[2] - u[0]) * (u[3] - u[1]) <= TI_LE_TRANG_TOI_DA_NHOM_CO_CHU * dien_tich


def _doi_tuong_day(day) -> dict:
    a, b = day[0]["a"], day[-1]["b"]
    phat_lai = []
    for x, y in zip(day, day[1:]):
        phat_lai += list(range(x["b"] + 1, y["a"]))
    return {"a": a, "b": b, "loai": "nhom", "nguon": "nhom", "bbox": _hop_doi_tuong(day), "la": [i for o in day for i in o["la"]], "n_chu": 0,
            "chi_duong": True, "phat_lai": phat_lai, "so_muc": len(day)}


def _gop_day(muc, lenh, dien_tich) -> list:
    """Các mục cùng một khối cha, theo thứ tự lệnh; None là chỗ chặn (khối con không thành nhóm). Gom các mục liền nhau, chồng/chạm hộp (ví dụ các nét
    của một khung màu, một hình vẽ không bọc khối) thành một nhóm."""
    ra, day = [], []

    def chot():
        ra.append(_doi_tuong_day(day) if len(day) >= 2 else day[0]) if day else None
        day.clear()
    for o in muc:
        if o is None:
            chot()
        elif day and _noi_duoc(day, o, lenh, dien_tich):
            day.append(o)
        else:
            chot()
            day.append(o)
    chot()
    return ra


def _lap_doi_tuong(q, chi_tiet: bool) -> list:
    """Danh sách đối tượng (chưa lọc nét nhỏ). chi_tiet: từng ảnh, từng nét riêng lẻ; không thì nhóm: khối q...Q ngoài cùng đủ điều kiện,
    rồi các mục liền nhau chồng/chạm hộp trong cùng một khối."""
    if chi_tiet:
        return [_doi_tuong_tu_la(q, i) for i in range(len(q["la"]))]
    hop = q["hop"]
    dt = (hop[2] - hop[0]) * (hop[3] - hop[1])
    ra, can_xu_ly = [], [0]
    while can_xu_ly:
        nut = q["nut"][can_xu_ly.pop()]
        muc = [(c["a"], _doi_tuong_tu_nut(q, n)) for n in nut["con"] for c in (q["nut"][n],) if _la_dieu_kien_nhom(q, n, dt)]
        muc += [(q["nut"][n]["a"], None) for n in nut["con"] if not _la_dieu_kien_nhom(q, n, dt)]
        can_xu_ly += [n for n in nut["con"] if not _la_dieu_kien_nhom(q, n, dt)]
        muc += [(q["la"][i]["a"], _doi_tuong_tu_la(q, i)) for i in nut["la"]]
        muc.sort(key=lambda t: t[0])
        ra += _gop_day([m for _, m in muc], q["lenh"], dt)
    ra.sort(key=lambda o: (o["a"], o["b"]))
    return ra


def _qua_nho(o) -> bool:
    x0, y0, x1, y1 = o["bbox"]
    w, h = x1 - x0, y1 - y0
    if max(w, h) < 2:
        return True
    if len(o["la"]) == 1 and o["nguon"] != "khoi":  # nét công thức: gạch phân số, dấu căn, chấm; mảnh ảnh của đường chấm
        return max(w, h) < 4 or (min(w, h) <= 1.2 and max(w, h) < 60)
    return False


def _khung_chu(o, pt):
    """Hộp (tọa độ nhìn thấy) của các đoạn chữ nằm trong khoảng lệnh của đối tượng, None nếu không có."""
    kh = [pt.ds[k]["khung"] for k, op in enumerate(pt.ops_chu) if o["a"] <= op["i"] <= o["b"] and k < len(pt.ds)]
    if not kh:
        return None
    return (min(k[0] for k in kh), min(k[1] for k in kh), max(k[2] for k in kh), max(k[3] for k in kh))


def _khung_hien(o, nguoc, pt) -> tuple:
    kh = _hop_nhin(o["bbox"], nguoc)
    if o["n_chu"] and pt is not None and pt.khop:
        c = _khung_chu(o, pt)
        if c:
            kh = (min(kh[0], c[0]), min(kh[1], c[1]), max(kh[2], c[2]), max(kh[3], c[3]))
    return kh


def _hop_nhin(bbox, nguoc) -> tuple:
    x0, y0, x1, y1 = bbox
    return _bao([nguoc(x, y) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))])


def _ly_do(o, q, pt):
    if q["ctm_tai"][o["a"]] is None or _nghich(q["ctm_tai"][o["a"]]) is None:
        return "Đối tượng bị biến dạng (ma trận suy biến) nên app chưa sửa được."
    if o["n_chu"] and (pt is None or not pt.khop):
        return "Nhóm này có chữ bên trong mà app chưa đọc khớp được với nội dung trang."
    if o["b"] is None:
        return "Khối vẽ chưa đóng, app chưa sửa được."
    return None


def ds_doi_tuong(pdf, trang: int, chi_tiet: bool = False) -> list:
    """Các đối tượng không phải chữ trên trang `trang` (từ 1), theo thứ tự vẽ (cái sau nằm trên).
    Mỗi mục: id ("trang:a-b", ổn định khi file chưa đổi), trang, loai ("anh" | "hinh" | "nhom"), nguon ("anh" | "anh-inline" | "duong" | "khoi" | "nhom"),
    khung [x0, y0, x1, y1] (pt, trang nhìn thấy), sua_duoc, ly_do, so_phan_tu, co_chu (nhóm có chữ bên trong), nen_trang (phủ gần hết trang),
    thêm ten, rong_px, cao_px với ảnh và Form, phan_tu (id các nét con, tối đa 200) với nhóm.
    chi_tiet = False: gom theo khối q...Q và bỏ nét quá nhỏ; True: từng ảnh, từng nét riêng lẻ (id dùng được như id nhóm)."""
    khoa = chu_pdf.khoa_dem(pdf, trang)
    loai_dem = "dt-ct" if chi_tiet else "dt"
    if (loai_dem, *khoa) in chu_pdf._DEM_TRANG:
        return [dict(d) for d in chu_pdf._DEM_TRANG[(loai_dem, *khoa)]]
    with _mo_pdf(pdf) as k:
        if not 1 <= trang <= len(k.pages):
            raise LoiChu(f"File không có trang {trang}.")
        pt = chu_pdf._trang_nhe(k, trang)
        q = _quet_do_hoa(pt.lenh, pt.tai_nguyen, pt.hop)
        dt = _lap_doi_tuong(q, chi_tiet)
        if not chi_tiet:
            dt = [o for o in dt if not _qua_nho(o)]
        hop_trang = pt.hop
        _, nguoc = _ban_do(pt.hop, pt.r)
        if any(o["n_chu"] for o in dt):
            chu_pdf._bo_sung_chu(pt, pdf, trang)
        else:
            pt = None
    dien_tich = (hop_trang[2] - hop_trang[0]) * (hop_trang[3] - hop_trang[1])
    ra = []
    for o in dt:
        kh = _khung_hien(o, nguoc, pt)
        ly_do = _ly_do(o, q, pt)
        m = {"id": f"{trang}:{o['a']}-{o['b']}", "trang": trang, "loai": o["loai"], "nguon": o["nguon"], "khung": list(kh), "sua_duoc": ly_do is None,
             "ly_do": ly_do, "so_phan_tu": len(o["la"]), "co_chu": bool(o["n_chu"]),
             "nen_trang": (kh[2] - kh[0]) * (kh[3] - kh[1]) >= 0.9 * dien_tich}
        for t in ("ten", "rong_px", "cao_px"):
            if t in o:
                m[t] = o[t]
        if len(o["la"]) > 1:
            m["phan_tu"] = [f"{trang}:{q['la'][i]['a']}-{q['la'][i]['b']}" for i in o["la"][:200]]
        ra.append(m)
    chu_pdf.nho_dem(loai_dem, khoa, ra)
    return [dict(d) for d in ra]


# ---------- Sửa ----------

def _doc_id(id_, trang: int) -> tuple:
    m = re.fullmatch(r"(\d+):(\d+)-(\d+)", str(id_))
    if not m or int(m.group(1)) != int(trang):
        raise LoiChu("Mã đối tượng không đúng trang.")
    return int(m.group(2)), int(m.group(3))


def _so_thuc(v, ten):
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise LoiChu(f"Giá trị {ten} không phải số.")
    if f != f or abs(f) > 1e6:
        raise LoiChu(f"Giá trị {ten} không hợp lệ.")
    return f


def _tim_doi_tuong(q, a: int, b: int):
    """Đối tượng ứng với khoảng lệnh (a, b): một mục trong danh sách mặc định (kể cả nhóm gom dãy), một lá, hoặc một khối q...Q đã đóng."""
    if "tra" not in q:
        q["tra"] = {(o["a"], o["b"]): o for o in _lap_doi_tuong(q, False)}
    if (a, b) in q["tra"]:
        return q["tra"][a, b]
    for i, la in enumerate(q["la"]):
        if la["a"] == a and la["b"] == b:
            return _doi_tuong_tu_la(q, i)
    for n, nut in enumerate(q["nut"]):
        if n and nut["a"] == a and nut["b"] == b and nut["tat_ca"]:
            return _doi_tuong_tu_nut(q, n)
    return None


def _tinh_viec(o, viec: dict, kh_cu: tuple) -> tuple:
    """Từ việc của giao diện ra (V, khung mới): V là phép biến đổi trong tọa độ nhìn thấy (vectơ hàng), khung mới None nếu xóa."""
    loai = (viec or {}).get("loai")
    if loai == "xoa":
        return None, None
    if loai == "doi":
        dx, dy = _so_thuc(viec.get("dx", 0), "dx"), _so_thuc(viec.get("dy", 0), "dy")
        return (1.0, 0.0, 0.0, 1.0, dx, dy), (kh_cu[0] + dx, kh_cu[1] + dy, kh_cu[2] + dx, kh_cu[3] + dy)
    if loai == "co":
        km = viec.get("khung_moi")
        if not km or len(km) != 4:
            raise LoiChu("Thiếu khung mới để co đối tượng.")
        x0, y0, x1, y1 = (_so_thuc(v, "khung_moi") for v in km)
        x0, x1, y0, y1 = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
        rong, cao = kh_cu[2] - kh_cu[0], kh_cu[3] - kh_cu[1]
        if rong < 0.01 or cao < 0.01:
            raise LoiChu("Đối tượng quá mỏng nên không co theo khung được. Hãy dời thay vì co.")
        sx, sy = (x1 - x0) / rong, (y1 - y0) / cao
        if viec.get("giu_ti_le"):
            sx = sy = min(sx, sy)
        if sx < 0.005 or sy < 0.005:
            raise LoiChu("Khung mới quá nhỏ.")
        moi = (x0, y0, x0 + rong * sx, y0 + cao * sy)
        return (sx, 0.0, 0.0, sy, x0 - kh_cu[0] * sx, y0 - kh_cu[1] * sy), moi
    raise LoiChu("Việc với đối tượng phải là doi, co hoặc xoa.")


def _ke_hoach_trang(pt, q, so: int, viec: list, chi_so_lenh_chu: set) -> dict:
    """Tính các sửa đối tượng của một trang (pt: kết quả _trang_nhe hay _phan_tich_trang). Trả {chen_truoc, chen_sau, bo, vung, ket_qua}."""
    P = _ma_tran_nhin(pt.hop, pt.r)
    Pn = _nghich(P)
    _, nguoc = _ban_do(pt.hop, pt.r)
    chen_truoc, chen_sau, bo, vung, ket_qua, khoang = {}, {}, set(), [], [], []
    for v in viec:
        a, b = _doc_id(v["id"], so)
        o = _tim_doi_tuong(q, a, b)
        if o is None:
            raise LoiChu("Đối tượng này không còn trong trang (file đã đổi). Bấm chọn lại.")
        ly_do = _ly_do(o, q, pt if getattr(pt, "ds", None) is not None else None)
        if ly_do:
            raise LoiChu(ly_do)
        kh_cu = _khung_hien(o, nguoc, pt if getattr(pt, "ds", None) is not None else None)
        V, kh_moi = _tinh_viec(o, v.get("viec"), kh_cu)
        if any(a <= i <= b for i in chi_so_lenh_chu):
            raise LoiChu("Một dòng chữ đang sửa nằm trong đối tượng này. Sửa chữ và đối tượng ở hai lần lưu khác nhau.")
        khoang.append((a, b))
        pad = 3.0
        vung.append((kh_cu[0] - pad, kh_cu[1] - pad, kh_cu[2] + pad, kh_cu[3] + pad))
        if V is None:
            bo.update(range(a, b + 1))
        else:
            T = _nhan(_nhan(P, V), Pn)
            C = q["ctm_tai"][a]
            M = _nhan(_nhan(C, T), _nghich(C))
            chen_truoc.setdefault(a, []).extend([chu_pdf._lenh("q"), chu_pdf._lenh("cm", *[float(f"{x:.6f}") for x in M])])
            chen_sau.setdefault(b, []).extend([chu_pdf._lenh("Q"), *(q["lenh"][i] for i in o.get("phat_lai", ()))])
            vung.append((kh_moi[0] - pad, kh_moi[1] - pad, kh_moi[2] + pad, kh_moi[3] + pad))
        ket_qua.append({"trang": so, "id": v["id"], "khung_cu": list(kh_cu), "khung_moi": list(kh_moi) if kh_moi else None})
    khoang.sort()
    for (a1, b1), (a2, b2) in zip(khoang, khoang[1:]):
        if a2 <= b1:
            raise LoiChu("Hai đối tượng chọn chồng lên nhau (nhóm và phần tử trong nhóm, hoặc chọn trùng). Sửa từng cái một.")
    return {"chen_truoc": chen_truoc, "chen_sau": chen_sau, "bo": bo, "vung": vung, "ket_qua": ket_qua}


def _chuan_viec(ds, ten) -> dict:
    theo = {}
    for d in ds or []:
        try:
            so = int(d["trang"])
        except (KeyError, TypeError, ValueError):
            raise LoiChu(f"Mục {ten} thiếu số trang.")
        theo.setdefault(so, []).append(d)
    return theo


def ap_sua(pdf_vao, pdf_ra, sua_dong: list = None, sua_doi_tuong: list = None, kiem_tra: bool = True) -> dict:
    """Sửa chữ có sẵn và đối tượng cùng một lượt, mọi thay đổi tính trên bản phân tích của file nguyên bản rồi ghi một lần.
    sua_dong = [{trang, dong_id, chu_moi, thuoc_tinh?}] (dong_id lấy từ ds_dong / tim_dong);
    sua_doi_tuong = [{trang, id, viec}] (id lấy từ ds_doi_tuong), viec = {"loai": "doi", "dx", "dy"} (pt, trang nhìn thấy, y xuống) |
    {"loai": "co", "khung_moi": [x0, y0, x1, y1], "giu_ti_le"?: bool} | {"loai": "xoa"}.
    Không ghi đè pdf_vao. Trả {duong, ds: [kết quả từng dòng, như sua_nhieu_dong], doi_tuong: [{trang, id, khung_cu, khung_moi}]}.
    Một dòng chữ nằm trong nhóm đang dời/co/xóa, hay hai đối tượng chồng nhau, thì báo lỗi (LoiChu)."""
    ra = _mo_ra_an_toan(pdf_vao, pdf_ra)
    chu_theo, dt_theo = _chuan_viec(sua_dong, "sửa dòng"), _chuan_viec(sua_doi_tuong, "sửa đối tượng")
    if not chu_theo and not dt_theo:
        raise LoiChu("Chưa có gì để sửa.")
    ket_chu, ket_dt, vung = [], [], {}
    try:
        with _mo_pdf(pdf_vao) as pdf:
            for so in sorted(set(chu_theo) | set(dt_theo)):
                if not 1 <= so <= len(pdf.pages):
                    raise LoiChu(f"File không có trang {so}.")
                pt = chu_pdf._trang_nhe(pdf, so)
                q = _quet_do_hoa(pt.lenh, pt.tai_nguyen, pt.hop) if dt_theo.get(so) else None
                can_chu = bool(chu_theo.get(so))
                if q is not None and not can_chu:  # nhóm có chữ cần vị trí chữ từ pdfium
                    for v in dt_theo[so]:
                        a, b = _doc_id(v["id"], so)
                        o = _tim_doi_tuong(q, a, b)
                        if o is not None and o["n_chu"]:
                            can_chu = True
                if can_chu:
                    chu_pdf._bo_sung_chu(pt, pdf_vao, so)
                thay, khoi, vung_t = {}, [], []
                viec_chu = []
                for d in chu_theo.get(so, []):
                    ks = chu_pdf._doc_ma_dong(d["dong_id"], so)
                    viec_chu.append((ks, d))
                if len({k for ks, _ in viec_chu for k in ks}) != sum(len(ks) for ks, _ in viec_chu):
                    raise LoiChu("Hai chỗ sửa trùng cùng một đoạn chữ.")
                for ks, d in viec_chu:
                    if any(k >= len(pt.ds) for k in ks):
                        raise LoiChu("Dòng này không còn trong trang (file đã đổi). Bấm chọn lại dòng.")
                if viec_chu and pt.loi:
                    raise LoiChu(pt.loi)
                for ks, d in viec_chu:
                    chu_moi = str(d.get("chu_moi", "")).replace("\r", "").replace("\n", " ")
                    kq = chu_pdf._tinh_sua_dong(pdf, pt, ks, chu_moi, d.get("thuoc_tinh") or {}, bool(d.get("giu_do_rong", True)))
                    thay.update(kq["thay"])
                    khoi.append(kq["khoi"])
                    vung_t += kq["vung"]
                    ket_chu.append({k: v for k, v in kq["tt"].items()})
                chen_truoc = chen_sau = None
                bo = set()
                if q is not None:
                    kh = _ke_hoach_trang(pt, q, so, dt_theo[so], set(thay))
                    chen_truoc, chen_sau, bo = kh["chen_truoc"], kh["chen_sau"], kh["bo"]
                    vung_t += kh["vung"]
                    ket_dt += kh["ket_qua"]
                chu_pdf._lenh_moi_va_ghi(pdf, pt, thay, b"".join(khoi), chen_truoc, chen_sau, bo)
                vung[so] = vung_t
            kt = (lambda tam: _so_anh(pdf_vao, tam, vung)) if kiem_tra else None
            _luu_an_toan(pdf, ra, kt)
    except pikepdf.PdfError as e:
        raise LoiChu(f"Không ghi được PDF: {e}")
    return {"duong": str(ra), "ds": ket_chu, "doi_tuong": ket_dt}


def sua_doi_tuong(pdf_vao, pdf_ra, ds: list, kiem_tra: bool = True) -> dict:
    """ds = [{trang, id, viec}]; xem ap_sua. Ghi pdf_ra, không đụng pdf_vao."""
    return ap_sua(pdf_vao, pdf_ra, sua_doi_tuong=ds, kiem_tra=kiem_tra)


def xem_thu(pdf, trang: int, id_: str, viec: dict) -> dict:
    """Tính thử một việc mà không ghi file: {khung_cu, khung_moi (None nếu xóa), sua_duoc, ly_do}. Lỗi báo bằng LoiChu."""
    with _mo_pdf(pdf) as k:
        if not 1 <= trang <= len(k.pages):
            raise LoiChu(f"File không có trang {trang}.")
        pt = chu_pdf._trang_nhe(k, trang)
        q = _quet_do_hoa(pt.lenh, pt.tai_nguyen, pt.hop)
        a, b = _doc_id(id_, trang)
        o = _tim_doi_tuong(q, a, b)
        if o is None:
            raise LoiChu("Đối tượng này không còn trong trang (file đã đổi). Bấm chọn lại.")
        if o["n_chu"]:
            chu_pdf._bo_sung_chu(pt, pdf, trang)
        else:
            pt.ds = None
        _, nguoc = _ban_do(pt.hop, pt.r)
        ly_do = _ly_do(o, q, pt if pt.ds is not None else None)
        kh_cu = _khung_hien(o, nguoc, pt if pt.ds is not None else None)
        _, kh_moi = _tinh_viec(o, viec, kh_cu)
    return {"khung_cu": list(kh_cu), "khung_moi": list(kh_moi) if kh_moi else None, "sua_duoc": ly_do is None, "ly_do": ly_do}
