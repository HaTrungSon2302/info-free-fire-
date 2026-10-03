# FF Checker — Vercel + Upstash Redis

Bản này được chuyển từ PHP sang Node.js Serverless để chạy ổn trên Vercel.

## Chức năng

- Trang admin tại `/`
- API check giữ dạng: `/checkauto?UID=12345678&Token=TOKEN`
- Thêm nhiều API key trong admin
- Mỗi key mặc định 500 lượt (có thể đổi limit khi thêm)
- Tự chuyển sang key tiếp theo khi key hiện tại đạt limit hoặc upstream trả lỗi quota/429/403
- Bộ đếm key lưu trên Upstash Redis nên deploy/restart không mất
- Cache UID lưu Redis và có TTL
- Thống kê 7 ngày: API calls, cache hits, UID unique
- `/health` kiểm tra kết nối Redis

## 1. Đưa source lên GitHub

Giải nén thư mục này rồi upload toàn bộ file vào một repository GitHub.

## 2. Tạo project trên Vercel

- Vercel > Add New > Project
- Import repository GitHub
- Framework Preset: Other
- Root Directory: thư mục chứa `package.json`
- Deploy

## 3. Kết nối Redis

Trong project Vercel, mở Marketplace/Storage và tạo hoặc kết nối Upstash Redis.

Project cần có một trong hai cặp biến môi trường:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

hoặc:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Sau khi kết nối Redis, Redeploy project.

## 4. Thêm Environment Variables

Trong Vercel > Project > Settings > Environment Variables thêm:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=mat_khau_admin_rat_manh
SESSION_SECRET=chuoi_bi_mat_dai_ngau_nhien_it_nhat_32_ky_tu
CHECK_TOKEN=token_goi_api_cua_web
FF_API_BASE=https://siambhau69.eu.cc/freefireinfo/bhau
FF_DEFAULT_REGION=BD
FF_CACHE_SECONDS=180
```

Sau đó Redeploy.

> Không commit mật khẩu, token hoặc API key thật vào GitHub public.

## 5. Thêm API key FF

Mở domain Vercel, đăng nhập bằng `ADMIN_USERNAME` và `ADMIN_PASSWORD`, sau đó thêm Key 1, Key 2, Key 3...

Ví dụ mỗi key đặt limit = `500`.

## 6. Test

Health:

```text
https://TEN-DOMAIN.vercel.app/health
```

Check UID:

```text
https://TEN-DOMAIN.vercel.app/checkauto?UID=12345678&Token=TOKEN_CUA_BAN
```

## Auto rotate hoạt động thế nào?

Ví dụ:

- Key 1: 499/500 -> dùng thêm 1 request -> 500/500
- Request tiếp theo tự bỏ qua Key 1
- Key 2 được dùng từ 0/500
- Nếu upstream trả 429/403 hoặc thông báo quota/limit/exhausted, key đó được đánh dấu hết lượt và hệ thống thử key tiếp theo ngay trong request đó.

## Lưu ý

Nút `Reset` chỉ nên dùng khi nhà cung cấp API đã cấp lại quota cho key. Nếu quota của nhà cung cấp là quota vĩnh viễn, reset số trong Redis không làm quota thật quay lại.
