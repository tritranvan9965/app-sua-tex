# Hướng dẫn soạn bài bằng mẫu tritoan

File cũ dùng `\RequirePackage{tritoan}` vẫn chạy như cũ, không phải sửa gì.

## Chọn mẫu

Các mẫu đều nằm trong thư viện mẫu của TriTeX (`%APPDATA%\TriTeX\thu-vien-mau\tritoan`). Khi biên dịch, TriTeX tự lấy mẫu từ đó, thư mục soạn bài **không cần chép**.

| Mẫu | Dùng cho | Dòng cần gõ |
|---|---|---|
| `toan_thcs` | Tài liệu, bài tập cấp 2 | `\usepackage{toan_thcs}` |
| `toan_thpt` | Tài liệu, bài tập cấp 3 | `\usepackage{toan_thpt}` |
| `kiem_tra_thcs` | Đề kiểm tra cấp 2 kiểu Sở HN (các bài `baihn`: Bài I, II, ...), in đen trắng | `\usepackage{kiem_tra_thcs}` |
| `kiem_tra_thpt` | Đề kiểm tra cấp 3: trắc nghiệm, đúng sai, trả lời ngắn + tự luận, in đen trắng. Câu hỏi giống `toan_thpt`, kéo sang dùng ngay | `\usepackage{kiem_tra_thpt}` |
| `thptqg` | Đề thi tốt nghiệp THPT: giống `kiem_tra_thpt`, chỉ khác đầu đề (kỳ thi tốt nghiệp, khung tên đề như ĐỀ THI THỬ 01) | `\usepackage{thptqg}` |
| `tu_do` | Mẫu trơn: chỉ đầu trang, chân trang, tiêu đề, đề mục; không hộp màu | `\usepackage{tu_do}` |

Các lệnh soạn câu hỏi (`tn`, `ds`, `tln`, `bt`, `vd`, `\loigiai`, `\dang`, `\phan`...) giống nhau ở mọi mẫu, chỉ khác cách in.

## Hai cách dùng

**Cách (a): gọi thẳng mẫu trong file `.tex`.** Gọn nhất, không cần thêm file nào. Đặt môn bằng `\mon`:

```latex
\documentclass[12pt]{article}
\usepackage{kiem_tra_thpt}
\begin{document}
\mon{TOÁN 10}
\taodaude
```

Cách này không có danh mục chương. Muốn có tên tài liệu thì đặt tay bằng `\dattentailieu{Chuyên đề Hàm số}`. Nếu file dùng `\loai{..}`, `\chuong{..}` mà không có danh mục thì TriTeX báo lỗi, đó là đúng.

**Cách (b): thư mục soạn bài làm một mẫu con mỏng** (đặt tên theo ý, ví dụ `toan10.sty`), có danh mục lớp và tên môn. Mẫu con chỉ vài dòng:

```latex
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{toan10}[2026/11/11 Mau tai lieu Toan 10]
\RequirePackage{toan_thpt}        % gọi mẫu trong thư viện
\input{danhmuc10.tex}             % danh mục nằm cạnh file này
\mon{TOÁN 10}                     % tên môn
\endinput
```

Đề kiểm tra thì còn ngắn hơn (`de10.sty`):

```latex
\RequirePackage{kiem_tra_thpt}
\mon{TOÁN 10}
```

Rồi trong file `.tex` chỉ cần `\usepackage{toan10}` hoặc `\usepackage{de10}`. Chép mẫu con từ thư mục `vi-du` rồi đổi số.

Chỗ đặt mẫu con và danh mục:

- Đặt **chung một thư mục** trong thư mục soạn bài, ví dụ `Tài liệu Toán 10\mau\`. Danh mục phải nằm **cạnh** mẫu con (TriTeX chỉ chép file cùng thư mục với mẫu con). Không dùng đường dẫn `../...`.
- TriTeX tìm mẫu con từ thư mục chứa file `.tex` đi ngược lên tối đa 4 cấp, rồi tìm xuống mỗi nhánh tối đa 3 cấp. Thư mục có tên bắt đầu bằng `.` hoặc `_` bị bỏ qua.
- Muốn khác mẫu thư viện thì ghi đè trong mẫu con, không sửa mẫu thư viện:

```latex
\renewcommand{\chantrang}{Ôn thi Toán 10 - Thầy Trí}   % dòng chân trang
\definecolor{xanh}{HTML}{0B5345}                         % màu chủ đạo (mẫu tài liệu)
\truong{TRƯỜNG THPT ...}                                 % trường in ở đầu đề
```

- Thêm lệnh riêng thì dùng `\newcommand`. Trùng tên lệnh của mẫu thư viện thì LaTeX báo lỗi ngay, nhờ vậy không đè nhầm.
- Không định nghĩa lại các môi trường `tn`, `ds`, `tln`, `bt`, `vd`.
- Lệnh nào hữu ích cho mọi người thì đề nghị đưa vào mẫu thư viện, đừng chép sang nhiều mẫu con.
- Script riêng của thư mục (ví dụ `xuat.py` tự biên dịch, không qua TriTeX) phải tự chép các file `.sty` từ thư viện mẫu sang chỗ biên dịch.

**Danh mục** (`danhmuc10.tex`) theo khuôn sau (chép từ `vi-du\danhmuc10.tex`):

```latex
\dmuc{loai1}{CÁC CHUYÊN ĐỀ CƠ BẢN TOÁN 10}      % tên bộ, in bên phải đầu trang
\dmuc{loai2}{ĐỀ KIỂM TRA TOÁN 10}
\dmuc{chuong1}{Chương I. Mệnh đề và tập hợp}
\dmucngan{chuong1}{Chương I. Mệnh đề, tập hợp}   % tên ngắn cho đầu trang, chỉ cần với tên dài
\dmuc{chuyende1}{Chuyên đề 1. ...}
```

Thiếu tên chương hay chuyên đề thì thêm một dòng `\dmuc{...}` vào file danh mục.

## Soạn tài liệu, bài tập (toan_thcs, toan_thpt, tu_do)

Chép file hợp loại từ `vi-du` sang thư mục soạn bài rồi đổi tên:

- `mau1-chuyen-de-co-ban.tex`: chương, bài, dạng
- `mau3-on-thi.tex`: chuyên đề ôn thi
- `tai-lieu-thcs.tex`, `tai-lieu-thpt.tex`, `tu-do.tex`: mỗi mẫu một ví dụ ngắn

| Muốn viết | Gõ |
|---|---|
| Tên bài | `\tieude{\tentailieu}{Bài 1. Mệnh đề}` |
| Mục A, B, C | `\phan{A. Lý thuyết}` |
| Dạng | `\dang{Tên dạng}` |
| Đề mục loại bài (đặt trong một dạng) | `\muctl` (tự luận), `\muctn` (trắc nghiệm), `\mucds` (đúng sai), `\muctln` (trả lời ngắn) |
| Tự luận | `\begin{bt} đề \loigiai{...} \end{bt}` |
| Trắc nghiệm | `\begin{tn} đề \pa{..}{\dung{đáp án đúng}}{..}{..} \end{tn}` |
| Đúng sai | `\begin{ds} đề \ydung{..} \ysai{..} \ydung{..} \ysai{..} \end{ds}` |
| Trả lời ngắn | `\begin{tln} đề \traloi{2,5} \end{tln}` |
| Lời giải | `\loigiai{...}` đặt trước `\end{...}` |
| Bảng đáp án | `\bangdapan` ở cuối bài hoặc cuối đề |
| Bài mới trong cùng file | `\baimoi` rồi `\tieude{}{Bài 2. ...}` |
| Tên môn | `\mon{TOÁN 10}` |
| Tên tài liệu khi không có danh mục | `\dattentailieu{Tên tài liệu}` |

Với mẫu `tu_do`, các đề mục in chữ đậm trơn, không hộp màu, không dải nền.

Mẹo: chép một câu có sẵn trong file mẫu rồi sửa chữ, khỏi phải nhớ lệnh.

## Soạn đề kiểm tra, đề thi (kiem_tra_thcs, kiem_tra_thpt, thptqg)

Chép `de-thcs.tex`, `de-thpt.tex` hoặc `de-thptqg.tex` từ `vi-du`.

### Đề THPT: `kiem_tra_thpt` và `thptqg`

Hai mẫu này **giống hệt nhau, chỉ khác phần đầu đề**. Cả hai dùng chung lõi với `toan_thpt`, chỉ khác cách trình bày:
in đen trắng, không có đầu trang, chân trang như tài liệu ("Giỏi Toán cùng Trí Trí - ĐT: …" | "Trang x"),
trang cuối **tự có chữ "— HẾT —"** (không cần gõ `\hetde`; ở bản GV chữ HẾT nằm sau bảng đáp án).
Đổi qua lại giữa hai mẫu chỉ cần sửa dòng `\usepackage`.

| | `kiem_tra_thpt` (đề kiểm tra) | `thptqg` (đề thi tốt nghiệp) |
|---|---|---|
| Ô trái đầu đề | **GIỎI TOÁN CÙNG TRÍ TRÍ**, dưới là nguồn đề `\nguon{..}` | **GIỎI TOÁN CÙNG TRÍ TRÍ**, dưới là khung tên đề `\tende{..}` (ví dụ **ĐỀ THI THỬ 01**, **ĐỀ MINH HỌA 01**) |
| Ô phải đầu đề | tên đề `\tende{..}`, **NĂM HỌC …**, Môn, Thời gian | KỲ THI TỐT NGHIỆP THPT NĂM …, Môn thi, Thời gian |
| Dòng ký tên | Họ, tên học sinh | Họ, tên thí sinh |

```latex
\documentclass[12pt]{article}
\usepackage{kiem_tra_thpt}            % hoặc \usepackage{thptqg}
\begin{document}
\mon{TOÁN 10}
\tende{Kiểm tra giữa học kì I}        % (kiem_tra_thpt) tên đề, ô phải
\nguon{THPT Phan Huy Chú - Đống Đa}   % (kiem_tra_thpt) nguồn đề, ô trái; bỏ trống thì không in
\made{101}
\taodaude
\phantn  ... các câu ...
\phands  ... các câu ...
\phantln ... các câu ...
\phantl[3,0] ... các bài tự luận ...  % nếu có
\bangdapan
\end{document}
```

Lệnh thông tin đề (cái nào không ghi thì lấy mặc định):

| Lệnh | Mẫu | Tác dụng |
|---|---|---|
| `\mon{TOÁN 10}` | cả hai | tên môn |
| `\tende{..}` (hoặc `\kythi{..}`) | `kiem_tra_thpt` | tên đề, dòng đầu ô phải |
| `\nguon{..}` | `kiem_tra_thpt` | nguồn đề, dưới "GIỎI TOÁN CÙNG TRÍ TRÍ" |
| `\namhoc{..}` | `kiem_tra_thpt` | năm học; không ghi thì tự tính theo ngày xuất (từ tháng 8 sang năm học mới) |
| `\so{..}` | cả hai | đổi dòng trên cùng ô trái |
| `\tende{..}` | `thptqg` | tên đề trong khung ô trái, in chữ hoa: `\tende{Đề thi thử 01}`, `\tende{Đề minh họa 01}`... (không ghi thì "ĐỀ THI THỬ") |
| `\namthi{2026}` | `thptqg` | năm trong dòng KỲ THI TỐT NGHIỆP TRUNG HỌC PHỔ THÔNG NĂM … |
| `\thoigian{90 phút}`, `\made{101}` | cả hai | thời gian làm bài, mã đề (bỏ trống thì không in ô mã đề) |

**Kéo câu từ ngân hàng, file bài tập sang đề là dùng được, không phải sửa:**

- Câu `tn`, `ds`, `tln`, `bt`, `\pa`, `\loigiai`, `\dapso`, `cacy`, `\hinh`... giữ nguyên.
- Câu viết bằng `bt` nằm trong PHẦN I, II, III tự in "Câu n" và đếm chung với `tn`, `ds`, `tln`. Trong phần tự luận vẫn là "Bài n".
- Trong PHẦN III, `\dapso{..}` có ô Đáp số và vào bảng đáp án như `\traloi{..}`.
- Lỡ chép theo cả đề mục của tài liệu cũng không lỗi: `\muctn` thành PHẦN I, `\mucds` thành PHẦN II, `\muctln` thành PHẦN III,
  `\muctl` thành phần tự luận; `\phan{PHẦN I. ...}` của ngân hàng cũng vậy. `\dang`, `\tieude`, `\loai`, `\chuong` không in gì.
- Bảng đáp án lấy đáp án từ `\dung`, `\ydung`/`\ysai`, `\traloi` và `\dapso` (PHẦN III). Câu đúng sai viết bằng `bt` + `cacy`
  (đáp án nằm trong lời giải) thì chưa vào bảng.

### Đề THCS: `kiem_tra_thcs`

Thông tin đề, ghi trước `\taodaude`:

```latex
\mon{TOÁN 9}  \so{...}  \truong{...}  \kythi{...}  \namhoc{2026 -- 2027}  \ngaythi{..}  \thoigian{90 phút}  \made{101}
\taodaude
```

Cấu trúc: các bài `baihn`, `\hetde`. Muốn thêm trắc nghiệm: `\phantn` (I), `\phantl` (II. Tự luận kiểu `bt`).

| Lệnh | Tác dụng |
|---|---|
| `\begin{baihn}{1,5}` | "Bài I. (1,5 điểm)", đánh số La Mã. Ý nhỏ viết trong `\begin{ychinh} \item ... \end{ychinh}` (1), 2), 3)) |
| `\phantn[3,0]` | PHẦN TRẮC NGHIỆM, có thể kèm điểm cả phần |
| `\namhoc{..}`, `\ngaythi{..}` | năm học, ngày thi in ở đầu đề (bỏ trống thì không in) |

### Lệnh dùng chung cho đề có tự luận

| Lệnh | Tác dụng |
|---|---|
| `\phantl` hoặc `\phantl[3,0]` | PHẦN TỰ LUẬN, có thể kèm điểm cả phần. Bài tự luận đánh số lại từ 1 |
| `\diem{2,0}` | Đặt ngay sau `\begin{bt}`: in "Bài 1. **(2,0 điểm)** ..." |

Ví dụ một bài tự luận:

```latex
\phantl[3,0]
\begin{bt}\diem{1,5}
Giải phương trình $x^2-5x+6=0$.
\loigiai{$x=2$ hoặc $x=3$.}
\end{bt}
```

**Đổi đề cũ sang mẫu `kiem_tra_thcs`.** Chỉ đổi tên mẫu là chưa đủ, phải làm hai việc:

1. Xoá khối khung từ dòng `% ----- Khung đề kiểm tra kiểu Sở HN` đến dòng `% ----- Hết khung -----` (có `\taodauhn`, `baihn`, `ychinh`, `\hetdehn`, `\phantl`). Mẫu đã có sẵn các lệnh này, khai lại sẽ báo lỗi "already defined".
2. Khai thông tin đề bằng lệnh của mẫu, ngay sau `\begin{document}` và trước `\taodauhn`. Mấy dòng `\newcommand{\dh@...}` cũ không còn tác dụng.

```latex
\documentclass[12pt]{article}
\usepackage{kiem_tra_thcs}      % thay cho \usepackage{toan9}
\begin{document}
\mon{TOÁN 9}
\so{Giỏi Toán cùng Trí Trí}
\truong{THCS CAO LỘC 25-26}
\kythi{Kiểm tra giữa học kì II}
\namhoc{2026 -- 2027}
\taodauhn                       % hoặc \taodaude, như nhau
```

Phần còn lại giữ nguyên: `\phantn`, `tn`, `\phantl`, `baihn`, `ychinh`, `\hetdehn` (hoặc `\hetde`), `\bangdapan`. Dòng `\loai{4}\dattentailieu{...}` bỏ được. Muốn đầu trang vẫn hiện tên tài liệu thì giữ `\dattentailieu{Kiểm tra giữa HK2}`. File chưa sửa vẫn dùng `toan9` như cũ, không hỏng.

Ba mẫu đề in đen trắng. `kiem_tra_thcs` có chân trang "Trang x/y - Mã đề"; `kiem_tra_thpt`, `thptqg` có chân trang như tài liệu. Bảng đáp án chỉ in ở bản GV.

## Xuất PDF trong TriTeX

- Mặc định ra **bản GV** (có lời giải, đáp án).
- Muốn **bản HS**: bấm nút **Ẩn đáp án** (Ctrl+Shift+H) rồi Chạy thử hoặc Lưu ra PDF. Bấm lại là về bản GV. File `.tex` không phải sửa gì.
- Bản HS tự bỏ: `\loigiai{..}`, `\dapso{..}`, gạch chân `\dung{..}`, chữ Đúng/Sai của `\ydung`/`\ysai`, số trong ô `\traloi{..}`, nhãn mức độ, `\bangdapan`. Ví dụ `vd` + `\giai{..}` vẫn in ở cả hai bản.
- Ngoài TriTeX (tự chạy xelatex): thêm `\def\BANHS{1}` vào dòng đầu tiên của file, trước `\documentclass`.

## Ảnh

**1. Chỗ đặt.** Ảnh của file `X.tex` nằm ở `hinh\X\` cạnh file `.tex`. Tên thư mục lấy từ tên file `.tex`, bỏ dấu, dấu cách thành `-` (`Buổi 01 Hàm số.tex` → `hinh\Buoi-01-Ham-so\`). Tên ảnh không dấu, không dấu cách.

**2. Tên ảnh.** TriTeX tự đặt `h001`, `h002`, … tăng dần, không dùng lại số đã có trong thư mục. Đừng đổi tên bằng tay khi ảnh đã chèn vào bài.

**3. Loại ảnh.**

| Dùng cho | Loại |
|---|---|
| Ảnh chụp màn hình, hình vẽ | PNG |
| Hình cắt từ PDF | PDF |
| Ảnh chụp thật | JPG |

WEBP, BMP dán vào thì TriTeX tự đổi sang PNG.

**4. Lệnh chèn ảnh.**

| Muốn viết | Gõ |
|---|---|
| Ảnh căn giữa (tỉ lệ bỏ trống = 0.5) | `\hinh[0.5]{hinh/X/h001.png}` |
| Ảnh bên phải nội dung (tỉ lệ bỏ trống = 0.4) | `\hinhphai[0.4]{hinh/X/h001.png}{nội dung}` |
| Ảnh bên trái nội dung | `\hinhtrai[0.4]{hinh/X/h001.png}{nội dung}` |

Tỉ lệ là phần của độ rộng dòng (`\linewidth`). Lệnh `\hinhgoc` cũ vẫn dùng được.

**5. Làm trong TriTeX (chế độ Theo dòng).**

- Dán (Ctrl+V) hoặc kéo file ảnh vào một câu: ảnh được lưu và chèn vào cuối phần đề, trước lời giải.
- Bấm vào ảnh để chọn: kéo núm ở góc để đổi cỡ, nút nhỏ cạnh ảnh để thay ảnh, đổi căn giữa hay bên phải, cắt ảnh, sửa code, xoá.
- Mỗi thay đổi là một bước Ctrl+Z.

**6. Xoá ảnh.** Xoá ảnh là bỏ lệnh khỏi `.tex` ngay, Ctrl+Z lấy lại được. Khi **Lưu**, ảnh bạn đã xóa khỏi bài (ảnh file từng dùng khi mở hoặc lúc lưu trước, hoặc TriTeX vừa thêm, nay không còn lệnh nào nhắc tới) được đưa vào Thùng rác của Windows, lấy lại được từ đó. Ảnh tự chép vào `hinh\X\` mà bài chưa từng dùng thì không bị đụng, ảnh ở nơi khác cũng vậy.
