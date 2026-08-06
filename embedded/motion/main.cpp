// 文件功能：运动控制服务入口骨架，接入调度服务并回环处理抓取指令（真实运动学与力控逻辑待接入）
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-07-26
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "comm/tcp_client.hpp"

namespace
{

// 调度服务默认地址（正式版本从 embedded/config/ 读取，禁止硬编码入库版本仅作骨架联调用）
const char* const SERVER_HOST = "127.0.0.1";
constexpr int SERVER_PORT = 9000;

// 断线重连递增间隔（秒），与协议规范一致
constexpr int RECONNECT_INTERVALS_SEC[] = {1, 3, 5};
constexpr int RECONNECT_STAGE_COUNT = 3;

// TODO(嵌入式组)：接入 JSON 库（jsoncons）后替换手工拼接，本骨架仅验证通信链路
std::string build_register_message()
{
    return R"({"msg_type":"register","source":"motion","target":"backend",)"
           R"("code":0,"msg":"success","data":{"module":"motion"},"timestamp":0})";
}

std::string build_heartbeat_message()
{
    return R"({"msg_type":"heartbeat","source":"motion","target":"backend",)"
           R"("code":0,"msg":"success","data":{},"timestamp":0})";
}

}  // namespace

int main()
{
    using vis_rl_grasp::comm::TcpClient;
    int reconnect_stage = 0;
    while (true)
    {
        TcpClient client(SERVER_HOST, SERVER_PORT);
        if (client.connect())
        {
            std::printf("[INFO] 已连接调度服务 %s:%d\n", SERVER_HOST, SERVER_PORT);
            reconnect_stage = 0;
            client.send_line(build_register_message());

            // 心跳线程：按统一间隔发送心跳
            std::thread heartbeat_thread([&client]()
            {
                while (client.send_line(build_heartbeat_message()))
                {
                    std::this_thread::sleep_for(
                        std::chrono::seconds(static_cast<int>(vis_rl_grasp::comm::HEARTBEAT_INTERVAL_SEC)));
                }
            });

            client.run_receive_loop([](const std::string& json_line)
            {
                // TODO(嵌入式组)：解析 grasp_command -> 运动学解算 -> 轨迹插补 -> 回报 motion_status
                std::printf("[INFO] 收到报文：%s\n", json_line.c_str());
            });
            client.close();
            heartbeat_thread.join();
        }
        const int interval = RECONNECT_INTERVALS_SEC[
            reconnect_stage < RECONNECT_STAGE_COUNT ? reconnect_stage : RECONNECT_STAGE_COUNT - 1];
        std::printf("[WARN] 连接断开，%d 秒后重连\n", interval);
        std::this_thread::sleep_for(std::chrono::seconds(interval));
        ++reconnect_stage;
    }
    return 0;
}
