# CSM-008: Bộ thu thập Telemetry cho OpenCode (`src/csm/opencode.py`)

- **Status**: `DONE`
- **Priority**: P0 (High)
- **Estimate**: M (~2h)
- **Dependencies**: None
- **Files Touched**:
  - `src/csm/opencode.py` (new)
  - `tests/test_multi_agent.py`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Người dùng chạy các phiên OpenCode (`opencode`) trên máy và muốn giám sát trạng thái, lượng token tiêu thụ, chi phí (`cost`), nhánh subagent (`parent_id`), lệnh bash và các file đang chỉnh sửa của OpenCode trên cùng bảng điều khiển.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Phát hiện Tiến trình OpenCode & Tmux Pane**:
   - Quét `/proc/[0-9]*/cmdline` để tìm các tiến trình `opencode` đang chạy (loại trừ tiến trình nền `opencode serve --service`).
   - Đọc `/proc/<pid>/cwd` và dò `tmux` pane (`%pane_id`) theo cây PID để hỗ trợ tính năng `Nhảy tới pane ↗` và xem trực tiếp `Terminal` cho các phiên OpenCode CLI.
2. **Đọc SQLite Database (`~/.local/share/opencode/opencode.db`)**:
   - Mở kết nối `file:~/.local/share/opencode/opencode.db?mode=ro`.
   - Truy vấn bảng `session_v2` cho các phiên có `time_archived IS NULL` và (`time_updated` trong vòng **2 giờ gần nhất** hoặc khớp với tiến trình `opencode` đang chạy), cùng các phiên con qua `parent_id` / `fork_session_id`.
   - Ánh xạ trực tiếp các cột telemetry:
     - `id`, `slug`, `title`, `directory` (`cwd`), `parent_id`, `agent`, `model` (parse JSON lấy `id` / `providerID`).
     - `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, `cost`.
3. **Đọc `session_message` để trích xuất Hội thoại, Bash & File Edits**:
   - Đọc các bản ghi trong `session_message` của những phiên đang hoạt động.
   - Parse cột JSON `data`:
     - Lấy nội dung prompt của user và câu trả lời của assistant.
     - Trích xuất các tool call liên quan đến `bash` và chỉnh sửa file (`edit`, `write`, `patch`, hoặc mảng `files`) đưa vào `files_edited` và `bash`.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Đọc `opencode.db` ở chế độ `mode=ro` an toàn với WAL mode của OpenCode.
- [ ] Hiển thị chính xác tên phiên (`title` hoặc `slug`), model, số lượng token, trạng thái (`busy` / `waiting` / `idle` / `exited`) và `tmux_target` nếu chạy trong `tmux`.
- [ ] Trích xuất được danh sách file sửa (`files_edited`) và lệnh bash từ `session_message`.
- [ ] Có unit test kiểm thử với database SQLite mẫu trong `tests/test_multi_agent.py`.
