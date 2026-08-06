# 文件功能：嵌入式控制层顶层构建配置
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-07-26
cmake_minimum_required(VERSION 3.20)
project(visrl_motion_control LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 运动控制服务可执行程序（骨架阶段：TCP 接入 + 指令解析回环）
add_executable(motion_control
    motion/main.cpp
    comm/tcp_client.cpp
)
target_include_directories(motion_control PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

if(WIN32)
    target_link_libraries(motion_control PRIVATE ws2_32)
endif()

# TODO(嵌入式组)：接入 CoppeliaSim ZMQ Remote API C++ 客户端时，
# 使用 FetchContent 拉取 cppzmq 与 jsoncons 依赖（STYLEGUIDE 2.4）
