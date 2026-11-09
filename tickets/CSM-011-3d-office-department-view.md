# CSM-011: Chế độ Kép `2D Sơ đồ ↔ 3D Phòng ban` (Isometric 3D Cyber-Office)

- **Status**: `DONE`
- **Priority**: P1 (High)
- **Estimate**: M (~2h)
- **Dependencies**: `CSM-010`
- **Files Touched**:
  - `web/index.html`
  - `web/style.css`
  - `web/app.js`

---

## 1. Bối cảnh & Vấn đề (Context & Problem)
Người vận hành muốn quan sát toàn bộ các nhóm dự án (`Fleet`) như những **Phòng ban 3D sống động (Isometric 3D Cyber-Office)** với bàn làm việc của Quản lý (`Coordinator`) và Nhân viên (`Subagent / Worker`), hiệu ứng nhân vật Agent làm việc theo trạng thái thực tế (`busy` gõ phím, `waiting` còi báo động đỏ, `idle` nghỉ ngơi/uống cà phê), cáp quang phát sáng dưới mặt sàn nối các bàn làm việc, trong khi vẫn giữ khả năng chuyển đổi tức thì về chế độ `2D Sơ đồ` truyền thống.

## 2. Giải pháp Kỹ thuật (Technical Design)
1. **Nút Chuyển đổi Chế độ Xem (`2D Sơ đồ` | `🏢 3D Phòng ban`) trên Top Bar (`web/index.html`, `web/app.js`)**:
   - Thêm cụm `.view-mode-switch` trên `.top-actions` gồm 2 nút `#view-2d` và `#view-3d` (phím tắt `v`), lưu trạng thái vào `localStorage.getItem('csm_view_mode')` (mặc định mở `'3d'` hoặc theo lựa chọn người dùng).
   - Khi ở chế độ `3d`, gắn class `view-3d` lên `#workspace`.
2. **Không gian Phòng ban Isometric 3D (`web/style.css`)**:
   - Mỗi `.fleet` biến thành một **Phòng ban 3D** với sàn kẻ lưới kỹ thuật số (`background-image` grid + viền phát sáng neon nhẹ), hiệu ứng chiều sâu `perspective: 1400px` và mặt sàn nghiêng `rotateX(26deg)` (kèm tuỳ chọn giữ chữ trên bảng Hologram luôn sắc nét hướng về phía người đọc bằng counter-rotation `rotateX(-26deg)`).
   - **Phân khu trong Phòng ban**:
     - Hàng đầu (`tier = 0`): Khu vực Bàn Điều phối / Trưởng phòng (`Coordinator Zone`).
     - Các hàng tiếp theo (`tier >= 1`): Khu vực Bàn Nhân viên / Subagent (`Worker Cubicles`).
     - Hàng công cụ (`tool-row`): Khu vực Tủ Server (`MCP & Skill Server Racks`).
3. **Trạm làm việc 3D (`.workstation-3d`) + Nhân vật Agent + Bảng Hologram HUD (`web/app.js`, `web/style.css`)**:
   - Bổ sung `.desk-stage` bên trong mỗi `.card` (chỉ hiển thị khi bật `view-3d`):
     - **Bàn làm việc Isometric + Cụm màn hình kép**: Màn hình hiển thị các dòng code chuyển động khi `status === 'busy'`, nhấp nháy cảnh báo đỏ khi `waiting`, hoặc chế độ chờ khi `idle`.
     - **Nhân vật Agent 3D SVG/CSS**: Màu sắc theo `provider` (`claude` Cam Hổ Phách, `antigravity` Xanh Ngọc, `opencode` Xanh Lá):
       - `busy`: Hiệu ứng nhấp nhô gõ phím nhanh + tia sáng bàn phím.
       - `waiting`: Đèn còi báo động đỏ xoay trên đỉnh đầu (`🚨`) + vòng sóng xung kích đỏ dưới chân bàn.
       - `idle`: Hiệu ứng thở nhẹ + biểu tượng ly cà phê bốc khói / `zZz`.
       - `exited`: Bàn làm việc hologram mờ nét đứt (`Ghost Workstation`).
     - **Bảng Hologram Lơ lửng (Floating HUD)**: Nổi phía trên bàn làm việc, hiển thị rõ nét Badge công cụ, Tên phiên, Nhánh Git, Thanh Context %, Cảnh báo Đụng độ file, và nút `Nhảy tới pane ↗`.
4. **Cáp quang âm sàn & Hạt dữ liệu (`3D Floor Conduit Wires`)**:
   - Khi ở chế độ `view-3d`, lớp SVG `.wires` nằm áp sát mặt sàn phòng ban, nối từ chân Bàn Điều phối xuống các Bàn Nhân viên với hiệu ứng phát sáng (`drop-shadow`) và các hạt xung dữ liệu chạy dọc theo đường cáp.

## 3. Tiêu chí Nghiệm thu (Acceptance Criteria)
- [ ] Có nút chuyển đổi `🗺 2D` / `🏢 3D Phòng ban` trên Top Bar (và phím tắt `v`), chuyển đổi mượt mà không mất trạng thái đang chọn.
- [ ] Ở chế độ `3D Phòng ban`, mỗi Fleet hiển thị như một tầng văn phòng 3D với bàn làm việc, màn hình, nhân vật Agent theo màu công cụ (`CLAUDE`, `ANTIGRAVITY`, `OPENCODE`) và hiệu ứng động theo trạng thái (`busy`, `waiting`, `idle`, `exited`).
- [ ] Chữ trên bảng Hologram HUD phía trên mỗi bàn làm việc luôn sắc nét, dễ đọc và bấm vào bàn hoặc dây cáp vẫn mở bảng Inspector chi tiết bên phải.
