# 嵌入式第三方依赖

| 依赖 | 固定版本 | 本地目录 | 用途 |
| --- | --- | --- | --- |
| Eigen | 3.4.0 | `eigen3/`，目录内有 `Eigen/Core` | 矩阵、四元数、几何变换 |
| jsoncons | 1.10.0 | `jsoncons/`，目录内有 `include/jsoncons/json.hpp` | JSON 配置及 NDJSON 协议 |

两者均为头文件库。源码缓存被 Git 忽略，不提交生成文件或压缩包。
已有离线源码优先使用，并检查版本；缺失时 CMake 自动按固定 URL 和 SHA256 获取。
下载缓存位于 `cache/`。来源、许可证和校验值保存在各源码目录及
`../cmake/dependencies.cmake`：Eigen 为 MPL-2.0，jsoncons 为 BSL-1.0。

可用 `-DVISRL_EIGEN_SOURCE_DIR=...`、`-DVISRL_JSONCONS_SOURCE_DIR=...` 指定其他离线目录。
完全离线配置可加 `-DFETCHCONTENT_FULLY_DISCONNECTED=ON`；需事先提供依赖。
