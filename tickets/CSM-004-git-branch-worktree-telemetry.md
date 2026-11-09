# CSM-004: Hiển thị nhánh Git hiện tại (`branch`) và trạng thái thay đổi (`dirty`) trên mỗi phiên

- **Status**: `DONE`
- **Priority**: P1 (Medium)
- **Estimate**: S (~1–1.5h)
- **Dependencies**: None
- **Files Touched**:
  - `src/csm/projects.py`
  - `src/csm/fleet.py`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Hiện tại `projects.py` dùng `git rev-parse --show-superproject-working-tree` để gom các phiên vào cùng một Fleet. Tuy nhiên, khi chạy nhiều phiên Claude Code, người dùng thường tạo nhiều nhánh (branch) hoặc `git worktree` khác nhau. Việc chỉ hiển thị đường dẫn `cwd` không cho biết phiên đó đang đứng ở nhánh Git nào hay có thay đổi chưa commit (`dirty`) hay không.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Bổ sung `git_info(cwd: str)` có TTL Cache trong `src/csm/projects.py`**:
   - Vì `Fleet.snapshot()` được gọi mỗi 2 giây, không nên chạy `git status` liên tục mỗi 2 giây cho mọi phiên.
   - Tạo bộ nhớ đệm `_git_cache: dict[str, tuple[float, dict]] = {}` với `GIT_TTL = 10.0` giây:
     - Chạy `git -C <cwd> status --porcelain --branch -uall` (chỉ 1 lệnh `git` duy nhất lấy được cả tên nhánh ở dòng đầu `## branch...` và danh sách các file thay đổi ở các dòng sau, timeout `2s`).
     - Phân tích kết quả trả về:
       ```python
       {
           "branch": branch_name,   # ví dụ: "main", "feat/ui", hoặc commit hash ngắn nếu detached HEAD
           "dirty": changed_count > 0,
           "changedCount": changed_count,
       }
       ```
     - Nếu `cwd` không phải là kho Git, trả về `{"branch": "", "dirty": False, "changedCount": 0}`.
2. **Đính kèm vào `src/csm/fleet.py`**:
   - Thêm trường `"git": projects.git_info(raw.get("cwd") or "")` vào mỗi `card` trong `Fleet.snapshot()`.
3. **Hiển thị trên Card & Inspector (`web/app.js`, `web/style.css`)**:
   - Trên dòng `.card-meta` của `.card`:
     - Nếu `s.git && s.git.branch`, hiển thị pill nhánh `⎇ ${s.git.branch}` (nếu `s.git.dirty` là `true`, thêm chấm/dấu `*` màu vàng `--shell` và tooltip `${s.git.changedCount} file chưa commit`).
   - Trong bảng `Context & Token` của Inspector:
     - Thêm dòng `Nhánh Git`: `${s.git.branch} (${s.git.changedCount} thay đổi)` (hoặc `Sạch`).

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Chỉ tốn tối đa 1 lệnh `git status --porcelain --branch` cho mỗi `cwd` duy nhất sau mỗi 10 giây (nhờ TTL cache).
- [ ] Nếu thư mục `cwd` không phải Git repo hoặc lệnh `git` lỗi/timeout, trả về rỗng an toàn mà không làm chậm luồng SSE.
- [ ] Thẻ Session hiển thị rõ tên nhánh `⎇ <branch>` và chỉ báo `dirty` nếu có file đang sửa dở.
