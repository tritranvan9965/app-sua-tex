# Mô tả ảnh chụp giao diện app "Sửa TeX" (1440x900)

App Windows để sửa LaTeX và xem, tách, gộp, in PDF; thay Foxit Phantom PDF cho giáo viên. Giao diện: ribbon kiểu Word ở trên (Tệp, Trang chủ, Chèn, Trang, Chú thích, Tài liệu, Xem), thanh file bên trái, vùng làm việc ở giữa, thanh trạng thái ở dưới. Nút "sắp có" là nút đã hiện nhưng chưa làm; bấm vào chỉ báo "chức năng này sắp có". Nút bị mờ là nút đang không dùng được.

| Ảnh | Màn hình và thao tác |
|---|---|
| 01-man-hinh-dau | Vừa mở app, chưa mở file nào. Tab Trang chủ. Giữa màn hình là "Bắt đầu" và danh sách "Gần đây". |
| 02-mo-tex | Bấm CD2.tex ở thanh file. Mã LaTeX bên trái, PDF đã biên dịch bên phải. Tab Trang chủ. |
| 03-ribbon-trang-chu | Tab Trang chủ khi đang mở file .tex. |
| 04-ribbon-chen | Tab Chèn: toàn bộ nút ở tab này là "sắp có". |
| 05-ribbon-trang-khi-mo-tex | Tab Trang khi đang ở file .tex. |
| 06-ribbon-chu-thich-khi-mo-tex | Tab Chú thích khi đang ở file .tex. |
| 07-ribbon-tai-lieu | Tab Tài liệu. |
| 08-ribbon-xem-khi-mo-tex | Tab Xem khi đang ở file .tex. |
| 09-menu-tep | Bấm nút "Tệp" góc trên trái: menu Mở file, Mở thư mục, Lưu, Biên dịch để xem, Xuất PDF, In, Đóng file, Thư viện mẫu, Phím tắt, Thoát. |
| 10-tooltip-nut-bien-dich | Rê chuột vào nút Biên dịch (tab Trang chủ, file .tex): tooltip "Biên dịch F5 - Tạo PDF để xem, chưa tạo file dùng". |
| 11-mo-pdf | Bấm CD2_GV.pdf ở thanh file: PDF mở thành thẻ riêng; dải trang thu nhỏ bên trái, trang to bên phải. |
| 12-ribbon-trang-chu-khi-mo-pdf | Tab Trang chủ khi đang mở PDF (Biên dịch, Xuất PDF bị mờ). |
| 13-ribbon-trang-khi-mo-pdf | Tab Trang khi đang mở PDF: chọn trang, xoay, xóa, lưu thành file... |
| 14-ribbon-chu-thich-khi-mo-pdf | Tab Chú thích khi đang mở PDF (mặc định đang ở Chọn chữ). |
| 15-ribbon-tai-lieu-khi-mo-pdf | Tab Tài liệu khi đang mở PDF. |
| 16-ribbon-xem-khi-mo-pdf | Tab Xem khi đang mở PDF. |
| 17-chon-chu-alt1 | Bấm Alt+1 (Chọn chữ), tab Chú thích. Trạng thái DOM: nút Chọn chữ aria-pressed=true, Chọn vùng aria-pressed=false (cả nút ribbon lẫn nút #nav-chu, #nav-vung ở thanh dưới). |
| 18-chon-vung-alt2 | Bấm Alt+2 (Chọn vùng). DOM: Chọn chữ aria-pressed=false, Chọn vùng aria-pressed=true. Nền nút đang bật là xanh nhạt rgb(232,239,233), viền và chữ xanh đậm; nút không bật nền trong suốt. |
| 19-chon-chu-bam-nut | Bấm nút Chọn chữ trên ribbon để quay lại chế độ chọn chữ. |
| 20-sap-trang-da-chon-4-trang | Tab Trang, gõ "1-3, 5" vào ô chọn trang rồi Enter: đã chọn 4 / 41 trang. |
| 21-day-trang-muc-luc | Bấm nút "Mục lục" ở đầu dải trang bên trái (thay cho trang thu nhỏ). |
| 22-menu-chuot-phai-file-pdf | Bấm chuột phải vào CD2_GV.pdf ở thanh file. |
| 23-menu-chuot-phai-file-tex | Bấm chuột phải vào CD2.tex ở thanh file. |
| 24-menu-chuot-phai-thu-muc | Bấm chuột phải vào thư mục "Ngân hàng" ở thanh file. |
| 25-menu-chuot-phai-trang-pdf | Bấm chuột phải lên một trang PDF. |
| 26-hop-thoai-in | Ctrl+P khi đang mở PDF: hộp thoại In có xem trước. |
| 27-tooltip-nut-chi-co-bieu-tuong | Rê chuột vào nút "Đảo thứ tự" (tab Trang), nút chỉ có biểu tượng. |
| 28-bam-nut-sap-co-phan-so | Tab Chèn, bấm nút "Phân số": chỉ hiện thông báo nhỏ "Phân số: chức năng này sắp có." |
| 29-tooltip-nut-sap-co-cau-moi | Rê chuột vào nút "Câu mới" (sắp có). |
| 30-tooltip-nut-bi-mo-bien-dich-khi-mo-pdf | Rê chuột vào nút Biên dịch đang bị mờ (đang mở PDF): tooltip vẫn chỉ nói công dụng, không nói vì sao mờ. |
| 31-cat-cong-cu-dang-chon-chu-ribbon / -thanh-duoi | Ảnh cắt phóng to x2: nhóm "Công cụ" của ribbon và cụm nút ở thanh dưới lúc đang ở Chọn chữ. |
| 32-cat-cong-cu-dang-chon-vung-ribbon / -thanh-duoi | Như trên nhưng đang ở Chọn vùng. |
| 33-the-tex-sau-khi-dung-cong-cu-pdf | Quay lại thẻ CD2.tex. |

Ghi chú kỹ thuật: ảnh chụp bằng Edge headless, không lưu hay sửa file dữ liệu nào.
