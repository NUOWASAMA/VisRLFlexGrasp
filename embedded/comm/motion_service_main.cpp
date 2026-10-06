// 文件功能：运动控制服务入口，TCP客户端业务逻辑，接收抓取指令并调用motion运动学模块
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-07-26
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>
#include "comm/tcp_client.hpp"
// 引入运动学模块头文件
#include "motion/ur5_forward_kinematics.h"
#include "motion/ur5_inverse_kinematics.h"
#include "motion/trajectory_planner.h"
#include "motion/kinematics_utils.h"

namespace
{
  // 调度服务地址，正式版本从 config 读取，当前硬编码用于联调测试
  const char *const SERVER_HOST = "127.0.0.1";
  constexpr int SERVER_PORT = 9000;
  // 断线重连递增间隔（秒）
  constexpr int RECONNECT_INTERVALS_SEC[] = {1, 3, 5};
  constexpr int RECONNECT_STAGE_COUNT = 3;

  // 构造注册报文
  std::string build_register_message()
  {
    return R"({"msg_type":"register","source":"motion","target":"backend","code":0,"msg":"success","data":{"module":"motion"},"timestamp":0})";
  }

  // 构造心跳报文
  std::string build_heartbeat_message()
  {
    return R"({"msg_type":"heartbeat","source":"motion","target":"backend","code":0,"msg":"success","data":{},"timestamp":0})";
  }

  // 构造运动状态上报报文
  std::string build_motion_status_message(int code, const std::string &msg)
  {
    return R"({"msg_type":"motion_status","source":"motion","target":"backend","code":)" + std::to_string(code) + R"(,"msg":")" + msg + R"(","data":{},"timestamp":0})";
  }
} // namespace

int main()
{
  using vis_rl_grasp::comm::TcpClient;
  using namespace motion;

  int reconnect_stage = 0;
  while (true)
  {
    TcpClient client(SERVER_HOST, SERVER_PORT);
    if (client.connect())
    {
      std::printf("[INFO] 已连接调度服务 %s:%d\n", SERVER_HOST, SERVER_PORT);
      reconnect_stage = 0;

      // 发送模块注册报文
      if (!client.send_line(build_register_message()))
      {
        std::printf("[WARN] 发送注册报文失败\n");
        client.close();
        continue;
      }

      // 心跳线程：独立线程持续发送心跳包
      std::thread heartbeat_thread([&client]()
                                   {
                while (client.send_line(build_heartbeat_message()))
                {
                    std::this_thread::sleep_for(std::chrono::duration<double>(vis_rl_grasp::comm::HEARTBEAT_INTERVAL_SEC));
                }
                std::printf("[WARN] 心跳发送中断，连接断开\n"); });

      // 接收报文回调函数：收到后端下发的抓取指令
      client.run_receive_loop([&client](const std::string &json_line)
                              {
                std::printf("[INFO] 收到报文：%s\n", json_line.c_str());
                // ====================== (未完成)业务逻辑 ======================
                // 1. 解析JSON，提取目标4×4齐次变换矩阵 T_target
                // 2. 调用 UR5InverseKinematics 求解关节角
                // 3. 调用 TrajectoryPlanner 生成运动轨迹
                // 4. 计算完成，上报状态报文
                // =========================================================
                // 示例：上报状态（测试用）
                client.send_line(build_motion_status_message(0, "receive grasp cmd, ready to solve")); });

      // 等待心跳线程退出
      heartbeat_thread.join();
      client.close();
      std::printf("[INFO] 连接已关闭\n");
    }

    // 断线重连逻辑
    const int interval = RECONNECT_INTERVALS_SEC[reconnect_stage < RECONNECT_STAGE_COUNT ? reconnect_stage : RECONNECT_STAGE_COUNT - 1];
    std::printf("[WARN] 连接断开，%d 秒后尝试重连\n", interval);
    std::this_thread::sleep_for(std::chrono::seconds(interval));
    ++reconnect_stage;
  }
  return 0;
}