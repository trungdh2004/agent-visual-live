# CSM-009: Hợp nhất Đồ thị Fleet, Dây nối Subagent Cha-Con & Đụng độ File Xuyên Công cụ

- **Status**: `DONE`
- **Priority**: P0 (High)
- **Estimate**: M (~2h)
- **Dependencies**: `CSM-007`, `CSM-008`
- **Files Touched**:
  - `src/csm/fleet.py`
  - `src/csm/app.py`
  - `tests/test_multi_agent.py`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Sau khi có dữ liệu từ 3 nguồn (`Claude Code`, `Antigravity`, `OpenCode`), `Fleet` cần gộp chung các phiên làm việc trên cùng một Git repository vào chung một khung dự án, vẽ dây nối phân tầng giữa phiên Cha và Subagent (`parentId`), đồng thời phát hiện đụng độ sửa file (`File Collision`) xuyên qua cả 3 công cụ.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Hợp nhất Nguồn Phiên trong `Fleet.snapshot()` (`src/csm/fleet.py`)**:
   - Thu thập danh sách phiên từ cả 3 nguồn: `registry.load_sessions()` (Claude Code), `antigravity.load_sessions()`, và `opencode.load_sessions()`.
   - Gắn trường `provider` (`"claude"`, `"antigravity"`, `"opencode"`) và `providerLabel` (`"CLAUDE"`, `"ANTIGRAVITY"`, `"OPENCODE"`).
   - Gom nhóm chung theo `project_root(cwd)` để mọi công cụ cùng làm việc trên một repo nằm trong cùng một khung Fleet.
2. **Tạo Dây nối Cha ──▶ Con (`Parent -> Subagent Edges`)**:
   - Với các phiên có `parentId` (`parent_conversation_id` của Antigravity hoặc `parent_id`/`fork_session_id` của OpenCode) mà phiên Cha có mặt trên sơ đồ:
     - Tạo cạnh nối có hướng từ `parentId` sang `session.id`.
     - Đánh dấu phiên Cha là `role = "coordinator"` và phiên Con là `role = "worker"`.
     - Khi truy vấn `GET /api/threads/{a}/{b}`, trả về luồng hội thoại gồm prompt giao việc (`invoke_subagent` / `send_message` hoặc prompt khởi tạo của phiên con) và báo cáo kết quả trả về của phiên con.
3. **Phát hiện Đụng độ File Xuyên Công cụ (`Cross-Agent File Collisions`)**:
   - Chuẩn hóa đường dẫn file trong `filesEdited` (hỗ trợ cả đường dẫn tuyệt đối và tương đối theo `cwd`) trên toàn bộ các phiên đang sống (`exited == False`) của cả 3 công cụ.
   - Gắn cảnh báo `conflicts` kèm tên phiên và nhãn công cụ của đối phương (ví dụ: `master-tool [CLAUDE]`, `Fix UI [ANTIGRAVITY]`).
4. **Thống kê Tổng hợp theo Công cụ (`totals.byProvider`)**:
   - Bổ sung `byProvider: {"claude": n1, "antigravity": n2, "opencode": n3}` vào `totals` trong snapshot để Frontend hiển thị số đếm trên thanh lọc Top Bar.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Các phiên Claude, Antigravity và OpenCode cùng làm việc trên một Git repo được xếp chung vào một khung Fleet.
- [ ] Các Subagent của Antigravity và OpenCode hiển thị ở cột `Subagents / Workers` và có dây nối Bezier có hướng nối từ phiên Cha sang.
- [ ] Bấm vào dây nối giữa phiên Cha và Subagent hiển thị rõ nội dung giao việc và kết quả trả về.
- [ ] Sửa cùng một file trên Claude Code và Antigravity (hoặc OpenCode) kích hoạt ngay cảnh báo đỏ `⚠ Đụng độ file` trên cả hai thẻ.
