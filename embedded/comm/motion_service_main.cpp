// 文件功能：配置驱动的运动规划 TCP 服务，注册、心跳、重连与业务处理分离
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <array>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include "comm/motion_config.h"
#include "comm/motion_processor.h"
#include "comm/tcp_client.hpp"
namespace
{
using namespace vis_rl_grasp::comm;
void serve_connection(TcpClient& client, const MotionConfig& config, const motion::RobotModel& model)
{
    MotionProcessor processor(config, model);
    Json registration = Json::object();
    registration["module"] = "motion";
    if (!client.send_line(build_message("register", registration).to_string()))
    {
        client.close();
        return;
    }
    std::atomic<bool> stopping{false};
    std::mutex wait_mutex;
    std::condition_variable wake;
    std::thread heartbeat([&]
    {
        std::unique_lock<std::mutex> lock(wait_mutex);
        while (!wake.wait_for(lock, std::chrono::duration<double>(HEARTBEAT_INTERVAL_SEC),
            [&] { return stopping.load(); }))
        {
            lock.unlock();
            if (!processor.is_registered() || !client.send_line(build_message("heartbeat", Json::object()).to_string()))
            {
                client.close();
                return;
            }
            lock.lock();
        }
    });
    auto cleanup = [&]
    {
        client.close();
        stopping.store(true);
        wake.notify_all();
        heartbeat.join();
    };
    try
    {
        client.run_receive_loop([&](const std::string& line)
        {
            const auto reply = processor.handle_line(line);
            if (reply && !client.send_line(reply->to_string()))
            {
                std::cerr << "[WARN] 业务回复发送失败，重建连接\n";
                client.close();
            }
        });
    }
    catch (...)
    {
        cleanup();
        throw;
    }
    cleanup();
}
}
int main(int argc, char** argv)
{
    try
    {
        std::string config_path = "embedded/config/base.json";
        for (int idx = 1; idx < argc; ++idx)
        {
            const std::string option = argv[idx];
            if (option == "--help")
            {
                std::cout << "motion_control [--config embedded/config/base.json]\n"
                    << "VISRL_ENV=dev/sim；当前输出规划轨迹，不执行机械臂动作。\n";
                return 0;
            }
            if (option != "--config" || idx + 1 >= argc)
            {
                throw std::invalid_argument("未知参数或 --config 缺少路径");
            }
            config_path = argv[++idx];
        }
        const auto config = vis_rl_grasp::comm::MotionConfig::load(config_path);
        const auto model = motion::RobotModel::load(config.model_path);
        // 启动时校验参考关节；避免不断连接后因错误配置异常退出。
        vis_rl_grasp::comm::MotionProcessor validation(config, model);
        constexpr std::array<int, 3> RECONNECT_SECONDS = {1, 3, 5};
        size_t reconnect_stage = 0;
        while (true)
        {
            vis_rl_grasp::comm::TcpClient client(config.server_host, config.server_port);
            if (client.connect())
            {
                std::cout << "[INFO] 已连接 " << config.server_host << ':' << config.server_port
                    << "，模式 plan_only" << std::endl;
                reconnect_stage = 0;
                serve_connection(client, config, model);
            }
            const int interval = RECONNECT_SECONDS[reconnect_stage];
            std::cerr << "[WARN] 连接断开，" << interval << " 秒后重连\n";
            std::this_thread::sleep_for(std::chrono::seconds(interval));
            if (reconnect_stage + 1 < RECONNECT_SECONDS.size())
            {
                ++reconnect_stage;
            }
        }
    }
    catch (const std::exception& error)
    {
        std::cerr << "[ERROR] " << error.what() << '\n';
        return 1;
    }
}
