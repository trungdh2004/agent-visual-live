# CSM-010: Giao diện Badge Công cụ, Bộ lọc Agent trên Top Bar & Inspector Thích ứng

- **Status**: `DONE`
- **Priority**: P1 (High)
- **Estimate**: M (~2h)
- **Dependencies**: `CSM-009`
- **Files Touched**:
  - `web/index.html`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Khi cả 3 hệ Agent (`Claude Code`, `Antigravity`, `OpenCode`) cùng xuất hiện trong một khung dự án Fleet, người vận hành cần nhận diện tức thì thẻ nào thuộc công cụ nào, lọc nhanh theo công cụ trên thanh Top Bar, và tương tác phù hợp với từng môi trường (nhảy tới `tmux` pane cho CLI, hoặc xem Artifacts & Copy ID cho Antigravity IDE).

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Badge Nhận diện Công cụ trên mỗi Card (`web/app.js`, `web/style.css`)**:
   - Hiển thị `.provider-badge` sắc nét ở góc trên của mỗi `.card`:
     - `CLAUDE`: Màu Cam Hổ Phách (`#FB923C`, viền `rgba(251, 146, 60, 0.35)`, nền `rgba(251, 146, 60, 0.12)`).
     - `ANTIGRAVITY`: Màu Xanh Ngọc / Indigo (`#38BDF8`, viền `rgba(56, 189, 248, 0.35)`, nền `rgba(56, 189, 248, 0.12)`).
     - `OPENCODE`: Màu Xanh Lá Emerald (`#34D399`, viền `rgba(52, 211, 153, 0.35)`, nền `rgba(52, 211, 153, 0.12)`).
2. **Cụm Pill Lọc theo Công cụ trên Top Bar (`web/index.html`, `web/app.js`)**:
   - Bổ sung nhóm `.provider-pills` trên thanh Top Bar:
     - `[Tất cả]` `[Claude N]` `[Antigravity N]` `[OpenCode N]`.
   - Kết hợp điều kiện lọc `activeProviderFilter` với `activeStatusFilter` và ô tìm kiếm `/`.
3. **Inspector Thích ứng theo Công cụ (`Adaptive Inspector` trong `web/app.js`)**:
   - **Nút hành động ở Header**:
     - Nếu `s.hasTmux` (`Boolean(s.tmux)`): Giữ nút `Nhảy tới pane ↗`.
     - Nếu `!s.hasTmux`: Hiển thị nút `📋 Copy ID` (chép nhanh `s.id` vào clipboard và báo `Đã chép ID ✓`).
   - **Tab `Terminal / Artifacts`**:
     - Nếu phiên có `tmux`: Giữ nguyên khung xem trực tiếp `tmux capture-pane`.
     - Nếu phiên là Antigravity IDE (không có `tmux`): Hiển thị danh sách **Artifacts (`s.artifacts`)** kèm đường dẫn và danh sách các lệnh `run_command` gần nhất.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Mỗi thẻ phiên hiển thị rõ Badge `CLAUDE`, `ANTIGRAVITY`, hoặc `OPENCODE` với bảng màu đạt chuẩn tương phản WCAG AA trên nền tối.
- [ ] Các nút lọc Agent trên Top Bar cập nhật đúng số lượng phiên theo thời gian thực và lọc mượt mà khi bấm.
- [ ] Các phiên chạy trong `tmux` vẫn nhảy tới pane và xem Terminal bình thường; các phiên Antigravity IDE hiển thị nút `Copy ID` và danh sách Artifacts trong Inspector.
