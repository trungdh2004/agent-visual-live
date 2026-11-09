# CSM-002: Theo dõi File chỉnh sửa & Cảnh báo xung đột ghi đè (`File Collision Detection`)

- **Status**: `DONE`
- **Priority**: P0 (High)
- **Estimate**: M (~2–3h)
- **Dependencies**: None
- **Files Touched**:
  - `src/csm/transcript.py`
  - `src/csm/fleet.py`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Khi chạy nhiều phiên Claude Code song song trong cùng một dự án (Fleet), rủi ro lớn nhất là 2 agent cùng chỉnh sửa (`Edit`, `Write`, `MultiEdit`) một file mã nguồn mà không biết sự tồn tại của nhau, dẫn đến ghi đè code hoặc xung đột logic. Hiện tại `transcript.py` mới chỉ theo dõi `Bash`, `SendMessage`, `Skill` và `mcp__*`.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Trích xuất thao tác file trong `src/csm/transcript.py`**:
   - Khởi tạo thêm `self.files_edited: dict[str, dict] = {}` trong `SessionTranscript.__init__`.
   - Trong `SessionTranscript._tool_use(self, block: dict, stamp: str)`:
     - Nếu `name in ("Edit", "Write", "MultiEdit", "NotebookEdit")`:
       - Lấy đường dẫn từ `args.get("file_path") or args.get("notebook_path") or args.get("path")`.
       - Chuẩn hóa đường dẫn (nếu là đường dẫn tương đối hoặc tuyệt đối) và cập nhật vào `self.files_edited[path]`:
         ```python
         entry = self.files_edited.setdefault(path, {"path": path, "edits": 0, "last": ""})
         entry["edits"] += 1
         entry["last"] = max(entry["last"], stamp or "")
         ```
2. **Phát hiện xung đột trong `src/csm/fleet.py`**:
   - Trong `Fleet.snapshot()`, đính kèm trường `"filesEdited"` (sắp xếp theo thời gian `last` giảm dần, tối đa 25 file) vào mỗi `card`.
   - Viết phương thức `_attach_collisions(cards: list[dict])`:
     - Xây dựng bảng ánh xạ `by_path: dict[str, list[dict]]` từ tất cả các phiên đang chạy (`status != "exited"`).
     - Với mỗi `path` có `len(owners) >= 2`:
       - Ghi nhận vào từng `card` trong `owners` danh sách `card["conflicts"]`:
         ```python
         {
             "path": path,
             "peers": [other["name"] for other in owners if other["id"] != card["id"]],
         }
         ```
3. **Hiển thị trên Giao diện (`web/app.js`, `web/style.css`)**:
   - **Trên Card (`.card`)**:
     - Nếu `s.conflicts && s.conflicts.length > 0`, hiển thị một badge cảnh báo màu hổ phách/đỏ `⚠ Trùng ${s.conflicts.length} file` ở `.card-foot` hoặc `.banner-slot` (kèm tooltip liệt kê tên file và tên phiên đang đụng độ).
   - **Trong Inspector (`Tổng quan`)**:
     - Thêm khối **`File đã chỉnh sửa (${s.filesEdited.length})`**:
       - Hiển thị đường dẫn rút gọn (so với `cwd` hoặc `~`) kèm số lần sửa (`N lần`).
       - Nếu file nằm trong `s.conflicts`, tô viền cảnh báo và ghi rõ `⚠ Đụng độ với: <tên peer>`.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] `transcript.py` bắt chính xác các lệnh `Edit`, `Write`, `MultiEdit`, `NotebookEdit` mà không làm tăng chi phí đọc file (vẫn tận dụng cơ chế tail theo byte offset).
- [ ] Nếu dữ liệu JSON trong transcript thiếu `file_path`, hệ thống bỏ qua an toàn và không văng ngoại lệ.
- [ ] Khi 2 phiên đang chạy cùng sửa chung 1 đường dẫn file, cả 2 thẻ trên đồ thị đều xuất hiện badge `⚠ Trùng N file`.
- [ ] Trong tab `Tổng quan` của Inspector, người dùng xem được danh sách các file phiên đó đã sửa và thấy rõ file nào đang bị đụng độ với phiên nào.
